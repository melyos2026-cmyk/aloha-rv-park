import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { setCustomMap } from './App.jsx'
import 'react-datepicker/dist/react-datepicker.css'
import './index.css'

// Oct 20 (per Mely): use the park's own uploaded map picture when it has
// one (uploaded by MelyOS staff in admin.melyos.io → Map Builder). Looked up
// before the first render so the map never flashes another park's picture.
// If the lookup is slow or fails, the last known picture (or the default)
// is used.
const parkId = new URLSearchParams(window.location.search).get('park_id') || 'aloha';
const CACHE_KEY = 'mapimage_' + parkId;

function cached() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}

async function lookup() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch('/api/save-map-element?parkId=' + encodeURIComponent(parkId) + '&type=mapImage', { signal: ctrl.signal });
    if (!res.ok) return cached();
    const rows = await res.json();
    const img = Array.isArray(rows) && rows[0] && rows[0].data && rows[0].data.url ? rows[0].data : null;
    try {
      if (img) localStorage.setItem(CACHE_KEY, JSON.stringify(img));
      else localStorage.removeItem(CACHE_KEY);
    } catch {}
    return img;
  } catch {
    return cached();
  } finally {
    clearTimeout(timer);
  }
}

lookup().then((img) => {
  setCustomMap(img);
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
