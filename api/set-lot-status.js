import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_STATUSES = ['available', 'occupied', 'reserved', 'maintenance', 'for_sale'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lotName, status, parkId } = req.body || {};

    if (!lotName || !status) {
      return res.status(400).json({ error: 'Missing lotName or status' });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('id')
      .eq('park_id', parkId || 'aloha')
      .single();

    if (companyErr || !company) {
      return res.status(404).json({ error: 'Park not found' });
    }

    const { error: updateErr } = await supabase
      .from('rv_lots')
      .update({ status })
      .eq('company_id', company.id)
      .eq('lot_name', lotName);

    if (updateErr) throw updateErr;

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error setting lot status:', err);
    return res.status(500).json({ error: 'Could not set lot status' });
  }
}
