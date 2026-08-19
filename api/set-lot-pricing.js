import { createClient } from '@supabase/supabase-js';
import { checkEditToken } from './_editTokenAuth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// POST /api/set-lot-pricing
// Body: { parkId, lotName, basePrice, highSeasonPrice, lowSeasonPrice, dailyRate, weeklyRate, maxLengthFt, ampService, token }
// Writes straight to rv_lots — the same table admin.aloharvparkfl.com's
// "Lots & Seasonal Pricing" screen manages, so editing pricing (and now
// max RV length / amperage) from the map's edit mode and from that admin
// screen stay in sync automatically (no separate lot_info fields involved,
// which guests never actually see — that was the bug).
//
// Aug 19 (public-site audit): had ZERO auth check — anyone who found this
// URL could change any lot's real price with no login at all. Now
// requires a valid edit token (same one the map editor UI already uses
// to decide whether to SHOW its editing controls — now also enforced
// server-side, not just client-side).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { parkId, lotName, basePrice, highSeasonPrice, lowSeasonPrice, dailyRate, weeklyRate, maxLengthFt, ampService, photoUrl, maxDriverSlideOuts, maxPassengerSlideOuts, description, token } = req.body;

    if (!parkId || !lotName) {
      return res.status(400).json({ error: 'parkId and lotName are required.' });
    }

    const auth = await checkEditToken(token, parkId, supabase);
    if (!auth.valid) {
      return res.status(403).json({ error: 'Not authorized to edit this map.' });
    }

    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('id')
      .eq('park_id', parkId)
      .single();

    if (companyErr || !company) {
      return res.status(404).json({ error: 'Park not found' });
    }

    const updatePayload = {
      base_price: basePrice === '' || basePrice == null ? null : Number(basePrice),
      high_season_price: highSeasonPrice === '' || highSeasonPrice == null ? null : Number(highSeasonPrice),
      low_season_price: lowSeasonPrice === '' || lowSeasonPrice == null ? null : Number(lowSeasonPrice),
      daily_rate: dailyRate === '' || dailyRate == null ? null : Number(dailyRate),
      weekly_rate: weeklyRate === '' || weeklyRate == null ? null : Number(weeklyRate),
      max_length_ft: maxLengthFt === '' || maxLengthFt == null ? null : Number(maxLengthFt),
      amp_service: ampService === '' || ampService == null ? null : String(ampService),
    };
    // Aug 8 (per Mely): not every RV fits every lot — some lots can't
    // physically accommodate slide-outs on one particular side, or too
    // many of them. Independent max per side (not a single combined
    // count+category) so an applicant's separate Driver/Passenger side
    // counts can be checked precisely. Only included in the update when
    // actually sent, so this route's other callers (if any exist
    // elsewhere without these fields) don't accidentally wipe them back
    // to null.
    if (maxDriverSlideOuts !== undefined) {
      updatePayload.max_driver_slide_outs = maxDriverSlideOuts || 'Any';
    }
    if (maxPassengerSlideOuts !== undefined) {
      updatePayload.max_passenger_slide_outs = maxPassengerSlideOuts || 'Any';
    }
    // Aug 8: lets the admin remove a photo (photoUrl: null) without
    // needing a separate endpoint — upload-lot-photo.js handles setting one.
    if (photoUrl !== undefined) {
      updatePayload.photo_url = photoUrl;
    }
    if (description !== undefined) {
      updatePayload.description = description;
    }

    const { error } = await supabase
      .from('rv_lots')
      .update(updatePayload)
      .eq('company_id', company.id)
      .eq('lot_name', lotName);

    if (error) throw error;

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error saving lot pricing:', err);
    return res.status(500).json({ error: 'Could not save lot pricing' });
  }
}
