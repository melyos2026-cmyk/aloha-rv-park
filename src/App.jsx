import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import PropaneCheckoutModal from './components/PropaneCheckoutModal';
import StorageCheckoutModal from './components/StorageCheckoutModal';
import LotSearch from './components/LotSearch';
import LotCheckoutModal from './components/LotCheckoutModal';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Rnd } from "react-rnd";

let MAP_IMG = "/AlohaRvParkMap.webp"; // Oct 13: same map, ~5x smaller file = loads much faster
// Oct 20 (per Mely — MelyOS staff upload each company's own map in
// admin.melyos.io → Map Builder): main.jsx looks up the park's uploaded
// picture (map_elements 'mapImage') before the map renders and calls
// setCustomMap. Parks without one keep the default picture and lots.
let HAS_CUSTOM_MAP = false;
let MAP_W = 1116, MAP_H = 1409;
export function setCustomMap(img) {
  if (!img || !img.url || !(img.width > 0) || !(img.height > 0)) return;
  MAP_IMG = img.url;
  MAP_W = img.width;
  MAP_H = img.height;
  MAP_ASPECT_RATIO = img.height / img.width;
  HAS_CUSTOM_MAP = true;
}
// Aug 12 (per Mely): the map/lot/emoji positioning system hardcoded the
// image's aspect ratio as 1130/900 (1.2556), but the real PNG is
// 1116x1409 (1.2625) — a small mismatch that compounds into visible
// vertical drift for absolutely-positioned emojis/lots, worse at wider
// container sizes (desktop) than narrower ones (mobile), which is why
// the same saved position could look correctly aligned in one view but
// off in another even though it's the same underlying % coordinate.
// Update this if the map image is ever replaced with a different size.
let MAP_ASPECT_RATIO = 1409 / 1116;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
console.log("DEBUG SUPABASE_URL:", SUPABASE_URL);
console.log("DEBUG SUPABASE_KEY length:", SUPABASE_KEY ? SUPABASE_KEY.length : "undefined/null");
console.log("DEBUG all env:", import.meta.env);
const PARK_ID_PROVIDED = typeof window !== "undefined" && !!new URLSearchParams(window.location.search).get("park_id");
const PARK_ID = (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("park_id")) || 'aloha';
let cachedCompanyId = null;
let cachedCompanyProfile = null;
async function getCompanyProfile() {
  if (cachedCompanyProfile) return cachedCompanyProfile;
  // Aug 19 (per Mely — caught this live: "el mapa necesita supabase para
  // los emoji, estas mirando eso sin que se rompa?"): this was a direct
  // anon-key fetch to the raw companies table, which relied on the
  // "Public can view company info" policy dropped earlier today (closing
  // a real gap: EIN/business_license/account_number were exposed to
  // anyone with the anon key). Pointed at the new public_company_profile
  // VIEW instead — same "id" column, no sensitive fields exist in it at
  // all, and PostgREST exposes views through the same REST endpoint
  // shape as tables, so nothing else about this call needed to change.
  //
  // Sep 21 (per Mely — building a second demo company, "Sunset Ridge",
  // found live: several UI strings on this map hardcoded "Aloha RV
  // Park" and its real street address, so a second company's map showed
  // Aloha's own branding). Expanded the select to also pull
  // company_name/address, cached alongside the id, so every hardcoded
  // "Aloha RV Park" mention below can use the real per-company values
  // instead — Aloha's own map is unaffected since its real name/address
  // are exactly what's already been showing.
  const res = await fetch(SUPABASE_URL + '/rest/v1/public_company_profile?park_id=eq.' + PARK_ID + '&select=id,company_name,address', {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  const rows = await res.json();
  cachedCompanyProfile = rows[0] || null;
  cachedCompanyId = cachedCompanyProfile?.id || null;
  return cachedCompanyProfile;
}
async function getCompanyId() {
  if (cachedCompanyId) return cachedCompanyId;
  const profile = await getCompanyProfile();
  return profile?.id || null;
}

async function saveToSupabase(type, key, data, token) {
  const companyId = await getCompanyId();
  // Aug 12 (per Mely — "coordinates keep reverting after refresh"): was
  // writing directly to map_elements with the public anon key
  // (VITE_SUPABASE_KEY) from the browser — the exact same pattern that
  // caused silent failures on many other tables throughout this whole
  // project (RLS quietly blocking anon-key writes, fetch still
  // resolves with no thrown error). Routed through a new Service-Role-
  // Key server route instead, which bypasses RLS entirely and actually
  // surfaces an error if something fails.
  const res = await fetch('/api/save-map-element', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parkId: PARK_ID, companyId, type, key, data, token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('saveToSupabase failed:', type, err);
  }
  return res.ok;
}

// Oct 30 (per Mely — "View as park admin", read only): when the admin opens the editor with a
// read-only token, every write this page would send is stopped here, in the browser, and a short
// "Read-only view" note is shown. The server refuses those tokens too (api/_editTokenAuth.js).
let mapReadOnlyInstalled = false;
function installMapReadOnlyGuard() {
  if (mapReadOnlyInstalled || typeof window === 'undefined') return;
  mapReadOnlyInstalled = true;
  const original = window.fetch.bind(window);
  let lastNote = 0;
  const note = () => {
    if (Date.now() - lastNote < 2500) return;
    lastNote = Date.now();
    try {
      const el = document.createElement('div');
      el.setAttribute('role', 'status');
      el.textContent = 'Read-only view — changes are not saved.';
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;background:#1c1917;color:#fafaf9;font:600 13px/1.3 system-ui,sans-serif;padding:10px 16px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.25)';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3200);
    } catch { /* ignore */ }
  };
  window.fetch = function (input, init) {
    try {
      const method = String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        note();
        return Promise.resolve(new Response(JSON.stringify({ error: 'Read-only view', viewAs: true }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
      }
    } catch { /* fall through */ }
    return original(input, init);
  };
}

async function saveLotInfo(parkId, lotKey, info, token) {
  const res = await fetch('/api/save-lot-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parkId, lotKey, info, token }),
  });
  return res.ok;
}

// Aug 12 (per Mely): consolidated from 2 separate buttons ("Save Lot
// Info" + "Save Changes") into one — this runs first inside whichever
// single save button is showing (AlohaMap's edit panel), so one click
// saves everything instead of needing both. Module-level (like
// saveLotInfo above) rather than a closure inside AlohaMap, so it's not
// tied to one component's scope.
async function saveActiveLotInfo(activeEditLot, lotInfo, token) {
  if (!activeEditLot) return;
  const info = lotInfo[activeEditLot] || {};
  if (activeEditLot.startsWith("S")) {
    await saveLotInfo(PARK_ID, activeEditLot, {
      lot_type: info.lot_type || "outdoor",
      size: info.size || "",
      has_electricity: info.has_electricity || false,
      amperage: info.has_electricity ? (info.amperage || 30) : null,
      price_daily: info.price_daily || 10,
      price_monthly: info.price_monthly || 100,
      price_yearly: info.price_yearly || null,
      description: info.description || ""
    }, token);
  } else {
    // Oct 30 (per Mely): an RV lot's Yearly price is set only in the admin's
    // Lots & Seasonal Pricing (still stored in lot_info.price_yearly), so the
    // map editor no longer sends it and can't overwrite it.
    await fetch('/api/set-lot-pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parkId: PARK_ID,
        lotName: activeEditLot,
        // Oct 30: prices are no longer sent from the map editor (Lots & Seasonal Pricing owns them).
        maxLengthFt: info.max_length_ft,
        maxWidthFt: info.max_width_ft,
        ampService: info.amp_service,
        maxDriverSlideOuts: info.max_driver_slide_outs,
        maxPassengerSlideOuts: info.max_passenger_slide_outs,
        description: info.description,
        token,
      }),
    });
  }
}

async function ensureRealEstateListing(lotKey, token) {
  await fetch('/api/ensure-real-estate-listing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parkId: PARK_ID, lotKey, listingType: 'sale', token }),
  });
}

// Aug 14 (per Mely): a "For Rent" lot is always park-owned inventory —
// residents can't put their own homes up for straight rental (only for
// sale/rent-to-own via the resident-consignment flow), so seller_type is
// hardcoded 'park' here, unlike the sale listing above which the admin
// may later reassign to a resident seller from RealEstateModule.
async function ensureRentListing(lotKey, token) {
  await fetch('/api/ensure-real-estate-listing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parkId: PARK_ID, lotKey, listingType: 'rent', token }),
  });
}

