// Nov 22 (per Mely — "Online Service Fee", Ticketmaster style): same rules as aloha-rv-park-web's
// src/lib/platformFee.ts and melyos-builder's lib/connectSplit.ts (keep all three in sync).
// The fee on every online payment is 3.5% (minimum $2.25). Each park decides in Fee Settings how
// much of the 3.5% its customers pay (company_fee_settings.customer_fee_percent, 0–3.5); the park
// pays the rest out of its payout. NULL (never set) = the old switch (pass_processing_fee_to_resident).
// (Files starting with "_" are not served as API routes by Vercel.)
export const PROCESSING_FEE_PERCENT = 0.035;
export const PROCESSING_FEE_MINIMUM = 2.25;
export const ONLINE_SERVICE_FEE_LABEL = 'Online Service Fee';
export const ONLINE_SERVICE_FEE_DESCRIPTION = 'Covers secure online payment processing and the MelyOS online booking & account platform.';

const roundCents = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function calculateProcessingFee(amount) {
  return roundCents(Math.max(amount * PROCESSING_FEE_PERCENT, PROCESSING_FEE_MINIMUM));
}

export function customerFeeRatio(settings, opts = {}) {
  const raw = settings?.customer_fee_percent;
  if (raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw))) {
    return Math.min(Math.max(Number(raw) / (PROCESSING_FEE_PERCENT * 100), 0), 1);
  }
  if (opts.ignorePassSwitch) return 1;
  return settings?.pass_processing_fee_to_resident === false ? 0 : 1;
}

/** Fee in CENTS → { customerCents, parkCents } (whole cents, same rounding as the website). */
export function splitServiceFeeCents(feeCents, ratio) {
  const f = Math.round(feeCents);
  const r = Math.min(Math.max(Number(ratio) || 0, 0), 1);
  const customerCents = Math.min(Math.round(f * r), f);
  return { customerCents, parkCents: f - customerCents };
}

export async function loadFeeSettingsRow(supabase, companyId) {
  if (!companyId) return null;
  const { data } = await supabase.from('company_fee_settings').select('*').eq('company_id', companyId).maybeSingle();
  return data || null;
}
