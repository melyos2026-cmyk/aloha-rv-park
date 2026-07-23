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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const parkId = req.query.park_id || 'aloha';

    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('id')
      .eq('park_id', parkId)
      .single();

    if (companyErr || !company) {
      return res.status(404).json({ error: 'Park not found' });
    }

    const { data: lots, error: lotsErr } = await supabase
      .from('rv_lots')
      .select('lot_name, base_price, high_season_price, low_season_price, daily_rate, weekly_rate')
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
      // Monthly = today's season price if both high/low are set, else fall
      // back to base_price (a flat year-round rate for grandfathered lots).
      let monthly = l.base_price || null;
      if (hasSeasonDates && l.high_season_price != null && l.low_season_price != null) {
        monthly = inHighSeason ? l.high_season_price : l.low_season_price;
      }
      pricing[l.lot_name] = {
        price_daily: l.daily_rate || null,
        price_weekly: l.weekly_rate || null,
        price_monthly: monthly,
      };
    });

    return res.status(200).json(pricing);
  } catch (err) {
    console.error('Error fetching lot pricing:', err);
    return res.status(500).json({ error: 'Could not fetch lot pricing' });
  }
}
