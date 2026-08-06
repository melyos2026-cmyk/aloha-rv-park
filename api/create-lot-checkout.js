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

// Aug 5 (per Mely): same processing-fee model as every other charge in the
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
      .select('id, max_length_ft, base_price, high_season_price, low_season_price, daily_rate, weekly_rate, use_seasonal_pricing, weekly_high_season_price, weekly_low_season_price, daily_high_season_price, daily_low_season_price')
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
      .select('lease_defaults, high_season_start_month_day, high_season_end_month_day, stripe_connect_account_id, stripe_connect_onboarded')
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
    const effectiveWeeklyRate = useSeasonal
      ? (inHighSeason ? lotRow.weekly_high_season_price : lotRow.weekly_low_season_price) || lotRow.weekly_rate
      : lotRow.weekly_rate;
    const effectiveDailyRate = useSeasonal
      ? (inHighSeason ? lotRow.daily_high_season_price : lotRow.daily_low_season_price) || lotRow.daily_rate
      : lotRow.daily_rate;

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

    // Aug 5 (per Mely): add the processing fee (Aloha gets 100% of the
    // real booking amount; MelyOS keeps only this fee) and split via
    // Stripe Connect if Aloha has connected their bank account — same
    // pattern as every other checkout in the system. Falls back to a
    // normal unsplit charge if not connected yet, so bookings still work.
    const subtotalCents = lineItems.reduce((sum, li) => sum + li.price_data.unit_amount * li.quantity, 0);
    const processingFeeCents = Math.round(calculateProcessingFee(subtotalCents / 100) * 100);

    // Aug 5 (per Mely): sales tax — one company-wide rate + mode, shared
    // across propane/reservations/rent (varies by county, e.g. Aloha is
    // 7.5%). "excluded" adds it as its own line item on top; "included"
    // means the listed rate already has tax baked in (no separate line);
    // blank/null means no mode chosen yet, so no tax is charged. The
    // FULL tax amount always goes to Aloha (they're the one who remits
    // it) — MelyOS never takes any share of tax, only its processing fee.
    const { data: taxSettingsRow } = await supabase
      .from('company_tax_settings')
      .select('enable_tax, manual_tax_rate_percent, reservations_tax_mode')
      .eq('company_id', companyRow?.id)
      .maybeSingle();
    const taxRatePercent = Number(taxSettingsRow?.manual_tax_rate_percent || 0);
    const taxEnabled = !!taxSettingsRow?.enable_tax && taxRatePercent > 0 && taxSettingsRow?.reservations_tax_mode === 'excluded';
    const taxCents = taxEnabled ? Math.round(subtotalCents * (taxRatePercent / 100)) : 0;

    if (taxCents > 0) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `Sales Tax (${taxRatePercent}%)` },
          unit_amount: taxCents,
        },
        quantity: 1,
      });
    }

    const { data: feeSettingsRow } = await supabase
      .from('company_fee_settings')
      .select('pass_processing_fee_to_resident')
      .eq('company_id', companyRow?.id)
      .maybeSingle();
    const passFeeToResident = feeSettingsRow?.pass_processing_fee_to_resident !== false;

    if (passFeeToResident) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'Card Processing Fee' },
          unit_amount: processingFeeCents,
        },
        quantity: 1,
      });
    }

    const totalChargeCents = subtotalCents + taxCents + (passFeeToResident ? processingFeeCents : 0);
    // Aloha's share is the full booking subtotal PLUS all of the tax
    // (theirs to remit) — MelyOS's cut is only the processing fee, taken
    // from the resident's payment if they're covering it, or otherwise
    // out of the park's own subtotal.
    const alohaShareCents = subtotalCents + taxCents + (passFeeToResident ? 0 : -processingFeeCents);
    const melyOsShareCents = Math.max(totalChargeCents - alohaShareCents, 0);

    const canSplit = parkSettingsRow?.stripe_connect_account_id && parkSettingsRow?.stripe_connect_onboarded;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,
      line_items: lineItems,
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
        park: 'aloha-rv-park',
        service: 'rv_lot',
        arrivalDate,
        departureDate,
        months: String(stay.months),
        weeks: String(stay.weeks),
        extraDays: String(stay.extraDays),
        isYearly: String(stay.isYearly),
      },
      // Aug 5 (per Mely): send guests back to the REAL public site's home
      // page after paying, not this widget's own bare origin — that
      // origin has no ?park_id= param, which trips this app's own "No
      // Park Specified" safety guard and shows a scary error instead of
      // a normal post-payment landing. lot_payment=success/cancelled was
      // also never actually read/used anywhere in the frontend.
      success_url: `https://aloharvparkfl.com/?park_id=${PARK_ID}&lot_payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://aloharvparkfl.com/?park_id=${PARK_ID}&lot_payment=cancelled`,
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    console.error('Stripe lot checkout error:', err);
    return res.status(500).json({ error: 'Could not create payment session' });
  }
}
