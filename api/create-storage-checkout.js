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
// Oct 22 (per Mely): the park comes from the request (the map's ?park_id=), so a storage
// space on another park's map is never booked or paid to Aloha. Old links default to Aloha.
const parkFrom = (body) => String((body && body.parkId) || 'aloha').replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || 'aloha';

// Aug 6 (per Mely): same processing-fee model as every other charge in the
// system — 4% of the charge, or a $1.50 fixed minimum, whichever is
// greater (guarantees real margin even on small/short bookings).
function calculateProcessingFee(amount) {
  return Math.max(amount * 0.04, 1.5);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lotId, billingType, quantity, isSubscription, customerEmail } = req.body || {};
    const PARK_ID = parkFrom(req.body);

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

    // Aug 6 (per Mely): fetch the park's Connect account (same lookup used
    // by lot/propane checkout) so storage payments split the same way —
    // Aloha gets the real charge, MelyOS keeps only the processing fee.
    const { data: companyRow } = await supabase
      .from('companies')
      .select('id, is_demo, domain')
      .eq('park_id', PARK_ID)
      .maybeSingle();
    const { data: parkSettingsRow } = await supabase
      .from('park_settings')
      .select('stripe_connect_account_id, stripe_connect_onboarded')
      .eq('company_id', companyRow?.id)
      .maybeSingle();
    const canSplit = parkSettingsRow?.stripe_connect_account_id && parkSettingsRow?.stripe_connect_onboarded;

    const lotDescription = [
      lotInfo.lot_type === 'indoor' ? 'Indoor' : 'Outdoor',
      lotInfo.size || null,
      lotInfo.has_electricity ? `${lotInfo.amperage} Amp electricity` : null,
    ].filter(Boolean).join(' · ');

    let session;

    // Oct 21 (per Mely — demo.melyos.io is public): demo companies never take a real card payment.
    if (companyRow && (companyRow.is_demo === true || /(^|\.)melyos\.io$/i.test(String(companyRow.domain || '')))) {
      return res.status(403).json({ error: 'This is a demo website — online payments are turned off. No card was charged.' });
    }

    if (isSubscription) {
      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        // Oct 13 (per Mely): policy shown on Stripe's pay button before the customer pays.
        custom_text: { submit: { message: 'Cancellations: the card processing fee is not refunded. A $15 fee applies to any payment dispute or chargeback.' } },
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
        // Aug 6: recurring Connect split uses a percent (Stripe doesn't
        // support a fixed application_fee_amount on subscriptions) — 4%
        // approximates the same-everywhere-else model; the $1.50 floor
        // only really matters for small one-time charges, not recurring
        // storage rent.
        ...(canSplit
          ? {
              subscription_data: {
                application_fee_percent: 4,
                transfer_data: { destination: parkSettingsRow.stripe_connect_account_id },
              },
            }
          : {}),
        metadata: {
          lotId,
          billingType,
          quantity: '1',
          isSubscription: 'true',
          park: 'aloha-rv-park',
          park_id: PARK_ID,
          service: 'rv_storage',
        },
        success_url: `${origin}/?park_id=${PARK_ID}&storage_payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?park_id=${PARK_ID}&storage_payment=cancelled`,
      });
    } else {
      const lineItemAmount = Math.round(unitAmount * qty);
      const processingFeeCents = Math.round(calculateProcessingFee(lineItemAmount / 100) * 100);
      const totalChargeCents = lineItemAmount + processingFeeCents;
      // MelyOS's cut is only the processing fee; Aloha gets the full
      // storage charge — same split model as every other checkout.
      const melyOsShareCents = canSplit ? processingFeeCents : 0;

      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        // Oct 13 (per Mely): policy shown on Stripe's pay button before the customer pays.
        custom_text: { submit: { message: 'Cancellations: the card processing fee is not refunded. A $15 fee applies to any payment dispute or chargeback.' } },
        customer_email: customerEmail || undefined,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `RV Storage — Lot ${lotId} (${LABEL_MAP[billingType]})`,
                description: `${lotDescription} · ${qty} ${UNIT_LABEL[billingType]} × $${rate}`,
              },
              unit_amount: lineItemAmount,
            },
            quantity: 1,
          },
          {
            price_data: {
              currency: 'usd',
              product_data: { name: 'Card Processing Fee' },
              unit_amount: processingFeeCents,
            },
            quantity: 1,
          },
        ],
        ...(canSplit
          ? {
              payment_intent_data: {
                application_fee_amount: melyOsShareCents,
                transfer_data: { destination: parkSettingsRow.stripe_connect_account_id },
              },
            }
          : {}),
        metadata: {
          lotId,
          billingType,
          quantity: String(qty),
          isSubscription: 'false',
          park: 'aloha-rv-park',
          park_id: PARK_ID,
          service: 'rv_storage',
        },
        success_url: `${origin}/?park_id=${PARK_ID}&storage_payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?park_id=${PARK_ID}&storage_payment=cancelled`,
      });
    }

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    console.error('Stripe storage checkout error:', err);
    return res.status(500).json({ error: 'Could not create payment session' });
  }
}
