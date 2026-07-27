import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/verify-edit-token?park_id=aloha&token=...
// Confirms the token was signed with MAP_EDIT_SECRET, hasn't expired, AND
// was issued for THIS park's own company_id — a token generated for a
// different company's map is rejected even though the secret is shared
// infrastructure across all park deployments.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ valid: false, error: 'Method not allowed' });
  }

  try {
    const { park_id: parkId, token } = req.query;
    const secret = process.env.MAP_EDIT_SECRET;

    if (!secret || !token || !parkId) {
      return res.status(200).json({ valid: false });
    }

    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('id')
      .eq('park_id', parkId)
      .single();

    if (companyErr || !company) {
      return res.status(200).json({ valid: false });
    }

    let decoded;
    try {
      decoded = Buffer.from(token, 'base64url').toString('utf8');
    } catch {
      return res.status(200).json({ valid: false });
    }

    const parts = decoded.split('.');
    if (parts.length !== 4) return res.status(200).json({ valid: false });
    const [tokenCompanyId, role, expiresStr, signature] = parts;

    const payload = `${tokenCompanyId}.${role}.${expiresStr}`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const validSignature =
      signature.length === expectedSignature.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

    if (!validSignature) return res.status(200).json({ valid: false });
    if (Date.now() > Number(expiresStr)) return res.status(200).json({ valid: false });
    if (tokenCompanyId !== company.id) return res.status(200).json({ valid: false });

    return res.status(200).json({ valid: true, role: role === 'master_admin' ? 'master_admin' : 'park_admin' });
  } catch (err) {
    console.error('Error verifying map edit token:', err);
    return res.status(200).json({ valid: false });
  }
}
