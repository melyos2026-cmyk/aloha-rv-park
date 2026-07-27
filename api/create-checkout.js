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
    const { productId, quantity, lotId, customerEmail, parkId } = req.body || {};

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
      .select('label, price, unit')
      .eq('company_id', company.id)
      .eq('product_id', productId)
      .single();

    if (!product) {
      return res.status(400).json({ error: 'Producto inválido' });
    }

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

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,
      line_items: [
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
      ],
      metadata: {
        productId,
        quantity: String(rawQty),
        lotId: lotId || '',
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
