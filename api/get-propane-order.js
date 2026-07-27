import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/get-propane-order?session_id=...
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { session_id: sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'session_id is required' });
    }

    const { data, error } = await supabase
      .from('propane_orders')
      .select('product_label, quantity, unit, amount_total, qr_token, redeemed')
      .eq('stripe_session_id', sessionId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Order not found yet — please wait a moment and refresh.' });
    }

    return res.status(200).json({ order: data });
  } catch (err) {
    console.error('Error fetching propane order:', err);
    return res.status(500).json({ error: 'Could not fetch order' });
  }
}
