import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PARK_ID = 'aloha';

// Anniversary-date method: a "month" runs from the arrival day to the
// same day next month, regardless of how many days that spans (28-31).
// Remaining days after full months are split into full weeks (if the lot
// offers a weekly rate) plus leftover nightly days.
function calcStay(arrivalStr, departureStr, hasWeekly) {
  const arrival = new Date(arrivalStr + 'T00:00:00');
  const departure = new Date(departureStr + 'T00:00:00');
  const totalNights = Math.round((departure - arrival) / 86400000);

  if (totalNights === 365) {
    return { isYearly: true, months: 0, weeks: 0, extraDays: 0, totalNights: totalNights + 1 };
  }

  let months = 0;
  let cursor = new Date(arrival);
  while (true) {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    if (next <= departure) {
      months++;
      cursor = next;
    } else {
      break;
    }
  }
  const remainingAfterMonths = Math.round((departure - cursor) / 86400000);
  const weeks = hasWeekly ? Math.floor(remainingAfterMonths / 7) : 0;
  const leftoverExclusive = remainingAfterMonths - (weeks * 7);
  const extraDays = leftoverExclusive > 0 ? leftoverExclusive + 1 : 0;

  return { isYearly: false, months, weeks, extraDays, totalNights: totalNights + 1 };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lotId, arrivalDate, departureDate, customerEmail } = req.body || {};

    if (!lotId || !arrivalDate || !departureDate) {
      return res.status(400).json({ error: 'Missing lot ID or dates' });
    }

    const arrival = new Date(arrivalDate + 'T00:00:00');
    const departure = new Date(departureDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isNaN(arrival) || isNaN(departure) || departure <= arrival) {
      return res.status(400).json({ error: 'Invalid date range' });
    }
    if (arrival < today) {
      return res.status(400).json({ error: 'Arrival date cannot be in the past' });
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

    // Check for overlapping paid reservations OR active resident leases on this lot
    const { data: lotRow, error: lotRowErr } = await supabase
      .from('rv_lots')
      .select('id')
      .eq('lot_name', lotId)
      .single();

    if (lotRowErr || !lotRow) {
      return res.status(404).json({ error: 'Lot not found' });
    }

    const { data: blockedRanges, error: ordersError } = await supabase.rpc(
      'get_lot_blocked_ranges',
      { p_lot_id: lotRow.id }
    );

    if (ordersError) {
      console.error('Error checking existing orders:', ordersError);
      return res.status(500).json({ error: 'Could not verify availability' });
    }

    const hasOverlap = (blockedRanges || []).some((r) => {
      const bookedStart = new Date(r.range_start + 'T00:00:00');
      const bookedEnd = new Date(r.range_end + 'T00:00:00');
      return arrival < bookedEnd && departure > bookedStart;
    });

    if (hasOverlap) {
      return res.status(409).json({ error: 'These dates overlap with an existing reservation' });
    }

    const hasWeekly = !!lotInfo.price_weekly;
    const stay = calcStay(arrivalDate, departureDate, hasWeekly);
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const lineItems = [];

    if (stay.isYearly) {
      if (!lotInfo.price_yearly || lotInfo.price_yearly <= 0) {
        return res.status(400).json({ error: 'Yearly rate not available for this lot' });
      }
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `RV Lot ${lotId} — 1 Year` },
          unit_amount: Math.round(lotInfo.price_yearly * 100),
        },
        quantity: 1,
      });
    } else {
      if (stay.months > 0) {
        if (!lotInfo.price_monthly || lotInfo.price_monthly <= 0) {
          return res.status(400).json({ error: 'Monthly rate not available for this lot' });
        }
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: `RV Lot ${lotId} — ${stay.months} month(s)` },
            unit_amount: Math.round(lotInfo.price_monthly * 100),
          },
          quantity: stay.months,
        });
      }
      if (stay.weeks > 0) {
        if (!lotInfo.price_weekly || lotInfo.price_weekly <= 0) {
          return res.status(400).json({ error: 'Weekly rate not available for this lot' });
        }
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: `RV Lot ${lotId} — ${stay.weeks} week(s)` },
            unit_amount: Math.round(lotInfo.price_weekly * 100),
          },
          quantity: stay.weeks,
        });
      }
      if (stay.extraDays > 0) {
        if (!lotInfo.price_daily || lotInfo.price_daily <= 0) {
          return res.status(400).json({ error: 'Nightly rate not available for this lot' });
        }
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: `RV Lot ${lotId} — ${stay.extraDays} night(s)` },
            unit_amount: Math.round(lotInfo.price_daily * 100),
          },
          quantity: stay.extraDays,
        });
      }
    }

    if (lineItems.length === 0) {
      return res.status(400).json({ error: 'Stay length is too short to book' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,
      line_items: lineItems,
      metadata: {
        lotId,
        park: 'aloha-rv-park',
        service: 'rv_lot',
        arrivalDate,
        departureDate,
        months: String(stay.months),
        weeks: String(stay.weeks),
        extraDays: String(stay.extraDays),
        isYearly: String(stay.isYearly),
      },
      success_url: `${origin}/?lot_payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?lot_payment=cancelled`,
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    console.error('Stripe lot checkout error:', err);
    return res.status(500).json({ error: 'Could not create payment session' });
  }
}
