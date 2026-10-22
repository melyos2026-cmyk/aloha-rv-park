import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Same wrap-around-safe season check as melyos-builder's
// LeaseApplicationForm.tsx isDateInSeason — kept in sync manually since
// this is a separate codebase (Vite, not Next.js).
function isDateInSeason(dateStr, startMonthDay, endMonthDay) {
  const [, m, d] = dateStr.split('-').map(Number);
  const [startM, startD] = startMonthDay.split('-').map(Number);
  const [endM, endD] = endMonthDay.split('-').map(Number);

  const toComparable = (mm, dd) => mm * 100 + dd;
  const target = toComparable(m, d);
  const start = toComparable(startM, startD);
  const end = toComparable(endM, endD);

  if (start <= end) return target >= start && target <= end;
  return target >= start || target <= end; // wraps across year-end
}

async function getAvailability(req, res) {
  const { lotId } = req.query;
  if (!lotId) return res.status(400).json({ error: 'Missing lot ID' });
  // Oct 21 (per Mely): the same lot name (A1, B2…) exists in more than one park
  // (Aloha and the demo), so the lot must be looked up inside THIS park only —
  // otherwise .single() fails and the calendar shows every date as open.
  const parkId = req.query.park_id || 'aloha';
  const { data: company } = await supabase.from('companies').select('id').eq('park_id', parkId).maybeSingle();
  if (!company) return res.status(404).json({ error: 'Park not found' });

  const { data: lotRow, error: lotErr } = await supabase
    .from('rv_lots')
    .select('id')
    .eq('company_id', company.id)
    .eq('lot_name', lotId)
    .maybeSingle();

  if (lotErr || !lotRow) return res.status(404).json({ error: 'Lot not found' });

  const { data, error } = await supabase.rpc('get_lot_blocked_ranges', { p_lot_id: lotRow.id });
  if (error) throw error;

  const mapped = (data || []).map((r) => ({
    arrival_date: r.range_start,
    departure_date: r.range_end,
  }));

  return res.status(200).json(mapped);
}

async function getPricing(req, res) {
  const parkId = req.query.park_id || 'aloha';

  const { data: company, error: companyErr } = await supabase
    .from('companies')
    .select('id')
    .eq('park_id', parkId)
    .single();

  if (companyErr || !company) return res.status(404).json({ error: 'Park not found' });

  const { data: lots, error: lotsErr } = await supabase
    .from('rv_lots')
    .select('lot_name, base_price, high_season_price, low_season_price, daily_rate, weekly_rate, max_length_ft, amp_service, use_seasonal_pricing, weekly_high_season_price, weekly_low_season_price, daily_high_season_price, daily_low_season_price, max_driver_slide_outs, max_passenger_slide_outs, description, photo_url')
    .eq('company_id', company.id);

  if (lotsErr) throw lotsErr;

  const { data: settings } = await supabase
    .from('park_settings')
    .select('high_season_start_month_day, high_season_end_month_day')
    .eq('company_id', company.id)
    .maybeSingle();

  const todayStr = new Date().toISOString().slice(0, 10);
  const hasSeasonDates = !!(settings?.high_season_start_month_day && settings?.high_season_end_month_day);
  const inHighSeason = hasSeasonDates
    ? isDateInSeason(todayStr, settings.high_season_start_month_day, settings.high_season_end_month_day)
    : null;

  const pricing = {};
  (lots || []).forEach((l) => {
    let monthly = l.base_price || null;
    const useSeasonal = l.use_seasonal_pricing !== false;
    if (useSeasonal && hasSeasonDates && l.high_season_price != null && l.low_season_price != null) {
      monthly = inHighSeason ? l.high_season_price : l.low_season_price;
    }
    let weekly = l.weekly_rate || null;
    if (useSeasonal && hasSeasonDates) {
      const seasonalWeekly = inHighSeason ? l.weekly_high_season_price : l.weekly_low_season_price;
      if (seasonalWeekly != null) weekly = seasonalWeekly;
    }
    let daily = l.daily_rate || null;
    if (useSeasonal && hasSeasonDates) {
      const seasonalDaily = inHighSeason ? l.daily_high_season_price : l.daily_low_season_price;
      if (seasonalDaily != null) daily = seasonalDaily;
    }
    pricing[l.lot_name] = {
      price_daily: daily,
      price_weekly: weekly,
      price_monthly: monthly,
      base_price: l.base_price || null,
      high_season_price: l.high_season_price || null,
      low_season_price: l.low_season_price || null,
      max_length_ft: l.max_length_ft || null,
      amp_service: l.amp_service || null,
      max_driver_slide_outs: l.max_driver_slide_outs || "Any",
      max_passenger_slide_outs: l.max_passenger_slide_outs || "Any",
      description: l.description || "",
      photo_url: l.photo_url || null,
    };
  });

  return res.status(200).json(pricing);
}