async function loadLotInfo(parkId) {
  const res = await fetch('/api/lot-info?parkId=' + encodeURIComponent(parkId));
  if (!res.ok) return {};
  return res.json();
}
async function saveParkSettings(settings, token) {
  const res = await fetch('/api/save-park-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parkId: PARK_ID, settings, token }),
  });
  return res.ok;
}
async function loadParkSettings() {
  // Resolve this park's own company_id first, then load ITS park_settings
  // row — was previously hardcoded to id=eq.1 (assumed there'd only ever
  // be one park_settings row), which would silently read another park's
  // settings once a 2nd company exists on the platform.
  const companyId = await getCompanyId();
  if (!companyId) return null;

  // Oct 22 (security): only the public booking settings (never payment account details).
  const res = await fetch(SUPABASE_URL + '/rest/v1/park_settings?select=checkin_time,checkout_time,cancellation_days,lease_defaults&company_id=eq.' + companyId, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// Oct 13 (per Mely): remember the last-loaded map look in this browser so the
// lots appear instantly on repeat visits; fresh data still replaces it a moment later.
const MAP_CACHE_KEY = 'mapcache_' + PARK_ID;
function readMapCache() { try { return JSON.parse(localStorage.getItem(MAP_CACHE_KEY) || 'null'); } catch { return null; } }
function writeMapCache(o) { try { localStorage.setItem(MAP_CACHE_KEY, JSON.stringify(o)); } catch {} }
const MAP_CACHE = readMapCache();

async function loadFromSupabase(type) {
  const res = await fetch('/api/save-map-element?parkId=' + encodeURIComponent(PARK_ID) + '&type=' + encodeURIComponent(type));
  return res.ok ? await res.json() : [];
}


// ═══ Lot coordinate definitions [x_pct, y_pct, w_pct, h_pct] ═══
// Based on the 900x1130 resized map image

const LOTS = {
  A8: [9.0, 16.7, 4.1, 5.3],
  A7: [13.0, 16.7, 4.1, 5.3],
  A6: [17.1, 16.7, 4.1, 5.3],
  A5: [21.1, 16.7, 4.1, 5.3],
  A4: [25.1, 16.8, 4.1, 5.4],
  A3: [29.1, 16.8, 4.1, 5.4],
  A2: [33.2, 16.8, 4.1, 5.4],
  A9: [7.7, 22.2, 3.9, 5.7],
  A11: [11.5, 22.2, 4.2, 5.7],
  A13: [15.7, 22.3, 4.2, 5.7],
  A15: [19.8, 22.3, 4.3, 5.7],
  A17: [24.0, 22.4, 4.3, 5.7],
  A19: [28.2, 22.4, 4.2, 5.7],
  A21: [32.4, 22.5, 4.3, 5.6],
  A23: [36.6, 22.5, 4.1, 5.6],
  A25: [40.6, 22.6, 4.3, 5.6],
  A27: [44.8, 22.6, 4.2, 5.6],
  A29: [49.0, 22.7, 4.2, 5.6],
  A31: [53.1, 22.7, 4.1, 5.6],
  A10: [4.2, 31.1, 3.7, 6.0],
  A12: [7.9, 31.2, 3.7, 6.0],
  A14: [11.6, 31.2, 3.7, 6.0],
  A16: [15.2, 31.2, 3.7, 6.1],
  A18: [18.9, 31.3, 3.9, 6.0],
  A20: [22.8, 31.3, 3.6, 6.0],
  A22: [26.3, 31.3, 3.7, 6.1],
  A24: [29.9, 31.4, 3.9, 6.0],
  A26: [33.7, 31.4, 3.6, 6.1],
  A28: [37.2, 31.5, 3.8, 6.0],
  A30: [40.9, 31.5, 3.8, 6.1],
  A32: [44.6, 31.5, 3.8, 6.1],
  A34: [51.8, 37.9, 6.0, 6.4],
  B1: [63.9, 24.2, 5.4, 2.8],
  B2: [63.9, 27.0, 5.4, 2.8],
  B3: [63.9, 29.7, 5.4, 2.8],
  B4: [63.9, 32.5, 5.4, 2.7],
  B5: [63.9, 35.2, 5.4, 2.7],
  B6: [63.9, 37.9, 5.4, 2.9],
  B7: [63.9, 40.8, 5.4, 2.7],
  B8: [63.9, 43.5, 5.4, 2.7],
  B9: [63.9, 46.2, 5.4, 2.7],
  B10: [63.9, 48.8, 5.4, 2.8],
  B11: [63.9, 51.6, 5.4, 2.7],
  B12: [63.8, 57.5, 5.4, 2.4],
  B13: [63.8, 59.8, 5.4, 2.3],
  B14: [63.8, 62.1, 5.4, 2.4],
  B15: [63.8, 64.5, 5.4, 2.3],
  B16: [63.8, 66.8, 5.4, 2.4],
  B17: [63.8, 69.1, 5.4, 2.4],
  B18: [63.8, 71.5, 5.4, 2.4],
  B19: [63.8, 73.9, 5.4, 2.4],
  B20: [63.8, 76.2, 5.4, 2.4],
  B21: [63.8, 78.5, 5.4, 2.4],
  B22: [63.8, 80.9, 5.4, 2.5],
  B23: [63.8, 83.3, 5.4, 2.4],
  B24: [63.8, 85.7, 5.4, 2.5],
  B25: [63.8, 88.2, 5.4, 2.5],
  B26: [63.8, 90.6, 5.4, 2.3],
  B27: [63.8, 92.9, 5.4, 2.3],
  C1: [73.7, 93.4, 5.8, 1.9],
  C2: [73.7, 91.6, 5.8, 1.9],
  C3: [73.7, 89.6, 5.8, 2.0],
  C4: [73.7, 87.8, 5.8, 1.9],
  C5: [73.7, 85.8, 5.8, 2.0],
  C6: [73.7, 83.8, 5.8, 2.0],
  C7: [73.7, 81.8, 5.8, 2.0],
  C8: [73.7, 79.7, 5.8, 2.1],
  C9: [73.7, 77.9, 5.8, 1.9],
  C10: [73.7, 76.0, 5.8, 1.9],
  C11: [73.7, 74.0, 5.8, 2.0],
  C12: [73.7, 72.2, 5.8, 1.9],
  C13: [73.7, 70.4, 5.8, 1.9],
  D1: [73.7, 47.9, 4.2, 2.8],
  D3: [73.7, 45.2, 4.2, 2.7],
  D5: [73.7, 42.5, 4.2, 2.7],
  D7: [73.7, 39.6, 4.2, 2.9],
  D9: [73.7, 36.8, 4.2, 2.8],
  D11: [73.7, 34.0, 4.2, 2.8],
  D13: [73.7, 31.2, 4.2, 2.8],
  D15: [73.7, 28.3, 4.2, 2.9],
  D17: [73.7, 24.8, 4.2, 3.5],
  D2: [78.3, 48.3, 4.3, 3.2],
  D4: [78.3, 45.4, 4.3, 2.9],
  D6: [78.3, 42.4, 4.3, 3.0],
  D8: [78.3, 39.5, 4.3, 2.9],
  D10: [78.3, 36.6, 4.3, 2.9],
  D12: [78.3, 33.7, 4.3, 2.9],
  D14: [78.3, 30.8, 4.3, 2.9],
  D16: [78.3, 27.8, 4.3, 3.0],
  D19: [78.3, 24.8, 4.3, 3.0],
  D20: [86.8, 13.4, 5.2, 5.0],
  S1: [82.2, 58.0, 4.4, 2.7],
  S2: [86.5, 58.0, 4.8, 2.7],
  S3: [82.2, 60.6, 4.4, 2.7],
  S4: [86.5, 60.6, 4.8, 2.7],
  S6: [86.5, 63.2, 4.8, 2.5],
  S5: [82.2, 63.2, 4.4, 2.5],
};

const ALL_LOTS = Object.keys(LOTS);

const STATUS_COLORS = {
  available:   "rgba(34,197,94,0.65)",
  occupied:    "rgba(239,68,68,0.7)",
  reserved:    "rgba(234,179,8,0.72)",
  maintenance: "rgba(107,114,128,0.7)",
  for_sale:    "rgba(172,103,221,0.7)",
  for_rent:    "rgba(139,92,246,0.7)",
};

const STATUS_SOLID = {
  available:   "#16a34a",
  occupied:    "#dc2626",
  reserved:    "#ca8a04",
  maintenance: "#4b5563",
  for_sale:    "#ac67dd",
  for_rent:    "#8b5cf6",
};

// Fallback statuses, only used for the instant before the real fetch
// from rv_lots resolves (or if that fetch fails).
function initStatuses() {
  const s = {};
  ALL_LOTS.forEach(l => { s[l] = "available"; });
  return s;
}

// ═══ Booking Modal ═══
function calcStayPreview(arrivalStr, departureStr, hasWeekly) {
  const arrival = new Date(arrivalStr + "T00:00:00");
  const departure = new Date(departureStr + "T00:00:00");
  const totalNights = Math.round((departure - arrival) / 86400000);

  if (totalNights === 365) {
    return { isYearly: true, months: 0, weeks: 0, extraDays: 0, totalNights };
  }

  let months = 0;
  let cursor = new Date(arrival);
  while (true) {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    if (next <= departure) {
      months++;
      cursor = next;
    } else {
      break;
    }
  }
  const remainingAfterMonths = Math.round((departure - cursor) / 86400000);
  const weeks = hasWeekly ? Math.floor(remainingAfterMonths / 7) : 0;
  // Standard checkin/checkout billing: nights = departure date - arrival
  // date (e.g. arrive Thu 7/30 4pm, depart Sat 8/1 11am = 2 nights, not 3).
  const extraDays = remainingAfterMonths - (weeks * 7);

  return { isYearly: false, months, weeks, extraDays, totalNights };
}

// Oct 21 (per Mely): sample lot photo for demo parks (lots without their own photo).
// Served by this map app itself, so it loads wherever the map is shown.
const DEMO_LOT_PHOTO = "/demo-lot-photo.jpg";
const DEFAULT_LOT_PHOTO = { "sunset-ridge": DEMO_LOT_PHOTO };
const lotPhoto = (url) => (url && url.includes("demo-lot-photo.jpg") ? DEMO_LOT_PHOTO : url) || DEFAULT_LOT_PHOTO[PARK_ID] || null;

function BookingModal({ lot, status, lotInfo, parkSettings, reservedUntil, requiresCallOffice, prefill, onClose }) {
  // Oct 22 (per Mely — "estadía de más de 15 días, no 32 noches"): any stay longer than the park's
  // application threshold (Lease Defaults, default 15 days) goes to Apply. Dates from the search
  // bar come pre-filled.
  const longStayDays = Number(parkSettings?.lease_defaults?.background_check_threshold_days) || 15;
  const prefillLong = !!(prefill && prefill.arrival && prefill.departure && Math.round((new Date(prefill.departure + "T00:00:00") - new Date(prefill.arrival + "T00:00:00")) / 86400000) > longStayDays);
  const [form, setForm] = useState({ arrival: prefill?.arrival || "", departure: prefillLong ? "" : (prefill?.departure || ""), rvLength: prefill?.rvLength ? String(prefill.rvLength) : "", slideOutDriverCount: prefill?.slideOutDriverCount || "", slideOutPassengerCount: prefill?.slideOutPassengerCount || "" });
  const [longStay, setLongStay] = useState(prefillLong);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bookedRanges, setBookedRanges] = useState([]);
  const [loadingAvailability, setLoadingAvailability] = useState(true);
  const [allowLotBooking, setAllowLotBooking] = useState(!lotInfo?.phone_only && !requiresCallOffice);
  const [listing, setListing] = useState(null);
  // Only 'available' and 'reserved' (soon-vacating, known move-out date) lots
  // can be booked here. A solid 'occupied' lot has no known availability at
  // all — showing a booking form there would let someone pick dates with no
  // real guarantee the lot will ever be free then.
  const canBookStatus = status === "available" || status === "reserved";

  useEffect(() => {
    fetch(SUPABASE_URL + '/rest/v1/real_estate_listings?park_id=eq.' + PARK_ID + '&lot_key=eq.' + encodeURIComponent(lot) + '&available=eq.true&select=*', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
    })
      .then(res => res.json())
      .then(rows => {
        if (Array.isArray(rows) && rows.length > 0) {
          setListing(rows[0]);
          if (rows[0].allow_lot_booking === false) {
            setAllowLotBooking(false);
          }
        }
      })
      .catch(() => {});
  }, [lot]);

  useEffect(() => {
    fetch('/api/lot-data?type=availability&lotId=' + encodeURIComponent(lot) + '&park_id=' + encodeURIComponent(PARK_ID))
      .then(res => res.json())
      .then(data => {
        setBookedRanges(Array.isArray(data) ? data : []);
        setLoadingAvailability(false);
      })
      .catch(() => setLoadingAvailability(false));
  }, [lot]);

  const excludeDateIntervals = bookedRanges.map(r => {
    const start = new Date(r.arrival_date + "T00:00:00");
    const end = new Date(r.departure_date + "T00:00:00");
    end.setDate(end.getDate() - 1); // checkout day itself is available for a new arrival
    return { start, end };
  });

  // For the Departure calendar: shift the start forward by 1 day so that
  // the exact arrival_date of a blocked range (e.g. a resident's move-in day)
  // still shows as available for someone else's checkout (11am checkout vs 4pm check-in).
  const excludeDateIntervalsForDeparture = bookedRanges.map(r => {
    const start = new Date(r.arrival_date + "T00:00:00");
    start.setDate(start.getDate() + 1);
    const end = new Date(r.departure_date + "T00:00:00");
    end.setDate(end.getDate() - 1);
    return { start, end };
  });

  // Aug 12 (per Mely): reused for the new green-available /
  // crossed-out-blocked calendar day styling below.
  function isDateBlocked(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d < today) return true; // past dates were showing green/available — they never should
    return bookedRanges.some(r => {
      const start = new Date(r.arrival_date + "T00:00:00");
      const end = new Date(r.departure_date + "T00:00:00");
      end.setDate(end.getDate() - 1); // checkout day itself is available for a new arrival
      return d >= start && d <= end;
    });
  }

  function rangeOverlaps(arrivalStr, departureStr) {
    const arrival = new Date(arrivalStr + "T00:00:00");
    const departure = new Date(departureStr + "T00:00:00");
    return bookedRanges.some(r => {
      const bookedStart = new Date(r.arrival_date + "T00:00:00");
      const bookedEnd = new Date(r.departure_date + "T00:00:00");
      return arrival < bookedEnd && departure > bookedStart;
    });
  }

  const hasWeekly = !!lotInfo?.price_weekly;
  const hasValidDates = form.arrival && form.departure && new Date(form.departure) > new Date(form.arrival);
  const hasOverlap = hasValidDates && rangeOverlaps(form.arrival, form.departure);
  const stay = hasValidDates && !hasOverlap ? calcStayPreview(form.arrival, form.departure, hasWeekly) : null;

  const rvLengthNum = Number(form.rvLength) || 0;
  const rvTooLong =
    !!lotInfo?.max_length_ft && rvLengthNum > 0 && rvLengthNum > lotInfo.max_length_ft;

  // Aug 8 (per Mely): required for short-term reservations here (the map
  // has no other way to know what's coming), same as RV Length above —
  // BLOCKS Pay Now, unlike the lease application's softer warning, since
  // there's no admin review step in between for a direct booking. Long-
  // term stays don't need this here: they go through requiresApplication
  // below, and the lease application (which already matches this same
  // rv_lots data) collects it there instead.
  const driverCountNum = form.slideOutDriverCount ? Number(form.slideOutDriverCount.replace("+", "")) : 0;
  const passengerCountNum = form.slideOutPassengerCount ? Number(form.slideOutPassengerCount.replace("+", "")) : 0;
  const lotMaxDriverSlideOuts = lotInfo?.max_driver_slide_outs;
  const lotMaxPassengerSlideOuts = lotInfo?.max_passenger_slide_outs;
  const driverSlideOutTooMany =
    !!lotMaxDriverSlideOuts && lotMaxDriverSlideOuts !== "Any" && form.slideOutDriverCount &&
    driverCountNum > Number(lotMaxDriverSlideOuts.replace("+", ""));
  const passengerSlideOutTooMany =
    !!lotMaxPassengerSlideOuts && lotMaxPassengerSlideOuts !== "Any" && form.slideOutPassengerCount &&
    passengerCountNum > Number(lotMaxPassengerSlideOuts.replace("+", ""));
  const slideOutCountTooMany = driverSlideOutTooMany || passengerSlideOutTooMany;

  // Stays longer than the park's background-check threshold (admin-editable
  // under Lease Defaults, default 15 days) — and any yearly stay — mean the
  // guest is becoming a resident, not making a short-term reservation. Those
  // always require the lease application (with background check), so they
  // can't just Pay Now here.
  const backgroundCheckThresholdDays =
    Number(parkSettings?.lease_defaults?.background_check_threshold_days) || 15;
  const requiresApplication =
    longStay || (!!stay && (stay.isYearly || stay.totalNights > backgroundCheckThresholdDays));

  let total = 0;
  let breakdownLines = [];
  if (stay) {
    if (stay.isYearly) {
      total = lotInfo?.price_yearly || 0;
      breakdownLines.push(`1 year × $${lotInfo?.price_yearly || 0}/year`);
    } else {
      const monthlyCost = stay.months * (lotInfo?.price_monthly || 0);
      const weeklyCost = stay.weeks * (lotInfo?.price_weekly || 0);
      const dailyCost = stay.extraDays * (lotInfo?.price_daily || 0);
      total = monthlyCost + weeklyCost + dailyCost;
      if (stay.months > 0) breakdownLines.push(`${stay.months} month(s) × $${lotInfo?.price_monthly || 0}/month = $${monthlyCost.toLocaleString()}`);
      if (stay.weeks > 0) breakdownLines.push(`${stay.weeks} week(s) × $${lotInfo?.price_weekly || 0}/week = $${weeklyCost.toLocaleString()}`);
      if (stay.extraDays > 0) breakdownLines.push(`${stay.extraDays} night(s) × $${lotInfo?.price_daily || 0}/night = $${dailyCost.toLocaleString()}`);
    }
  }

  async function handlePayNow() {
    setError("");
    if (requiresApplication) {
      setError(`Stays of ${backgroundCheckThresholdDays}+ days require a lease application instead.`);
      return;
    }
    if (!form.rvLength) {
      setError("Please enter your RV's length so we can confirm it fits this lot.");
      return;
    }
    if (rvTooLong) {
      setError(`This RV (${form.rvLength} ft) is too long for this lot (max ${lotInfo.max_length_ft} ft). Please choose a different lot.`);
      return;
    }
    if (!form.slideOutDriverCount || !form.slideOutPassengerCount) {
      setError("Please enter your RV's slide-outs (Driver Side and Passenger Side, even if 0) so we can confirm it fits this lot.");
      return;
    }
    if (driverSlideOutTooMany) {
      setError(`This lot supports up to ${lotMaxDriverSlideOuts} driver-side slide-out(s). Please choose a different lot.`);
      return;
    }
    if (passengerSlideOutTooMany) {
      setError(`This lot supports up to ${lotMaxPassengerSlideOuts} passenger-side slide-out(s). Please choose a different lot.`);
      return;
    }
    if (!hasValidDates) {
      setError("Please select a valid arrival and departure date");
      return;
    }
    if (rangeOverlaps(form.arrival, form.departure)) {
      setError("These dates overlap with an existing reservation. Please choose different dates.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/create-lot-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lotId: lot,
          arrivalDate: form.arrival,
          departureDate: form.departure,
          rvLength: form.rvLength,
          slideOutDriverCount: form.slideOutDriverCount,
          slideOutPassengerCount: form.slideOutPassengerCount,
          parkId: PARK_ID,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error creating payment');

      // Aug 5 (per Mely — real bug, confirmed via console: "Stripe
      // Checkout is not able to run in an iFrame"): this widget is
      // ALWAYS embedded via iframe (even on the "public" site), and
      // Stripe explicitly refuses to render Checkout inside one.
      // Redirecting window.top instead breaks out to the real top-level
      // browser tab so Stripe actually loads. Falls back to the normal
      // redirect if window.top is inaccessible for any reason (e.g. a
      // stricter cross-origin sandbox) rather than silently doing nothing.
      try {
        window.top.location.href = data.url;
      } catch {
        window.location.href = data.url;
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div style={overlay}>
      <div style={{ ...modal, maxWidth:480 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <h2 style={mh2}>Book Lot {lot}</h2>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#888" }}>✕</button>
        </div>

        {listing && (
          <div style={{ border:"1.5px solid #ede9fe", borderRadius:10, overflow:"hidden", marginBottom:16, fontFamily:"sans-serif" }}>
            {listing.image_url ? (
              <img src={listing.image_url} alt={listing.title} style={{ width:"100%", height:220, objectFit:"cover", objectPosition:"center 25%", display:"block" }} />
            ) : (
              <div style={{ width:"100%", height:100, background:"#f5f3ff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36 }}>🏠</div>
            )}
            <div style={{ padding:"10px 12px" }}>
              <div style={{ fontSize:11, color:"#7c3aed", fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:2 }}>
                {listing.type === "sale" ? "For Sale" : listing.type === "rent" ? "For Rent" : "Rent-to-Own"} · {listing.category}
              </div>
              <div style={{ fontWeight:700, fontSize:15, color:"#1f2937", marginBottom:4 }}>{listing.title}</div>
              <div style={{ fontWeight:700, fontSize:16, color:"#7c3aed", marginBottom:6 }}>{listing.price}</div>
              <div style={{ display:"flex", gap:12, fontSize:12, color:"#6b7280", marginBottom: listing.description ? 8 : 0 }}>
                {listing.beds != null && <span>🛏 {listing.beds} bed</span>}
                {listing.baths != null && <span>🚿 {listing.baths} bath</span>}
                {listing.sqft != null && <span>📐 {listing.sqft} sqft</span>}
              </div>
              {listing.description && (
                <div style={{ fontSize:12, color:"#6b7280", lineHeight:1.5, marginBottom:8 }}>{listing.description}</div>
              )}
              <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                <a href={`mailto:info@aloharvparkfl.com?subject=Inquiry: ${listing.title}`} style={{ display:"inline-block", background:"#7c3aed", color:"#fff", padding:"7px 14px", borderRadius:6, fontSize:12, fontWeight:700, textDecoration:"none" }}>
                  📩 Inquire Now
                </a>
                <a href="tel:6892520567" style={{ display:"inline-block", background:"#fff", color:"#7c3aed", border:"1.5px solid #7c3aed", padding:"7px 14px", borderRadius:6, fontSize:12, fontWeight:700, textDecoration:"none" }}>
                  📞 Call Us
                </a>
              </div>
              <a
                href={`https://aloharvparkfl.com/real-estate/${listing.id}`}
                target="_top"
                style={{ display:"block", textAlign:"left", fontSize:11.5, fontWeight:700, color:"#7c3aed", textDecoration:"underline" }}
              >
                View More Photos & Full Listing
              </a>
            </div>
          </div>
        )}

        {status === "reserved" && allowLotBooking && (
          <div style={{ display:"flex", alignItems:"center", gap:8, background:"#fffbeb", border:"1px solid #fde68a", borderRadius:8, padding:"8px 12px", marginBottom:16, fontFamily:"sans-serif" }}>
            <div style={{ width:10, height:10, borderRadius:3, background: STATUS_SOLID[status] }} />
            <span style={{ fontSize:12, color:"#92400e" }}>
              This lot is currently marked <strong style={{ textTransform:"capitalize" }}>{status.replace(/_/g," ")}</strong>, but you can still book any open dates below.
            </span>
          </div>
        )}

        {/* Oct 21 (per Mely): demo parks show a sample lot photo on every lot card
            that has no photo of its own (storage lots S1–S6 use a different card). */}
        {lotPhoto(lotInfo?.photo_url) && (
          <img src={lotPhoto(lotInfo?.photo_url)} alt="Lot" style={{ width:"100%", maxHeight:220, objectFit:"cover", borderRadius:10, marginBottom:16 }} />
        )}

        {canBookStatus && (lotInfo?.max_length_ft || lotInfo?.amp_service || (lotInfo?.max_driver_slide_outs && lotInfo.max_driver_slide_outs !== "Any") || (lotInfo?.max_passenger_slide_outs && lotInfo.max_passenger_slide_outs !== "Any")) && (
          <div style={{ background:"#f9fafb", borderRadius:8, padding:"10px 12px", marginBottom:16, display:"flex", gap:16, fontFamily:"sans-serif", flexWrap:"wrap" }}>
            {lotInfo?.max_length_ft && (
              <div>
                <span style={{ fontSize:11, color:"#6b7280" }}>Max RV Length: </span>
                <span style={{ fontSize:12, fontWeight:700, color:"#374151" }}>{lotInfo.max_length_ft}ft</span>
              </div>
            )}
            {lotInfo?.amp_service && (
              <div>
                <span style={{ fontSize:11, color:"#6b7280" }}>Amperage: </span>
                <span style={{ fontSize:12, fontWeight:700, color:"#374151" }}>{lotInfo.amp_service} Amp</span>
              </div>
            )}
            {lotInfo?.max_driver_slide_outs && lotInfo.max_driver_slide_outs !== "Any" && (
              <div>
                <span style={{ fontSize:11, color:"#6b7280" }}>Max Driver-Side Slide-Outs: </span>
                <span style={{ fontSize:12, fontWeight:700, color:"#374151" }}>{lotInfo.max_driver_slide_outs}</span>
              </div>
            )}
            {lotInfo?.max_passenger_slide_outs && lotInfo.max_passenger_slide_outs !== "Any" && (
              <div>
                <span style={{ fontSize:11, color:"#6b7280" }}>Max Passenger-Side Slide-Outs: </span>
                <span style={{ fontSize:12, fontWeight:700, color:"#374151" }}>{lotInfo.max_passenger_slide_outs}</span>
              </div>
            )}
          </div>
        )}

        {lotInfo?.description && (
          <div style={{ fontSize:12, color:"#6b7280", lineHeight:1.5, marginBottom:16, fontFamily:"sans-serif" }}>
            {lotInfo.description}
          </div>
        )}

        {/* Aug 13 (per Mely): the RV Length / Slide-Outs form fields
            below previously rendered unconditionally, regardless of
            whether the lot can actually be booked — showing a confusing
            RV booking form for e.g. a for_sale lot that already has a
            house on it. Now gated behind the same canBookStatus check
            the actual rates/calendar section already uses. */}
        {canBookStatus && (
        <>
        <div style={{ marginBottom:16 }}>
          <label style={{ fontSize:12, fontWeight:700, color:"#374151", display:"block", marginBottom:4, fontFamily:"sans-serif" }}>
            Your RV Length (ft){form.departure && (
              <span style={{
                color: "#dc2626",
                fontSize: 20,
                fontWeight: 900,
                marginLeft: 4,
                display: "inline-block",
                animation: "pulse-asterisk 1s ease-in-out infinite",
              }}>
                *
              </span>
            )}
          </label>
          <input
            type="number"
            min="1"
            value={form.rvLength}
            onChange={(e) => setForm(f => ({ ...f, rvLength: e.target.value }))}
            placeholder="e.g. 32"
            style={{ width:"100%", boxSizing:"border-box", padding:"8px 10px", borderRadius:8, border: rvTooLong ? "1px solid #dc2626" : "1px solid #ddd", fontSize:14, fontFamily:"sans-serif" }}
          />
          {rvTooLong && (
            <div style={{ fontSize:12, color:"#dc2626", marginTop:4, fontFamily:"sans-serif" }}>
              This RV ({form.rvLength} ft) is too long for this lot (max {lotInfo.max_length_ft} ft). Please choose a different lot.
            </div>
          )}
        </div>

        <div style={{ marginBottom:16 }}>
          <label style={{ fontSize:12, fontWeight:700, color:"#374151", display:"block", marginBottom:4, fontFamily:"sans-serif" }}>
            Driver Side Slide-Outs{" "}
            {lotMaxDriverSlideOuts && lotMaxDriverSlideOuts !== "Any" && (
              <span style={{ fontWeight: 400, color: "#9ca3af" }}>(max {lotMaxDriverSlideOuts} for this lot)</span>
            )}
            <span style={{ color: "#dc2626", fontSize: 20, fontWeight: 900, marginLeft: 4, display: "inline-block" }}>*</span>
          </label>
          <select
            value={form.slideOutDriverCount}
            onChange={(e) => setForm(f => ({ ...f, slideOutDriverCount: e.target.value }))}
            style={{ width:"100%", boxSizing:"border-box", padding:"8px 10px", borderRadius:8, border: driverSlideOutTooMany ? "1px solid #dc2626" : "1px solid #ddd", fontSize:14, fontFamily:"sans-serif" }}
          >
            <option value="">Select...</option>
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4+">4+</option>
          </select>
          {driverSlideOutTooMany && (
            <div style={{ fontSize:12, color:"#dc2626", marginTop:4, fontFamily:"sans-serif" }}>
              This lot supports up to {lotMaxDriverSlideOuts} driver-side slide-out(s). Please choose a different lot.
            </div>
          )}
        </div>

        <div style={{ marginBottom:16 }}>
          <label style={{ fontSize:12, fontWeight:700, color:"#374151", display:"block", marginBottom:4, fontFamily:"sans-serif" }}>
            Passenger Side Slide-Outs{" "}
            {lotMaxPassengerSlideOuts && lotMaxPassengerSlideOuts !== "Any" && (
              <span style={{ fontWeight: 400, color: "#9ca3af" }}>(max {lotMaxPassengerSlideOuts} for this lot)</span>
            )}
            <span style={{ color: "#dc2626", fontSize: 20, fontWeight: 900, marginLeft: 4, display: "inline-block" }}>*</span>
          </label>
          <select
            value={form.slideOutPassengerCount}
            onChange={(e) => setForm(f => ({ ...f, slideOutPassengerCount: e.target.value }))}
            style={{ width:"100%", boxSizing:"border-box", padding:"8px 10px", borderRadius:8, border: passengerSlideOutTooMany ? "1px solid #dc2626" : "1px solid #ddd", fontSize:14, fontFamily:"sans-serif" }}
          >
            <option value="">Select...</option>
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4+">4+</option>
          </select>
          {passengerSlideOutTooMany && (
            <div style={{ fontSize:12, color:"#dc2626", marginTop:4, fontFamily:"sans-serif" }}>
              This lot supports up to {lotMaxPassengerSlideOuts} passenger-side slide-out(s). Please choose a different lot.
            </div>
          )}
        </div>
        </>
        )}

        {lotInfo?.description && (
          <div style={{ background:"#f0fdf4", borderRadius:8, padding:"8px 12px", marginBottom:16, fontSize:13, color:"#166534", fontFamily:"sans-serif" }}>
            {lotInfo.description}
          </div>
        )}

        {!(allowLotBooking && canBookStatus) && (
          <div style={{ background:"#f5f3ff", border:"1px solid #ddd6fe", borderRadius:8, padding:"12px 16px", marginBottom:16, fontFamily:"sans-serif" }}>
            {lotInfo?.phone_only ? (
              <p style={{ fontSize:13, color:"#5b21b6", margin:0, lineHeight:1.6 }}>
                This is a limited storage space — please call the office to check availability. Our team will confirm the space is the right size for your RV or trailer before booking.
              </p>
            ) : requiresCallOffice ? (
              <p style={{ fontSize:13, color:"#5b21b6", margin:0, lineHeight:1.6 }}>
                Please call the office to check availability and pricing for this lot before booking.
              </p>
            ) : status === "occupied" ? (
              <p style={{ fontSize:13, color:"#5b21b6", margin:0, lineHeight:1.6 }}>
                This lot is currently under a month-to-month lease and is not available for rent at this time. Please check back later, or take a look at our other available{" "}
                <span style={{ display:"inline-block", width:10, height:10, borderRadius:3, background: STATUS_SOLID.available, verticalAlign:"middle", margin:"0 2px" }} /> or soon-to-be-available{" "}
                <span style={{ display:"inline-block", width:10, height:10, borderRadius:3, background: STATUS_SOLID.reserved, verticalAlign:"middle", margin:"0 2px" }} /> lots on the map.
              </p>
            ) : (
              <p style={{ fontSize:13, color:"#5b21b6", margin:0, lineHeight:1.5 }}>
                This lot is not available through our standard booking system. See details above or contact us for more information.
              </p>
            )}
          </div>
        )}

        {allowLotBooking && canBookStatus && (
        <>
        <div style={{ marginBottom:16 }}>
          <label style={lbl}>Rates</label>
          {(() => {
            const monthlyPerNight = lotInfo?.price_monthly ? lotInfo.price_monthly / 30 : null;
            const weeklyPerNight = lotInfo?.price_weekly ? lotInfo.price_weekly / 7 : null;
            const yearlyPerNight = lotInfo?.price_yearly ? lotInfo.price_yearly / 365 : null;
            const bestPerNight = Math.min(...[weeklyPerNight, monthlyPerNight, yearlyPerNight].filter(v => v !== null));
            const isBest = (v) => v !== null && v === bestPerNight;

            const hasYearly = !!lotInfo?.price_yearly;
            const cols = 2 + (hasWeekly ? 1 : 0) + (hasYearly ? 1 : 0);

            return (
              <div style={{ display:"grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap:8 }}>
                <div style={{ border:"1.5px solid #d1fae5", borderRadius:8, padding:"10px 8px", textAlign:"center", position:"relative" }}>
                  <div style={{ fontWeight:700, fontSize:12, fontFamily:"sans-serif" }}>Daily</div>
                  <div style={{ fontSize:12, color:"#16a34a", fontWeight:700, fontFamily:"sans-serif" }}>{lotInfo?.price_daily ? `$${lotInfo.price_daily}` : "—"}</div>
                  <div style={{ fontSize:10, color:"#9ca3af" }}>per night</div>
                </div>
                {hasWeekly && (
                  <div style={{ border: isBest(weeklyPerNight) ? "2px solid #16a34a" : "1.5px solid #d1fae5", borderRadius:8, padding:"10px 8px", textAlign:"center", position:"relative", background: isBest(weeklyPerNight) ? "#f0fdf4" : "transparent" }}>
                    {isBest(weeklyPerNight) && (
                      <div style={{ position:"absolute", top:-9, left:"50%", transform:"translateX(-50%)", background:"#16a34a", color:"#fff", fontSize:8, fontWeight:700, padding:"2px 6px", borderRadius:10, whiteSpace:"nowrap" }}>BEST VALUE</div>
                    )}
                    <div style={{ fontWeight:700, fontSize:12, fontFamily:"sans-serif" }}>Weekly</div>
                    <div style={{ fontSize:12, color:"#16a34a", fontWeight:700, fontFamily:"sans-serif" }}>${lotInfo.price_weekly}</div>
                    <div style={{ fontSize:10, color:"#9ca3af" }}>per week</div>
                    {weeklyPerNight && (
                      <div style={{ fontSize:9, color:"#16a34a", fontWeight:600, marginTop:2 }}>≈ ${weeklyPerNight.toFixed(2)}/night</div>
                    )}
                  </div>
                )}
                <div style={{ border: isBest(monthlyPerNight) ? "2px solid #16a34a" : "1.5px solid #d1fae5", borderRadius:8, padding:"10px 8px", textAlign:"center", position:"relative", background: isBest(monthlyPerNight) ? "#f0fdf4" : "transparent" }}>
                  {isBest(monthlyPerNight) && (
                    <div style={{ position:"absolute", top:-9, left:"50%", transform:"translateX(-50%)", background:"#16a34a", color:"#fff", fontSize:8, fontWeight:700, padding:"2px 6px", borderRadius:10, whiteSpace:"nowrap" }}>BEST VALUE</div>
                  )}
                  <div style={{ fontWeight:700, fontSize:12, fontFamily:"sans-serif" }}>Monthly</div>
                  <div style={{ fontSize:12, color:"#16a34a", fontWeight:700, fontFamily:"sans-serif" }}>{lotInfo?.price_monthly ? `$${lotInfo.price_monthly}` : "—"}</div>
                  <div style={{ fontSize:10, color:"#9ca3af" }}>per month</div>
                  {monthlyPerNight && (
                    <div style={{ fontSize:9, color:"#16a34a", fontWeight:600, marginTop:2 }}>≈ ${monthlyPerNight.toFixed(2)}/night</div>
                  )}
                </div>
                {hasYearly && (
                  <div style={{ border: isBest(yearlyPerNight) ? "2px solid #16a34a" : "1.5px solid #d1fae5", borderRadius:8, padding:"10px 8px", textAlign:"center", position:"relative", background: isBest(yearlyPerNight) ? "#f0fdf4" : "transparent" }}>
                    {isBest(yearlyPerNight) && (
                      <div style={{ position:"absolute", top:-9, left:"50%", transform:"translateX(-50%)", background:"#16a34a", color:"#fff", fontSize:8, fontWeight:700, padding:"2px 6px", borderRadius:10, whiteSpace:"nowrap" }}>BEST VALUE</div>
                    )}
                    <div style={{ fontWeight:700, fontSize:12, fontFamily:"sans-serif" }}>Yearly</div>
                    <div style={{ fontSize:12, color:"#16a34a", fontWeight:700, fontFamily:"sans-serif" }}>${lotInfo.price_yearly}</div>
                    <div style={{ fontSize:10, color:"#9ca3af" }}>per year</div>
                    {yearlyPerNight && (
                      <div style={{ fontSize:9, color:"#16a34a", fontWeight:600, marginTop:2 }}>≈ ${yearlyPerNight.toFixed(2)}/night</div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {(() => {
          // For 'reserved' lots, surface the nearest actually-open date up
          // front so the guest isn't left guessing among all the grayed-out
          // days. If the admin manually set a REAL "available from" date
          // (Lot Status Control), that's the authoritative answer — use it
          // directly. But a far-future placeholder (e.g. 2099 — set when a
          // lot is marked Reserved without specifying a real end date) is
          // meaningless and must NOT be shown to the guest or used instead
          // of the real booking data — Aug 12 (per Mely): in that case,
          // ignore it entirely and compute the real next-available date
          // from bookedRanges instead (the actual short-term reservation's
          // real departure date), exactly as if reservedUntil were absent —
          // this is what makes the green available dates on the calendar
          // meaningful even for a lot currently marked Reserved.
          if (status !== "reserved" || loadingAvailability) return null;
          let candidate;
          let useReservedUntil = false;
          if (reservedUntil) {
            const parsed = new Date(reservedUntil + "T00:00:00");
            const threeYearsOut = new Date();
            threeYearsOut.setFullYear(threeYearsOut.getFullYear() + 3);
            if (parsed <= threeYearsOut) {
              candidate = parsed;
              useReservedUntil = true;
            }
          }
          if (!useReservedUntil) {
            candidate = new Date();
            candidate.setHours(0, 0, 0, 0);
            let changed = true;
            while (changed) {
              changed = false;
              for (const r of bookedRanges) {
                const start = new Date(r.arrival_date + "T00:00:00");
                const end = new Date(r.departure_date + "T00:00:00");
                if (candidate >= start && candidate < end) {
                  candidate = new Date(end);
                  changed = true;
                }
              }
            }
          }
          // Aug 13 (per Mely — A5 is month-to-month, genuinely no known
          // move-out date): a resident's indefinite active lease also
          // blocks bookedRanges through a 2099 sentinel (same convention
          // used by the get_lot_blocked_ranges database function), so
          // even the real computed candidate can still land far in the
          // future when there's truly no known end date yet. In that
          // case there's nothing useful to suggest — hide the banner
          // entirely rather than show a confusing date or a generic
          // message. It'll show a real date automatically once the
          // resident sets a move-out date in their portal (that updates
          // resident_leases.lease_end, which feeds directly into both
          // this calculation and the database function).
          const threeYearsOutFinal = new Date();
          threeYearsOutFinal.setFullYear(threeYearsOutFinal.getFullYear() + 3);
          if (candidate > threeYearsOutFinal) return null;
          const label = candidate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
          const isoDate = candidate.toISOString().split("T")[0];
          return (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:8, padding:"10px 12px", marginBottom:12, fontFamily:"sans-serif" }}>
              <span style={{ fontSize:12.5, color:"#166534" }}>
                Next available date: <strong>{label}, 4:00 PM</strong> (check-out time)
              </span>
              <button
                type="button"
                onClick={() => setForm(prev => ({ ...prev, arrival: isoDate }))}
                style={{ fontSize:11.5, fontWeight:700, color:"#166534", background:"#dcfce7", border:"1px solid #86efac", borderRadius:6, padding:"5px 10px", cursor:"pointer", whiteSpace:"nowrap" }}
              >
                Use this date
              </button>
            </div>
          );
        })()}

        <div style={row2}>
          <div>
            <label style={lbl}>Arrival</label>
            <DatePicker
              selected={form.arrival ? new Date(form.arrival + "T00:00:00") : null}
              onChange={(date) => {
                setLongStay(false);
                setForm({...form, arrival: date ? date.toISOString().split("T")[0] : "", departure: ""});
              }}
              minDate={new Date()}
              excludeDateIntervals={excludeDateIntervals}
              dayClassName={(date) => isDateBlocked(date) ? "day-blocked" : "day-available"}
              dateFormat="MM/dd/yyyy"
              placeholderText={loadingAvailability ? "Loading..." : "Select date"}
              disabled={loadingAvailability}
              className="lot-date-input"
            />
          </div>
          {!longStay && (
          <div>
            <label style={lbl}>Departure</label>
            <DatePicker
              selected={form.departure ? new Date(form.departure + "T00:00:00") : null}
              onChange={(date) => {
                const newDeparture = date ? date.toISOString().split("T")[0] : "";
                const tentative = newDeparture && form.arrival ? calcStayPreview(form.arrival, newDeparture, hasWeekly) : null;
                if (tentative && (tentative.isYearly || tentative.totalNights > longStayDays)) {
                  setLongStay(true);
                  setForm({...form, departure: ""});
                  return;
                }
                setForm({...form, departure: newDeparture});
              }}
              minDate={form.arrival ? new Date(form.arrival + "T00:00:00") : new Date()}
              excludeDateIntervals={excludeDateIntervalsForDeparture}
              dayClassName={(date) => isDateBlocked(date) ? "day-blocked" : "day-available"}
              dateFormat="MM/dd/yyyy"
              placeholderText={loadingAvailability ? "Loading..." : "Select date"}
              disabled={loadingAvailability}
              className="lot-date-input"
            />
          </div>
          )}
        </div>

        {longStay && (
          <div style={{ fontSize:12, color:"#6b7280", marginBottom:12, fontFamily:"sans-serif" }}>
            Not sure how long you're staying yet? That's fine — you'll set your move-out date (if you know it) in the lease application.{" "}
            <button type="button" onClick={()=>setLongStay(false)} style={{ background:"none", border:"none", padding:0, color:"#16a34a", textDecoration:"underline", cursor:"pointer", fontSize:12 }}>
              Pick a departure date instead
            </button>
          </div>
        )}

        {hasOverlap && (
          <div style={{ background:"#fef2f2", color:"#dc2626", padding:"8px 10px", borderRadius:8, fontSize:13, marginBottom:12, fontFamily:"sans-serif" }}>
            These dates overlap with an existing reservation. Please choose different dates.
          </div>
        )}

        {stay && !requiresApplication && (
          <div style={{ background:"#f0fdf4", borderRadius:8, padding:"10px 14px", marginBottom:16, fontFamily:"sans-serif", fontSize:14 }}>
            {breakdownLines.map((line,i) => (
              <div key={i} style={{ marginBottom:4, color:"#374151" }}>{line}</div>
            ))}
            <div style={{ marginTop:8, paddingTop:8, borderTop:"1px solid #d1fae5", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontWeight:600 }}>Total</span>
              <strong style={{ color:"#16a34a", fontSize:18 }}>${total.toLocaleString()}</strong>
            </div>
          </div>
        )}

        {requiresApplication && !!lotInfo?.price_monthly && (
          <div style={{ background:"#f0fdf4", borderRadius:8, padding:"10px 14px", marginBottom:16, fontFamily:"sans-serif", fontSize:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ color:"#374151" }}>Rent</span>
            <strong style={{ color:"#16a34a", fontSize:18 }}>${lotInfo.price_monthly.toLocaleString()}/month</strong>
          </div>
        )}

        {error && (
          <div style={{ background:"#fef2f2", color:"#dc2626", padding:"8px 10px", borderRadius:8, fontSize:13, marginBottom:12, fontFamily:"sans-serif" }}>
            {error}
          </div>
        )}

        <div style={{ fontSize:11, color:"#9ca3af", marginBottom:12, fontFamily:"sans-serif", lineHeight:1.5 }}>
          Check-in: {parkSettings?.checkin_time || "2:00 PM"} · Check-out: {parkSettings?.checkout_time || "11:00 AM"}
          <br />
          Free cancellation up to {parkSettings?.cancellation_days ?? 7} day(s) before arrival.
        </div>

        {requiresApplication ? (
          <div>
            <div style={{ background:"#f5f3ff", border:"1px solid #ddd6fe", borderRadius:8, padding:"12px 14px", marginBottom:12, fontFamily:"sans-serif" }}>
              <p style={{ fontSize:13, color:"#5b21b6", margin:0, lineHeight:1.5 }}>
                Stays of {backgroundCheckThresholdDays}+ days make you a resident, not just a
                reservation — please complete a lease application (including a background check).
              </p>
            </div>
            <a
              href="https://aloharvparkfl.com/apply"
              target="_top"
              style={{ display:"block", width:"100%", boxSizing:"border-box", background:"linear-gradient(135deg,#14532d,#16a34a)", color:"#fff", textAlign:"center", padding:"12px 14px", borderRadius:8, fontWeight:700, fontSize:14, fontFamily:"sans-serif", textDecoration:"none", boxShadow:"0 4px 12px rgba(22,163,74,0.3)" }}
            >
              Go to Lease Application
            </a>
          </div>
        ) : (
          <button onClick={handlePayNow} disabled={loading || !hasValidDates || hasOverlap || rvTooLong || !form.rvLength || !form.slideOutDriverCount || !form.slideOutPassengerCount || driverSlideOutTooMany || passengerSlideOutTooMany} style={{ display:"block", width:"100%", background: (loading || !hasValidDates || hasOverlap || rvTooLong || !form.rvLength || !form.slideOutDriverCount || !form.slideOutPassengerCount || driverSlideOutTooMany || passengerSlideOutTooMany) ? "#9ca3af" : "linear-gradient(135deg,#14532d,#16a34a)", color:"#fff", textAlign:"center", padding:"12px 14px", borderRadius:8, fontWeight:700, fontSize:14, fontFamily:"sans-serif", border:"none", cursor: loading || !hasValidDates || hasOverlap || rvTooLong || !form.rvLength || !form.slideOutDriverCount || !form.slideOutPassengerCount || driverSlideOutTooMany || passengerSlideOutTooMany ? "default" : "pointer", boxShadow: (loading || !hasValidDates || hasOverlap || rvTooLong || !form.rvLength || !form.slideOutDriverCount || !form.slideOutPassengerCount || driverSlideOutTooMany || passengerSlideOutTooMany) ? "none" : "0 4px 12px rgba(22,163,74,0.3)" }}>
            {loading ? "Processing..." : "Pay Now"}
          </button>
        )}
        </>
        )}
      </div>
    </div>
  );
}
function MyReservationsModal({ parkSettings, onClose }) {
  const [email, setEmail] = useState("");
  const [bookings, setBookings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cancellingId, setCancellingId] = useState(null);

  async function handleSearch() {
    setError("");
    if (!email) {
      setError("Please enter your email");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/lot-data?type=my-bookings&email=' + encodeURIComponent(email) + '&park_id=' + encodeURIComponent(PARK_ID));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not fetch bookings');
      setBookings(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function daysUntil(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr + "T00:00:00");
    return Math.round((target - today) / 86400000);
  }

  async function handleCancel(orderId) {
    if (!window.confirm("Cancel this reservation and request a refund?")) return;
    setCancellingId(orderId);
    setError("");
    try {
      // Oct 20 (security review): cancelling now takes 2 steps — the server
      // e-mails a one-time code to the booking's address, and the guest
      // types it here. Knowing someone's e-mail is no longer enough to
      // cancel (and refund) their reservation.
      const res = await fetch('/api/cancel-lot-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel booking');
      if (!data.codeRequired) throw new Error('Could not cancel booking');
      const code = window.prompt("We e-mailed an 8-digit code to " + email + ". Enter it to confirm the cancellation (the card processing fee is not refunded):");
      if (!code) return;
      const res2 = await fetch('/api/cancel-lot-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, email, code: code.trim() }),
      });
      const data2 = await res2.json();
      if (!res2.ok) throw new Error(data2.error || 'Could not cancel booking');
      setBookings(prev => prev.filter(b => b.id !== orderId));
      alert(data2.amountRefunded != null
        ? "Booking cancelled. Refund of $" + Number(data2.amountRefunded).toFixed(2) + " issued to your card."
        : "Booking cancelled and refunded.");
    } catch (err) {
      setError(err.message);
    } finally {
      setCancellingId(null);
    }
  }

  const cancellationDays = parkSettings?.cancellation_days ?? 7;

  return (
    <div style={overlay}>
      <div style={{ ...modal, maxWidth:480 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <h2 style={mh2}>My Reservations</h2>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#888" }}>✕</button>
        </div>

        {bookings === null && (
          <>
            <label style={lbl}>Email used for booking</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com" style={inp} />
            {error && (
              <div style={{ background:"#fef2f2", color:"#dc2626", padding:"8px 10px", borderRadius:8, fontSize:13, marginTop:10 }}>{error}</div>
            )}
            <button onClick={handleSearch} disabled={loading} style={{ ...btnPrimary, width:"100%", marginTop:14 }}>
              {loading ? "Searching..." : "Find My Reservations"}
            </button>
          </>
        )}

        {bookings !== null && (
          <>
            {bookings.length === 0 ? (
              <p style={{ fontFamily:"sans-serif", color:"#666" }}>No upcoming reservations found for this email.</p>
            ) : (
              bookings.map(b => {
                const eligible = daysUntil(b.arrival_date) >= cancellationDays;
                return (
                  <div key={b.id} style={{ background:"#f9fafb", borderRadius:10, padding:14, marginBottom:10, fontFamily:"sans-serif" }}>
                    <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>Lot {b.lot_id}</div>
                    <div style={{ fontSize:13, color:"#6b7280", marginBottom:4 }}>{b.arrival_date} → {b.departure_date}</div>
                    <div style={{ fontSize:13, color:"#374151", marginBottom:8 }}>Total paid: ${b.amount_total.toLocaleString()}</div>
                    {eligible ? (
                      <button
                        onClick={() => handleCancel(b.id)}
                        disabled={cancellingId === b.id}
                        style={{ background:"#dc2626", color:"#fff", border:"none", padding:"8px 14px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600 }}>
                        {cancellingId === b.id ? "Processing..." : "Cancel & Refund"}
                      </button>
                    ) : (
                      <div style={{ fontSize:12, color:"#9ca3af" }}>
                        Not eligible for refund (must cancel at least {cancellationDays} day(s) before arrival)
                      </div>
                    )}
                  </div>
                );
              })
            )}
            {error && (
              <div style={{ background:"#fef2f2", color:"#dc2626", padding:"8px 10px", borderRadius:8, fontSize:13, marginTop:10 }}>{error}</div>
            )}
            <button onClick={() => { setBookings(null); setEmail(""); }} style={{ ...btnSecondary, width:"100%", marginTop:10 }}>
              Search a different email
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ═══ Main App ═══
// Oct 30: small line icons for the map editor (replace the emoji in its buttons).
const ED_ICON_PATHS = {
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  pencil: "M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
  monitor: "M3 4h18v12H3z M8 20h8 M12 16v4",
  phone: "M7 2h10v20H7z M11 18h2",
  auto: "M4 8V4h4 M20 8V4h-4 M4 16v4h4 M20 16v4h-4",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  x: "M18 6 6 18 M6 6l12 12",
  trash: "M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6 M10 11v6 M14 11v6",
  save: "M5 3h11l3 3v15H5z M8 3v5h7V3 M8 21v-7h8v7",
  reset: "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5",
};
function EdIcon({ name, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ED_ICON_PATHS[name]} />
    </svg>
  );
}
const ED_STATUS_OPTIONS = [["available","#16a34a","Available"],["occupied","#dc2626","Occupied"],["reserved","#ca8a04","Reserved"],["maintenance","#4b5563","Maintenance"],["for_sale","#ac67dd","For Sale"],["for_rent","#8b5cf6","For Rent"]];
const edShapeLabel = (s) => { const t = s.replace(/-/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };

const emojiHoverStyle = `
.map-emoji-hover:hover {
  transform: scale(1.25);
  filter: drop-shadow(0 0 6px rgba(250, 204, 21, 0.9));
}
.react-datepicker__day.day-available {
  background-color: #bbf7d0;
  border-radius: 4px;
  color: #14532d;
  font-weight: 600;
}
.react-datepicker__day.day-available:hover {
  background-color: #86efac;
}
.react-datepicker__day.day-blocked {
  text-decoration: line-through;
  color: #9ca3af;
}
.map-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 20px;
}
.map-legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(150px, auto));
  gap: 12px 28px;
}
.map-legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
@media (max-width: 620px) {
  .map-header {
    flex-direction: column;
    align-items: flex-start;
  }
  .map-legend {
    grid-template-columns: repeat(2, 1fr);
    width: 100%;
    gap: 12px 16px;
  }
  /* Oct 29 (per Mely — phone): tighter header, legend as a neat 2-column list,
     editor buttons wrap into tidy rows instead of piling up. Desktop untouched. */
  .map-header { padding: 16px 16px 14px !important; gap: 12px; }
  .map-title { font-size: 19px !important; }
  .map-subtitle { font-size: 10.5px !important; }
  .map-legend { gap: 8px 12px; }
  .map-legend-item { gap: 6px; min-width: 0; }
  .map-legend-item > div { width: 11px !important; height: 11px !important; border-radius: 3px !important; }
  .map-legend-item span { font-size: 12px !important; overflow: hidden; text-overflow: ellipsis; }
  .map-hint { padding: 12px 14px 0 !important; }
  .map-hint p { font-size: 12.5px !important; font-weight: 500 !important; line-height: 1.45; }
  .map-outer { padding: 10px !important; }
  /* editor toolbar / mode buttons: phone layout lives in the .ed-* rules below */
}
/* Oct 30 (per Mely — "professional and elegant, not childish"): one quiet admin look
   for the map editor — white panels, hairline borders, 8px corners, small gray labels,
   one dark-green primary button. Styling only. */
.ed {
  --ed-accent: #14532d; --ed-accent-hover: #166534; --ed-text: #111827; --ed-muted: #6b7280;
  --ed-border: #e5e7eb; --ed-border-strong: #d1d5db; --ed-subtle: #f9fafb; --ed-track: #f3f4f6;
  font-family: "DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ed-text); font-size: 13px; line-height: 1.4;
}
.ed *, .ed *::before, .ed *::after { box-sizing: border-box; }
.ed-panel {
  max-width: 900px; margin: 0 auto 20px; background: #fff;
  border: 1px solid var(--ed-border); border-radius: 8px;
  box-shadow: 0 1px 2px rgba(16,24,40,0.05);
}
.ed-section { padding: 16px 20px; }
.ed-section + .ed-section { border-top: 1px solid var(--ed-border); }
.ed-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.ed-title { font-size: 14px; font-weight: 600; color: var(--ed-text); margin: 0; }
.ed-hint { font-size: 12px; color: var(--ed-muted); font-weight: 400; }
.ed-label { display: block; font-size: 12px; font-weight: 500; color: var(--ed-muted); margin-bottom: 6px; }
.ed-sublabel { font-size: 11.5px; font-weight: 500; color: var(--ed-muted); margin: 10px 0 6px; }
.ed-row { display: flex; gap: 8px; align-items: center; }
.ed-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; }
.ed-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 16px; }
.ed-span { grid-column: 1 / -1; }
.ed-input {
  width: 100%; height: 36px; padding: 0 10px; font: inherit; font-size: 13px; color: var(--ed-text);
  background: #fff; border: 1px solid var(--ed-border-strong); border-radius: 8px; outline: none;
  transition: border-color .12s, box-shadow .12s;
}
textarea.ed-input { height: auto; min-height: 72px; padding: 8px 10px; resize: vertical; line-height: 1.45; }
select.ed-input { padding-right: 6px; }
.ed-input:focus { border-color: var(--ed-accent); box-shadow: 0 0 0 3px rgba(20,83,45,0.12); }
.ed-input::placeholder { color: #9ca3af; }
.ed-color {
  width: 36px; height: 36px; padding: 3px; flex-shrink: 0; cursor: pointer;
  background: #fff; border: 1px solid var(--ed-border-strong); border-radius: 8px;
}
.ed-color::-webkit-color-swatch-wrapper { padding: 0; }
.ed-color::-webkit-color-swatch { border: none; border-radius: 5px; }
.ed-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 36px; padding: 0 14px; font: inherit; font-size: 13px; font-weight: 600; white-space: nowrap;
  border-radius: 8px; border: 1px solid transparent; cursor: pointer;
  transition: background .12s, border-color .12s, color .12s, box-shadow .12s;
}
.ed-btn:disabled { opacity: .55; cursor: default; }
.ed-btn svg { flex-shrink: 0; }
.ed-btn-primary { background: var(--ed-accent); color: #fff; box-shadow: 0 1px 2px rgba(16,24,40,0.08); }
.ed-btn-primary:hover { background: var(--ed-accent-hover); }
.ed-btn-secondary { background: #fff; color: #374151; border-color: var(--ed-border-strong); }
.ed-btn-secondary:hover { background: var(--ed-subtle); border-color: #9ca3af; }
.ed-btn-danger { background: #fff; color: #b91c1c; border-color: #fca5a5; }
.ed-btn-danger:hover { background: #fef2f2; border-color: #f87171; }
.ed-btn-danger-solid { background: #dc2626; color: #fff; }
.ed-btn-danger-solid:hover { background: #b91c1c; }
.ed-btn-ghost { background: transparent; color: var(--ed-muted); }
.ed-btn-ghost:hover { background: var(--ed-track); color: var(--ed-text); }
.ed-btn-sm { height: 30px; padding: 0 10px; font-size: 12px; }
.ed-btn-icon { width: 32px; height: 32px; padding: 0; }
.ed-btn-block { width: 100%; }
.ed-seg {
  display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px;
  background: var(--ed-track); border: 1px solid var(--ed-border); border-radius: 8px;
}
.ed-seg > button {
  display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px;
  font: inherit; font-size: 12.5px; font-weight: 500; color: #4b5563; white-space: nowrap;
  background: transparent; border: 1px solid transparent; border-radius: 6px; cursor: pointer;
  transition: background .12s, color .12s, box-shadow .12s;
}
.ed-seg > button:hover { color: var(--ed-text); }
.ed-seg > button[aria-pressed="true"] {
  background: #fff; color: var(--ed-text); font-weight: 600;
  border-color: var(--ed-border); box-shadow: 0 1px 2px rgba(16,24,40,0.08);
}
.ed-seg-fill { display: flex; }
.ed-seg-fill > button { flex: 1 1 auto; justify-content: center; }
.ed-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ed-zoom > button { width: 30px; padding: 0; justify-content: center; }
.ed-zoom > span { display: inline-flex; align-items: center; justify-content: center; min-width: 46px; font-size: 12.5px; font-weight: 600; color: #374151; font-variant-numeric: tabular-nums; }
.ed-tiles { display: flex; flex-wrap: wrap; gap: 6px; }
.ed-tile {
  width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
  font-size: 18px; line-height: 1; background: #fff; border: 1px solid var(--ed-border); border-radius: 8px;
  cursor: pointer; transition: border-color .12s, background .12s;
}
.ed-tile:hover { border-color: var(--ed-accent); background: #f0fdf4; }
.ed-lot-chip {
  display: inline-flex; align-items: center; height: 26px; padding: 0 10px; margin-left: 8px;
  font-size: 13px; font-weight: 700; color: var(--ed-accent); background: #f0fdf4;
  border: 1px solid #bbf7d0; border-radius: 6px; letter-spacing: .01em;
}
.ed-range { width: 100%; accent-color: var(--ed-accent); }
.ed-value { font-size: 12.5px; font-weight: 600; color: #374151; min-width: 38px; text-align: right; font-variant-numeric: tabular-nums; }
.ed-card { background: var(--ed-subtle); border: 1px solid var(--ed-border); border-radius: 8px; padding: 14px 16px; }
.ed-code { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--ed-accent); user-select: all; white-space: pre-wrap; word-break: break-all; }
.ed-check { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: #374151; cursor: pointer; }
.ed-check input { width: 16px; height: 16px; accent-color: var(--ed-accent); margin: 0; }
.ed-file { font: inherit; font-size: 12.5px; color: #4b5563; }
.ed-file::file-selector-button {
  font: inherit; font-size: 12.5px; font-weight: 600; color: #374151; height: 32px; padding: 0 12px; margin-right: 10px;
  background: #fff; border: 1px solid var(--ed-border-strong); border-radius: 8px; cursor: pointer;
}
.ed-file::file-selector-button:hover { background: var(--ed-subtle); }
.ed-note { font-size: 11.5px; color: #9ca3af; margin: 6px 0 0; }
.ed-footer { padding: 14px 20px; background: var(--ed-subtle); border-top: 1px solid var(--ed-border); border-radius: 0 0 8px 8px; }
.ed-toolbar { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 10px; padding: 14px 16px 0; }
.ed-modebar { max-width: 900px; margin: 0 auto 10px; display: flex; justify-content: flex-end; gap: 8px; padding: 0 16px; }
.ed-modal-back { position: fixed; inset: 0; background: rgba(17,24,39,0.45); display: flex; align-items: center; justify-content: center; z-index: 2000; padding: 16px; }
.ed-modal { background: #fff; border-radius: 8px; width: 380px; max-width: 100%; box-shadow: 0 20px 48px rgba(16,24,40,0.22); overflow: hidden; }
.ed-modal-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--ed-border); }
.ed-modal-body { padding: 18px 20px; display: grid; gap: 14px; }
.ed-modal-foot { padding: 14px 20px; display: flex; justify-content: flex-end; gap: 8px; background: var(--ed-subtle); border-top: 1px solid var(--ed-border); }
.ed-pop {
  position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
  width: 240px; background: #fff; border: 1px solid var(--ed-border); border-radius: 8px;
  padding: 12px; box-shadow: 0 10px 28px rgba(16,24,40,0.18); z-index: 500; display: grid; gap: 10px;
}
.ed-pop .ed-label { margin-bottom: 4px; }
.ed-pop .ed-input { height: 32px; font-size: 12.5px; }
.ed-pop textarea.ed-input { min-height: 60px; height: auto; }
@media (max-width: 620px) {
  .ed-section { padding: 14px 14px; }
  .ed-footer { padding: 12px 14px; }
  .ed-grid { grid-template-columns: 1fr; gap: 12px; }
  .ed-grid-3 { grid-template-columns: 1fr 1fr; }
  .ed-modebar { justify-content: center; flex-wrap: wrap; }
  .ed-modebar > .ed-btn { flex: 1 1 150px; }
  .ed-toolbar { padding: 10px 10px 0; gap: 8px; }
  .ed-seg > button { padding: 0 9px; font-size: 12px; }
}
.map-zoom-ctl {
  position: absolute; top: 8px; right: 8px; z-index: 300;
  display: flex; flex-direction: column; overflow: hidden;
  background: #fff; border: 1px solid rgba(0,0,0,0.12); border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.18);
}
.map-zoom-ctl button {
  width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
  background: #fff; color: #14532d; border: 0; padding: 0; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.map-zoom-ctl button + button { border-top: 1px solid #e5e7eb; }
.map-zoom-ctl button:disabled { color: #c4c9cf; cursor: default; }
.map-zoom-ctl button:active:not(:disabled) { background: #f0fdf4; }
`;

export default function AlohaMap() {
  const [statuses, setStatuses] = useState(() => (MAP_CACHE && MAP_CACHE.statuses) ? { ...initStatuses(), ...MAP_CACHE.statuses } : initStatuses());
  const [bookingDisabled, setBookingDisabled] = useState({});
  const [reservedDates, setReservedDates] = useState({});
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  // Oct 22 (per Mely): Expedia-style date search above the map.
  const [lotSearch, setLotSearch] = useState(null);
  const searchFree = lotSearch ? new Set((lotSearch.results || []).map((r) => r.lot)) : null;
  const searchPrefill = lotSearch ? {
    arrival: lotSearch.arrival, departure: lotSearch.departure, rvLength: lotSearch.rvLength || "",
    slideOutDriverCount: lotSearch.driverSlideOuts || "", slideOutPassengerCount: lotSearch.passengerSlideOuts || "",
  } : null;
  const [selectedStorageLot, setSelectedStorageLot] = useState(null);
  const [payLotSelected, setPayLotSelected] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  // Sep 21 (per Mely): real per-company name/address instead of the
  // hardcoded "Aloha RV Park" strings below — falls back to Aloha's own
  // real values while this loads, so nothing flashes empty for Aloha.
  const [companyProfile, setCompanyProfile] = useState({ company_name: "Aloha RV Park", address: "4648 S. Orange Blossom Trail, Kissimmee FL 34744" });
  useEffect(() => {
    getCompanyProfile().then((profile) => {
      if (profile) setCompanyProfile(profile);
    });
  }, []);
  const containerRef = useRef(null);
  const aboveMapRef = useRef(null);
  const reportHeightRef = useRef(null);
  const [previewWidth, setPreviewWidth] = useState(null); // null = actual device width; 900/390 = forced preview
  const [zoomLevel, setZoomLevel] = useState(1);
  // Aug 12 (per Mely): real Pan & Zoom for the guest-facing map — separate
  // from the admin-only preview zoom above. Uses a CSS transform (works on
  // all browsers/mobile, unlike the CSS `zoom` property used for the admin
  // preview control). getBoundingClientRect() already accounts for this
  // transform automatically, so existing click/drag position math (lot
  // hotspots, admin edit dragging) keeps working correctly without changes.
  const [mapScale, setMapScale] = useState(1);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const pinchStartRef = useRef(null);
  const viewportRef = useRef(null);
  // Aug 12 (per Mely): the whole map must be visible on load, on every
  // device — mobile frames are much shorter than desktop, so a fixed
  // "no zoom out past 100%" limit cropped the map on mobile (only
  // showing down to ~C9). minScale is now computed from the ACTUAL
  // available frame height vs. the map's real content height, so
  // "fully zoomed out" always means "see the entire map", regardless of
  // screen size. hasFitRef prevents this from fighting the visitor's
  // own manual zoom/pan once they've touched the map.
  const [minScale, setMinScale] = useState(1);
  const hasFitRef = useRef(false);
  const hasInteractedRef = useRef(false);

  useEffect(() => {
    function fitToFrame() {
      if (hasInteractedRef.current) return;
      const viewportEl = viewportRef.current;
      const contentWidth = containerRef.current?.offsetWidth;
      if (!viewportEl || !contentWidth) return;
      const availableHeight = viewportEl.offsetHeight;
      const naturalContentHeight = contentWidth * MAP_ASPECT_RATIO;
      if (!availableHeight || !naturalContentHeight) return;
      const fit = Math.min(1, Math.max(0.15, availableHeight / naturalContentHeight));
      setMinScale(fit);
      setMapScale(fit);
      setMapPan({ x: 0, y: 0 });
      hasFitRef.current = true;
    }
    fitToFrame();
    window.addEventListener("resize", fitToFrame);
    // Content/container can settle a moment after mount (fonts, image load) — re-check briefly.
    const t1 = setTimeout(fitToFrame, 300);
    const t2 = setTimeout(fitToFrame, 1000);
    return () => {
      window.removeEventListener("resize", fitToFrame);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const MAX_MAP_SCALE = 4;

  function clampPan(pan, scaleValue) {
    // Aug 12: keeps the map from being dragged so far that you lose it —
    // the more you're zoomed in past minScale (the "see everything"
    // level), the further you're allowed to pan. At minScale itself, no
    // panning is needed since the whole map is already visible.
    // Oct 29 (per Mely — phone view): on narrow screens the map is zoomed with the
    // on-map +/- buttons, so pan limits follow the real zoomed size — you can reach every
    // edge of the map but never drag it out of view. Desktop keeps the original limits.
    if (isNarrowMap && viewportRef.current && containerRef.current) {
      const vw = viewportRef.current.clientWidth, vh = viewportRef.current.clientHeight;
      const cw = containerRef.current.offsetWidth, ch = containerRef.current.offsetHeight;
      const mx = Math.max(0, (cw * scaleValue - vw) / 2), my = Math.max(0, (ch * scaleValue - vh) / 2);
      return { x: Math.max(-mx, Math.min(mx, pan.x)), y: Math.max(-my, Math.min(my, pan.y)) };
    }
    const maxOffset = Math.max(0, scaleValue - minScale) * 400;
    return {
      x: Math.max(-maxOffset, Math.min(maxOffset, pan.x)),
      y: Math.max(-maxOffset, Math.min(maxOffset, pan.y)),
    };
  }

  function zoomBy(delta, center) {
    hasInteractedRef.current = true;
    setMapScale(prev => {
      const next = Math.max(minScale, Math.min(MAX_MAP_SCALE, Math.round((prev + delta) * 100) / 100));
      if (next === minScale) setMapPan({ x: 0, y: 0 });
      return next;
    });
  }

  function handleMapWheel(e) {
    if (editMode) return; // don't fight with admin lot-dragging
    e.preventDefault();
    hasInteractedRef.current = true;
    zoomBy(e.deltaY < 0 ? 0.15 : -0.15);
  }

  function handlePanMouseDown(e) {
    if (editMode || mapScale <= minScale) return;
    hasInteractedRef.current = true;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, panX: mapPan.x, panY: mapPan.y };
  }

  function handlePanMouseMove(e) {
    if (!isPanning) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setMapPan(clampPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy }, mapScale));
  }

  function handlePanMouseUp() {
    setIsPanning(false);
  }

  function touchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function handleMapTouchStart(e) {
    if (editMode) return;
    hasInteractedRef.current = true;
    if (e.touches.length === 2) {
      pinchStartRef.current = { dist: touchDistance(e.touches), scale: mapScale };
    } else if (e.touches.length === 1 && mapScale > minScale) {
      setIsPanning(true);
      panStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, panX: mapPan.x, panY: mapPan.y };
    }
  }

  function handleMapTouchMove(e) {
    if (editMode) return;
    if (e.touches.length === 2 && pinchStartRef.current) {
      e.preventDefault();
      const newDist = touchDistance(e.touches);
      const next = Math.max(
        minScale,
        Math.min(MAX_MAP_SCALE, Math.round((pinchStartRef.current.scale * (newDist / pinchStartRef.current.dist)) * 100) / 100)
      );
      setMapScale(next);
    } else if (e.touches.length === 1 && isPanning) {
      const dx = e.touches[0].clientX - panStartRef.current.x;
      const dy = e.touches[0].clientY - panStartRef.current.y;
      setMapPan(clampPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy }, mapScale));
    }
  }

  function handleMapTouchEnd(e) {
    if (e.touches.length < 2) pinchStartRef.current = null;
    if (e.touches.length === 0) setIsPanning(false);
  }

  const [scale, setScale] = useState({ w: 900, h: 900 * MAP_ASPECT_RATIO });
  const scaleFactor = (scale.w || 900) / 900;
  const [draftLots, setDraftLots] = useState(() => (MAP_CACHE && MAP_CACHE.lots && Object.keys(MAP_CACHE.lots).length > 0) ? MAP_CACHE.lots : (HAS_CUSTOM_MAP ? {} : LOTS));
  // Oct 13 (per Mely): keep the lot overlays hidden until the map image AND the saved
  // positions/colors/statuses have loaded, so nothing jumps around on refresh.
  const [dataReady, setDataReady] = useState(() => !!(MAP_CACHE && MAP_CACHE.lots));
  const [imgReady, setImgReady] = useState(false);
  const mapImgRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => { setDataReady(true); setImgReady(true); }, 5000); // safety: never stay hidden
    return () => clearTimeout(t);
  }, []);
  useEffect(() => { if (mapImgRef.current && mapImgRef.current.complete) setImgReady(true); }, []);
  // Oct 9: styled confirmation (replaces the browser's plain window.confirm popup)
  const [confirmDeleteLot, setConfirmDeleteLot] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const lastSavedLots = useRef(HAS_CUSTOM_MAP ? {} : LOTS); // what the database held after the previous save/load
  const [activeEditLot, setActiveEditLot] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState("");
  const [snapLines, setSnapLines] = useState({ x: null, y: null });
  const [newLotName, setNewLotName] = useState("");
  const [texts, setTexts] = useState(() => (MAP_CACHE && MAP_CACHE.texts) || []);
  const [lotColors, setLotColors] = useState(() => (MAP_CACHE && MAP_CACHE.lotColors) || {});
  const [rotations, setRotations] = useState(() => (MAP_CACHE && MAP_CACHE.rotations) || {});
  const [emojiRotations, setEmojiRotations] = useState(() => (MAP_CACHE && MAP_CACHE.emojiRotations) || {});
  const [textRotations, setTextRotations] = useState(() => (MAP_CACHE && MAP_CACHE.textRotations) || {});
  const [lotInfo, setLotInfo] = useState({});
  const [parkSettings, setParkSettings] = useState({ cancellation_days: 7, checkin_time: "2:00 PM", checkout_time: "11:00 AM" });
  const [showParkSettings, setShowParkSettings] = useState(false);
  const [showMyReservations, setShowMyReservations] = useState(false);
  const [emojis, setEmojis] = useState(() => (MAP_CACHE && MAP_CACHE.emojis) || []);
  const [lotShapes, setLotShapes] = useState(() => (MAP_CACHE && MAP_CACHE.lotShapes) || {});
  const [dragging, setDragging] = useState(null);
  // Aug 12 (per Mely): emoji edit-mode dragging now uses this SAME
  // real-DOM-rect-based % computation as everything else (lots, guest
  // emoji rendering) — replacing react-rnd's separate JS-pixel math for
  // emojis, which could disagree with the guest CSS-% rendering in
  // subtle ways (what looked centered while dragging didn't always
  // match what guests actually saw). One single coordinate system now,
  // used identically in both edit and guest mode — guaranteed WYSIWYG.
  const [draggingEmoji, setDraggingEmoji] = useState(null);
  const emojiDragOffsetRef = useRef({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [editorRole, setEditorRole] = useState(null); // null | 'master_admin' | 'park_admin'
  // Aug 19 (public-site audit): the raw token itself is now also kept in
  // state (not just the resolved editorRole) so every write request below
  // can include it — every map write endpoint used to accept writes from
  // anyone with no login at all; they now all verify this same token
  // server-side too.
  const [editToken, setEditToken] = useState(null);
  // Oct 30: "View as park admin" — the editor shows exactly as the park admin sees it, nothing saves.
  const [mapReadOnly, setMapReadOnly] = useState(false);
  // master_admin: full editor (move/resize lots, everything below).
  // park_admin: restricted — can only manage emoji (add/edit info/delete)
  // and change a lot's color, never move/resize lots or edit their info/price.
  const isAdmin = editorRole === "master_admin";
  const canEditMap = editorRole === "master_admin" || editorRole === "park_admin";
  const isRestrictedEditor = editorRole === "park_admin";
  const isInfoOnly = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("edit") === "info";
  const [editMode, setEditMode] = useState(false);
  // Oct 29 (per Mely — Android phone): narrow map = phone layout. Lot labels are sized to
  // fit inside each lot (turned sideways in tall, thin lots) so they never run into each
  // other, and small +/- buttons on the map zoom in to read them. Desktop is unchanged.
  const isNarrowMap = !editMode && (scale.w || 900) < 640;
  function zoomMapTo(target) {
    hasInteractedRef.current = true;
    const next = Math.max(minScale, Math.min(MAX_MAP_SCALE, Math.round(target * 100) / 100));
    const ratio = next / (mapScale || 1);
    setMapScale(next);
    setMapPan(next <= minScale ? { x: 0, y: 0 } : clampPan({ x: mapPan.x * ratio, y: mapPan.y * ratio }, next));
  }

  // Aug 12 (per Mely, Phase 2 of the pan/zoom work): react-rnd (the
  // library powering lot move/resize/rotate in edit mode) doesn't
  // correctly account for an ancestor CSS transform — dragging while
  // zoomed/panned would feel wrong (jumpy or offset). Simplest safe fix:
  // editing always happens at true 1:1 scale, regardless of whatever
  // zoom/pan a guest (or the admin, before switching to edit) had set.
  useEffect(() => {
    if (editMode) {
      setMapScale(1);
      setMapPan({ x: 0, y: 0 });
    }
  }, [editMode]);
  const [activeEmoji, setActiveEmoji] = useState(null);
  const [propaneModalLotId, setPropaneModalLotId] = useState(null);
  const [propaneReceipt, setPropaneReceipt] = useState(null);
  const [storageModalOpen, setStorageModalOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const editRequested = params.get("edit") === "true";
    const token = params.get("token");
    if (!editRequested || !token) {
      setEditorRole(null);
      return;
    }
    fetch(`/api/verify-edit-token?park_id=${PARK_ID}&token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((result) => {
        if (result.valid && result.readOnly) {
          installMapReadOnlyGuard();
          setMapReadOnly(true);
        }
        setEditorRole(result.valid ? result.role : null);
        setEditToken(result.valid ? token : null);
      })
      .catch(() => {
        setEditorRole(null);
        setEditToken(null);
      });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("propane_payment") !== "success") return;
    const sessionId = params.get("session_id");
    if (!sessionId) return;

    let attempts = 0;
    function fetchOrder() {
      fetch(`/api/propane-data?type=order&session_id=${encodeURIComponent(sessionId)}`)
        .then((res) => res.json())
        .then((result) => {
          if (result.order) {
            setPropaneReceipt(result.order);
          } else if (attempts < 5) {
            // the Stripe webhook can take a couple seconds to land
            attempts += 1;
            setTimeout(fetchOrder, 1500);
          }
        })
        .catch(() => {});
    }
    fetchOrder();
    // Clean the URL so refreshing doesn't re-trigger this
    window.history.replaceState({}, "", window.location.pathname);
  }, []);


  useEffect(() => {
    if (window.self === window.top) return; // not embedded in an iframe, nothing to report

    // Aug 12 (per Mely): the frame is fixed-height now (Pan/Zoom lets
    // visitors navigate within it) — so this no longer watches a moving
    // scrollHeight target (that would just measure the fixed frame
    // itself now, a circular value). Instead, it computes the TRUE
    // natural height needed to show the whole page with zero cropping
    // at the current device width: header+legend+instructions (measured
    // directly) + the map graphic's real height at this width
    // (contentWidth * MAP_ASPECT_RATIO). Reported a few times with
    // settle delays (fonts/layout can shift slightly right after mount)
    // then stopped for good — never a continuous loop, so it can't
    // drift into a stale/wrong value like the old mechanism did.
    reportHeightRef.current = reportNaturalHeight;
    function reportNaturalHeight() {
      const aboveHeight = aboveMapRef.current?.offsetHeight || 0;
      const contentWidth = containerRef.current?.offsetWidth;
      if (!contentWidth) return;
      const mapHeight = contentWidth * MAP_ASPECT_RATIO;
      // Oct 29: +40 = the map box's padding (16 top + 16 bottom) and border — the old +24
      // cut the bottom edge of the map off by a few pixels inside the website's frame.
      const total = Math.ceil(aboveHeight + mapHeight + 40);
      window.parent.postMessage({ type: "aloha-map-height", height: total }, "*");
    }

    reportNaturalHeight();
    const t1 = setTimeout(reportNaturalHeight, 300);
    const t2 = setTimeout(reportNaturalHeight, 1000);
    window.addEventListener("resize", reportNaturalHeight);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", reportNaturalHeight);
    };
  }, []);

  // Oct 28: searching opens a strip of lot cards above the map, which makes the page
  // taller than it was at mount — re-measure so the website resizes the frame to match.
  useEffect(() => {
    const t = setTimeout(() => reportHeightRef.current?.(), 50);
    return () => clearTimeout(t);
  }, [lotSearch]);

  // Oct 30 (per Mely — "in edit mode the lots move from their position"): edit mode draws
  // each lot in pixels (react-rnd), worked out from this measured map size, while preview
  // draws the same saved % directly. The size used to be measured only on load and on a
  // window resize — but switching to edit mode changes the map's width without any window
  // resize (the preview frame's 2px border goes away, the taller editor page brings a
  // scrollbar, the narrow-screen padding changes), so edit mode kept drawing every lot
  // against the OLD width and they slid off the picture, more toward the right/bottom.
  // Now it watches the map box itself and always measures its real inner size (the same
  // box the % positions in preview are relative to). Saved coordinates are untouched.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      // computed width/height = the exact (sub-pixel) inner box, unaffected by the
      // pan/zoom transform; clientWidth would round to whole pixels.
      const cs = window.getComputedStyle(el);
      const w = parseFloat(cs.width) || el.clientWidth;
      if (!w) return;
      const h = parseFloat(cs.height) || el.clientHeight || w * MAP_ASPECT_RATIO;
      setScale((prev) => (Math.abs(prev.w - w) < 0.01 && Math.abs(prev.h - h) < 0.01 ? prev : { w, h }));
    };
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", update);
    return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", update); };
  }, [previewWidth, editMode, !!confirmed]);

  useEffect(() => {
    async function loadData() {
      const [emojiRows, shapeRows, textRows, colorRows, rotRows, emojiRotRows, textRotRows, geoRowsAll, statusData] = await Promise.all([
        loadFromSupabase('emojis'),
        loadFromSupabase('shapes'),
        loadFromSupabase('texts'),
        loadFromSupabase('lotColors'),
        loadFromSupabase('rotations'),
        loadFromSupabase('emojiRotations'),
        loadFromSupabase('textRotations'),
        loadFromSupabase('lotGeometry').catch(() => []),
        fetch('/api/lot-data?type=statuses&park_id=' + PARK_ID).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      // Oct 9 (per Mely): lot positions now live in the database
      // (map_elements, type 'lotGeometry'), not only in this file. The
      // LOTS constant below is just the default for a park that has never
      // saved its own positions.
      try {
        const geo = geoRowsAll[0]?.data;
        if (geo && typeof geo === 'object' && Object.keys(geo).length > 0) { setDraftLots(geo); lastSavedLots.current = geo; }
        // Oct 20: a park with its own uploaded map starts with no lots
        // (never another park's default lots) until they are placed.
        else if (HAS_CUSTOM_MAP) { setDraftLots({}); lastSavedLots.current = {}; }
      } catch (err) {
        console.error('Error loading lot positions:', err);
      }
      if (emojiRows.length > 0) setEmojis(emojiRows[0].data || []);
      if (shapeRows.length > 0) setLotShapes(shapeRows[0].data || {});
      if (textRows.length > 0) setTexts(textRows[0].data || []);
      if (colorRows.length > 0) setLotColors(colorRows[0].data || {});
      if (rotRows.length > 0) setRotations(rotRows[0].data || {});
      if (emojiRotRows.length > 0) setEmojiRotations(emojiRotRows[0].data || {});
      if (textRotRows.length > 0) setTextRotations(textRotRows[0].data || {});
      if (statusData) {
        setStatuses(prev => ({ ...prev, ...(statusData.statuses || {}) }));
        setBookingDisabled(statusData.bookingDisabled || {});
      }
      writeMapCache({
        lots: (geoRowsAll[0]?.data && Object.keys(geoRowsAll[0].data).length > 0) ? geoRowsAll[0].data : null,
        emojis: emojiRows[0]?.data || [], lotShapes: shapeRows[0]?.data || {}, texts: textRows[0]?.data || [],
        lotColors: colorRows[0]?.data || {}, rotations: rotRows[0]?.data || {},
        emojiRotations: emojiRotRows[0]?.data || {}, textRotations: textRotRows[0]?.data || {},
        statuses: (statusData && statusData.statuses) || {},
      });
      // Everything that changes how the lots LOOK is in — show the map now.
      // (Prices, dates and settings below load quietly afterwards.)
      setDataReady(true);
      // Real, live lot statuses — rv_lots.status is the single source of
      // truth shared with the lease application / reservation systems, not
      // the old disconnected map_elements "statuses" blob.
      try {
        const reservedRes = await fetch('/api/lot-data?type=reserved-dates&park_id=' + PARK_ID);
        if (reservedRes.ok) {
          setReservedDates(await reservedRes.json());
        }
      } catch (err) {
        console.error('Error loading lot reserved-until dates:', err);
      }
      const info = await loadLotInfo(PARK_ID);
      // Real, live pricing — rv_lots.daily_rate/weekly_rate/high_season_price/
      // low_season_price is the single source of truth shared with the
      // admin's "Lots & Seasonal Pricing" screen, not the old disconnected
      // lot_info price_daily/price_monthly/price_weekly fields. Only
      // price_yearly (rarely used, no rv_lots equivalent) still comes from
      // lot_info's own manual entry.
      try {
        const pricingRes = await fetch('/api/lot-data?type=pricing&park_id=' + PARK_ID);
        if (pricingRes.ok) {
          const livePricing = await pricingRes.json();
          Object.keys(livePricing).forEach((lotName) => {
            info[lotName] = { ...(info[lotName] || {}), ...livePricing[lotName] };
          });
        }
      } catch (err) {
        console.error('Error loading live lot pricing:', err);
      }
      setLotInfo(info);
      const settings = await loadParkSettings();
      if (settings) setParkSettings(settings);
    }
    loadData().catch(err => console.error('loadData failed:', err)).finally(() => setDataReady(true));
  }, []);

  const handleConfirm = (lot, form) => {
    setStatuses(s => ({ ...s, [lot]: "reserved" }));
    setConfirmed({ lot, ...form });
    setSelected(null);
  };

  const getSnapLines = (lot, px, py, pw, ph) => {
    const lines = { x: null, y: null };
    const threshold = 5;
    Object.entries(draftLots).forEach(([key, [ox, oy, ow, oh]]) => {
      if (key === lot) return;
      const mapW = scale.w || 900;
      const mapH = scale.h || (900 * MAP_ASPECT_RATIO);
      const opx = ox / 100 * mapW;
      const opy = oy / 100 * mapH;
      const opw = ow / 100 * mapW;
      const oph = oh / 100 * mapH;
      // Alinear izquierda
      if (Math.abs(px - opx) < threshold) lines.x = opx;
      // Alinear derecha
      if (Math.abs(px + pw - opx - opw) < threshold) lines.x = opx + opw - pw;
      // Alinear top
      if (Math.abs(py - opy) < threshold) lines.y = opy;
      // Alinear bottom
      if (Math.abs(py + ph - opy - oph) < threshold) lines.y = opy + oph - ph;
      // Centro horizontal
      if (Math.abs(py + ph/2 - opy - oph/2) < threshold) lines.y = opy + oph/2 - ph/2;
    });
    return lines;
  };

  const counts = Object.values(statuses).reduce((acc, s) => { acc[s] = (acc[s]||0)+1; return acc; }, {});

  if (!PARK_ID_PROVIDED) {
    return (
      <div style={{ minHeight:"100vh", background:"#f9fafb", display:"flex", alignItems:"center", justifyContent:"center", padding:20, fontFamily:"sans-serif" }}>
        <div style={{ background:"#fff", borderRadius:16, padding:40, maxWidth:440, width:"100%", textAlign:"center", boxShadow:"0 10px 40px rgba(0,0,0,0.1)" }}>
          <div style={{ fontSize:48, marginBottom:12 }}>⚠️</div>
          <h1 style={{ fontSize:20, fontWeight:800, color:"#374151", marginBottom:8 }}>No Park Specified</h1>
          <p style={{ fontSize:14, color:"#6b7280" }}>This map link is missing its park identifier and cannot be displayed. Please contact support instead of assuming any particular property's data.</p>
        </div>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div style={{ minHeight:"100vh", background:"#f0fdf4", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
        <div style={{ background:"#fff", borderRadius:20, padding:48, maxWidth:440, width:"100%", textAlign:"center", boxShadow:"0 20px 60px rgba(0,0,0,0.15)" }}>
          <div style={{ fontSize:64, marginBottom:16 }}>🎉</div>
          <h1 style={{ fontFamily:"Georgia,serif", fontSize:28, color:"#166534", marginBottom:12 }}>Reservation Confirmed!</h1>
          <p style={{ fontFamily:"sans-serif", color:"#555", marginBottom:8 }}>
            <strong>Lot {confirmed.lot}</strong> has been reserved for <strong>{confirmed.name}</strong>.
          </p>
          <p style={{ fontFamily:"sans-serif", color:"#555", marginBottom:24, fontSize:14 }}>
            {confirmed.arrival} → {confirmed.departure} · Confirmation sent to {confirmed.email}
          </p>
          <div style={{ background:"#f0fdf4", borderRadius:12, padding:16, marginBottom:24 }}>
            <p style={{ fontFamily:"sans-serif", fontSize:13, color:"#16a34a", fontWeight:600 }}>
              📍 {companyProfile.company_name} · {companyProfile.address}
            </p>
          </div>
          <button onClick={()=>setConfirmed(null)} style={{ ...btnPrimary, width:"100%" }}>← Back to Map</button>
        </div>
      </div>
    );
  }

  const isFixedFrame = window.self !== window.top && !editMode;

  // Oct 29: phone-only lot label. Drawn at 10px and shrunk with a transform (not a smaller
  // font-size) so Android's text boosting / minimum font size can't blow it back up past
  // the lot's edges. Tall, thin lots get the label turned sideways, which lets it be larger.
  // Oct 29 (per Mely): the sideways labels use the SAME letter size as the other lots (B, C, D…),
  // not bigger — so sideways labels are capped at the typical size of the horizontal labels.
  const labelFit = (lot, pw, ph) => {
    const textW = lot.length * 6.4 + 1;
    const textH = 10;
    const kFlat = Math.min(1, (pw - 3) / textW, (ph - 3) / textH);
    const kSide = Math.min(1, (ph - 3) / textW, (pw - 3) / textH);
    return { kFlat, kSide, side: kSide > kFlat * 1.2 };
  };
  const flatLabelK = (() => {
    const mapW = scale.w || 900, mapH = scale.h || (900 * MAP_ASPECT_RATIO);
    const ks = Object.entries(draftLots || {})
      .map(([lot, [, , w, h]]) => labelFit(lot, w / 100 * mapW, h / 100 * mapH))
      .filter((f) => !f.side).map((f) => f.kFlat).sort((a, b) => a - b);
    return ks.length ? ks[Math.floor(ks.length / 2)] : 1;
  })();
  const narrowLotLabel = (lot, pw, ph) => {
    const { kFlat, kSide, side } = labelFit(lot, pw, ph);
    const k = Math.max(0.3, side ? Math.min(kSide, flatLabelK) : kFlat);
    return (
      <span style={{ fontSize:10, fontWeight:700, color:"#fff", textShadow:"0 1px 2px rgba(0,0,0,0.85)", lineHeight:1, whiteSpace:"nowrap", letterSpacing:"-0.02em", fontFamily:"Arial,Helvetica,sans-serif", pointerEvents:"none", display:"inline-block", transform:`${side ? "rotate(-90deg) " : ""}scale(${k})`, transformOrigin:"center" }}>
        {lot}
      </span>
    );
  };

  return (
    <div style={{
      minHeight: !isFixedFrame ? "100vh" : undefined,
      height: isFixedFrame ? "100%" : undefined,
      display: isFixedFrame ? "flex" : undefined,
      flexDirection: isFixedFrame ? "column" : undefined,
      overflow: isFixedFrame ? "hidden" : undefined,
      background:"#f0fdf4", fontFamily:"sans-serif",
    }}>
      <style>{emojiHoverStyle}</style>
      <div ref={aboveMapRef}>
      {/* Oct 28 (per Mely): the search sits above the map on its own white band — it reads
          as part of the page, not as something inside the map. */}
      {!editMode && (
        <LotSearch
          parkId={PARK_ID}
          search={lotSearch}
          onResults={setLotSearch}
          onPick={(lot) => setSelected({ lot, status: "available", prefill: searchPrefill })}
        />
      )}
      {/* Header */}
      <div className="map-header" style={{ background:"linear-gradient(135deg,#14532d,#16a34a)", padding:"24px" }}>
        <div>
          <div className="map-title" style={{ fontFamily:"Georgia,serif", fontWeight:900, fontSize:22, color:"#fff" }}>🌺 {companyProfile.company_name}</div>
          <div className="map-subtitle" style={{ fontSize:12, color:"rgba(255,255,255,0.8)", letterSpacing:1, marginTop:4 }}>INTERACTIVE LOT MAP · KISSIMMEE, FL</div>
        </div>
        <div className="map-legend">
          {Object.entries(STATUS_COLORS).map(([s,c]) => (
            <div key={s} className="map-legend-item">
              <div style={{ width:14, height:14, borderRadius:4, background:STATUS_SOLID[s], flexShrink:0 }} />
              <span style={{ color:"#fff", fontSize:13, textTransform:"capitalize", fontWeight:600 }}>{s.replace(/_/g," ")} ({counts[s]||0})</span>
            </div>
          ))}
        </div>
      </div>

      <div className="map-hint" style={{ padding:"16px 16px 0", textAlign:"center" }}>
        <p style={{ color:"#166534", fontWeight:600, margin:0, fontSize:14 }}>
          Click any <span style={{ color:"#16a34a" }}>🟢 green</span> or <span style={{ color:"#ca8a04" }}>🟡 orange</span> lot to check availability and reserve it. Hover to see the lot number.
        </p>
      </div>
      </div>

      {canEditMap && editMode && (
        <div className="map-edit-toolbar ed ed-toolbar">
          <div className="ed-seg" role="group" aria-label="Preview width">
            <button type="button" aria-pressed={previewWidth === null} onClick={() => setPreviewWidth(null)}>
              <EdIcon name="auto" /> Auto (This Screen)
            </button>
            <button type="button" aria-pressed={previewWidth === 900} onClick={() => setPreviewWidth(900)}>
              <EdIcon name="monitor" /> Desktop View
            </button>
            <button type="button" aria-pressed={previewWidth === 390} onClick={() => setPreviewWidth(390)}>
              <EdIcon name="phone" /> Mobile View
            </button>
          </div>
          <div className="ed-seg ed-zoom" role="group" aria-label="Editor zoom">
            <button type="button" aria-label="Zoom out"
              onClick={() => setZoomLevel(z => Math.max(1, Math.round((z - 0.25) * 100) / 100))}
            ><EdIcon name="minus" /></button>
            <span>{Math.round(zoomLevel * 100)}%</span>
            <button type="button" aria-label="Zoom in"
              onClick={() => setZoomLevel(z => Math.min(2.5, Math.round((z + 0.25) * 100) / 100))}
            ><EdIcon name="plus" /></button>
          </div>
        </div>
      )}

      {/* Map Container */}
      <div className="map-outer" style={{
        padding:16, display:"flex", justifyContent:"center", zoom: zoomLevel,
        flex: isFixedFrame ? 1 : undefined,
        minHeight: isFixedFrame ? 0 : undefined,
      }}>
        <div
          ref={viewportRef}
          style={{
            overflow: (isFixedFrame || isNarrowMap) ? "hidden" : "visible",
            position: isNarrowMap ? "relative" : undefined,
            width: "100%",
            height: isFixedFrame ? "100%" : undefined,
            maxWidth: previewWidth || 900,
            ...(editMode ? {} : { border: "2px solid #111", borderRadius: 8, background: "#fff" }),
            touchAction: !editMode && mapScale > minScale ? "none" : "auto",
            cursor: isPanning ? "grabbing" : (!editMode && mapScale > minScale ? "grab" : "default"),
          }}
          onWheel={handleMapWheel}
          onMouseDown={handlePanMouseDown}
          onMouseMove={handlePanMouseMove}
          onMouseUp={handlePanMouseUp}
          onMouseLeave={handlePanMouseUp}
          onTouchStart={handleMapTouchStart}
          onTouchMove={handleMapTouchMove}
          onTouchEnd={handleMapTouchEnd}
        >
        <div
          ref={containerRef}
          style={{
            position:"relative", width:"100%", display:"inline-block", userSelect:"none",
            ...(previewWidth ? { border:"3px solid #166534", borderRadius:12, boxShadow:"0 4px 20px rgba(0,0,0,0.15)" } : {}),
            // edit mode is always drawn at true 1:1 (react-rnd can't follow a scaled parent)
            transform: editMode ? "none" : `translate(${mapPan.x}px, ${mapPan.y}px) scale(${mapScale})`,
            transformOrigin: "center center",
            transition: isPanning ? "none" : "transform 0.15s ease-out",
          }}
          className={(dataReady && imgReady) ? 'map-ready' : 'map-loading'}
          onClick={() => setActiveEmoji(null)}
          onMouseMove={editMode ? (e) => {
            if (draggingEmoji) {
              const d = emojiDragOffsetRef.current;
              if (d.startX !== undefined) {
                const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
                if (dist <= 4) return; // Aug 12: ignore tiny/accidental movement (e.g. a click) — only real dragging repositions
              }
              const rect = containerRef.current.getBoundingClientRect();
              const newX = Math.round(((e.clientX - rect.left) / rect.width * 100 - emojiDragOffsetRef.current.x) * 10) / 10;
              const newY = Math.round(((e.clientY - rect.top) / rect.height * 100 - emojiDragOffsetRef.current.y) * 10) / 10;
              setEmojis(prev => prev.map(em => em.id === draggingEmoji ? { ...em, x: newX, y: newY } : em));
              return;
            }
            if (!dragging) return;
            const rect = containerRef.current.getBoundingClientRect();
            const newX = Math.round(((e.clientX - rect.left) / rect.width * 100 - dragOffset.x) * 10) / 10;
            const newY = Math.round(((e.clientY - rect.top) / rect.height * 100 - dragOffset.y) * 10) / 10;
            setDraftLots(prev => ({
              ...prev,
              [dragging]: [newX, newY, prev[dragging][2], prev[dragging][3]]
            }));
          } : undefined}
          onMouseUp={editMode ? () => {
            if (draggingEmoji) setDraggingEmoji(null);
            if (dragging) {
              const [x,y,w,h] = draftLots[dragging];
              console.log(`${dragging}: [${x}, ${y}, ${w}, ${h}],`);
              setDragging(null);
            }
          } : undefined}
          onMouseLeave={editMode ? () => { setDragging(null); setDraggingEmoji(null); } : undefined}
        >
          <style>{`.map-loading{opacity:0 !important;} .map-loading > *{pointer-events:none !important;} .map-ready{transition:opacity .2s ease;}`}</style>
          <img
            ref={mapImgRef}
            onLoad={() => setImgReady(true)}
            src={MAP_IMG}
            alt={`${companyProfile.company_name} Map`}
            style={{ width:"100%", height:"auto", aspectRatio:`auto ${MAP_W} / ${MAP_H}`, display:"block", borderRadius:12, boxShadow:"0 4px 24px rgba(0,0,0,0.18)" }}
          />
          {/* Snap Lines */}
          {editMode && snapLines.x !== null && (
            <div style={{ position:"absolute", left:snapLines.x, top:0, width:1, height:"100%", background:"#f59e0b", zIndex:1000, pointerEvents:"none" }} />
          )}
          {editMode && snapLines.y !== null && (
            <div style={{ position:"absolute", top:snapLines.y, left:0, height:1, width:"100%", background:"#f59e0b", zIndex:1000, pointerEvents:"none" }} />
          )}
          {/* Lot overlays */}
          {Object.entries(draftLots).map(([lot, [x, y, w, h]]) => {
            const status = statuses[lot] || "available";
            const isHov = hover === lot;
            const isActive = activeEditLot === lot;
            const shape = lotShapes[lot] || "rectangle";
            const borderRadius = shape === "circle" ? "50%" : shape === "rounded" ? "8px" : "3px";
            const clipPath = shape === "parallelogram-left" ? "polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)" :
                             shape === "parallelogram-right" ? "polygon(0% 0%, 90% 0%, 100% 100%, 10% 100%)" : "none";
            const mapW = scale.w || 900;
            const mapH = scale.h || (900 * MAP_ASPECT_RATIO);
            const px = x / 100 * mapW;
            const py = y / 100 * mapH;
            const pw = w / 100 * mapW;
            const ph = h / 100 * mapH;
            if (editMode && isAdmin) {
              return (
                <Rnd
                  key={lot}
                  position={{ x: px, y: py }}
                  size={{ width: pw, height: ph }}
                  onDrag={(e, d) => {
                    const lines = getSnapLines(lot, d.x, d.y, pw, ph);
                    setSnapLines(lines);
                  }}
                  onDragStop={(e, d) => {
                    setSnapLines({ x: null, y: null });
                    const nx = Math.round(d.x / mapW * 1000) / 10;
                    const ny = Math.round(d.y / mapH * 1000) / 10;
                    setDraftLots(prev => ({ ...prev, [lot]: [nx, ny, prev[lot][2], prev[lot][3]] }));
                    setActiveEditLot(lot);
                  }}
                  onResizeStop={(e, dir, ref, delta, pos) => {
                    const nx = Math.round(pos.x / mapW * 1000) / 10;
                    const ny = Math.round(pos.y / mapH * 1000) / 10;
                    const nw = Math.round(ref.offsetWidth / mapW * 1000) / 10;
                    const nh = Math.round(ref.offsetHeight / mapH * 1000) / 10;
                    setDraftLots(prev => ({ ...prev, [lot]: [nx, ny, nw, nh] }));
                    setActiveEditLot(lot);
                  }}
                  bounds="parent"
                  style={{
                    cursor:"move",
                    boxSizing:"border-box",
                    zIndex: isActive ? 50 : 10,
                  }}
                  onClick={() => setActiveEditLot(lot)}
                >
                  {/* Oct 30: the lot's look (and its rotation) lives on this inner box — react-rnd
                      places the outer box with its own CSS transform, which silently replaced the
                      rotate() here, so rotated lots showed un-rotated in edit mode. */}
                  <div style={{
                    width:"100%", height:"100%",
                    background: isActive ? "rgba(251,191,36,0.85)" : lotColors[lot] ? lotColors[lot] : STATUS_COLORS[status],
                    borderRadius: borderRadius,
                    clipPath: clipPath,
                    border: isActive ? "2px solid #f59e0b" : "1.5px solid rgba(255,255,255,0.6)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    boxSizing:"border-box",
                    transform: `rotate(${rotations[lot] || 0}deg)`,
                  }}>
                    <span style={{ fontSize:"clamp(5px,0.85vw,10px)", fontWeight:700, color:"#fff", textShadow:"0 1px 3px rgba(0,0,0,0.8)", pointerEvents:"none" }}>{lot}</span>
                  </div>
                </Rnd>
              );
            }
            if (editMode && isRestrictedEditor) {
              // park_admin: can change this lot's status/color/info, but never move/resize it.
              return (
                <div
                  key={lot}
                  onClick={() => setActiveEditLot(lot)}
                  style={{
                    position:"absolute",
                    left:`${x}%`, top:`${y}%`,
                    width:`${w}%`, height:`${h}%`,
                    background: lotColors[lot] ? lotColors[lot] : STATUS_COLORS[status],
                    borderRadius: borderRadius,
                    clipPath: clipPath,
                    border: activeEditLot === lot ? "2px solid #f59e0b" : "1.5px dashed rgba(255,255,255,0.8)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    cursor:"pointer",
                    boxSizing:"border-box",
                    zIndex: activeEditLot === lot ? 50 : 10,
                    transform: `rotate(${rotations[lot] || 0}deg)`,
                  }}
                >
                  <span style={{ fontSize:"clamp(5px,0.85vw,10px)", fontWeight:700, color:"#fff", textShadow:"0 1px 3px rgba(0,0,0,0.8)", pointerEvents:"none" }}>{lot}</span>
                </div>
              );
            }
            return (
              <div
                key={lot}
                onClick={() => {
                  if (lot.startsWith("S")) {
                    setSelectedStorageLot({ lot, status });
                  } else if (searchFree && searchFree.has(lot)) {
                    setSelected({ lot, status: "available", prefill: searchPrefill });
                  } else {
                    setSelected({ lot, status, prefill: searchPrefill });
                  }
                }}
                onMouseEnter={() => setHover(lot)}
                onMouseLeave={() => setHover(null)}
                title={`Lot ${lot} • ${status}`}
                style={{
                  position:"absolute",
                  left:`${x}%`, top:`${y}%`,
                  width:`${w}%`, height:`${h}%`,
                  background: searchFree
                    ? (searchFree.has(lot) ? (isHov ? "rgba(22,163,74,0.95)" : "rgba(34,197,94,0.85)") : "rgba(107,114,128,0.35)")
                    : lotColors[lot] ? lotColors[lot] : isHov ? STATUS_COLORS[status].replace(/[\d.]+\)$/, "0.88)") : STATUS_COLORS[status],
                  borderRadius: borderRadius,
                  clipPath: clipPath,
                  cursor: "pointer",
                  border: searchFree && searchFree.has(lot) ? "2.5px solid #fff" : isHov ? "2px solid rgba(255,255,255,0.9)" : "1.5px solid rgba(255,255,255,0.45)",
                  boxShadow: searchFree && searchFree.has(lot) ? "0 0 0 2px rgba(22,163,74,0.9)" : undefined,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  transition:"all 0.12s",
                  zIndex: isHov ? 20 : 1,
                  transform: `rotate(${rotations[lot] || 0}deg)`,
                  boxSizing:"border-box",
                }}
              >
                {isNarrowMap ? narrowLotLabel(lot, pw, ph) : (
                <span style={{ fontSize:"clamp(5px,0.85vw,10px)", fontWeight:700, color:"#fff", textShadow:"0 1px 3px rgba(0,0,0,0.8)", lineHeight:1, pointerEvents:"none" }}>
                  {lot}
                </span>
                )}
              </div>
            );
          })}
          {/* Texts */}
          {texts.map((item) => {
            const textSize = item.size * scaleFactor;

            // Aug 12 (per Mely): same fix as emojis below — guest view
            // uses plain CSS % positioning instead of react-rnd's
            // JS-pixel math, both to fix the same cross-view drift and
            // because texts previously had no disableDragging guard at
            // all, meaning a guest could accidentally drag a map label.
            if (!editMode) {
              return (
                <div
                  key={item.id}
                  style={{
                    position:"absolute", left:`${item.x}%`, top:`${item.y}%`,
                    fontSize:textSize, color:item.color, fontWeight:700,
                    textShadow:"0 1px 3px rgba(0,0,0,0.5)", whiteSpace:"nowrap",
                    userSelect:"none", zIndex:200, pointerEvents:"none",
                  }}
                >
                  {item.text}
                </div>
              );
            }

            return (
            <Rnd
              key={item.id}
              position={{ x: item.x / 100 * (scale.w || 900), y: item.y / 100 * (scale.h || (900 * MAP_ASPECT_RATIO)) }}
              size={{ width: item.text.length * textSize * 0.6 + 20 * scaleFactor, height: textSize + 16 * scaleFactor }}
              onDragStop={(e, d) => {
                const nx = Math.round(d.x / (scale.w || 900) * 1000) / 10;
                const ny = Math.round(d.y / (scale.h || (900 * MAP_ASPECT_RATIO)) * 1000) / 10;
                setTexts(prev => prev.map(t => t.id === item.id ? { ...t, x: nx, y: ny } : t));
              }}
              enableResizing={false}
              style={{ zIndex:200, cursor:"move" }}
            >
              <div style={{ fontSize:textSize, color:item.color, fontWeight:700, textShadow:"0 1px 3px rgba(0,0,0,0.5)", whiteSpace:"nowrap", userSelect:"none" }}>
                {item.text}
                {editMode && (
                  <button onClick={()=>setTexts(prev=>prev.filter(t=>t.id!==item.id))}
                    style={{ position:"absolute", top:-8, right:-8, background:"#ef4444", color:"#fff", border:"none", borderRadius:"50%", width:16, height:16, fontSize:10, cursor:"pointer", lineHeight:"16px", textAlign:"center" }}>x</button>
                )}
              </div>
            </Rnd>
          );})}
          {/* Emojis */}
          {emojis.map((item) => {
            const rawSize = item.size || 24;
            const emojiSize = rawSize * scaleFactor;

            // Aug 12 (per Mely): guest-facing emojis now use plain CSS %
            // positioning — the SAME system lots already correctly use —
            // instead of react-rnd's JS-pixel math (which depends on
            // scale.w/scale.h staying perfectly in sync with the real
            // rendered container, and was the actual source of the
            // cross-view drift, even after the aspect-ratio fix). Only
            // admin edit mode (or the info-only mode) still needs Rnd,
            // since only those modes let you drag an emoji to reposition
            // it.
            if (!editMode && !isInfoOnly) {
              return (
                <div key={item.id} style={{ position:"absolute", left:`${item.x}%`, top:`${item.y}%`, width:0, height:0, zIndex:100 }}>
                  <span
                    onClick={e => { e.stopPropagation(); setActiveEmoji(activeEmoji === item.id ? null : item.id); }}
                    className="map-emoji-hover"
                    style={{ fontSize: emojiSize, lineHeight:1, userSelect:"none", display:"inline-block", position:"absolute", left:0, top:0, transform:"translate(-50%,-50%)", cursor:"pointer", transition:"transform 0.15s, filter 0.15s" }}
                  >{item.emoji}</span>

                  {activeEmoji === item.id && (item.label || item.info) && createPortal(
                    <div onClick={()=>setActiveEmoji(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:1999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
                      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:20, padding:"24px 28px", minWidth:280, maxWidth:360, width:"100%", boxShadow:"0 24px 64px rgba(0,0,0,0.4)", fontFamily:"sans-serif", position:"relative" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                            <span style={{ fontSize:32 }}>{item.emoji}</span>
                            <span style={{ fontSize:20, fontWeight:800, color:"#14532d", fontFamily:"Georgia,serif" }}>{item.label}</span>
                          </div>
                          <button onClick={()=>setActiveEmoji(null)} style={{ background:"#f3f4f6", border:"none", borderRadius:"50%", width:32, height:32, fontSize:16, cursor:"pointer", color:"#6b7280", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                        </div>
                        {item.info && (
                          <div style={{ background:"#f0fdf4", borderRadius:12, padding:"12px 16px", borderLeft:"4px solid #16a34a" }}>
                            {item.info.split("\n").filter(l=>l.trim()).map((line, i) => (
                              <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:14 }}>
                                <span style={{ color:"#16a34a", fontWeight:700, fontSize:16, marginTop:1 }}>•</span>
                                <p style={{ margin:0, fontSize:15, color:"#166534", fontWeight:500, lineHeight:1.6, fontFamily:"Georgia, serif", letterSpacing:"0.01em" }}>{line}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {item.emoji === "⛽" && item.label && (item.label.toLowerCase().includes("propane") || item.label.toLowerCase().includes("propano")) && (
                          <div style={{ marginTop:16 }}>
                            <button onClick={()=>{ setActiveEmoji(null); setPropaneModalLotId(String(item.id)); }}
                              style={{ display:"block", width:"100%", background:"linear-gradient(135deg,#14532d,#16a34a)", color:"#fff", textAlign:"center", padding:"12px 20px", borderRadius:50, fontWeight:700, fontSize:15, fontFamily:"sans-serif", border:"none", cursor:"pointer", boxShadow:"0 4px 12px rgba(22,163,74,0.3)", marginBottom:10 }}>
                              💳 Buy Propane
                            </button>
                            <a href="tel:6892520567" style={{ display:"block", background:"#f3f4f6", color:"#374151", textAlign:"center", padding:"10px 20px", borderRadius:50, fontWeight:700, fontSize:14, fontFamily:"sans-serif", textDecoration:"none", border:"1.5px solid #d1d5db" }}>
                              📞 Questions: Call (689) 252-0567
                            </a>
                          </div>
                        )}
                        <div style={{ marginTop:16, textAlign:"center" }}>
                          <div style={{ fontSize:11, color:"#9ca3af", fontFamily:"sans-serif" }}>🌺 {companyProfile.company_name} · {companyProfile.address}</div>
                        </div>
                      </div>
                    </div>
                  , document.body)}
                </div>
              );
            }

            return (
              <div
                key={item.id}
                style={{ position:"absolute", left:`${item.x}%`, top:`${item.y}%`, width:0, height:0, zIndex:100 }}
              >
                <span
                  onMouseDown={e => {
                    if (!(editMode || isInfoOnly)) return;
                    e.stopPropagation();
                    const rect = containerRef.current.getBoundingClientRect();
                    emojiDragOffsetRef.current = {
                      x: (e.clientX - rect.left) / rect.width * 100 - item.x,
                      y: (e.clientY - rect.top) / rect.height * 100 - item.y,
                      startX: e.clientX,
                      startY: e.clientY,
                      moved: false,
                    };
                    setDraggingEmoji(item.id);
                  }}
                  onClick={e => {
                    e.stopPropagation();
                    // Aug 12: distinguishes a click (open the popup editor)
                    // from a drag (reposition) — only opens if the mouse
                    // barely moved since mousedown.
                    const d = emojiDragOffsetRef.current;
                    if (d?.startX !== undefined) {
                      const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
                      if (dist > 4) return;
                    }
                    setActiveEmoji(activeEmoji === item.id ? null : item.id);
                  }}
                  className="map-emoji-hover"
                  style={{
                    fontSize: emojiSize, lineHeight:1, userSelect:"none", display:"inline-block",
                    position:"absolute", left:0, top:0, transform:"translate(-50%,-50%)",
                    cursor: (editMode || isInfoOnly) ? "move" : "pointer",
                    transition: draggingEmoji === item.id ? "none" : "transform 0.15s, filter 0.15s",
                  }}
                >{item.emoji}</span>

                {(editMode || isInfoOnly) && activeEmoji === item.id && (
                  <div onClick={e => e.stopPropagation()} className="ed ed-pop">
                    <div>
                      <label className="ed-label">Popup title</label>
                      <input
                        className="ed-input"
                        value={item.label || ""}
                        onChange={e => setEmojis(prev => prev.map(em => em.id === item.id ? { ...em, label: e.target.value } : em))}
                        placeholder="e.g. Pool, Office..."
                      />
                    </div>
                    <div>
                      <label className="ed-label">Popup info (one per line)</label>
                      <textarea
                        className="ed-input"
                        value={item.info || ""}
                        onChange={e => setEmojis(prev => prev.map(em => em.id === item.id ? { ...em, info: e.target.value } : em))}
                        placeholder="Hours: 9am-9pm&#10;Rules: No running&#10;Price: Free"
                        rows={3}
                      />
                    </div>
                    <div>
                      <div style={{ display:"flex", justifyContent:"space-between" }}>
                        <label className="ed-label">Size</label>
                        <span className="ed-value" style={{ fontSize:12 }}>{rawSize}px</span>
                      </div>
                      <input
                        type="range" min="12" max="80" value={rawSize} className="ed-range"
                        onChange={e => setEmojis(prev => prev.map(em => em.id === item.id ? { ...em, size: parseInt(e.target.value) } : em))}
                      />
                    </div>
                    <button
                      type="button"
                      className="ed-btn ed-btn-danger ed-btn-sm ed-btn-block"
                      onClick={() => { setEmojis(prev => prev.filter(em => em.id !== item.id)); setActiveEmoji(null); }}
                    ><EdIcon name="trash" size={13} /> Delete</button>
                    {isAdmin && (
                      <div style={{ paddingTop:10, borderTop:"1px solid #e5e7eb" }}>
                        <label className="ed-label">Coordinates (master admin only)</label>
                        <div style={{ display:"flex", gap:6 }}>
                          <input
                            className="ed-input"
                            type="number" step="0.1" value={item.x}
                            onChange={e => setEmojis(prev => prev.map(em => em.id === item.id ? { ...em, x: parseFloat(e.target.value) || 0 } : em))}
                          />
                          <input
                            className="ed-input"
                            type="number" step="0.1" value={item.y}
                            onChange={e => setEmojis(prev => prev.map(em => em.id === item.id ? { ...em, y: parseFloat(e.target.value) || 0 } : em))}
                          />
                        </div>
                        <div className="ed-note" style={{ marginTop:4 }}>x, y (% of map)</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

        </div>
        {isNarrowMap && (
          <div className="map-zoom-ctl" onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
            <button type="button" aria-label="Zoom in" onClick={() => zoomMapTo(mapScale * 1.5)} disabled={mapScale >= MAX_MAP_SCALE}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button type="button" aria-label="Zoom out" onClick={() => zoomMapTo(mapScale / 1.5)} disabled={mapScale <= minScale}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
            </button>
            {mapScale > minScale && (
              <button type="button" aria-label="Show whole map" onClick={() => zoomMapTo(minScale)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
              </button>
            )}
          </div>
        )}
        </div>
      </div>

      {propaneModalLotId && (
        <PropaneCheckoutModal lotId={propaneModalLotId} onClose={()=>setPropaneModalLotId(null)} />
      )}
      {propaneReceipt && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:4000 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:28, width:320, maxWidth:"90vw", textAlign:"center", fontFamily:"sans-serif" }}>
            <h3 style={{ margin:"0 0 4px 0", fontSize:18 }}>✅ Payment Confirmed</h3>
            <p style={{ color:"#555", fontSize:13.5, margin:"0 0 16px 0" }}>
              {propaneReceipt.quantity} {propaneReceipt.unit === "gallon" ? "gallons" : "×"} {propaneReceipt.product_label} — ${Number(propaneReceipt.amount_total).toFixed(2)}
            </p>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(propaneReceipt.qr_token)}`}
              alt="Propane pickup QR code"
              style={{ width:220, height:220, margin:"0 auto 16px auto", display:"block" }}
            />
            <p style={{ fontSize:12.5, color:"#777", marginBottom:20 }}>
              {propaneReceipt.unit === "gallon"
                ? "Show this code to staff for your fill-up. It can only be used once."
                : `Show this code to staff each time you pick up a tank — this code works once per tank purchased${propaneReceipt.quantity > 1 ? ` (${propaneReceipt.quantity} total, multiple visits OK)` : ""}.`}{" "}
              No refunds — unpicked-up tanks are not refundable.
            </p>
            <button onClick={() => setPropaneReceipt(null)} style={{ background:"#16a34a", color:"#fff", border:"none", padding:"10px 24px", borderRadius:8, fontWeight:700, fontSize:14, cursor:"pointer" }}>
              Done
            </button>
          </div>
        </div>
      )}
      {selectedStorageLot && (
        <StorageCheckoutModal
          lotId={selectedStorageLot.lot}
          lotInfo={lotInfo[selectedStorageLot.lot]}
          onClose={() => setSelectedStorageLot(null)}
        />
      )}

      {storageModalOpen && (
        <StorageCheckoutModal onClose={()=>setStorageModalOpen(false)} />
      )}

            {/* Edit/Preview Toggle */}
      <div className="map-mode-row ed ed-modebar">
        {canEditMap && mapReadOnly && (
          <span title="Viewing as the park admin — changes are not saved" style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"6px 12px", borderRadius:999, background:"#fef3c7", color:"#92400e", fontSize:12, fontWeight:700, border:"1px solid #fcd34d" }}>
            <EdIcon name="eye" /> Read-only view
          </span>
        )}
        {canEditMap && editMode && (
          <button type="button" className="ed-btn ed-btn-secondary" onClick={() => setShowParkSettings(true)}>
            <EdIcon name="gear" /> Park Settings
          </button>
        )}
        {canEditMap && (
          <button
            type="button"
            className={editMode ? "ed-btn ed-btn-secondary" : "ed-btn ed-btn-primary"}
            onClick={() => { setEditMode(m => !m); setActiveEmoji(null); }}
          >
            <EdIcon name={editMode ? "eye" : "pencil"} />
            {editMode ? "Switch to Preview Mode" : "Switch to Edit Mode"}
          </button>
        )}
      </div>

      {showParkSettings && (
        <div className="ed ed-modal-back">
          <div className="ed-modal" role="dialog" aria-label="Park Settings">
            <div className="ed-modal-head">
              <h3 className="ed-title" style={{ fontSize:15 }}>Park Settings</h3>
              <button type="button" aria-label="Close" className="ed-btn ed-btn-ghost ed-btn-icon" onClick={()=>setShowParkSettings(false)}><EdIcon name="x" size={16} /></button>
            </div>
            <div className="ed-modal-body">
              <div>
                <label className="ed-label">Check-in time</label>
                <input type="text" className="ed-input" value={parkSettings.checkin_time}
                  onChange={e=>setParkSettings(p=>({...p, checkin_time:e.target.value}))} />
              </div>
              <div>
                <label className="ed-label">Check-out time</label>
                <input type="text" className="ed-input" value={parkSettings.checkout_time}
                  onChange={e=>setParkSettings(p=>({...p, checkout_time:e.target.value}))} />
              </div>
              <div>
                <label className="ed-label">Cancellation window (days before arrival for full refund)</label>
                <input type="number" className="ed-input" value={parkSettings.cancellation_days}
                  onChange={e=>setParkSettings(p=>({...p, cancellation_days:parseInt(e.target.value,10) || 0}))} />
              </div>
            </div>
            <div className="ed-modal-foot">
              <button type="button" className="ed-btn ed-btn-primary ed-btn-block" onClick={async ()=>{
                await saveParkSettings(parkSettings, editToken);
                alert("Park settings saved!");
                setShowParkSettings(false);
              }}>
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info-Only Panel (admin.aloha restricted mode) */}
      {isInfoOnly && !editMode && (
        <div style={{ maxWidth:900, margin:"0 auto 20px", background:"#fff", border:"2px solid #8b5cf6", borderRadius:14, padding:16, fontFamily:"sans-serif" }}>
          <div style={{ marginBottom:10, fontSize:12, color:"#6b7280" }}>
            Click any icon on the map to edit its title/info. Use the buttons below to add a new icon.
          </div>
          <div style={{ marginBottom:14, padding:12, background:"#fef9c3", borderRadius:10 }}>
            <strong style={{ fontSize:13, color:"#854d0e" }}>Add Emoji/Sticker</strong>
            <div style={{ fontSize:11, color:"#92400e", marginBottom:6, marginTop:2 }}>Click to place at center, then click it to add a title/info</div>
            <div style={{ marginBottom:4, fontSize:11, color:"#6b7280", fontWeight:600 }}>AMENITIES</div>
            <div style={{ display:"flex", gap:6, marginBottom:8, flexWrap:"wrap" }}>
              {["🏢","🏊","🎯","⛽","🗑️","🔥","🧺","🚹","🚺","🅿️","🏛️","⛹🏽","🚑","🚐","♻️","🚻"].map(emoji=>(
                <button key={emoji} onClick={()=>{
                  setEmojis(prev=>[...prev, { id: Date.now(), emoji, x:50, y:50, label:"" }]);
                }} style={{ fontSize:16, background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:8, padding:"4px 8px", cursor:"pointer" }}>{emoji}</button>
              ))}
            </div>
            <div style={{ marginBottom:4, fontSize:11, color:"#6b7280", fontWeight:600 }}>NATURE & DECOR</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {["⭐","🌴","🌳","🎄","🎃","👻","☃️","❄️","🌺","🐄","🦌","🔥"].map(emoji=>(
                <button key={emoji} onClick={()=>{
                  setEmojis(prev=>[...prev, { id: Date.now(), emoji, x:50, y:50, label:"" }]);
                }} style={{ fontSize:16, background:"none", border:"1px solid #d1d5db", borderRadius:8, padding:"4px 8px", cursor:"pointer" }}>{emoji}</button>
              ))}
            </div>
          </div>
          <button onClick={async ()=>{
            await saveToSupabase('emojis', 'all', emojis, editToken);
            alert("Saved!");
          }} style={{ width:"100%", background:"#8b5cf6", color:"#fff", border:"none", padding:"10px", borderRadius:8, cursor:"pointer", fontSize:14, fontWeight:700 }}>
            💾 Save Changes
          </button>
        </div>
      )}

      {/* Edit Panel */}
      {/* Oct 30 (per Mely): restyled as a clean admin panel — same controls, same behavior. */}
      {editMode && (
        <div className="ed ed-panel" data-edit-panel>

          {/* Add Lot — master only */}
          {isAdmin && (
          <div className="ed-section">
            <div className="ed-section-head">
              <h4 className="ed-title">Add new lot</h4>
            </div>
            <div className="ed-row">
              <input className="ed-input" value={newLotName} onChange={e=>setNewLotName(e.target.value.toUpperCase())}
                placeholder="Lot name, e.g. E1" style={{ flex:1 }} />
              <button type="button" className="ed-btn ed-btn-secondary" onClick={()=>{
                if (!newLotName) return;
                setDraftLots(prev=>({ ...prev, [newLotName]: [10, 10, 5, 3] }));
                setActiveEditLot(newLotName);
                setNewLotName("");
              }}><EdIcon name="plus" /> Add</button>
            </div>
            {/* Oct 20 (per Mely): lots that exist in the system (Generate
                Spaces) but aren't on this map yet are lined up at the top
                of the map so they can be dragged into place. */}
            {(() => {
              const missing = Object.keys(statuses).filter(k => !draftLots[k])
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
              if (!missing.length) return null;
              return (
                <button type="button" className="ed-btn ed-btn-secondary ed-btn-block" onClick={() => {
                  const sizes = Object.values(draftLots);
                  const avg = (i, d) => sizes.length ? Math.round(sizes.reduce((t, v) => t + v[i], 0) / sizes.length * 10) / 10 : d;
                  const w = Math.min(avg(2, 4), 8), h = Math.min(avg(3, 5), 10);
                  const perRow = Math.max(1, Math.floor(96 / (w + 0.8)));
                  setDraftLots(prev => {
                    const next = { ...prev };
                    missing.forEach((name, i) => {
                      const col = i % perRow, row = Math.floor(i / perRow);
                      next[name] = [Math.round((2 + col * (w + 0.8)) * 10) / 10, Math.round((2 + row * (h + 0.8)) * 10) / 10, w, h];
                    });
                    return next;
                  });
                }} style={{ marginTop:10 }}>
                  Place missing lots ({missing.length}) at the top of the map
                </button>
              );
            })()}
          </div>
          )}

          {/* Oct 30 (per Mely): it wasn't clear that a lot's details open by tapping the lot. */}
          {canEditMap && !activeEditLot && (
            <div className="ed-section" style={{ display:"flex", gap:12, alignItems:"flex-start", background:"#f0fdf4", borderColor:"#bbf7d0" }}>
              <span aria-hidden style={{ fontSize:18, lineHeight:"22px" }}>👆</span>
              <div>
                <div style={{ fontWeight:700, color:"#14532d", fontSize:14 }}>Tap any lot on the map to edit it</div>
                <div style={{ color:"#4b5563", fontSize:13, marginTop:2, lineHeight:1.5 }}>
                  {isAdmin
                    ? <>Its menu opens below: status, color, shape, size, power, slide-outs, description and photo. Drag a lot to move it, or drag its corner to resize it. </>
                    : <>Its menu opens below: status, color, size, power, slide-outs, description and photo. Lot positions and sizes on the map are set by MelyOS. </>}
                  To fill many lots at once, use <b>Edit all lot details</b> at the top of Map Builder.
                </div>
              </div>
            </div>
          )}

          {/* Add Emojis */}
          <div className="ed-section">
            <div className="ed-section-head">
              <h4 className="ed-title">Add emoji / sticker</h4>
              <span className="ed-hint">Click to place at center, then drag into position</span>
            </div>
            <div className="ed-sublabel" style={{ marginTop:0 }}>Amenities</div>
            <div className="ed-tiles">
              {["🏢","🏊","🎯","⛽","🗑️","🔥","🧺","🚹","🚺","🅿️","🏛️","⛹🏽","🚑","🚐","♻️","🚻"].map(emoji=>(
                <button type="button" key={emoji} className="ed-tile" onClick={()=>{
                  setEmojis(prev=>[...prev, { id: Date.now(), emoji, x:50, y:50, label:"" }]);
                }}>{emoji}</button>
              ))}
            </div>
            <div className="ed-sublabel">Nature &amp; decor</div>
            <div className="ed-tiles">
              {["⭐","🌴","🌳","🎄","🎃","👻","☃️","❄️","🌺","🐄","🦌","🔥"].map(emoji=>(
                <button type="button" key={emoji} className="ed-tile" onClick={()=>{
                  setEmojis(prev=>[...prev, { id: Date.now(), emoji, x:50, y:50, label:"" }]);
                }}>{emoji}</button>
              ))}
            </div>
          </div>

          {/* Add Text — master only */}
          {isAdmin && (
          <div className="ed-section">
            <div className="ed-section-head">
              <h4 className="ed-title">Add text to map</h4>
            </div>
            <div className="ed-row" style={{ alignItems:"flex-end" }}>
              <div style={{ flex:1, minWidth:0 }}>
                <label className="ed-label" htmlFor="textInput">Text</label>
                <input id="textInput" className="ed-input" placeholder="Type text..." />
              </div>
              <div style={{ width:72 }}>
                <label className="ed-label" htmlFor="textSize">Size</label>
                <input id="textSize" className="ed-input" type="number" defaultValue="16" min="8" max="72" />
              </div>
              <div>
                <label className="ed-label" htmlFor="textColor">Color</label>
                <input id="textColor" className="ed-color" type="color" defaultValue="#000000" />
              </div>
              <button type="button" className="ed-btn ed-btn-secondary" onClick={()=>{
                const val = document.getElementById("textInput").value;
                const size = document.getElementById("textSize").value;
                const color = document.getElementById("textColor").value;
                if (!val) return;
                setTexts(prev=>[...prev, { id: Date.now(), text: val, size: parseInt(size), color, x: 50, y: 50 }]);
                document.getElementById("textInput").value = "";
              }}><EdIcon name="plus" /> Add</button>
            </div>
          </div>
          )}

          {canEditMap && activeEditLot && draftLots[activeEditLot] && (
            <>
              <div className="ed-section">
                <div className="ed-section-head" style={{ alignItems:"center", marginBottom:14 }}>
                  <h4 className="ed-title" style={{ display:"flex", alignItems:"center" }}>Editing <span className="ed-lot-chip">{activeEditLot}</span></h4>
                  <div className="ed-row">
                    {isAdmin && (
                    <>
                    <button type="button" className="ed-btn ed-btn-danger ed-btn-sm" onClick={()=>setConfirmDeleteLot(activeEditLot)}><EdIcon name="trash" size={13} /> Delete</button>
                    {confirmDeleteLot && (
                      <div onClick={()=>setConfirmDeleteLot(null)} className="ed-modal-back" style={{ zIndex:100000 }}>
                        <div onClick={(e)=>e.stopPropagation()} className="ed-modal" role="dialog" aria-label={`Delete lot ${confirmDeleteLot}`}>
                          <div className="ed-modal-body" style={{ gap:10, paddingTop:20 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                              <div style={{ width:36, height:36, borderRadius:8, background:"#fef2f2", color:"#dc2626", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><EdIcon name="trash" size={18} /></div>
                              <div style={{ fontSize:16, fontWeight:600, color:"#111827" }}>Delete lot {confirmDeleteLot}?</div>
                            </div>
                            <p style={{ margin:0, fontSize:13, lineHeight:1.55, color:"#4b5563" }}>
                              This removes the lot from the map. Press <strong>Save</strong> afterwards to make it permanent. Payment and reservation history is not deleted.
                            </p>
                          </div>
                          <div className="ed-modal-foot">
                            <button type="button" className="ed-btn ed-btn-secondary" onClick={()=>setConfirmDeleteLot(null)}>Cancel</button>
                            <button type="button" className="ed-btn ed-btn-danger-solid" onClick={()=>{
                              const lot = confirmDeleteLot;
                              setDraftLots(prev=>{ const n={...prev}; delete n[lot]; return n; });
                              setActiveEditLot(null);
                              setConfirmDeleteLot(null);
                            }}>Delete lot</button>
                          </div>
                        </div>
                      </div>
                    )}
                    </>
                    )}
                    <button type="button" aria-label="Close" className="ed-btn ed-btn-ghost ed-btn-icon" onClick={()=>setActiveEditLot(null)}><EdIcon name="x" size={16} /></button>
                  </div>
                </div>

                <div className="ed-grid">
                  <div className="ed-span">
                    <span className="ed-label">Status / color</span>
                    <div className="ed-seg ed-seg-fill" role="group" aria-label="Lot status">
                      {ED_STATUS_OPTIONS.map(([s,c,label])=>(
                        <button type="button" key={s} aria-pressed={statuses[activeEditLot]===s} onClick={async ()=>{
                          setStatuses(prev=>({...prev,[activeEditLot]:s}));
                          if (s === "for_sale") ensureRealEstateListing(activeEditLot, editToken);
                          if (s === "for_rent") ensureRentListing(activeEditLot, editToken);
                          // Write straight to rv_lots (the single source of truth
                          // shared with lease applications/reservations) so this
                          // manual change is immediately reflected everywhere,
                          // not just on this map.
                          try {
                            await fetch('/api/set-lot-status', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ lotName: activeEditLot, status: s, parkId: PARK_ID, token: editToken }),
                            });
                          } catch (err) {
                            console.error('Error saving lot status:', err);
                          }
                        }}>
                          <span className="ed-dot" style={{ background:c }} />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="ed-label">Custom color</span>
                    <div className="ed-row">
                      <input type="color" className="ed-color" value={lotColors[activeEditLot] || "#16a34a"}
                        onChange={e=>setLotColors(prev=>({...prev,[activeEditLot]:e.target.value}))} />
                      <span className="ed-hint" style={{ flex:1 }}>Pick any color for this lot</span>
                      <button type="button" className="ed-btn ed-btn-secondary ed-btn-sm" onClick={()=>setLotColors(prev=>{ const n={...prev}; delete n[activeEditLot]; return n; })}>Reset</button>
                    </div>
                  </div>

                  {isAdmin && (
                  <div>
                    <span className="ed-label">Rotation</span>
                    <div className="ed-row" style={{ height:36 }}>
                      <input type="range" className="ed-range" min="0" max="360" value={rotations[activeEditLot] || 0}
                        onChange={e=>setRotations(prev=>({...prev,[activeEditLot]:parseInt(e.target.value)}))}
                        style={{ flex:1 }} />
                      <span className="ed-value">{rotations[activeEditLot] || 0}°</span>
                      <button type="button" className="ed-btn ed-btn-secondary ed-btn-sm" onClick={()=>setRotations(prev=>({...prev,[activeEditLot]:0}))}>Reset</button>
                    </div>
                  </div>
                  )}

                  {isAdmin && (
                  <div className="ed-span">
                    <span className="ed-label">Shape</span>
                    <div className="ed-seg" role="group" aria-label="Lot shape">
                      {["rectangle","rounded","circle","parallelogram-left","parallelogram-right","diamond","hexagon"].map(s=>(
                        <button type="button" key={s} aria-pressed={lotShapes[activeEditLot]===s} onClick={()=>setLotShapes(prev=>({...prev,[activeEditLot]:s}))}>
                          {edShapeLabel(s)}
                        </button>
                      ))}
                    </div>
                  </div>
                  )}
                </div>
              </div>

              <div className="ed-section">
                <div className="ed-section-head">
                  <h4 className="ed-title">Lot details</h4>
                  <span className="ed-hint">Visible to guests</span>
                </div>
                {activeEditLot.startsWith("S") ? (
                  <div className="ed-grid">
                    <div>
                      <label className="ed-label">Type</label>
                      <select className="ed-input" defaultValue={lotInfo[activeEditLot]?.lot_type || "outdoor"}
                        onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], lot_type:e.target.value}}))}>
                        <option value="outdoor">Outdoor</option>
                        <option value="indoor">Indoor</option>
                      </select>
                    </div>
                    <div>
                      <label className="ed-label">Size</label>
                      <input type="text" className="ed-input" defaultValue={lotInfo[activeEditLot]?.size || ""}
                        onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], size:e.target.value}}))}
                        placeholder="e.g. 20ft x 10ft" />
                    </div>
                    <div className="ed-span">
                      <label className="ed-check" htmlFor="hasElec">
                        <input type="checkbox" id="hasElec" checked={lotInfo[activeEditLot]?.has_electricity || false}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], has_electricity:e.target.checked}}))} />
                        Has electricity
                      </label>
                    </div>
                    {lotInfo[activeEditLot]?.has_electricity && (
                      <div>
                        <label className="ed-label">Amperage</label>
                        <select className="ed-input" defaultValue={lotInfo[activeEditLot]?.amperage || 30}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], amperage:parseInt(e.target.value)}}))}>
                          <option value={30}>30 Amp</option>
                          <option value={50}>50 Amp</option>
                          <option value={30.50}>30/50 Amp</option>
                        </select>
                      </div>
                    )}
                    <div className="ed-span ed-grid-3">
                      <div>
                        <label className="ed-label">Daily ($)</label>
                        <input type="number" className="ed-input" defaultValue={lotInfo[activeEditLot]?.price_daily || 10}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], price_daily:parseFloat(e.target.value)}}))} />
                      </div>
                      <div>
                        <label className="ed-label">Monthly ($)</label>
                        <input type="number" className="ed-input" defaultValue={lotInfo[activeEditLot]?.price_monthly || 100}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], price_monthly:parseFloat(e.target.value)}}))} />
                      </div>
                      <div>
                        <label className="ed-label">Yearly ($)</label>
                        <input type="number" className="ed-input" defaultValue={lotInfo[activeEditLot]?.price_yearly || ""}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], price_yearly:parseFloat(e.target.value)}}))}
                          placeholder="optional" />
                      </div>
                    </div>
                    <div className="ed-span">
                      <label className="ed-label">Description</label>
                      <textarea className="ed-input" defaultValue={lotInfo[activeEditLot]?.description || ""}
                        onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], description:e.target.value}}))}
                        placeholder="e.g. Covered spot, near entrance..." />
                    </div>
                  </div>
                ) : (
                  <div className="ed-grid">
                    <div>
                      <label className="ed-label">Max RV length (ft)</label>
                      <input type="number" className="ed-input" key={activeEditLot + "-max_length_ft"} defaultValue={lotInfo[activeEditLot]?.max_length_ft || lotInfo[activeEditLot]?.max_length || ""} placeholder="e.g. 40"
                        onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], max_length_ft:parseInt(e.target.value)}}))} />
                    </div>
                    <div>
                      {/* Aug 20 (per Mely — "no veo width no lo veo ahi?"):
                          max_width_ft was already read/validated in the
                          apply form (rvTooWide) and shown as plain info
                          everywhere else, but this admin editor never had
                          an input for it — meaning no lot could ever
                          actually have a real value, so that validation
                          could never fire in practice. Mirrors Max RV
                          Length exactly. */}
                      <label className="ed-label">Max RV width (ft) — slide-outs extended</label>
                      <input type="number" className="ed-input" key={activeEditLot + "-max_width_ft"} defaultValue={lotInfo[activeEditLot]?.max_width_ft || ""}
                        placeholder="e.g. 14"
                        onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], max_width_ft:e.target.value ? parseInt(e.target.value) : null}}))} />
                    </div>
                    <div>
                      <label className="ed-label">Amperage</label>
                      <select className="ed-input" key={activeEditLot + "-amp_service"} defaultValue={lotInfo[activeEditLot]?.amp_service || (lotInfo[activeEditLot]?.amperage ? String(lotInfo[activeEditLot].amperage) : "")}
                        onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], amp_service:e.target.value}}))}>
                        <option value="">Not set</option>
                        <option value="30">30 Amp</option>
                        <option value="50">50 Amp</option>
                        <option value="30/50">30/50 Amp</option>
                      </select>
                    </div>
                    <div>
                      <label className="ed-label">Max driver side slide-outs</label>
                      <select className="ed-input" key={activeEditLot + "-max_driver_slide_outs"} defaultValue={lotInfo[activeEditLot]?.max_driver_slide_outs || "Any"}
                        onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], max_driver_slide_outs:e.target.value}}))}>
                        <option value="Any">Any</option>
                        <option value="0">0</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4+">4+</option>
                      </select>
                    </div>
                    <div>
                      <label className="ed-label">Max passenger side slide-outs</label>
                      <select className="ed-input" key={activeEditLot + "-max_passenger_slide_outs"} defaultValue={lotInfo[activeEditLot]?.max_passenger_slide_outs || "Any"}
                        onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], max_passenger_slide_outs:e.target.value}}))}>
                        <option value="Any">Any</option>
                        <option value="0">0</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4+">4+</option>
                      </select>
                    </div>
                    {/* Oct 30 (per Mely): prices are changed only in the admin's Lots & Seasonal Pricing
                        (sections, ranges, seasons). Here they're shown read-only, so there is one place to edit them. */}
                    <div className="ed-span">
                      <label className="ed-label">Prices</label>
                      <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", justifyContent:"space-between", gap:8, padding:"10px 12px", border:"1px solid #e5e7eb", borderRadius:8, background:"#f9fafb" }}>
                        <span style={{ fontSize:14, color:"#111827" }}>
                          {(() => {
                            const li = lotInfo[activeEditLot] || {};
                            const m = (v) => (Number(v) > 0 ? "$" + Number(v).toLocaleString("en-US") : null);
                            const parts = [
                              m(li.price_daily) && m(li.price_daily) + "/night",
                              m(li.price_weekly) && m(li.price_weekly) + "/week",
                              m(li.base_price) && m(li.base_price) + "/mo",
                              (m(li.high_season_price) || m(li.low_season_price)) && "Seasonal " + [m(li.high_season_price), m(li.low_season_price)].filter(Boolean).join(" / ") + " /mo",
                              m(li.price_yearly) && m(li.price_yearly) + "/yr",
                            ].filter(Boolean);
                            return parts.length ? parts.join(" · ") : "No price set yet";
                          })()}
                        </span>
                        <button type="button" className="ed-btn"
                          onClick={() => { try { window.parent.postMessage({ type: "melyos-open-module", module: "lots_pricing" }, "*"); } catch {} }}>
                          Change prices in Lots &amp; Seasonal Pricing →
                        </button>
                      </div>
                    </div>
                    <div className="ed-span">
                      <label className="ed-label">Description</label>
                      <textarea className="ed-input" key={activeEditLot + "-description"} defaultValue={lotInfo[activeEditLot]?.description || ""}
                        onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], description:e.target.value}}))}
                        placeholder="e.g. Corner lot, extra space, near pool..." />
                    </div>
                    <div className="ed-span">
                      <label className="ed-label">Photo (optional)</label>
                      {lotInfo[activeEditLot]?.photo_url && (
                        <div style={{ marginBottom:8, position:"relative", display:"inline-block" }}>
                          <img src={lotInfo[activeEditLot].photo_url} alt="Lot" style={{ maxWidth:"100%", maxHeight:120, borderRadius:8, display:"block", border:"1px solid #e5e7eb" }} />
                          <button type="button" aria-label="Remove photo" onClick={async ()=>{
                            setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], photo_url:null}}));
                            await fetch('/api/set-lot-pricing', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ parkId: PARK_ID, lotName: activeEditLot, photoUrl: null, token: editToken }),
                            });
                          }} className="ed-btn ed-btn-secondary ed-btn-icon" style={{ position:"absolute", top:6, right:6, width:26, height:26, color:"#b91c1c" }}>
                            <EdIcon name="x" size={13} />
                          </button>
                        </div>
                      )}
                      <div>
                        <input type="file" className="ed-file" accept="image/*" disabled={uploadingPhoto}
                          onChange={async (e)=>{
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setPhotoUploadError("");
                            setUploadingPhoto(true);
                            try {
                              const imageBase64 = await new Promise((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onload = () => resolve(reader.result);
                                reader.onerror = reject;
                                reader.readAsDataURL(file);
                              });
                              const res = await fetch('/api/upload-lot-photo', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ parkId: PARK_ID, lotName: activeEditLot, imageBase64, fileName: file.name, token: editToken }),
                              });
                              const result = await res.json();
                              if (!res.ok) throw new Error(result.error || 'Upload failed');
                              setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], photo_url: result.photoUrl}}));
                            } catch (err) {
                              setPhotoUploadError(err.message || 'Upload failed');
                            }
                            setUploadingPhoto(false);
                            e.target.value = "";
                          }} />
                      </div>
                      {uploadingPhoto && <p className="ed-note" style={{ color:"#6b7280" }}>Uploading...</p>}
                      {photoUploadError && <p className="ed-note" style={{ color:"#dc2626" }}>{photoUploadError}</p>}
                      <p className="ed-note">If no photo is added, guests just see the info above — no image is shown.</p>
                    </div>
                  </div>
                )}
              </div>

              {isAdmin && (
                <div className="ed-section">
                  <div className="ed-card">
                    <div className="ed-label" style={{ marginBottom:4 }}>Coordinates</div>
                    <pre className="ed-code">
                      {activeEditLot + ": [" + draftLots[activeEditLot].map(n=>n.toFixed(1)).join(", ") + "],"}
                    </pre>
                  </div>
                </div>
              )}
            </>
          )}

          {(isAdmin || isRestrictedEditor) && (
          <div className="ed-footer">
          {isAdmin && (
          <button type="button" className="ed-btn ed-btn-primary ed-btn-block" style={{ height:40, fontSize:14 }} onClick={async ()=>{
            try {
              await saveActiveLotInfo(activeEditLot, lotInfo, editToken);
              // Guardar emojis y shapes en Supabase
              const saveResults = await Promise.all([
                saveToSupabase('emojis', 'all', emojis, editToken),
                saveToSupabase('shapes', 'all', lotShapes, editToken),
                saveToSupabase('texts', 'all', texts, editToken),
                saveToSupabase('lotColors', 'all', lotColors, editToken),
                saveToSupabase('rotations', 'all', rotations, editToken),
                saveToSupabase('emojiRotations', 'all', emojiRotations, editToken),
                saveToSupabase('textRotations', 'all', textRotations, editToken),
                saveToSupabase('lotGeometry', 'all', draftLots, editToken),
              ]);
              if (saveResults.some(ok => !ok)) {
                throw new Error("One or more changes failed to save — check the browser console for details, or try again.");
              }

              // Aug 13 (per Mely — diagnosing "coordinates revert after
              // refresh" recurring even after yesterday's fixes):
              // immediately re-fetch what's ACTUALLY stored right after
              // saving, instead of needing a full page refresh to find
              // out — turns this into something we can see in one click.
              const verifyRes = await fetch('/api/save-map-element?parkId=' + encodeURIComponent(PARK_ID) + '&type=emojis');
              const verifyRows = await verifyRes.json();
              const verifyData = Array.isArray(verifyRows) && verifyRows[0] ? verifyRows[0].data : null;
              console.log('VERIFY after save — rows returned:', verifyRows.length, 'newest row data:', verifyData);

              // Oct 9: lot positions are saved in the database together with
              // everything else above (no more GitHub file edit, which could
              // fail silently). Read them back to prove they were stored.
              const geoCheck = await fetch('/api/save-map-element?parkId=' + encodeURIComponent(PARK_ID) + '&type=lotGeometry');
              const geoRows = await geoCheck.json();
              const stored = Array.isArray(geoRows) && geoRows[0] ? geoRows[0].data : null;
              const sameLots = stored && Object.keys(draftLots).length === Object.keys(stored).length &&
                Object.keys(draftLots).every(k => stored[k] && JSON.stringify(stored[k]) === JSON.stringify(draftLots[k]));
              if (!sameLots) {
                throw new Error("Lot positions were NOT stored correctly. Do not close this page — press Save again or send a screenshot.");
              }
              const prevLots = lastSavedLots.current || {};
              const changedNames = Object.keys(stored).filter(k => !prevLots[k] || JSON.stringify(prevLots[k]) !== JSON.stringify(stored[k]));
              const removedNames = Object.keys(prevLots).filter(k => !stored[k]);
              lastSavedLots.current = stored;
              setSaveResult({ ok:true, total:Object.keys(stored).length, changed:changedNames, removed:removedNames });
            } catch(e) {
              setSaveResult({ ok:false, message:e.message });
            }
          }}>
            <EdIcon name="save" /> Save All Changes
          </button>
          )}

          {isRestrictedEditor && (
          <button type="button" className="ed-btn ed-btn-primary ed-btn-block" style={{ height:40, fontSize:14 }} onClick={async ()=>{
            try {
              await saveActiveLotInfo(activeEditLot, lotInfo, editToken);
              await saveToSupabase('emojis', 'all', emojis, editToken);
              await saveToSupabase('lotColors', 'all', lotColors, editToken);
              alert("Changes saved!");
            } catch(e) {
              alert("⚠️ Error: " + e.message);
            }
          }}>
            <EdIcon name="save" /> Save Changes
          </button>
          )}
          </div>
          )}
        </div>
      )}

      {saveResult && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:3000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:"24px 26px", width:"100%", maxWidth:420, boxShadow:"0 20px 50px rgba(0,0,0,0.35)", fontFamily:"sans-serif", maxHeight:"85vh", overflowY:"auto" }}>
            <div style={{ fontSize:19, fontWeight:700, color: saveResult.ok ? "#15803d" : "#b91c1c", marginBottom:10 }}>
              {saveResult.ok ? "✅ Saved successfully" : "⚠️ Could not save"}
            </div>
            {saveResult.ok ? (
              <div style={{ fontSize:14, color:"#374151", lineHeight:1.55 }}>
                <div>Everything saved. <b>{saveResult.total}</b> lots in the database (plus emojis, colors, shapes and text).</div>
                <div style={{ marginTop:10 }}>
                  {saveResult.changed.length > 0
                    ? <>Updated in this save ({saveResult.changed.length}): <b>{saveResult.changed.join(", ")}</b></>
                    : <>No lot positions changed in this save.</>}
                </div>
                {saveResult.removed.length > 0 && (
                  <div style={{ marginTop:10 }}>Removed lots: <b>{saveResult.removed.join(", ")}</b></div>
                )}
              </div>
            ) : (
              <div style={{ fontSize:14, color:"#374151", lineHeight:1.55 }}>{saveResult.message}</div>
            )}
            <div style={{ display:"flex", justifyContent:"flex-end", marginTop:18 }}>
              <button onClick={()=>setSaveResult(null)} style={{ background:"#16a34a", color:"#fff", border:"none", padding:"9px 22px", borderRadius:9, cursor:"pointer", fontSize:14, fontWeight:700 }}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Booking modal */}
      {selected && (
        <BookingModal
          lot={selected.lot}
          status={selected.status}
          lotInfo={lotInfo[selected.lot]}
          parkSettings={parkSettings}
          reservedUntil={reservedDates[selected.lot]}
          requiresCallOffice={!!bookingDisabled[selected.lot]}
          prefill={selected.prefill || null}
          onClose={() => setSelected(null)}
        />
      )}

    </div>
  );
}

