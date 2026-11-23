import { createClient } from '@supabase/supabase-js';
import { customerFeeRatio, loadFeeSettingsRow, PROCESSING_FEE_PERCENT, PROCESSING_FEE_MINIMUM } from './_serviceFee.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// GET /api/service-fee?park_id=... — Nov 22 (per Mely): the Online Service Fee rules for the map's
// checkout previews (the same numbers the checkout APIs charge). Public: only the fee share.
export default async function handler(req, res) {
  const parkId = String(req.query?.park_id || 'aloha').replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || 'aloha';
  try {
    const { data: company } = await supabase.from('companies').select('id').eq('park_id', parkId).maybeSingle();
    const row = await loadFeeSettingsRow(supabase, company?.id);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      percent: PROCESSING_FEE_PERCENT,
      minimum: PROCESSING_FEE_MINIMUM,
      customerFeeRatio: customerFeeRatio(row),
      alwaysCustomerFeeRatio: customerFeeRatio(row, { ignorePassSwitch: true }),
    });
  } catch {
    return res.status(200).json({ percent: PROCESSING_FEE_PERCENT, minimum: PROCESSING_FEE_MINIMUM, customerFeeRatio: 1, alwaysCustomerFeeRatio: 1 });
  }
}
