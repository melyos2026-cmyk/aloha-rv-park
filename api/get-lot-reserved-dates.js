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
      .select('lot_name, reserved_until')
      .eq('company_id', company.id);

    if (lotsErr) throw lotsErr;

    const dates = {};
    (lots || []).forEach((l) => {
      if (l.reserved_until) dates[l.lot_name] = l.reserved_until;
    });

    return res.status(200).json(dates);
  } catch (err) {
    console.error('Error fetching lot reserved-until dates:', err);
    return res.status(500).json({ error: 'Could not fetch reserved dates' });
  }
}