// ═══ Styles ═══
const overlay = { position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 };
const modal   = { background:"#fff", borderRadius:20, padding:28, width:"100%", maxWidth:420, boxShadow:"0 24px 64px rgba(0,0,0,0.35)", maxHeight:"90vh", overflowY:"auto" };
const mh2     = { fontFamily:"Georgia,serif", fontSize:22, color:"#14532d", marginBottom:16 };
const row2    = { display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:16 };
const lbl     = { fontSize:12, fontWeight:600, color:"#374151", display:"block", marginBottom:6, fontFamily:"sans-serif" };
const inp     = { width:"100%", padding:"9px 12px", border:"1.5px solid #d1fae5", borderRadius:8, fontSize:14, outline:"none", fontFamily:"sans-serif", boxSizing:"border-box" };
const btnPrimary   = { background:"linear-gradient(135deg,#14532d,#16a34a)", color:"#fff", border:"none", padding:"11px 22px", borderRadius:50, cursor:"pointer", fontSize:14, fontWeight:600, fontFamily:"sans-serif" };
const btnSecondary = { background:"#f3f4f6", color:"#374151", border:"1.5px solid #d1d5db", padding:"11px 22px", borderRadius:50, cursor:"pointer", fontSize:14, fontWeight:600, fontFamily:"sans-serif" };