async function getReservedDates(req, res) {
  const parkId = req.query.park_id || 'aloha';

  const { data: company, error: companyErr } = await supabase
    .from('companies')
    .select('id')
    .eq('park_id', parkId)
    .single();

  if (companyErr || !company) return res.status(404).json({ error: 'Park not found' });

  const { data: lots, error: lotsErr } = await supabase
    .from('rv_lots')
    .select('lot_name, reserved_until')
    .eq('company_id', company.id);

  if (lotsErr) throw lotsErr;

  const dates = {};
  (lots || []).forEach((l) => {
    if (l.reserved_until) dates[l.lot_name] = l.reserved_until;
  });

  return res.status(200).json(dates);
}

// Aug 14 (per Mely — "si el calendario ya tiene los días correctos, por
// qué el color del lote no puede correr por el calendario?"): this used
// to just read the stored rv_lots.status column, which only gets kept in
// sync by the twice-daily arrival/departure crons — meaning the color
// could lag up to several hours behind reality between cron runs. Now
// computes live from the exact same data the calendar itself uses
// (get_live_lot_statuses — reservations/leases covering TODAY), so the
// map's color is never stale. online_booking_disabled still comes from
// the stored rv_lots row (that's a pure admin setting, not calendar-
// driven, so it's unaffected).
async function getStatuses(req, res) {
  const parkId = req.query.park_id || 'aloha';

  const { data: company, error: companyErr } = await supabase
    .from('companies')
    .select('id')
    .eq('park_id', parkId)
    .single();

  if (companyErr || !company) return res.status(404).json({ error: 'Park not found' });

  const { data: lots, error: lotsErr } = await supabase
    .from('rv_lots')
    .select('lot_name, online_booking_disabled')
    .eq('company_id', company.id);

  if (lotsErr) throw lotsErr;

  const { data: liveStatuses, error: liveErr } = await supabase.rpc('get_live_lot_statuses', {
    p_company_id: company.id,
  });

  if (liveErr) throw liveErr;

  const liveByLotName = {};
  (liveStatuses || []).forEach((row) => {
    liveByLotName[row.lot_name] = row.live_status;
  });

  const statuses = {};
  const bookingDisabled = {};
  (lots || []).forEach((l) => {
    statuses[l.lot_name] = liveByLotName[l.lot_name] || 'available';
    bookingDisabled[l.lot_name] = !!l.online_booking_disabled;
  });

  return res.status(200).json({ statuses, bookingDisabled });
}

// Oct 20 (security review): still returns order ids (the My Reservations
// cancel button needs them), but an id + email is no longer enough to
// cancel — cancel-lot-booking.js now also requires a one-time code e-mailed
// to the booking's address, which this endpoint never returns.
async function getMyBookings(req, res) {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const todayStr = new Date().toISOString().split('T')[0];

  // Oct 22 (security): only bookings at THIS park (older Aloha orders have no park saved).
  const parkId = String(req.query.park_id || 'aloha').replace(/[^a-z0-9_-]/gi, '');
  let q = supabase
    .from('lot_orders')
    .select('id, lot_id, arrival_date, departure_date, amount_total, status, created_at')
    .eq('customer_email', email)
    .eq('status', 'paid');
  q = parkId === 'aloha' ? q.or('park_id.eq.aloha,park_id.is.null') : q.eq('park_id', parkId);
  const { data, error } = await q
    .gte('departure_date', todayStr)
    .order('arrival_date', { ascending: true });

  if (error) throw error;

  return res.status(200).json(data || []);
}

