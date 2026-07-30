import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PARK_ID = 'aloha';

async function recomputeLotStatus(lotId) {
  const todayStr = new Date().toISOString().split('T')[0];

  const { data: activeOrders } = await supabase
    .from('lot_orders')
    .select('arrival_date, departure_date, months')
    .eq('lot_id', lotId)
    .eq('status', 'paid')
    .lte('arrival_date', todayStr)
    .gt('departure_date', todayStr);

  let newStatus = 'available';
  if (activeOrders && activeOrders.length > 0) {
    const isLongTerm = activeOrders.some((o) => (o.months || 0) > 0);
    newStatus = isLongTerm ? 'occupied' : 'reserved';
  }

  const { data: statusRow } = await supabase
    .from('map_elements')
    .select('data')
    .eq('park_id', PARK_ID)
    .eq('element_type', 'statuses')
    .eq('element_key', 'all')
    .single();

  const currentStatuses = statusRow?.data || {};
  currentStatuses[lotId] = newStatus;

  await supabase
    .from('map_elements')
    .upsert(
      { park_id: PARK_ID, element_type: 'statuses', element_key: 'all', data: currentStatuses },
      { onConflict: 'park_id,element_type,element_key' }
    );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { orderId, email } = req.body || {};
    if (!orderId || !email) {
      return res.status(400).json({ error: 'Missing order ID or email' });
    }

    const { data: order, error: orderError } = await supabase
      .from('lot_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (order.customer_email !== email) {
      return res.status(403).json({ error: 'Email does not match this booking' });
    }

    if (order.status !== 'paid') {
      return res.status(400).json({ error: 'This booking is not eligible for cancellation' });
    }

    // Scoped to THIS park's own company_id — was previously hardcoded to
    // id=1, which would silently read another park's settings once a 2nd
    // company exists on the platform.
    const { data: companyRow } = await supabase
      .from('companies')
      .select('id')
      .eq('park_id', PARK_ID)
      .maybeSingle();
    const { data: settings } = await supabase
      .from('park_settings')
      .select('cancellation_days')
      .eq('company_id', companyRow?.id)
      .maybeSingle();

    const cancellationDays = settings?.cancellation_days ?? 7;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const arrival = new Date(order.arrival_date + 'T00:00:00');
    const daysUntilArrival = Math.round((arrival - today) / 86400000);

    if (daysUntilArrival < cancellationDays) {
      return res.status(400).json({
        error: `Cancellations must be made at least ${cancellationDays} day(s) before arrival. This booking is not eligible for a refund.`,
      });
    }

    if (order.stripe_payment_intent) {
      await stripe.refunds.create({ payment_intent: order.stripe_payment_intent });
    }

    const { error: updateError } = await supabase
      .from('lot_orders')
      .update({ status: 'refunded' })
      .eq('id', orderId);

    if (updateError) {
      console.error('Error updating order status:', updateError);
    }

    await recomputeLotStatus(order.lot_id);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error cancelling booking:', err);
    return res.status(500).json({ error: 'Could not process cancellation' });
  }
}
