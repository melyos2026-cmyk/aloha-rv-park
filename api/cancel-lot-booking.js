import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

import crypto from 'crypto';

// Oct 20 (security review): PARK_ID was hardcoded to 'aloha' here, so a
// cancellation for any other park would read Aloha's cancellation window
// and rewrite Aloha's lot-status map. Every park-scoped step below now
// uses the order's own park_id (falls back to 'aloha' only for legacy
// rows with no park_id, matching stripe-webhook.js).
const DEFAULT_PARK_ID = 'aloha';

// Oct 20 (per Mely): the refund is the total paid minus the Card Processing
// Fee (MelyOS keeps it — Stripe doesn't return its own cost). There is NO
// administrative fee on refunds; the only $15 fee is for card disputes
// (chargebacks), which is handled separately.

// Total paid and the processing fee line, read from the booking's own
// Stripe checkout. Used for the e-mail preview and for the refund itself.
async function refundBreakdown(order) {
  const pi = order.stripe_payment_intent;
  if (!pi) return null;
  const intent = await stripe.paymentIntents.retrieve(pi, { expand: ['latest_charge'] });
  const charge = intent.latest_charge;
  if (!charge || typeof charge === 'string' || !charge.paid) return { error: 'This payment could not be found. Please contact the park office.' };
  if (charge.refunded || charge.amount_refunded > 0) return { error: 'This booking has already been refunded.' };
  let feeCents = 0;
  const sessionId = order.stripe_session_id
    || (await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 })).data[0]?.id;
  if (sessionId) {
    const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100 });
    for (const it of items.data) {
      if (/processing fee/i.test(it.description || '')) feeCents += it.amount_total || 0;
    }
  }
  const totalCents = charge.amount;
  return { totalCents, feeCents: Math.min(feeCents, totalCents), refundCents: totalCents - Math.min(feeCents, totalCents) };
}
const money = (c) => '$' + (c / 100).toFixed(2);