// GET /api/lot-data?type=availability&lotId=A34
// GET /api/lot-data?type=pricing&park_id=aloha
// GET /api/lot-data?type=reserved-dates&park_id=aloha
// GET /api/lot-data?type=statuses&park_id=aloha
// GET /api/lot-data?type=my-bookings&email=...
//
// Consolidated from 5 separate endpoints (get-lot-availability,
// get-lot-pricing, get-lot-reserved-dates, get-lot-statuses,
// get-my-bookings) to stay under Vercel's Hobby-plan 12-serverless-function
// limit per deployment. Response shapes are unchanged from the originals.

// Oct 22 (per Mely — "estilo Expedia"): search every lot of THIS park for a date range.
// Uses the exact same sources as the lot calendar and the checkout: get_lot_blocked_ranges
// (paid bookings + resident leases/applications + holds) for availability, and the same
// month/week/night split and seasonal rates the checkout charges. Read-only.
function calcStaySplit(arrivalStr, departureStr, hasWeekly) {
  const arrival = new Date(arrivalStr + 'T00:00:00');
  const departure = new Date(departureStr + 'T00:00:00');
  const totalNights = Math.round((departure - arrival) / 86400000);
  if (totalNights === 365) return { isYearly: true, months: 0, weeks: 0, extraDays: 0, totalNights };
  let months = 0;
  let cursor = new Date(arrival);
  for (;;) {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    if (next <= departure) { months++; cursor = next; } else break;
  }
  const rest = Math.round((departure - cursor) / 86400000);
  const weeks = hasWeekly ? Math.floor(rest / 7) : 0;
  return { isYearly: false, months, weeks, extraDays: rest - weeks * 7, totalNights };
}

function inSeason(dateStr, start, end) {
  if (!start || !end) return false;
  const md = dateStr.slice(5);
  return start <= end ? (md >= start && md <= end) : (md >= start || md <= end);
}

