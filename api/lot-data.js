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

  const { data: lotRow, error: lotErr } = await supabase
    .from('rv_lots')
    .select('id')
    .eq('lot_name', lotId)
    .single();

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

async function getMyBookings(req, res) {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const todayStr = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('lot_orders')
    .select('id, lot_id, arrival_date, departure_date, amount_total, status, created_at')
    .eq('customer_email', email)
    .eq('status', 'paid')
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
