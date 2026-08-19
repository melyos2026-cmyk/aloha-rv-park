import crypto from 'crypto';

// Aug 19 (public-site audit): every map write endpoint (save-map-element,
// set-lot-status, set-lot-pricing, upload-lot-photo, cancel-lot-booking,
// save-to-github) had ZERO server-side authorization — the edit token
// was only ever checked client-side (verify-edit-token.js, called once
// on page load purely to decide whether the EDITOR UI shows itself).
// Anyone who found these URLs directly could change any lot's status or
// PRICE, upload arbitrary photos, cancel a real resident's paid booking,
// or overwrite the live app's own source code on GitHub — with no login
// of any kind. This extracts the same HMAC verification logic already
// used by verify-edit-token.js into a reusable function so every write
// route can require a valid, non-expired, correct-company token before
// doing anything.
//
// Returns { valid: true, role } or { valid: false }. Callers should
// reject the request (401/403) when valid is false — never proceed.
export async function checkEditToken(token, parkId, supabase, requiredRole = null) {
  const secret = process.env.MAP_EDIT_SECRET;
  if (!secret || !token || !parkId) return { valid: false };

  const { data: company, error: companyErr } = await supabase
    .from('companies')
    .select('id')
    .eq('park_id', parkId)
    .single();
  if (companyErr || !company) return { valid: false };

  let decoded;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return { valid: false };
  }

  const parts = decoded.split('.');
  if (parts.length !== 4) return { valid: false };
  const [tokenCompanyId, role, expiresStr, signature] = parts;

  const payload = `${tokenCompanyId}.${role}.${expiresStr}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  const validSignature =
    signature.length === expectedSignature.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

  if (!validSignature) return { valid: false };
  if (Date.now() > Number(expiresStr)) return { valid: false };
  if (tokenCompanyId !== company.id) return { valid: false };

  const resolvedRole = role === 'master_admin' ? 'master_admin' : 'park_admin';
  if (requiredRole === 'master_admin' && resolvedRole !== 'master_admin') return { valid: false };

  return { valid: true, role: resolvedRole };
}