async function searchLots(req, res) {
  const parkId = String(req.query.park_id || 'aloha');
  const arrival = String(req.query.arrival || '');
  const departure = String(req.query.departure || '');
  const rvLength = Number(req.query.rv_length) || 0;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(arrival) || !iso.test(departure) || departure <= arrival) {
    return res.status(400).json({ error: 'Choose an arrival and a departure date.' });
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (new Date(arrival + 'T00:00:00') < today) return res.status(400).json({ error: 'Arrival date cannot be in the past.' });
  const nights = Math.round((new Date(departure + 'T00:00:00') - new Date(arrival + 'T00:00:00')) / 86400000);
  if (nights > 400) return res.status(400).json({ error: 'Please choose a shorter stay.' });

  const { data: company } = await supabase.from('companies').select('id').eq('park_id', parkId).maybeSingle();
  if (!company) return res.status(404).json({ error: 'Park not found' });

  const [{ data: lots, error: lotsErr }, { data: settings }, { data: infos }] = await Promise.all([
    supabase.from('rv_lots')
      .select('id, lot_name, status, online_booking_disabled, max_length_ft, amp_service, photo_url, description, base_price, high_season_price, low_season_price, daily_rate, weekly_rate, use_seasonal_pricing, weekly_high_season_price, weekly_low_season_price, daily_high_season_price, daily_low_season_price')
      .eq('company_id', company.id),
    supabase.from('park_settings')
      .select('lease_defaults, high_season_start_month_day, high_season_end_month_day')
      .eq('company_id', company.id).maybeSingle(),
    supabase.from('lot_info').select('lot_key, phone_only').eq('park_id', parkId),
  ]);
  if (lotsErr) throw lotsErr;
  const phoneOnly = new Set((infos || []).filter((i) => i.phone_only).map((i) => i.lot_key));
  const threshold = Number(settings?.lease_defaults?.background_check_threshold_days) || 15;
  const high = inSeason(arrival, settings?.high_season_start_month_day, settings?.high_season_end_month_day);

  const candidates = (lots || []).filter((l) =>
    !/^S/i.test(l.lot_name) &&
    !['maintenance', 'for_sale', 'for_rent'].includes(l.status) &&
    !l.online_booking_disabled && !phoneOnly.has(l.lot_name) &&
    (!rvLength || !l.max_length_ft || Number(l.max_length_ft) >= rvLength));

  const a = new Date(arrival + 'T00:00:00');
  const d = new Date(departure + 'T00:00:00');
  const free = [];
  for (let i = 0; i < candidates.length; i += 15) {
    const batch = candidates.slice(i, i + 15);
    const ranges = await Promise.all(batch.map((l) => supabase.rpc('get_lot_blocked_ranges', { p_lot_id: l.id })));
    batch.forEach((l, j) => {
      if (ranges[j].error) return; // unknown availability: never show it as free
      const busy = (ranges[j].data || []).some((r) => {
        const s = r.range_start || r.arrival_date; const e = r.range_end || r.departure_date;
        if (!s || !e) return true;
        return a < new Date(String(e).slice(0, 10) + 'T00:00:00') && d > new Date(String(s).slice(0, 10) + 'T00:00:00');
      });
      if (!busy) free.push(l);
    });
  }

  const results = free.map((l) => {
    const seasonal = l.use_seasonal_pricing !== false;
    let monthly = l.base_price;
    if (seasonal) {
      if (high && l.high_season_price) monthly = l.high_season_price;
      else if (!high && l.low_season_price) monthly = l.low_season_price;
    }
    const weekly = seasonal ? (high ? l.weekly_high_season_price : l.weekly_low_season_price) || l.weekly_rate : l.weekly_rate;
    const daily = seasonal ? (high ? l.daily_high_season_price : l.daily_low_season_price) || l.daily_rate : l.daily_rate;
    const stay = calcStaySplit(arrival, departure, !!l.weekly_rate);
    const apply = stay.isYearly || stay.totalNights > threshold;
    let total = null;
    if (!apply) {
      const parts = [[stay.months, monthly], [stay.weeks, weekly], [stay.extraDays, daily]];
      if (parts.every(([n, r]) => !n || (r && r > 0))) total = Math.round(parts.reduce((t, [n, r]) => t + (n ? n * r : 0), 0) * 100) / 100;
    }
    return {
      lot: l.lot_name, max_length_ft: l.max_length_ft || null, amp_service: l.amp_service || null,
      photo_url: l.photo_url || null, description: l.description || '',
      nightly: daily || null, total, apply, nights: stay.totalNights,
    };
  }).sort((x, y) => (x.apply === y.apply ? (x.total ?? 1e9) - (y.total ?? 1e9) : x.apply ? 1 : -1)
    || String(x.lot).localeCompare(String(y.lot), undefined, { numeric: true }));

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ arrival, departure, nights, threshold, results });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type } = req.query;

  try {
    switch (type) {
      case 'availability':
        return await getAvailability(req, res);
      case 'pricing':
        return await getPricing(req, res);
      case 'reserved-dates':
        return await getReservedDates(req, res);
      case 'statuses':
        return await getStatuses(req, res);
      case 'search':
        return await searchLots(req, res);
      case 'my-bookings':
        return await getMyBookings(req, res);
      default:
        return res.status(400).json({ error: 'Missing or invalid type parameter' });
    }
  } catch (err) {
    console.error(`Error in lot-data (type=${type}):`, err);
    return res.status(500).json({ error: 'Could not fetch data' });
  }
}
