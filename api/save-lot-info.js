import { createClient } from '@supabase/supabase-js';
import { checkEditToken } from './_editTokenAuth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// POST /api/save-lot-info
// Body: { parkId, lotKey, info: {...}, token }
//
// Aug 19 (public-site audit): saveLotInfo previously wrote directly to
// lot_info from the browser with the anon key — this table's real RLS
// policies require Supabase Auth context this map app doesn't have, so
// this write was almost certainly silently failing (the "Save Lot Info"
// button for storage lots S1-S6 never actually saved, same class of
// silent-failure bug found dozens of times across the whole project
// today). Also had no edit-token check, matching the other 5 map write
// routes fixed the same day. Fixed both at once here.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { parkId, lotKey, info, token } = req.body || {};
    if (!parkId || !lotKey || !info) {
      return res.status(400).json({ error: 'parkId, lotKey, and info are required.' });
    }

    const auth = await checkEditToken(token, parkId, supabase);
    if (!auth.valid) {
      return res.status(403).json({ error: 'Not authorized to edit this map.' });
    }

    const { data: company } = await supabase
      .from('companies')
      .select('id')
      .eq('park_id', parkId)
      .maybeSingle();

    const { error } = await supabase
      .from('lot_info')
      .upsert(
        { park_id: parkId, lot_key: lotKey, company_id: company?.id || null, ...info },
        { onConflict: 'park_id,lot_key' }
      );

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error saving lot info:', err);
    return res.status(500).json({ error: 'Could not save lot info' });
  }
}
