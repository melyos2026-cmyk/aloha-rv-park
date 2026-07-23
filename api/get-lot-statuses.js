import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const parkId = req.query.park_id || 'aloha';

    // rv_lots is scoped by company_id, not park_id — companies.park_id is
    // the bridge between this map's park_id string and that UUID.
    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('id')
      .eq('park_id', parkId)
      .single();

    if (companyErr || !company) {
      return res.status(404).json({ error: 'Park not found' });
    }

    const { data: lots, error: lotsErr } = await supabase
      .from('rv_lots')
      .select('lot_name, status')
      .eq('company_id', company.id);

    if (lotsErr) throw lotsErr;

    const statuses = {};
    (lots || []).forEach((l) => {
      statuses[l.lot_name] = l.status || 'available';
    });

    return res.status(200).json(statuses);
  } catch (err) {
    console.error('Error fetching lot statuses:', err);
    return res.status(500).json({ error: 'Could not fetch lot statuses' });
  }
}
