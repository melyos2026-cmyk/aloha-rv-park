import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PARK_ID = 'aloha';

// Determines whether `dateStr` (YYYY-MM-DD) falls within the park's
// configured high season (MM-DD to MM-DD, e.g. "10-01" to "04-30").
// Handles a season that wraps across the new year (start > end).
function isHighSeason(dateStr, startMonthDay, endMonthDay) {
  if (!startMonthDay || !endMonthDay) return false;
  const md = dateStr.slice(5); // "MM-DD"
  if (startMonthDay <= endMonthDay) {
    return md >= startMonthDay && md <= endMonthDay;
  }
  // Wraps across the new year (e.g. 10-01 to 04-30)
  return md >= startMonthDay || md <= endMonthDay;
}

// Anniversary-date method: a "month" runs from the arrival day to the
// same day next month, regardless of how many days that spans (28-31).
// Remaining days after full months are split into full weeks (if the lot
// offers a weekly rate) plus leftover nightly days.
function calcStay(arrivalStr, departureStr, hasWeekly) {
  const arrival = new Date(arrivalStr + 'T00:00:00');
  const departure = new Date(departureStr + 'T00:00:00');
  const totalNights = Math.round((departure - arrival) / 86400000);

  if (totalNights === 365) {
    return { isYearly: true, months: 0, weeks: 0, extraDays: 0, totalNights };
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
  // Standard checkin/checkout billing: nights = departure - arrival,
  // no extra padded day (e.g. Thu 4pm arrival to Sat 11am departure = 2
  // nights, not 3).
  const extraDays = remainingAfterMonths - (weeks * 7);

  return { isYearly: false, months, weeks, extraDays, totalNights };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lotId, arrivalDate, departureDate, customerEmail, rvLength } = req.body || {};

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

    if (lotInfo.phone_only) {
      return res.status(403).json({
        error: 'This lot is a limited storage space — please call the office to book it.',
      });
    }

    // Check for overlapping paid reservations OR active resident leases on this lot
    const { data: lotRow, error: lotRowErr } = await supabase
      .from('rv_lots')
      .select('id, max_length_ft, base_price, high_season_price, low_season_price, daily_rate, weekly_rate, use_seasonal_pricing')
      .eq('lot_name', lotId)
      .single();

    if (lotRowErr || !lotRow) {
      return res.status(404).json({ error: 'Lot not found' });
    }

    const rvLengthNum = Number(rvLength) || 0;
    if (!rvLengthNum) {
      return res.status(400).json({ error: "RV length is required to book this lot." });
    }
    if (lotRow.max_length_ft && rvLengthNum > lotRow.max_length_ft) {
      return res.status(400).json({
        error: `This RV (${rvLengthNum} ft) is too long for this lot (max ${lotRow.max_length_ft} ft). Please choose a different lot.`,
      });
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

    const hasWeekly = !!lotRow.weekly_rate;
    const stay = calcStay(arrivalDate, departureDate, hasWeekly);

    // Stays past the park's background-check threshold (Lease Defaults,
    // admin-editable, default 15 days) — and any yearly stay — mean the
    // guest is becoming a resident and must go through the lease
    // application (with background check), not a direct online payment.
    // Scoped to THIS park's own company_id — was previously hardcoded to
    // id=1, which would silently read another park's settings once a 2nd
    // company exists on the platform.
    const { data: companyRow } = await supabase
      .from('companies')
      .select('id')
      .eq('park_id', PARK_ID)
      .maybeSingle();
    const { data: parkSettingsRow } = await supabase
      .from('park_settings')
      .select('lease_defaults, high_season_start_month_day, high_season_end_month_day')
      .eq('company_id', companyRow?.id)
      .maybeSingle();
    const thresholdDays =
      Number(parkSettingsRow?.lease_defaults?.background_check_threshold_days) || 15;

    if (stay.isYearly || stay.totalNights > thresholdDays) {
      return res.status(403).json({
        error: `Stays of ${thresholdDays}+ days require a lease application instead of online payment.`,
      });
    }

    // Real pricing now comes from rv_lots (the table admin's Lots Pricing
    // screen actually edits) instead of the old, disconnected lot_info
    // table. The monthly rate is season-aware; weekly/daily are not (there's
    // only one weekly_rate/daily_rate value per lot, no season variants yet).
    const inHighSeason = isHighSeason(
      arrivalDate,
      parkSettingsRow?.high_season_start_month_day,
      parkSettingsRow?.high_season_end_month_day
    );
    const useSeasonal = lotRow.use_seasonal_pricing !== false;
    let effectiveMonthlyRate = lotRow.base_price;
    if (useSeasonal) {
      if (inHighSeason && lotRow.high_season_price) {
        effectiveMonthlyRate = lotRow.high_season_price;
      } else if (!inHighSeason && lotRow.low_season_price) {
        effectiveMonthlyRate = lotRow.low_season_price;
      }
    }
    const effectiveWeeklyRate = lotRow.weekly_rate;
    const effectiveDailyRate = lotRow.daily_rate;

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
        if (!effectiveMonthlyRate || effectiveMonthlyRate <= 0) {
          return res.status(400).json({ error: 'Monthly rate not available for this lot' });
        }
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: `RV Lot ${lotId} — ${stay.months} month(s)` },
            unit_amount: Math.round(effectiveMonthlyRate * 100),
          },
          quantity: stay.months,
        });
      }
      if (stay.weeks > 0) {
        if (!effectiveWeeklyRate || effectiveWeeklyRate <= 0) {
          return res.status(400).json({ error: 'Weekly rate not available for this lot' });
        }
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: `RV Lot ${lotId} — ${stay.weeks} week(s)` },
            unit_amount: Math.round(effectiveWeeklyRate * 100),
          },
          quantity: stay.weeks,
        });
      }
      if (stay.extraDays > 0) {
        if (!effectiveDailyRate || effectiveDailyRate <= 0) {
          return res.status(400).json({ error: 'Nightly rate not available for this lot' });
        }
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: `RV Lot ${lotId} — ${stay.extraDays} night(s)` },
            unit_amount: Math.round(effectiveDailyRate * 100),
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
