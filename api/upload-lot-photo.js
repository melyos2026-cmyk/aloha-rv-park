import { createClient } from '@supabase/supabase-js';
import { checkEditToken } from './_editTokenAuth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// POST /api/upload-lot-photo
// Body: { parkId, lotName, imageBase64, fileName, token }
// Aug 8 (per Mely): admin can optionally attach a photo per lot — if none
// is set, the lot detail view just shows the text info, no broken image.
// Reuses the 'company-assets' bucket, same one the admin's Company
// Settings hero-carousel upload already uses.
//
// Aug 19 (public-site audit): had ZERO auth check — now requires a valid
// edit token, same fix pattern as set-lot-pricing.js.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { parkId, lotName, imageBase64, fileName, token } = req.body;

    if (!parkId || !lotName || !imageBase64) {
      return res.status(400).json({ error: 'parkId, lotName, and imageBase64 are required.' });
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

    const matches = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'imageBase64 must be a data URL (data:image/...;base64,...).' });
    }
    const mimeType = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');

    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Photo must be under 5MB.' });
    }

    const cleanFileName = (fileName || 'photo.jpg')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${company.id}/lot-photos/${lotName}-${Date.now()}-${cleanFileName}`;

    const { error: uploadError } = await supabase.storage
      .from('company-assets')
      .upload(filePath, buffer, { contentType: mimeType, upsert: true });

    if (uploadError) {
      return res.status(500).json({ error: uploadError.message });
    }

    const { data: publicUrlData } = supabase.storage.from('company-assets').getPublicUrl(filePath);
    const photoUrl = publicUrlData.publicUrl;

    const { error: updateError } = await supabase
      .from('rv_lots')
      .update({ photo_url: photoUrl })
      .eq('company_id', company.id)
      .eq('lot_name', lotName);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    return res.status(200).json({ success: true, photoUrl });
  } catch (err) {
    console.error('Error uploading lot photo:', err);
    return res.status(500).json({ error: 'Could not upload lot photo' });
  }
}
