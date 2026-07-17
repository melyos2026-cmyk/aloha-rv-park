import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lotId } = req.query;
    if (!lotId) {
      return res.status(400).json({ error: 'Missing lot ID' });
    }

    // Look up the lot's UUID from its lot_name (lotId here is like "A34")
    const { data: lotRow, error: lotErr } = await supabase
      .from('rv_lots')
      .select('id')
      .eq('lot_name', lotId)
      .single();

    if (lotErr || !lotRow) {
      return res.status(404).json({ error: 'Lot not found' });
    }

    // Combines paid lot_orders + active resident leases into one set of blocked ranges
    const { data, error } = await supabase.rpc('get_lot_blocked_ranges', { p_lot_id: lotRow.id });

    if (error) throw error;

    const mapped = (data || []).map((r) => ({
      arrival_date: r.range_start,
      departure_date: r.range_end,
    }));

    return res.status(200).json(mapped);
  } catch (err) {
    console.error('Error fetching lot availability:', err);
    return res.status(500).json({ error: 'Could not fetch availability' });
  }
}
