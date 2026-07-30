import { useState } from 'react';

const LABELS = { daily: 'Daily', monthly: 'Monthly', yearly: 'Yearly' };
const UNIT_LABELS = { daily: 'day(s)', monthly: 'month(s)', yearly: 'year(s)' };

// Limited storage spots — always call-the-office, regardless of any
// lot_info.phone_only flag (which has been unreliable to keep in sync).
// Checking the lot ID directly here means this can never silently fail.
const PHONE_ONLY_LOTS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];

export default function StorageCheckoutModal({ lotId, lotInfo, onClose }) {
  const isPhoneOnly = PHONE_ONLY_LOTS.includes(lotId) || !!lotInfo?.phone_only;
  const [billingType, setBillingType] = useState('monthly');
  const [quantity, setQuantity] = useState(1);
  const [isSubscription, setIsSubscription] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const rate =
    billingType === 'daily' ? lotInfo?.price_daily :
    billingType === 'monthly' ? lotInfo?.price_monthly :
    lotInfo?.price_yearly;

  const available = !!rate && rate > 0;
  const total = isSubscription ? rate : (rate || 0) * quantity;

  function handleBillingChange(type) {
    setBillingType(type);
    setQuantity(1);
    setIsSubscription(false);
    setError('');
  }

  async function handleCheckout() {
    setError('');

    if (!available) {
      setError('This option is not available right now');
      return;
    }
    if (!isSubscription && (!quantity || quantity <= 0)) {
      setError('Invalid quantity');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/create-storage-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lotId,
          billingType,
          quantity,
          isSubscription,
          rate,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Error creating payment');
      }

      window.location.href = data.url;
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>🚐 RV Storage — Lot {lotId}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={styles.body}>
          <div style={styles.detailsBox}>
            <div style={styles.detailRow}>
              <span>Type</span>
              <span style={styles.detailValue}>{lotInfo?.lot_type === 'indoor' ? 'Indoor' : 'Outdoor'}</span>
            </div>
            {lotInfo?.size && (
              <div style={styles.detailRow}>
                <span>Size</span>
                <span style={styles.detailValue}>{lotInfo.size}</span>
              </div>
            )}
            <div style={styles.detailRow}>
              <span>Electricity</span>
              <span style={styles.detailValue}>
                {lotInfo?.has_electricity ? `Yes (${lotInfo.amperage} Amp)` : 'No'}
              </span>
            </div>
          </div>

          {lotInfo?.description && (
            <div style={styles.descBox}>{lotInfo.description}</div>
          )}

          {isPhoneOnly ? (
            <div style={styles.detailsBox}>
              <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
                Need RV storage?
                <br />
                Please contact the office for current availability and pricing.
                <br />
                📞 Phone: (689) 252-0567
              </p>
            </div>
          ) : (
          <>
          <label style={styles.label}>Billing Type</label>
          <select
            style={styles.select}
            value={billingType}
            onChange={(e) => handleBillingChange(e.target.value)}
          >
            <option value="daily" disabled={!lotInfo?.price_daily}>
              Daily {lotInfo?.price_daily ? `— $${lotInfo.price_daily}/day` : '(not available)'}
            </option>
            <option value="monthly" disabled={!lotInfo?.price_monthly}>
              Monthly {lotInfo?.price_monthly ? `— $${lotInfo.price_monthly}/month` : '(not available)'}
            </option>
            <option value="yearly" disabled={!lotInfo?.price_yearly}>
              Yearly {lotInfo?.price_yearly ? `— $${lotInfo.price_yearly}/year` : '(not available)'}
            </option>
          </select>

          {billingType !== 'daily' && (
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={isSubscription}
                onChange={(e) => setIsSubscription(e.target.checked)}
              />
              <span>Auto-renew automatically ({LABELS[billingType].toLowerCase()} subscription)</span>
            </label>
          )}

          {!isSubscription && (
            <>
              <label style={styles.label}>
                Quantity ({UNIT_LABELS[billingType]})
              </label>
              <input
                type="number"
                min="1"
                step="1"
                style={styles.input}
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
              />
            </>
          )}

          <div style={styles.totalRow}>
            <span>{isSubscription ? `Charged ${LABELS[billingType].toLowerCase()}` : 'Total'}</span>
            <span style={styles.totalAmount}>${total.toFixed(2)}</span>
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button
            style={{ ...styles.payBtn, opacity: loading || !available ? 0.6 : 1 }}
            onClick={handleCheckout}
            disabled={loading || !available}
          >
            {loading ? 'Processing...' : isSubscription ? 'Subscribe' : 'Pay Now'}
          </button>
          </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#fff',
    borderRadius: 12,
    width: 340,
    maxWidth: '90vw',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    overflow: 'hidden',
    fontFamily: 'Inter, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px',
    borderBottom: '1px solid #eee',
  },
  title: { margin: 0, fontSize: 16, fontWeight: 600 },
  closeBtn: {
    border: 'none',
    background: 'none',
    fontSize: 22,
    lineHeight: 1,
    cursor: 'pointer',
    color: '#666',
  },
  body: { padding: 16, display: 'flex', flexDirection: 'column', gap: 8 },
  detailsBox: {
    background: '#f9fafb',
    borderRadius: 8,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 13,
    color: '#6b7280',
  },
  detailValue: { fontWeight: 600, color: '#374151' },
  descBox: {
    background: '#f0fdf4',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 13,
    color: '#166534',
  },
  label: { fontSize: 12, fontWeight: 600, color: '#555', marginTop: 6 },
  select: {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #ddd',
    fontSize: 14,
  },
  input: {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #ddd',
    fontSize: 14,
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: '#444',
    marginTop: 4,
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    fontSize: 15,
    fontWeight: 600,
  },
  totalAmount: { color: '#16a34a', fontSize: 18 },
  error: {
    background: '#fef2f2',
    color: '#dc2626',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 13,
  },
  payBtn: {
    marginTop: 8,
    padding: '10px 14px',
    borderRadius: 8,
    border: 'none',
    background: '#635bff',
    color: '#fff',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
};
