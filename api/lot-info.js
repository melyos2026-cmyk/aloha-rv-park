import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/lot-info?parkId=...
//
// Aug 19 (public-site audit): loadLotInfo previously read lot_info
// directly from the browser with the anon key — this table's real RLS
// policies require Supabase Auth context this map app doesn't have, so
// this read was almost certainly silently returning empty (storage lot
// S1-S6 pricing/details never actually loading for any visitor). Public
// on purpose, no edit-token required — any visitor needs to see storage
// pricing, not just editors.
export default async function handler(req, res) {
  const { parkId } = req.query;
  if (!parkId) {
    return res.status(400).json({ error: 'parkId is required.' });
  }
  const { data, error } = await supabase
    .from('lot_info')
    .select('*')
    .eq('park_id', parkId);
  if (error) return res.status(500).json({ error: error.message });
  const result = {};
  (data || []).forEach((r) => { result[r.lot_key] = r; });
  return res.status(200).json(result);
}
