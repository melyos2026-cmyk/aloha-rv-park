import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/get-propane-pricing?park_id=aloha
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const parkId = req.query.park_id || 'aloha';

    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('id')
      .eq('park_id', parkId)
      .single();

    if (companyErr || !company) {
      return res.status(404).json({ error: 'Park not found' });
    }

    const { data, error } = await supabase
      .from('propane_pricing')
      .select('product_id, label, price, unit, taxable')
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
  } catch (err) {
    console.error('Error fetching propane pricing:', err);
    return res.status(500).json({ error: 'Could not fetch propane pricing' });
  }
}
