import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const INTERVAL_MAP = { daily: 'day', monthly: 'month', yearly: 'year' };
const LABEL_MAP = { daily: 'Daily', monthly: 'Monthly', yearly: 'Yearly' };
const UNIT_LABEL = { daily: 'day(s)', monthly: 'month(s)', yearly: 'year(s)' };
const PARK_ID = 'aloha';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lotId, billingType, quantity, isSubscription, customerEmail } = req.body || {};

    if (!lotId) {
      return res.status(400).json({ error: 'Missing lot ID' });
    }
    if (!['daily', 'monthly', 'yearly'].includes(billingType)) {
      return res.status(400).json({ error: 'Invalid billing type' });
    }

    const qty = parseFloat(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }

    const { data: lotInfo, error: lotError } = await supabase
      .from('lot_info')
      .select('*')
      .eq('park_id', PARK_ID)
      .eq('lot_key', lotId)
      .single();

    if (lotError || !lotInfo) {
      return res.status(404).json({ error: 'Lot information not found' });
    }

    if (lotInfo.phone_only) {
      return res.status(403).json({
        error: 'This lot is a limited storage space — please call the office to book it.',
      });
    }

    const rateField =
      billingType === 'daily' ? 'price_daily' :
      billingType === 'monthly' ? 'price_monthly' : 'price_yearly';
    const rate = lotInfo[rateField];

    if (!rate || rate <= 0) {
      return res.status(400).json({ error: 'This option is not available right now' });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const unitAmount = Math.round(rate * 100);

    const lotDescription = [
      lotInfo.lot_type === 'indoor' ? 'Indoor' : 'Outdoor',
      lotInfo.size || null,
      lotInfo.has_electricity ? `${lotInfo.amperage} Amp electricity` : null,
    ].filter(Boolean).join(' · ');

    let session;

    if (isSubscription) {
      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: customerEmail || undefined,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `RV Storage — Lot ${lotId} (${LABEL_MAP[billingType]})`,
              description: lotDescription,
            },
            unit_amount: unitAmount,
            recurring: { interval: INTERVAL_MAP[billingType] },
          },
          quantity: 1,
        }],
        metadata: {
          lotId,
          billingType,
          quantity: '1',
          isSubscription: 'true',
          park: 'aloha-rv-park',
          service: 'rv_storage',
        },
        success_url: `${origin}/?storage_payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?storage_payment=cancelled`,
      });
    } else {
      const lineItemAmount = Math.round(unitAmount * qty);
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: customerEmail || undefined,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `RV Storage — Lot ${lotId} (${LABEL_MAP[billingType]})`,
              description: `${lotDescription} · ${qty} ${UNIT_LABEL[billingType]} × $${rate}`,
            },
            unit_amount: lineItemAmount,
          },
          quantity: 1,
        }],
        metadata: {
          lotId,
          billingType,
          quantity: String(qty),
          isSubscription: 'false',
          park: 'aloha-rv-park',
          service: 'rv_storage',
        },
        success_url: `${origin}/?storage_payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?storage_payment=cancelled`,
      });
    }

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    console.error('Stripe storage checkout error:', err);
    return res.status(500).json({ error: 'Could not create payment session' });
  }
}
