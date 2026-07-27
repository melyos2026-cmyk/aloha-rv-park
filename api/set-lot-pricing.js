import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// POST /api/set-lot-pricing
// Body: { parkId, lotName, basePrice, highSeasonPrice, lowSeasonPrice, dailyRate, weeklyRate }
// Writes straight to rv_lots — the same table admin.aloharvparkfl.com's
// "Lots & Seasonal Pricing" screen manages, so editing pricing from the
// map's edit mode and from that admin screen stay in sync automatically
// (no separate lot_info pricing table involved).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { parkId, lotName, basePrice, highSeasonPrice, lowSeasonPrice, dailyRate, weeklyRate } = req.body;

    if (!parkId || !lotName) {
      return res.status(400).json({ error: 'parkId and lotName are required.' });
    }

    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('id')
      .eq('park_id', parkId)
      .single();

    if (companyErr || !company) {
      return res.status(404).json({ error: 'Park not found' });
    }

    const { error } = await supabase
      .from('rv_lots')
      .update({
        base_price: basePrice === '' || basePrice == null ? null : Number(basePrice),
        high_season_price: highSeasonPrice === '' || highSeasonPrice == null ? null : Number(highSeasonPrice),
        low_season_price: lowSeasonPrice === '' || lowSeasonPrice == null ? null : Number(lowSeasonPrice),
        daily_rate: dailyRate === '' || dailyRate == null ? null : Number(dailyRate),
        weekly_rate: weeklyRate === '' || weeklyRate == null ? null : Number(weeklyRate),
      })
      .eq('company_id', company.id)
      .eq('lot_name', lotName);

    if (error) throw error;

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error saving lot pricing:', err);
    return res.status(500).json({ error: 'Could not save lot pricing' });
  }
}
