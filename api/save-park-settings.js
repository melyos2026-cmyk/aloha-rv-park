import { createClient } from '@supabase/supabase-js';
import { checkEditToken } from './_editTokenAuth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// POST /api/save-park-settings
// Body: { parkId, settings: { checkin_time, checkout_time, cancellation_days }, token }
//
// Aug 19 (public-site audit): saveParkSettings previously wrote directly
// to park_settings from the browser with the anon key, upserting on a
// hardcoded `id: 1` — park_settings' real primary key is a UUID, so
// `id: 1` would never match any real row, meaning this write was broken
// TWO ways even before considering RLS (which also blocks anon writes
// here, same as everywhere else). Fixed both: routes through Service
// Role and upserts on company_id (like everywhere else in the project)
// instead of a literal id. Also now requires a valid edit token — this
// is an editor-only feature (Check-in/Check-out time, cancellation
// window), not something a public visitor should ever be able to touch.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { parkId, settings, token } = req.body || {};
    if (!parkId || !settings) {
      return res.status(400).json({ error: 'parkId and settings are required.' });
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
    if (!company) {
      return res.status(404).json({ error: 'Park not found.' });
    }

    const { error } = await supabase
      .from('park_settings')
      .upsert(
        {
          company_id: company.id,
          checkin_time: settings.checkin_time,
          checkout_time: settings.checkout_time,
          cancellation_days: settings.cancellation_days,
        },
        { onConflict: 'company_id' }
      );

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error saving park settings:', err);
    return res.status(500).json({ error: 'Could not save park settings' });
  }
}
