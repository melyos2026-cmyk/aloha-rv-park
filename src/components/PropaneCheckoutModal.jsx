import { useState } from 'react';

const PRODUCTS = [
  { id: '20lb', label: '20 LB Tank', price: 18, type: 'fixed' },
  { id: '30lb', label: '30 LB Tank', price: 30, type: 'fixed' },
  { id: '40lb', label: '40 LB Tank', price: 36, type: 'fixed' },
  { id: 'forklift', label: 'Forklift', price: 36, type: 'fixed' },
  { id: 'motorhome', label: 'Motor Home 40LB Tank', pricePerGallon: 4.25, type: 'variable' },
];

export default function PropaneCheckoutModal({ lotId, onClose }) {
  const [productId, setProductId] = useState('20lb');
  const [quantity, setQuantity] = useState(1);
  const [gallons, setGallons] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selected = PRODUCTS.find((p) => p.id === productId);
  const isVariable = selected.type === 'variable';

  const total = isVariable
    ? (parseFloat(gallons) || 0) * selected.pricePerGallon
    : selected.price * quantity;

  async function handleCheckout() {
    setError('');

    const qty = isVariable ? parseFloat(gallons) : quantity;
    if (!qty || qty <= 0) {
      setError(isVariable ? 'Ingresa los galones' : 'Cantidad inválida');
      return;
    }
    if (isVariable && qty > 200) {
      setError('Cantidad de galones demasiado alta');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          quantity: qty,
          lotId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Error al crear el pago');
      }

      window.location.href = data.url;
    } catch (err) {
      setError(err.message || 'Algo salió mal. Intenta de nuevo.');
      setLoading(false);
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>⛽ Propano {lotId ? `— Lote ${lotId}` : ''}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={styles.body}>
          <label style={styles.label}>Producto</label>
          <select
            style={styles.select}
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              setQuantity(1);
              setGallons('');
              setError('');
            }}
          >
            {PRODUCTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.type === 'fixed' ? `$${p.price}` : `$${p.pricePerGallon}/gal`}
              </option>
            ))}
          </select>

          {isVariable ? (
            <>
              <label style={styles.label}>Galones</label>
              <input
                type="number"
                min="0.1"
                step="0.1"
                style={styles.input}
                value={gallons}
                onChange={(e) => setGallons(e.target.value)}
                placeholder="Ej. 8.5"
              />
            </>
          ) : (
            <>
              <label style={styles.label}>Cantidad</label>
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
            <span>Total</span>
            <span style={styles.totalAmount}>${total.toFixed(2)}</span>
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button
            style={{ ...styles.payBtn, opacity: loading ? 0.6 : 1 }}
            onClick={handleCheckout}
            disabled={loading}
          >
            {loading ? 'Redirigiendo...' : 'Pagar con Stripe'}
          </button>
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
    width: 320,
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