// Oct 20 (security review): cancelling used to need only the order id +
// the guest's email, and /api/lot-data?type=my-bookings hands out order
// ids to anyone who types an email — so anyone who knew a guest's email
// could cancel (and refund) their booking. A cancellation now also needs
// a one-time code e-mailed to the address on the booking. The code is a
// stateless HMAC (no new table): valid for the current + previous
// 15-minute window, 8 digits, bound to this order + its payment intent.
const CODE_WINDOW_MS = 15 * 60 * 1000;
function cancelCodeFor(order, windowIndex) {
  const secret = process.env.BOOKING_CANCEL_SECRET || process.env.MAP_EDIT_SECRET;
  if (!secret) return null;
  const h = crypto
    .createHmac('sha256', secret)
    .update(`cancel-lot-booking|${order.id}|${order.customer_email}|${order.stripe_payment_intent || ''}|${windowIndex}`)
    .digest();
  return String(h.readUInt32BE(0) % 100000000).padStart(8, '0');
}
function verifyCancelCode(order, code) {
  const clean = String(code || '').replace(/\D/g, '');
  if (clean.length !== 8) return false;
  const w = Math.floor(Date.now() / CODE_WINDOW_MS);
  for (const idx of [w, w - 1]) {
    const expected = cancelCodeFor(order, idx);
    if (expected && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true;
  }
  return false;
}

async function recomputeLotStatus(lotId, PARK_ID) {
  const todayStr = new Date().toISOString().split('T')[0];

  const { data: activeOrders } = await supabase
    .from('lot_orders')
    .select('arrival_date, departure_date, months')
    .eq('lot_id', lotId)
    .eq('park_id', PARK_ID) // Oct 20 (security review): same lot name can exist in another park
    .eq('status', 'paid')
    .lte('arrival_date', todayStr)
    .gt('departure_date', todayStr);

  let newStatus = 'available';
  if (activeOrders && activeOrders.length > 0) {
    const isLongTerm = activeOrders.some((o) => (o.months || 0) > 0);
    newStatus = isLongTerm ? 'occupied' : 'reserved';
  }

  const { data: statusRow } = await supabase
    .from('map_elements')
    .select('data')
    .eq('park_id', PARK_ID)
    .eq('element_type', 'statuses')
    .eq('element_key', 'all')
    .single();

  const currentStatuses = statusRow?.data || {};
  currentStatuses[lotId] = newStatus;

  await supabase
    .from('map_elements')
    .upsert(
      { park_id: PARK_ID, element_type: 'statuses', element_key: 'all', data: currentStatuses },
      { onConflict: 'park_id,element_type,element_key' }
    );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { orderId, email, code } = req.body || {};
    if (!orderId || !email) {
      return res.status(400).json({ error: 'Missing order ID or email' });
    }

    const { data: order, error: orderError } = await supabase
      .from('lot_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (order.customer_email !== email) {
      return res.status(403).json({ error: 'Email does not match this booking' });
    }

    if (order.status !== 'paid') {
      return res.status(400).json({ error: 'This booking is not eligible for cancellation' });
    }

    const PARK_ID = order.park_id || DEFAULT_PARK_ID;

    // Scoped to THIS park's own company_id — was previously hardcoded to
    // id=1, which would silently read another park's settings once a 2nd
    // company exists on the platform.
    const { data: companyRow } = await supabase
      .from('companies')
      .select('id')
      .eq('park_id', PARK_ID)
      .maybeSingle();
    const { data: settings } = await supabase
      .from('park_settings')
      .select('cancellation_days')
      .eq('company_id', companyRow?.id)
      .maybeSingle();

    const cancellationDays = settings?.cancellation_days ?? 7;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const arrival = new Date(order.arrival_date + 'T00:00:00');
    const daysUntilArrival = Math.round((arrival - today) / 86400000);

    if (daysUntilArrival < cancellationDays) {
      return res.status(400).json({
        error: `Cancellations must be made at least ${cancellationDays} day(s) before arrival. This booking is not eligible for a refund.`,
      });
    }

    // Oct 20 (security review): step 1 of 2 — no code yet → e-mail one to
    // the address on the booking and stop. Nothing is refunded here.
    if (!code) {
      const sendCode = cancelCodeFor(order, Math.floor(Date.now() / CODE_WINDOW_MS));
      if (!sendCode || !process.env.RESEND_API_KEY) {
        console.error('cancel-lot-booking: BOOKING_CANCEL_SECRET/MAP_EDIT_SECRET or RESEND_API_KEY missing');
        return res.status(503).json({ error: 'Online cancellation is temporarily unavailable. Please contact the park office.' });
      }
      const { data: parkCompany } = await supabase.from('companies').select('company_name').eq('park_id', PARK_ID).maybeSingle();
      const parkName = parkCompany?.company_name || 'RV Park';
      const esc = (v) => String(v ?? '').replace(/[<>&"]/g, '');
      let breakdown = null;
      try { breakdown = await refundBreakdown(order); } catch (e) { console.error('cancel-lot-booking: breakdown', e); }
      if (breakdown?.error) return res.status(400).json({ error: breakdown.error });
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${String(parkName).replace(/[<>"]/g, '')} <noreply@aloharvparkfl.com>`,
          to: order.customer_email,
          subject: 'Your reservation cancellation code',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 460px; margin: 0 auto; color:#111;">
              <h2 style="margin-bottom:4px;">${esc(parkName)}</h2>
              <p>We received a request to cancel your reservation for <strong>Lot ${esc(order.lot_id)}</strong> (${esc(order.arrival_date)} to ${esc(order.departure_date)}).</p>
              <p>To confirm, enter this code:</p>
              <p style="font-size:30px;font-weight:bold;letter-spacing:4px;margin:8px 0 16px;">${sendCode}</p>
              ${breakdown && !breakdown.error ? `
              <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:12px;">
                <tr><td style="padding:4px 0;">Total paid</td><td style="text-align:right;">${money(breakdown.totalCents)}</td></tr>
                <tr><td style="padding:4px 0;">Card processing fee (not refundable)</td><td style="text-align:right;">− ${money(breakdown.feeCents)}</td></tr>
                <tr><td style="padding:6px 0;border-top:1px solid #ddd;"><strong>You will receive</strong></td><td style="text-align:right;border-top:1px solid #ddd;"><strong>${money(breakdown.refundCents)}</strong></td></tr>
              </table>
              <p style="font-size:13px;color:#555;">The refund goes back to the card you paid with. Banks usually show it within 5–10 business days.</p>` : ''}
              <p style="font-size:13px;color:#555;">The code expires in about 15 minutes. If you did not ask to cancel, ignore this e-mail — your reservation stays as it is.</p>
            </div>
          `,
        }),
      }).catch((e) => ({ ok: false, _err: e }));
      if (!emailRes.ok) {
        console.error('cancel-lot-booking: could not send code e-mail', emailRes._err || emailRes.status);
        return res.status(502).json({ error: 'Could not send the confirmation code. Please try again or contact the park office.' });
      }
      return res.status(200).json({ codeRequired: true, codeSent: true });
    }

    if (!verifyCancelCode(order, code)) {
      return res.status(403).json({ error: 'That code is not valid or has expired. Request a new one.' });
    }

    // Oct 20 (security review): refund rules mirror melyos-builder
    // rv-refunds (see top of file). Before, this was a full refund with no
    // reverse_transfer on a destination charge — Stripe took the whole
    // refund out of the MelyOS platform balance while the park kept the
    // transferred money. Now: refund = total − processing fee − $15 admin
    // fee (if the notice was shown), then take exactly that amount back
    // from the park's transfer. An explicit reversal is used (like the
    // builder) instead of reverse_transfer:true because Stripe reverses
    // proportionally on a partial refund, which would still leave MelyOS
    // paying part of it. The application fee is NOT refunded.
    let refundedCents = null;
    if (order.stripe_payment_intent) {
      const pi = order.stripe_payment_intent;
      const intent = await stripe.paymentIntents.retrieve(pi, { expand: ['latest_charge'] });
      const charge = intent.latest_charge;
      if (!charge || typeof charge === 'string' || !charge.paid) {
        return res.status(400).json({ error: 'This payment could not be found. Please contact the park office.' });
      }
      if (charge.refunded || charge.amount_refunded > 0) {
        return res.status(400).json({ error: 'This booking has already been refunded.' });
      }
      let bd;
      try {
        bd = await refundBreakdown(order);
      } catch (e) {
        console.error('cancel-lot-booking: could not read checkout session', e);
        return res.status(502).json({ error: 'Could not verify this payment right now. Please try again or contact the park office.' });
      }
      if (!bd || bd.error) return res.status(400).json({ error: bd?.error || 'This payment could not be found. Please contact the park office.' });
      const totalCents = bd.totalCents;
      const feeCents = bd.feeCents;
      const adminFeeCents = 0; // Oct 20 (per Mely): no administrative fee on refunds
      refundedCents = bd.refundCents;
      if (refundedCents < 50) {
        return res.status(400).json({ error: 'After the card processing fee, nothing is left to refund. Please contact the park office.' });
      }

      // Re-check right before money moves — a second tab / double click
      // must not refund twice (idempotency key below covers retries too).
      const { data: fresh } = await supabase.from('lot_orders').select('status').eq('id', order.id).maybeSingle();
      if (fresh?.status !== 'paid') {
        return res.status(400).json({ error: 'This booking is not eligible for cancellation' });
      }

      const refund = await stripe.refunds.create(
        {
          payment_intent: pi,
          amount: refundedCents,
          metadata: { source: 'public_self_cancel', lot_order_id: String(order.id), park_id: PARK_ID, admin_fee_cents: String(adminFeeCents), processing_fee_cents: String(feeCents) },
        },
        { idempotencyKey: `cancel-${order.id}` }
      );

      const tid = typeof charge.transfer === 'string' ? charge.transfer : charge.transfer?.id;
      if (tid) {
        try {
          const t = await stripe.transfers.retrieve(tid);
          const remaining = t.amount - (t.amount_reversed || 0);
          const rev = Math.min(refundedCents, remaining);
          if (rev > 0) {
            await stripe.transfers.createReversal(
              tid,
              { amount: rev, metadata: { refund_id: refund.id, lot_order_id: String(order.id) } },
              { idempotencyKey: `cancel-rev-${order.id}` }
            );
          }
          if (rev < refundedCents) {
            console.error(`cancel-lot-booking: transfer ${tid} could only cover ${rev} of ${refundedCents} cents for order ${order.id}`);
          }
        } catch (revErr) {
          // The guest's refund already went through — never fail the
          // response for this; log loudly so MelyOS can reverse by hand.
          console.error(`cancel-lot-booking: REFUND ${refund.id} ISSUED BUT TRANSFER REVERSAL FAILED for order ${order.id}:`, revErr);
        }
      }
    }

    const { error: updateError } = await supabase
      .from('lot_orders')
      .update({ status: 'refunded' })
      .eq('id', orderId);

    if (updateError) {
      console.error('Error updating order status:', updateError);
    }

    await recomputeLotStatus(order.lot_id, PARK_ID);

    return res.status(200).json({ success: true, amountRefunded: refundedCents != null ? refundedCents / 100 : null });
  } catch (err) {
    console.error('Error cancelling booking:', err);
    return res.status(500).json({ error: 'Could not process cancellation' });
  }
}
