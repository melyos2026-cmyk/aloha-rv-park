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

async function updateLotStatus(lotId, newStatus) {
  const { data: statusRow } = await supabase
    .from('map_elements')
    .select('data')
    .eq('park_id', 'aloha')
    .eq('element_type', 'statuses')
    .eq('element_key', 'all')
    .single();

  const currentStatuses = statusRow?.data || {};
  currentStatuses[lotId] = newStatus;

  const { error: statusError } = await supabase
    .from('map_elements')
    .upsert(
      { park_id: 'aloha', element_type: 'statuses', element_key: 'all', data: currentStatuses },
      { onConflict: 'park_id,element_type,element_key' }
    );

  if (statusError) {
    console.error('Error updating lot status:', statusError);
  }
}

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
    const { service } = session.metadata || {};

    if (service === 'rv_lot') {
      const { lotId, arrivalDate, departureDate, months, weeks, extraDays, isYearly } = session.metadata || {};

      try {
        const { error } = await supabase.from('lot_orders').upsert(
          {
            lot_id: lotId,
            customer_email: session.customer_details?.email || null,
            customer_name: session.customer_details?.name || null,
            billing_type: isYearly === 'true' ? 'yearly' : 'monthly_daily',
            quantity: null,
            months: parseInt(months, 10) || 0,
            weeks: parseInt(weeks, 10) || 0,
            extra_days: parseInt(extraDays, 10) || 0,
            amount_total: (session.amount_total || 0) / 100,
            is_subscription: false,
            stripe_session_id: session.id,
            stripe_payment_intent: session.payment_intent || null,
            status: 'paid',
            arrival_date: arrivalDate || null,
            departure_date: departureDate || null,
          },
          { onConflict: 'stripe_session_id' }
        );

        if (error) {
          console.error('Supabase lot order insert error:', error);
        }

        // Long-term stays (monthly/yearly) become residents (occupied/red).
        // Short-term stays (weekly/daily only) are just reserved (orange).
        const isLongTerm = isYearly === 'true' || parseInt(months, 10) > 0;
        if (lotId) {
          await updateLotStatus(lotId, isLongTerm ? 'occupied' : 'reserved');
        }
      } catch (err) {
        console.error('Error saving lot order:', err);
      }
    } else if (service === 'rv_storage') {
      const { billingType, quantity, isSubscription, lotId } = session.metadata || {};

      try {
        const { error } = await supabase.from('storage_orders').upsert(
          {
            customer_email: session.customer_details?.email || null,
            customer_name: session.customer_details?.name || null,
            billing_type: billingType,
            lot_id: lotId || null,
            quantity: parseFloat(quantity),
            amount_total: (session.amount_total || 0) / 100,
            is_subscription: isSubscription === 'true',
            stripe_session_id: session.id,
            stripe_subscription_id: session.subscription || null,
            status: 'paid',
          },
          { onConflict: 'stripe_session_id' }
        );

        if (error) {
          console.error('Supabase storage order insert error:', error);
        }

        if (lotId) {
          await updateLotStatus(lotId, 'reserved');
        }

        // Try to link this storage payment to a resident and create/update
        // a recurring charge so it auto-appears on future monthly invoices.
        const customerEmail = session.customer_details?.email || null;
        if (customerEmail && isSubscription === 'true') {
          const { data: resident } = await supabase
            .from('resident_accounts')
            .select('id, company_id')
            .eq('email', customerEmail)
            .maybeSingle();

          if (resident) {
            const monthlyAmount =
              billingType === 'monthly'
                ? (session.amount_total || 0) / 100
                : billingType === 'yearly'
                ? (session.amount_total || 0) / 100 / 12
                : (session.amount_total || 0) / 100 * 30;

            const { data: existingCharge } = await supabase
              .from('recurring_charges')
              .select('id, storage_spaces')
              .eq('resident_id', resident.id)
              .eq('charge_type', 'Storage Rental')
              .eq('source', 'stripe_storage')
              .maybeSingle();

            const spaces = existingCharge?.storage_spaces || [];
            const updatedSpaces = lotId && !spaces.includes(lotId)
              ? [...spaces, lotId]
              : spaces;

            if (existingCharge) {
              await supabase
                .from('recurring_charges')
                .update({
                  amount: monthlyAmount,
                  storage_spaces: updatedSpaces,
                  active: true,
                })
                .eq('id', existingCharge.id);
            } else {
              await supabase.from('recurring_charges').insert({
                company_id: resident.company_id,
                resident_id: resident.id,
                charge_type: 'Storage Rental',
                description: `Storage Rental (${lotId})`,
                amount: monthlyAmount,
                storage_spaces: lotId ? [lotId] : [],
                active: true,
                source: 'stripe_storage',
              });
            }
          }
        }
      } catch (err) {
        console.error('Error saving storage order:', err);
      }
    } else {
      // Flujo original de propano
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
  }

  // Manejo de pagos recurrentes de suscripciones (después del primer mes)
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    const subscriptionId = invoice.subscription;

    if (subscriptionId && invoice.billing_reason === 'subscription_cycle') {
      try {
        const { error } = await supabase.from('storage_orders').insert({
          customer_email: invoice.customer_email || null,
          billing_type: 'monthly',
          quantity: 1,
          amount_total: (invoice.amount_paid || 0) / 100,
          is_subscription: true,
          stripe_subscription_id: subscriptionId,
          status: 'paid',
        });

        if (error) {
          console.error('Supabase recurring order insert error:', error);
        }
      } catch (err) {
        console.error('Error saving recurring storage order:', err);
      }
    }
  }

  return res.status(200).json({ received: true });
}
