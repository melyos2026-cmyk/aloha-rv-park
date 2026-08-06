import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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

async function updateLotStatus(lotId, newStatus, parkId = 'aloha') {
  const { data: company, error: companyErr } = await supabase
    .from('companies')
    .select('id')
    .eq('park_id', parkId)
    .single();

  if (companyErr || !company) {
    console.error('Error resolving company for park_id', parkId, companyErr);
    return;
  }

  const { error: statusError } = await supabase
    .from('rv_lots')
    .update({ status: newStatus })
    .eq('company_id', company.id)
    .eq('lot_name', lotId);

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

        // Safety net against a race condition: the availability check only
        // runs once, when the checkout session is first created — if two
        // people start checkout for overlapping dates on the same lot
        // within that window, both could complete payment. This re-checks
        // right after payment confirms and flags it for the admin instead
        // of silently letting a double-booking go unnoticed.
        if (lotId && arrivalDate && departureDate && !error) {
          try {
            const { data: otherOrders } = await supabase
              .from('lot_orders')
              .select('id, arrival_date, departure_date, customer_name, customer_email')
              .eq('lot_id', lotId)
              .eq('status', 'paid')
              .neq('stripe_session_id', session.id);

            const newArrival = new Date(arrivalDate + 'T00:00:00');
            const newDeparture = new Date(departureDate + 'T00:00:00');
            const conflicting = (otherOrders || []).filter((o) => {
              if (!o.arrival_date || !o.departure_date) return false;
              const oStart = new Date(o.arrival_date + 'T00:00:00');
              const oEnd = new Date(o.departure_date + 'T00:00:00');
              return newArrival < oEnd && newDeparture > oStart;
            });

            if (conflicting.length > 0) {
              console.error(
                `DOUBLE-BOOKING DETECTED on lot ${lotId}: session ${session.id} overlaps with`,
                conflicting.map((o) => o.id)
              );

              await supabase
                .from('lot_orders')
                .update({ has_conflict: true })
                .eq('stripe_session_id', session.id);

              const conflictIds = conflicting.map((o) => o.id);
              await supabase
                .from('lot_orders')
                .update({ has_conflict: true })
                .in('id', conflictIds);

              const { data: company } = await supabase
                .from('companies')
                .select('id')
                .eq('park_id', 'aloha')
                .single();

              if (company) {
                await supabase.from('resident_update_notifications').insert({
                  company_id: company.id,
                  resident_name: null,
                  update_type: 'double_booking_alert',
                  message: `⚠️ Possible double-booking on Lot ${lotId}: two paid reservations overlap for ${arrivalDate} to ${departureDate}. Review and contact both customers.`,
                });
              }
            }
          } catch (conflictCheckErr) {
            console.error('Error running double-booking safety check:', conflictCheckErr);
          }
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
      //
      // ⚠️ propane_orders holds real Stripe transactions and each row's
      // qr_token is the customer's ONLY way to redeem their tank(s) — there
      // is no recovery path if a row is deleted. NEVER run an unconditional
      // `DELETE FROM propane_orders` during a "clear test data" cleanup
      // without a WHERE clause protecting real/recent purchases — this
      // already happened once and wiped 2 real customer orders along with
      // test data. If bulk-clearing test data, filter by a specific test
      // email/date range instead.
      const { productId, quantity, lotId, park, residentLot } = session.metadata || {};

      try {
        const qrToken = crypto.randomBytes(16).toString('hex');
        const customerEmail = session.customer_details?.email || null;
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
            customer_email: customerEmail,
            stripe_session_id: session.id,
            stripe_payment_intent: session.payment_intent || null,
            status: 'paid',
            paid_at: new Date().toISOString(),
            qr_token: qrToken,
            redeemed: false,
            resident_lot_name: residentLot || null,
          },
          { onConflict: 'stripe_session_id' }
        );

        if (error) {
          console.error('Supabase insert error:', error);
        } else {
          const { data: company } = await supabase
            .from('companies')
            .select('id')
            .eq('park_id', park || 'aloha')
            .single();

          if (company) {
            await supabase.from('resident_update_notifications').insert({
              company_id: company.id,
              resident_name: customerEmail || null,
              update_type: 'propane_payment',
              message: `Propane payment received: ${quantity} ${productId === 'motorhome' ? 'gal' : '×'} ${PRODUCT_LABELS[productId] || productId} — $${((session.amount_total || 0) / 100).toFixed(2)}.`,
            });
          }
        }

        if (!error && customerEmail && process.env.RESEND_API_KEY) {
          try {
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrToken)}`;
            const label = PRODUCT_LABELS[productId] || productId;
            const amount = ((session.amount_total || 0) / 100).toFixed(2);

            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'Aloha RV Park <noreply@aloharvparkfl.com>',
                to: customerEmail,
                subject: 'Your Propane Pickup QR Code',
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 420px; margin: 0 auto;">
                    <h2>⛽ Payment Confirmed</h2>
                    <p>${quantity} ${productId === 'motorhome' ? 'gallons' : '×'} ${label} — $${amount}</p>
                    <img src="${qrImageUrl}" alt="Propane pickup QR code" style="display:block;margin:16px 0;" />
                    <p style="font-size:13px;color:#555;">${
                      productId === 'motorhome'
                        ? 'Show this code to staff for your fill-up. It can only be used once.'
                        : `Show this code to staff each time you pick up a tank — this code works once per tank purchased (${quantity} total, multiple visits OK).`
                    } No refunds — unpicked-up tanks are not refundable.</p>
                  </div>
                `,
              }),
            });
          } catch (emailErr) {
            console.error('Failed to send propane QR email:', emailErr);
          }
        }
      } catch (err) {
        console.error('Error saving propane order:', err);
      }
    }
  }

  // Aug 6 (per Mely, real gap found): the webhook was already subscribed to
  // charge.refunded but had NO handler for it — a refunded propane or lot
  // order stayed marked 'paid' forever, so Payments & Taxes kept counting
  // refunded money as real revenue. Matches the refund back to its order
  // via stripe_payment_intent (both lot_orders and propane_orders store
  // this on the original checkout).
  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    const paymentIntentId = charge.payment_intent;

    if (paymentIntentId) {
      try {
        const { error: lotErr } = await supabase
          .from('lot_orders')
          .update({ status: 'refunded' })
          .eq('stripe_payment_intent', paymentIntentId);
        if (lotErr) console.error('Error marking lot_orders refunded:', lotErr);

        const { error: propaneErr } = await supabase
          .from('propane_orders')
          .update({ status: 'refunded' })
          .eq('stripe_payment_intent', paymentIntentId);
        if (propaneErr) console.error('Error marking propane_orders refunded:', propaneErr);
      } catch (err) {
        console.error('Error handling charge.refunded:', err);
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
