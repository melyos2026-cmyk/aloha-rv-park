import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_QTY = { '20lb': 20, '30lb': 20, '40lb': 20, forklift: 20, motorhome: 200 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { productId, quantity, lotId, customerEmail, parkId, residentLot } = req.body || {};

    if (!customerEmail && !residentLot) {
      return res.status(400).json({ error: 'Please provide an email address, or your lot number if you are a resident.' });
    }

    const { data: company } = await supabase
      .from('companies')
      .select('id')
      .eq('park_id', parkId || 'aloha')
      .single();

    if (!company) {
      return res.status(404).json({ error: 'Park not found' });
    }

    const { data: product } = await supabase
      .from('propane_pricing')
      .select('label, price, unit, taxable, tax_mode')
      .eq('company_id', company.id)
      .eq('product_id', productId)
      .single();

    if (!product) {
      return res.status(400).json({ error: 'Producto inválido' });
    }

    const { data: taxSettings } = await supabase
      .from('company_tax_settings')
      .select('enable_tax, manual_tax_rate_percent')
      .eq('company_id', company.id)
      .maybeSingle();

    const isGallon = product.unit === 'gallon';
    const rawQty = isGallon ? parseFloat(quantity) : parseInt(quantity, 10);
    const maxQty = MAX_QTY[productId] || 20;

    if (!Number.isFinite(rawQty) || rawQty <= 0) {
      return res.status(400).json({ error: 'Cantidad inválida' });
    }
    if (rawQty > maxQty) {
      return res.status(400).json({ error: `Cantidad máxima: ${maxQty}` });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const unitAmount = Math.round(Number(product.price) * 100);

    // Stripe no acepta cantidades con decimales, así que para productos por galón
    // calculamos el precio total exacto y usamos quantity: 1
    const lineItemAmount = isGallon ? Math.round(unitAmount * rawQty) : unitAmount;
    const lineItemQty = isGallon ? 1 : rawQty;

    // 4% card processing fee — a separate charge, not a tax, added on top
    // of the propane subtotal (Mely: no hay tax en el propano, pero sí un
    // cargo por procesar la tarjeta).
    const subtotalCents = lineItemAmount * lineItemQty;
    const processingFeeCents = Math.round(subtotalCents * 0.04);

    // Sales tax — per-company rate (works for any state, not hardcoded).
    // tax_mode overrides the product's default "taxable" rule when set:
    // "excluded" forces tax to be added on top, "included" means the listed
    // price already has tax baked in (no separate line), blank/null falls
    // back to the taxable checkbox.
    const effectiveTaxApplies =
      product.tax_mode === 'excluded'
        ? true
        : product.tax_mode === 'included'
        ? false
        : !!product.taxable;
    const taxEnabled = !!taxSettings?.enable_tax && effectiveTaxApplies;
    const taxRatePercent = Number(taxSettings?.manual_tax_rate_percent || 0);
    const taxCents = taxEnabled ? Math.round(subtotalCents * (taxRatePercent / 100)) : 0;

    const line_items = [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: product.label,
            description: isGallon ? `${rawQty} gallons × $${product.price}` : `Quantity: ${rawQty}`,
          },
          unit_amount: lineItemAmount,
        },
        quantity: lineItemQty,
      },
    ];

    if (taxCents > 0) {
      line_items.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `Sales Tax (${taxRatePercent}%)` },
          unit_amount: taxCents,
        },
        quantity: 1,
      });
    }

    line_items.push({
      price_data: {
        currency: 'usd',
        product_data: { name: 'Card Processing Fee (4%)' },
        unit_amount: processingFeeCents,
      },
      quantity: 1,
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,
      line_items,
      metadata: {
        productId,
        quantity: String(rawQty),
        lotId: lotId || '',
        residentLot: residentLot || '',
        park: parkId || 'aloha',
      },
      success_url: `${origin}/?propane_payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?propane_payment=cancelled`,
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: 'No se pudo crear la sesión de pago' });
  }
}
