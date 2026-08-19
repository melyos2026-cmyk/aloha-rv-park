import { createClient } from '@supabase/supabase-js';
import { checkEditToken } from './_editTokenAuth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// POST /api/ensure-real-estate-listing
// Body: { parkId, lotKey, listingType: 'sale'|'rent', token }
//
// Aug 19 (public-site audit): ensureRealEstateListing/ensureRentListing
// previously read+wrote real_estate_listings directly from the browser
// with the anon key — this table only has a narrow public SELECT policy
// (available=true), no anon write policy exists, so these writes were
// silently failing (marking a lot for_sale/for_rent in the map editor
// never actually created the listing row admins expect to then edit in
// Real Estate). Also had no edit-token check — this only ever fires from
// inside the editor (when an admin sets a lot's status to for_sale/
// for_rent), so it needs the same protection as the other editor-only
// map writes fixed the same day.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { parkId, lotKey, listingType, token } = req.body || {};
    if (!parkId || !lotKey || !listingType) {
      return res.status(400).json({ error: 'parkId, lotKey, and listingType are required.' });
    }
    if (listingType !== 'sale' && listingType !== 'rent') {
      return res.status(400).json({ error: 'listingType must be "sale" or "rent".' });
    }

    const auth = await checkEditToken(token, parkId, supabase);
    if (!auth.valid) {
      return res.status(403).json({ error: 'Not authorized to edit this map.' });
    }

    const { data: existing } = await supabase
      .from('real_estate_listings')
      .select('id')
      .eq('park_id', parkId)
      .eq('lot_key', lotKey);
    if (existing && existing.length > 0) {
      return res.status(200).json({ success: true, alreadyExisted: true });
    }

    const row =
      listingType === 'sale'
        ? {
            park_id: parkId,
            lot_key: lotKey,
            type: 'sale',
            category: 'Mini Home',
            title: 'New Listing - Lot ' + lotKey,
            price: 'TBD',
            available: false,
          }
        : {
            park_id: parkId,
            lot_key: lotKey,
            type: 'rent',
            seller_type: 'park',
            category: 'Mini Home',
            title: 'For Rent - Lot ' + lotKey,
            price: 'TBD',
            available: false,
          };

    const { error } = await supabase.from('real_estate_listings').insert(row);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error ensuring real estate listing:', err);
    return res.status(500).json({ error: 'Could not create listing' });
  }
}
