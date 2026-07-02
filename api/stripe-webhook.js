import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: false,
  },
};

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const PRODUCT_LABELS = {
  '20lb': '20 LB Tank',
  '30lb': '30 LB Tank',
  '40lb': '40 LB Tank',
  forklift: 'Forklift',
  motorhome: 'Motor Home 40LB Tank',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method not allowed');
  }

  let event;

  try {
    const rawBody = await buffer(req);
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { productId, quantity, lotId, park } = session.metadata || {};

    try {
      const { error } = await supabase.from('propane_orders').upsert(
        {
          park_id: park || 'aloha',
          lot_id: lotId || null,
          product_id: productId,
          product_label: PRODUCT_LABELS[productId] || productId,
          quantity: parseFloat(quantity),
          unit: productId === 'motorhome' ? 'gallon' : 'tank',
          amount_total: (session.amount_total || 0) / 100,
          currency: session.currency || 'usd',
          customer_email: session.customer_details?.email || null,
          stripe_session_id: session.id,
          stripe_payment_intent: session.payment_intent || null,
          status: 'paid',
          paid_at: new Date().toISOString(),
        },
        { onConflict: 'stripe_session_id' }
      );

      if (error) {
        console.error('Supabase insert error:', error);
      }
    } catch (err) {
      console.error('Error saving propane order:', err);
    }
  }

  return res.status(200).json({ received: true });
}
