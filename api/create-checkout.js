import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRODUCTS = {
  '20lb': { name: '20 LB Propane Tank', unitAmount: 1800, unit: 'tank', maxQty: 20 },
  '30lb': { name: '30 LB Propane Tank', unitAmount: 3000, unit: 'tank', maxQty: 20 },
  '40lb': { name: '40 LB Propane Tank', unitAmount: 3600, unit: 'tank', maxQty: 20 },
  forklift: { name: 'Forklift Propane Tank', unitAmount: 3600, unit: 'tank', maxQty: 20 },
  motorhome: { name: 'Motor Home 40LB Tank Fill', unitAmount: 425, unit: 'gallon', maxQty: 200 },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { productId, quantity, lotId, customerEmail } = req.body || {};

    const product = PRODUCTS[productId];
    if (!product) {
      return res.status(400).json({ error: 'Producto inválido' });
    }

    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty < 1) {
      return res.status(400).json({ error: 'Cantidad inválida' });
    }
    if (qty > product.maxQty) {
      return res.status(400).json({ error: `Cantidad máxima: ${product.maxQty}` });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: product.name,
              description: product.unit === 'gallon' ? `${qty} galones × $4.25` : `Cantidad: ${qty}`,
            },
            unit_amount: product.unitAmount,
          },
          quantity: qty,
        },
      ],
      metadata: {
        productId,
        quantity: String(qty),
        lotId: lotId || '',
        park: 'aloha-rv-park',
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
