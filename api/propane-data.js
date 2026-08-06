import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getPricing(req, res) {
  const parkId = req.query.park_id || 'aloha';

  const { data: company, error: companyErr } = await supabase
    .from('companies')
    .select('id')
    .eq('park_id', parkId)
    .single();

  if (companyErr || !company) return res.status(404).json({ error: 'Park not found' });

  const { data, error } = await supabase
    .from('propane_pricing')
    .select('product_id, label, price, unit, taxable, tax_mode')
    .eq('company_id', company.id);

  if (error) throw error;

  const { data: taxSettings } = await supabase
    .from('company_tax_settings')
    .select('enable_tax, manual_tax_rate_percent')
    .eq('company_id', company.id)
    .maybeSingle();

  return res.status(200).json({
    products: data || [],
    tax: {
      enabled: !!taxSettings?.enable_tax,
      ratePercent: Number(taxSettings?.manual_tax_rate_percent || 0),
    },
  });
}

async function getOrder(req, res) {
  const { session_id: sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'session_id is required' });

  const { data, error } = await supabase
    .from('propane_orders')
    .select('product_label, quantity, unit, amount_total, qr_token, redeemed')
    .eq('stripe_session_id', sessionId)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Order not found yet — please wait a moment and refresh.' });
  }

  return res.status(200).json({ order: data });
}

// GET /api/propane-data?type=pricing&park_id=aloha
// GET /api/propane-data?type=order&session_id=...
//
// Consolidated from get-propane-pricing and get-propane-order to stay
// under Vercel's Hobby-plan 12-serverless-function limit per deployment.
// Response shapes are unchanged from the originals.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type } = req.query;

  try {
    if (type === 'pricing') return await getPricing(req, res);
    if (type === 'order') return await getOrder(req, res);
    return res.status(400).json({ error: 'Missing or invalid type parameter' });
  } catch (err) {
    console.error(`Error in propane-data (type=${type}):`, err);
    return res.status(500).json({ error: 'Could not fetch propane data' });
  }
}
