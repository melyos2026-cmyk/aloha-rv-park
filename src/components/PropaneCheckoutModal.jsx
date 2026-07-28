import { useState, useEffect } from 'react';

const PARK_ID = (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('park_id')) || 'aloha';

export default function PropaneCheckoutModal({ lotId, onClose }) {
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [gallons, setGallons] = useState('');
  const [email, setEmail] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPrices, setLoadingPrices] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/get-propane-pricing?park_id=${PARK_ID}`)
      .then((res) => res.json())
      .then((result) => {
        const list = result.products || [];
        setProducts(list);
        if (list.length > 0) setProductId(list[0].product_id);
        setLoadingPrices(false);
      })
      .catch(() => setLoadingPrices(false));
  }, []);

  const selected = products.find((p) => p.product_id === productId);
  const isVariable = selected?.unit === 'gallon';

  const subtotal = selected
    ? isVariable
      ? (parseFloat(gallons) || 0) * Number(selected.price)
      : Number(selected.price) * quantity
    : 0;
  const processingFee = subtotal * 0.04;
  const total = subtotal + processingFee;

  async function handleCheckout() {
    setError('');

    if (!selected) {
      setError('No propane products configured for this park.');
      return;
    }

    const qty = isVariable ? parseFloat(gallons) : quantity;
    if (!qty || qty <= 0) {
      setError(isVariable ? 'Ingresa los galones' : 'Cantidad inválida');
      return;
    }
    if (isVariable && qty > 200) {
      setError('Cantidad de galones demasiado alta');
      return;
    }
    if (!email && !lotNumber) {
      setError('Ingresa tu email, o el número de tu lote si sos residente.');
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
          parkId: PARK_ID,
          customerEmail: email || undefined,
          residentLot: lotNumber || undefined,
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
          <h3 style={styles.title}>⛽ Propane</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={styles.body}>
          {loadingPrices ? (
            <p style={{ fontSize: 13, color: '#666' }}>Loading prices...</p>
          ) : (
          <>
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
            {products.map((p) => (
              <option key={p.product_id} value={p.product_id}>
                {p.label} — {p.unit === 'gallon' ? `$${p.price}/gal` : `$${p.price}`}
              </option>
            ))}
          </select>
          </>
          )}

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

          <label style={styles.label}>Email (requerido)</label>
          <input
            type="email"
            style={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
          />

          <label style={styles.label}>Lote (solo residentes — opcional en vez del email)</label>
          <input
            style={styles.input}
            value={lotNumber}
            onChange={(e) => setLotNumber(e.target.value)}
            placeholder="Ej. A12"
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#555', marginBottom: 4 }}>
            <span>Subtotal</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#555', marginBottom: 8 }}>
            <span>Card Processing Fee (4%)</span>
            <span>${processingFee.toFixed(2)}</span>
          </div>
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
            {loading ? 'Processing...' : 'Pay Now'}
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
