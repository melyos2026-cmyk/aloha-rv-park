import { useState, useRef, useEffect } from "react";
import PropaneCheckoutModal from './components/PropaneCheckoutModal';
import StorageCheckoutModal from './components/StorageCheckoutModal';
import LotCheckoutModal from './components/LotCheckoutModal';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Rnd } from "react-rnd";

const MAP_IMG = "/AlohaRvParkMap.png";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const PARK_ID = (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("park_id")) || 'aloha';
let cachedCompanyId = null;
async function getCompanyId() {
  if (cachedCompanyId) return cachedCompanyId;
  const res = await fetch(SUPABASE_URL + '/rest/v1/companies?park_id=eq.' + PARK_ID + '&select=id', {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  const rows = await res.json();
  cachedCompanyId = rows[0]?.id || null;
  return cachedCompanyId;
}

async function saveToSupabase(type, key, data) {
  const companyId = await getCompanyId();
  const res = await fetch(SUPABASE_URL + '/rest/v1/map_elements?on_conflict=park_id,element_type,element_key', {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify({ park_id: PARK_ID, company_id: companyId, element_type: type, element_key: key, data })
  });
  return res.ok;
}

async function saveLotInfo(parkId, lotKey, info) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/lot_info?on_conflict=park_id,lot_key', {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify({ park_id: parkId, lot_key: lotKey, ...info })
  });
  return res.ok;
}

async function ensureRealEstateListing(lotKey) {
  const checkRes = await fetch(SUPABASE_URL + '/rest/v1/real_estate_listings?park_id=eq.' + PARK_ID + '&lot_key=eq.' + lotKey, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  const rows = await checkRes.json();
  if (rows.length > 0) return; // already has a listing, don't overwrite

  await fetch(SUPABASE_URL + '/rest/v1/real_estate_listings', {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      park_id: PARK_ID,
      lot_key: lotKey,
      type: 'sale',
      category: 'Mini Home',
      title: 'New Listing - Lot ' + lotKey,
      price: 'TBD',
      available: false
    })
  });
}

async function loadLotInfo(parkId) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/lot_info?park_id=eq.' + parkId, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  if (!res.ok) return {};
  const rows = await res.json();
  const result = {};
  rows.forEach(r => { result[r.lot_key] = r; });
  return result;
}
async function saveParkSettings(settings) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/park_settings?on_conflict=id', {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify({ id: 1, ...settings })
  });
  return res.ok;
}
async function loadParkSettings() {
  const res = await fetch(SUPABASE_URL + '/rest/v1/park_settings?id=eq.1', {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

async function loadFromSupabase(type) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/map_elements?park_id=eq.' + PARK_ID + '&element_type=eq.' + type, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
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
  A1: [37.2, 16.8, 4.1, 5.4],
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
  A33: [48.4, 31.5, 3.7, 6.1],
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
};

const STATUS_SOLID = {
  available:   "#16a34a",
  occupied:    "#dc2626",
  reserved:    "#ca8a04",
  maintenance: "#4b5563",
  for_sale:    "#ac67dd",
};

// Default mock statuses
function initStatuses() {
  const s = {};
  ALL_LOTS.forEach(l => {
    if (["B1","B2","B3","B4"].includes(l)) s[l] = "occupied";
    else if (["B5","B6","C1","C2"].includes(l)) s[l] = "reserved";
    else if (["D1","D2"].includes(l)) s[l] = "maintenance";
    else s[l] = "available";
  });
  return s;
}

// ═══ Booking Modal ═══
function calcStayPreview(arrivalStr, departureStr, hasWeekly) {
  const arrival = new Date(arrivalStr + "T00:00:00");
  const departure = new Date(departureStr + "T00:00:00");
  const totalNights = Math.round((departure - arrival) / 86400000);

  if (totalNights === 365) {
    return { isYearly: true, months: 0, weeks: 0, extraDays: 0, totalNights: totalNights + 1 };
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
  const leftoverExclusive = remainingAfterMonths - (weeks * 7);
  // Both arrival and departure days are billable, so any leftover daily
  // segment counts one extra day (e.g. 7/3 to 7/9 = 7 billable days, not 6 nights).
  const extraDays = leftoverExclusive > 0 ? leftoverExclusive + 1 : 0;

  return { isYearly: false, months, weeks, extraDays, totalNights: totalNights + 1 };
}

function BookingModal({ lot, status, lotInfo, parkSettings, onClose }) {
  const [form, setForm] = useState({ arrival: "", departure: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bookedRanges, setBookedRanges] = useState([]);
  const [loadingAvailability, setLoadingAvailability] = useState(true);
  const [allowLotBooking, setAllowLotBooking] = useState(true);
  const [listing, setListing] = useState(null);

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
    fetch('/api/get-lot-availability?lotId=' + encodeURIComponent(lot))
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
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error creating payment');

      window.location.href = data.url;
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
              <div style={{ display:"flex", gap:8 }}>
                <a href={`mailto:info@aloharvparkfl.com?subject=Inquiry: ${listing.title}`} style={{ display:"inline-block", background:"#7c3aed", color:"#fff", padding:"7px 14px", borderRadius:6, fontSize:12, fontWeight:700, textDecoration:"none" }}>
                  📩 Inquire Now
                </a>
                <a href="tel:6892520567" style={{ display:"inline-block", background:"#fff", color:"#7c3aed", border:"1.5px solid #7c3aed", padding:"7px 14px", borderRadius:6, fontSize:12, fontWeight:700, textDecoration:"none" }}>
                  📞 Call Us
                </a>
              </div>
            </div>
          </div>
        )}

        {status !== "available" && allowLotBooking && (
          <div style={{ display:"flex", alignItems:"center", gap:8, background:"#fffbeb", border:"1px solid #fde68a", borderRadius:8, padding:"8px 12px", marginBottom:16, fontFamily:"sans-serif" }}>
            <div style={{ width:10, height:10, borderRadius:3, background: STATUS_SOLID[status] }} />
            <span style={{ fontSize:12, color:"#92400e" }}>
              This lot is currently marked <strong style={{ textTransform:"capitalize" }}>{status.replace(/_/g," ")}</strong>, but you can still book any open dates below.
            </span>
          </div>
        )}

        {(lotInfo?.max_length || lotInfo?.amperage) && (
          <div style={{ background:"#f9fafb", borderRadius:8, padding:"10px 12px", marginBottom:16, display:"flex", gap:16, fontFamily:"sans-serif" }}>
            {lotInfo?.max_length && (
              <div>
                <span style={{ fontSize:11, color:"#6b7280" }}>Max RV Length: </span>
                <span style={{ fontSize:12, fontWeight:700, color:"#374151" }}>{lotInfo.max_length}ft</span>
              </div>
            )}
            {lotInfo?.amperage && (
              <div>
                <span style={{ fontSize:11, color:"#6b7280" }}>Amperage: </span>
                <span style={{ fontSize:12, fontWeight:700, color:"#374151" }}>{lotInfo.amperage} Amp</span>
              </div>
            )}
          </div>
        )}

        {lotInfo?.description && (
          <div style={{ background:"#f0fdf4", borderRadius:8, padding:"8px 12px", marginBottom:16, fontSize:13, color:"#166534", fontFamily:"sans-serif" }}>
            {lotInfo.description}
          </div>
        )}

        {!allowLotBooking && (
          <div style={{ background:"#f5f3ff", border:"1px solid #ddd6fe", borderRadius:8, padding:"12px 16px", marginBottom:16, fontFamily:"sans-serif" }}>
            <p style={{ fontSize:13, color:"#5b21b6", margin:0, lineHeight:1.5 }}>
              This lot is not available through our standard booking system. See details above or contact us for more information.
            </p>
          </div>
        )}

        {allowLotBooking && (
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

        <div style={row2}>
          <div>
            <label style={lbl}>Arrival</label>
            <DatePicker
              selected={form.arrival ? new Date(form.arrival + "T00:00:00") : null}
              onChange={(date) => setForm({...form, arrival: date ? date.toISOString().split("T")[0] : ""})}
              minDate={new Date()}
              excludeDateIntervals={excludeDateIntervals}
              dateFormat="MM/dd/yyyy"
              placeholderText={loadingAvailability ? "Loading..." : "Select date"}
              disabled={loadingAvailability}
              className="lot-date-input"
            />
          </div>
          <div>
            <label style={lbl}>Departure</label>
            <DatePicker
              selected={form.departure ? new Date(form.departure + "T00:00:00") : null}
              onChange={(date) => setForm({...form, departure: date ? date.toISOString().split("T")[0] : ""})}
              minDate={form.arrival ? new Date(form.arrival + "T00:00:00") : new Date()}
              excludeDateIntervals={excludeDateIntervalsForDeparture}
              dateFormat="MM/dd/yyyy"
              placeholderText={loadingAvailability ? "Loading..." : "Select date"}
              disabled={loadingAvailability}
              className="lot-date-input"
            />
          </div>
        </div>

        {hasOverlap && (
          <div style={{ background:"#fef2f2", color:"#dc2626", padding:"8px 10px", borderRadius:8, fontSize:13, marginBottom:12, fontFamily:"sans-serif" }}>
            These dates overlap with an existing reservation. Please choose different dates.
          </div>
        )}

        {stay && (
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

        <button onClick={handlePayNow} disabled={loading || !hasValidDates || hasOverlap} style={{ display:"block", width:"100%", background:"linear-gradient(135deg,#14532d,#16a34a)", color:"#fff", textAlign:"center", padding:"12px 14px", borderRadius:8, fontWeight:700, fontSize:14, fontFamily:"sans-serif", border:"none", cursor: loading || !hasValidDates || hasOverlap ? "default" : "pointer", opacity: loading || !hasValidDates || hasOverlap ? 0.6 : 1, boxShadow:"0 4px 12px rgba(22,163,74,0.3)" }}>
          {loading ? "Processing..." : "Pay Now"}
        </button>
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
      const res = await fetch('/api/get-my-bookings?email=' + encodeURIComponent(email));
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
      const res = await fetch('/api/cancel-lot-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel booking');
      setBookings(prev => prev.filter(b => b.id !== orderId));
      alert("Booking cancelled and refunded.");
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
const emojiHoverStyle = `
.map-emoji-hover:hover {
  transform: scale(1.25);
  filter: drop-shadow(0 0 6px rgba(250, 204, 21, 0.9));
}
`;

export default function AlohaMap() {
  const [statuses, setStatuses] = useState(initStatuses);
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const [selectedStorageLot, setSelectedStorageLot] = useState(null);
  const [payLotSelected, setPayLotSelected] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const containerRef = useRef(null);
  const [scale, setScale] = useState({ w: 900, h: 1130 });
  const [draftLots, setDraftLots] = useState(LOTS);
  const [activeEditLot, setActiveEditLot] = useState(null);
  const [snapLines, setSnapLines] = useState({ x: null, y: null });
  const [newLotName, setNewLotName] = useState("");
  const [texts, setTexts] = useState([]);
  const [lotColors, setLotColors] = useState({});
  const [rotations, setRotations] = useState({});
  const [emojiRotations, setEmojiRotations] = useState({});
  const [textRotations, setTextRotations] = useState({});
  const [lotInfo, setLotInfo] = useState({});
  const [parkSettings, setParkSettings] = useState({ cancellation_days: 7, checkin_time: "2:00 PM", checkout_time: "11:00 AM" });
  const [showParkSettings, setShowParkSettings] = useState(false);
  const [showMyReservations, setShowMyReservations] = useState(false);
  const [emojis, setEmojis] = useState([]);
  const [lotShapes, setLotShapes] = useState({});
  const [dragging, setDragging] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const isAdmin = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("edit") === "true";
  const isInfoOnly = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("edit") === "info";
  const [editMode, setEditMode] = useState(false);
  const [activeEmoji, setActiveEmoji] = useState(null);
  const [propaneModalLotId, setPropaneModalLotId] = useState(null);
  const [storageModalOpen, setStorageModalOpen] = useState(false);

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        const w = containerRef.current.offsetWidth;
        setScale({ w, h: w * (1130 / 900) });
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    async function loadData() {
      const [emojiRows, shapeRows, statusRows, textRows, colorRows, rotRows, emojiRotRows, textRotRows] = await Promise.all([
        loadFromSupabase('emojis'),
        loadFromSupabase('shapes'),
        loadFromSupabase('statuses'),
        loadFromSupabase('texts'),
        loadFromSupabase('lotColors'),
        loadFromSupabase('rotations'),
        loadFromSupabase('emojiRotations'),
        loadFromSupabase('textRotations'),
      ]);
      if (emojiRows.length > 0) setEmojis(emojiRows[0].data || []);
      if (shapeRows.length > 0) setLotShapes(shapeRows[0].data || {});
      if (statusRows.length > 0) setStatuses(statusRows[0].data || {});
      if (textRows.length > 0) setTexts(textRows[0].data || []);
      if (colorRows.length > 0) setLotColors(colorRows[0].data || {});
      if (rotRows.length > 0) setRotations(rotRows[0].data || {});
      if (emojiRotRows.length > 0) setEmojiRotations(emojiRotRows[0].data || {});
      if (textRotRows.length > 0) setTextRotations(textRotRows[0].data || {});
      const info = await loadLotInfo(PARK_ID);
      setLotInfo(info);
      const settings = await loadParkSettings();
      if (settings) setParkSettings(settings);
    }
    loadData();
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
      const mapH = scale.h || 1130;
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
              📍 Aloha RV Park · 4648 S. Orange Blossom Trail, Kissimmee FL 34744
            </p>
          </div>
          <button onClick={()=>setConfirmed(null)} style={{ ...btnPrimary, width:"100%" }}>← Back to Map</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:"#f0fdf4", fontFamily:"sans-serif" }}>
      <style>{emojiHoverStyle}</style>
      {/* Header */}
      <div style={{ background:"linear-gradient(135deg,#14532d,#16a34a)", padding:"16px 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontFamily:"Georgia,serif", fontWeight:900, fontSize:22, color:"#fff" }}>🌺 Aloha RV Park</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.8)", letterSpacing:1 }}>INTERACTIVE LOT MAP · KISSIMMEE, FL</div>
        </div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {Object.entries(STATUS_COLORS).map(([s,c]) => (
            <div key={s} style={{ display:"flex", alignItems:"center", gap:5 }}>
              <div style={{ width:12, height:12, borderRadius:3, background:STATUS_SOLID[s] }} />
              <span style={{ color:"#fff", fontSize:11, textTransform:"capitalize", fontWeight:600 }}>{s.replace(/_/g," ")} ({counts[s]||0})</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding:"16px 16px 0", textAlign:"center" }}>
        <p style={{ color:"#166534", fontWeight:600, margin:0, fontSize:14 }}>
          Click any <span style={{ color:"#16a34a" }}>🟢 green lot</span> to reserve it. Hover to see the lot number.
        </p>
      </div>

      {/* Map Container */}
      <div style={{ padding:16, display:"flex", justifyContent:"center" }}>
        <div
          ref={containerRef}
          style={{ position:"relative", width:"100%", maxWidth:900, display:"inline-block", userSelect:"none" }}
          onClick={() => setActiveEmoji(null)}
          onMouseMove={editMode ? (e) => {
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
            if (dragging) {
              const [x,y,w,h] = draftLots[dragging];
              console.log(`${dragging}: [${x}, ${y}, ${w}, ${h}],`);
              setDragging(null);
            }
          } : undefined}
          onMouseLeave={editMode ? () => setDragging(null) : undefined}
        >
          <img
            src={MAP_IMG}
            alt="Aloha RV Park Map"
            style={{ width:"100%", height:"auto", display:"block", borderRadius:12, boxShadow:"0 4px 24px rgba(0,0,0,0.18)" }}
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
            const mapH = scale.h || 1130;
            const px = x / 100 * mapW;
            const py = y / 100 * mapH;
            const pw = w / 100 * mapW;
            const ph = h / 100 * mapH;
            if (editMode) {
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
                    background: isActive ? "rgba(251,191,36,0.85)" : lotColors[lot] ? lotColors[lot] : STATUS_COLORS[status],
                    borderRadius: borderRadius,
                    clipPath: clipPath,
                    border: isActive ? "2px solid #f59e0b" : "1.5px solid rgba(255,255,255,0.6)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    cursor:"move",
                    boxSizing:"border-box",
                    zIndex: isActive ? 50 : 10,
                    transform: `rotate(${rotations[lot] || 0}deg)`,
                  }}
                  onClick={() => setActiveEditLot(lot)}
                >
                  <span style={{ fontSize:"clamp(5px,0.85vw,10px)", fontWeight:700, color:"#fff", textShadow:"0 1px 3px rgba(0,0,0,0.8)", pointerEvents:"none" }}>{lot}</span>
                </Rnd>
              );
            }
            return (
              <div
                key={lot}
                onClick={() => {
                  if (lot.startsWith("S")) {
                    setSelectedStorageLot({ lot, status });
                  } else {
                    setSelected({ lot, status });
                  }
                }}
                onMouseEnter={() => setHover(lot)}
                onMouseLeave={() => setHover(null)}
                title={`Lot ${lot} • ${status}`}
                style={{
                  position:"absolute",
                  left:`${x}%`, top:`${y}%`,
                  width:`${w}%`, height:`${h}%`,
                  background: lotColors[lot] ? lotColors[lot] : isHov ? STATUS_COLORS[status].replace(/[\d.]+\)$/, "0.88)") : STATUS_COLORS[status],
                  borderRadius: borderRadius,
                  clipPath: clipPath,
                  cursor: "pointer",
                  border: isHov ? "2px solid rgba(255,255,255,0.9)" : "1.5px solid rgba(255,255,255,0.45)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  transition:"all 0.12s",
                  zIndex: isHov ? 20 : 1,
                  transform: `rotate(${rotations[lot] || 0}deg)`,
                  boxSizing:"border-box",
                }}
              >
                <span style={{ fontSize:"clamp(5px,0.85vw,10px)", fontWeight:700, color:"#fff", textShadow:"0 1px 3px rgba(0,0,0,0.8)", lineHeight:1, pointerEvents:"none" }}>
                  {lot}
                </span>
              </div>
            );
          })}
          {/* Texts */}
          {texts.map((item) => (
            <Rnd
              key={item.id}
              position={{ x: item.x / 100 * (scale.w || 900), y: item.y / 100 * (scale.h || 1130) }}
              size={{ width: item.text.length * item.size * 0.6 + 20, height: item.size + 16 }}
              onDragStop={(e, d) => {
                const nx = Math.round(d.x / (scale.w || 900) * 1000) / 10;
                const ny = Math.round(d.y / (scale.h || 1130) * 1000) / 10;
                setTexts(prev => prev.map(t => t.id === item.id ? { ...t, x: nx, y: ny } : t));
              }}
              enableResizing={false}
              style={{ zIndex:200, cursor:"move" }}
            >
              <div style={{ fontSize:item.size, color:item.color, fontWeight:700, textShadow:"0 1px 3px rgba(0,0,0,0.5)", whiteSpace:"nowrap", userSelect:"none" }}>
                {item.text}
                {editMode && (
                  <button onClick={()=>setTexts(prev=>prev.filter(t=>t.id!==item.id))}
                    style={{ position:"absolute", top:-8, right:-8, background:"#ef4444", color:"#fff", border:"none", borderRadius:"50%", width:16, height:16, fontSize:10, cursor:"pointer", lineHeight:"16px", textAlign:"center" }}>x</button>
                )}
              </div>
            </Rnd>
          ))}
          {/* Emojis */}
          {emojis.map((item) => {
            const emojiSize = item.size || 24;
            return (
            <Rnd
              key={item.id}
              position={{ x: item.x / 100 * (scale.w || 900), y: item.y / 100 * (scale.h || 1130) }}
              size={{ width: emojiSize + 8, height: emojiSize + 8 }}
              onDragStop={(e, d) => {
                const nx = Math.round(d.x / (scale.w || 900) * 1000) / 10;
                const ny = Math.round(d.y / (scale.h || 1130) * 1000) / 10;
                setEmojis(prev => prev.map(em => em.id === item.id ? { ...em, x: nx, y: ny } : em));
              }}
              enableResizing={false}
              disableDragging={!(editMode || isInfoOnly)}
              style={{ fontSize: emojiSize, display:"flex", alignItems:"center", justifyContent:"center", cursor: (editMode || isInfoOnly) ? "move" : "pointer", zIndex:100 }}
            >
              <span
                onClick={e => { e.stopPropagation(); setActiveEmoji(activeEmoji === item.id ? null : item.id); }}
                className="map-emoji-hover"
                style={{ lineHeight:1, userSelect:"none", display:"inline-block", transition:"transform 0.15s, filter 0.15s" }}
              >{item.emoji}</span>

              {(editMode || isInfoOnly) && activeEmoji === item.id && (
                <div onClick={e => e.stopPropagation()} style={{ position:"absolute", bottom:"calc(100% + 8px)", left:"50%", transform:"translateX(-50%)", background:"#fff", border:"1.5px solid #d1d5db", borderRadius:10, padding:"10px 12px", minWidth:210, boxShadow:"0 4px 16px rgba(0,0,0,0.2)", zIndex:500, fontFamily:"sans-serif" }}>
                  <div style={{ fontSize:11, color:"#6b7280", marginBottom:3, fontWeight:600 }}>POPUP TITLE</div>
                  <input
                    value={item.label || ""}
                    onChange={e => setEmojis(prev => prev.map(em => em.id === item.id ? { ...em, label: e.target.value } : em))}
                    placeholder="e.g. Pool, Office..."
                    style={{ width:"100%", padding:"4px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:12, marginBottom:6, boxSizing:"border-box" }}
                  />
                  <div style={{ fontSize:11, color:"#6b7280", marginBottom:3, fontWeight:600 }}>POPUP INFO (one per line)</div>
                  <textarea
                    value={item.info || ""}
                    onChange={e => setEmojis(prev => prev.map(em => em.id === item.id ? { ...em, info: e.target.value } : em))}
                    placeholder="Hours: 9am-9pm&#10;Rules: No running&#10;Price: Free"
                    rows={3}
                    style={{ width:"100%", padding:"4px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:12, marginBottom:6, boxSizing:"border-box", resize:"vertical" }}
                  />
                  <div style={{ fontSize:11, color:"#6b7280", marginBottom:3, fontWeight:600 }}>SIZE: {emojiSize}px</div>
                  <input
                    type="range" min="12" max="80" value={emojiSize}
                    onChange={e => setEmojis(prev => prev.map(em => em.id === item.id ? { ...em, size: parseInt(e.target.value) } : em))}
                    style={{ width:"100%", marginBottom:8 }}
                  />
                  <button
                    onClick={() => { setEmojis(prev => prev.filter(em => em.id !== item.id)); setActiveEmoji(null); }}
                    style={{ background:"#ef4444", color:"#fff", border:"none", borderRadius:6, padding:"5px 10px", cursor:"pointer", fontSize:12, width:"100%", fontWeight:600 }}
                  >🗑 Delete</button>
                </div>
              )}

              {!editMode && !isInfoOnly && activeEmoji === item.id && (item.label || item.info) && (
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
                        <button onClick={()=>setPropaneModalLotId(String(item.id))}
                          style={{ display:"block", width:"100%", background:"linear-gradient(135deg,#14532d,#16a34a)", color:"#fff", textAlign:"center", padding:"12px 20px", borderRadius:50, fontWeight:700, fontSize:15, fontFamily:"sans-serif", border:"none", cursor:"pointer", boxShadow:"0 4px 12px rgba(22,163,74,0.3)", marginBottom:10 }}>
                          💳 Buy Propane
                        </button>
                        <a href="tel:6892520567" style={{ display:"block", background:"#f3f4f6", color:"#374151", textAlign:"center", padding:"10px 20px", borderRadius:50, fontWeight:700, fontSize:14, fontFamily:"sans-serif", textDecoration:"none", border:"1.5px solid #d1d5db" }}>
                          📞 Questions: Call (689) 252-0567
                        </a>
                      </div>
                    )}
                    <div style={{ marginTop:16, textAlign:"center" }}>
                      <div style={{ fontSize:11, color:"#9ca3af", fontFamily:"sans-serif" }}>🌺 Aloha RV Park · Kissimmee, FL</div>
                    </div>
                  </div>
                </div>
              )}

                            {/* no tooltip - title only shows in popup */}
            </Rnd>
            );
          })}

        </div>
      </div>

      {propaneModalLotId && (
        <PropaneCheckoutModal lotId={propaneModalLotId} onClose={()=>setPropaneModalLotId(null)} />
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
      <div style={{ maxWidth:900, margin:"0 auto 10px", display:"flex", justifyContent:"flex-end", gap:8 }}>
        {isAdmin && editMode && (
          <button
            onClick={() => setShowParkSettings(true)}
            style={{ background:"#374151", color:"#fff", border:"none", padding:"8px 20px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:700 }}
          >
            ⚙️ Park Settings
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => { setEditMode(m => !m); setActiveEmoji(null); }}
            style={{ background: editMode ? "#f59e0b" : "#16a34a", color:"#fff", border:"none", padding:"8px 20px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:700, boxShadow:"0 2px 6px rgba(0,0,0,0.15)" }}
          >
            {editMode ? "👁 Switch to Preview Mode" : "✏️ Switch to Edit Mode"}
          </button>
        )}
      </div>

      {showParkSettings && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2000 }}>
          <div style={{ background:"#fff", borderRadius:12, padding:24, width:340, maxWidth:"90vw", fontFamily:"sans-serif" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <h3 style={{ margin:0, fontSize:16, fontWeight:700 }}>Park Settings</h3>
              <button onClick={()=>setShowParkSettings(false)} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#888" }}>✕</button>
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:12, color:"#6b7280", display:"block", marginBottom:4 }}>Check-in Time</label>
              <input type="text" value={parkSettings.checkin_time}
                onChange={e=>setParkSettings(p=>({...p, checkin_time:e.target.value}))}
                style={{ width:"100%", padding:"8px 10px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:12, color:"#6b7280", display:"block", marginBottom:4 }}>Check-out Time</label>
              <input type="text" value={parkSettings.checkout_time}
                onChange={e=>setParkSettings(p=>({...p, checkout_time:e.target.value}))}
                style={{ width:"100%", padding:"8px 10px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:12, color:"#6b7280", display:"block", marginBottom:4 }}>Cancellation Window (days before arrival for full refund)</label>
              <input type="number" value={parkSettings.cancellation_days}
                onChange={e=>setParkSettings(p=>({...p, cancellation_days:parseInt(e.target.value,10) || 0}))}
                style={{ width:"100%", padding:"8px 10px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }} />
            </div>
            <button onClick={async ()=>{
              await saveParkSettings(parkSettings);
              alert("Park settings saved!");
              setShowParkSettings(false);
            }} style={{ width:"100%", background:"#16a34a", color:"#fff", border:"none", padding:"10px", borderRadius:8, cursor:"pointer", fontSize:14, fontWeight:700 }}>
              Save Settings
            </button>
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
            await saveToSupabase('emojis', 'all', emojis);
            alert("Saved!");
          }} style={{ width:"100%", background:"#8b5cf6", color:"#fff", border:"none", padding:"10px", borderRadius:8, cursor:"pointer", fontSize:14, fontWeight:700 }}>
            💾 Save Changes
          </button>
        </div>
      )}

      {/* Edit Panel */}
      {editMode && (
        <div style={{ maxWidth:900, margin:"0 auto 20px", background:"#fff", border:"2px solid #f59e0b", borderRadius:14, padding:16, fontFamily:"sans-serif" }}>
          
          {/* Add Lot */}
          <div style={{ marginBottom:14, padding:12, background:"#f0fdf4", borderRadius:10 }}>
            <strong style={{ fontSize:13, color:"#166534" }}>+ Add New Lot</strong>

            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <input value={newLotName} onChange={e=>setNewLotName(e.target.value.toUpperCase())}
                placeholder="e.g. E1" style={{ flex:1, padding:"8px 12px", border:"1px solid #d1d5db", borderRadius:8, fontSize:14 }} />
              <button onClick={()=>{
                if (!newLotName) return;
                setDraftLots(prev=>({ ...prev, [newLotName]: [10, 10, 5, 3] }));
                setActiveEditLot(newLotName);
                setNewLotName("");
              }} style={{ background:"#16a34a", color:"#fff", border:"none", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontWeight:600 }}>Add</button>
            </div>
          </div>

          {/* Add Emojis */}
          <div style={{ marginBottom:14, padding:12, background:"#fef9c3", borderRadius:10 }}>
            <strong style={{ fontSize:13, color:"#854d0e" }}>Add Emoji/Sticker</strong>
            <div style={{ fontSize:11, color:"#92400e", marginBottom:6, marginTop:2 }}>Click to place at center, then drag into position</div>
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

          {/* Add Text */}
          <div style={{ marginBottom:14, padding:12, background:"#eff6ff", borderRadius:10 }}>
            <strong style={{ fontSize:13, color:"#1e40af" }}>Add Text to Map</strong>
            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <input id="textInput" placeholder="Type text..." style={{ flex:1, padding:"8px 12px", border:"1px solid #d1d5db", borderRadius:8, fontSize:14 }} />
              <input id="textSize" type="number" defaultValue="16" min="8" max="72" style={{ width:60, padding:"8px", border:"1px solid #d1d5db", borderRadius:8, fontSize:14 }} />
              <input id="textColor" type="color" defaultValue="#000000" style={{ width:40, padding:"2px", border:"1px solid #d1d5db", borderRadius:8, cursor:"pointer" }} />
              <button onClick={()=>{
                const val = document.getElementById("textInput").value;
                const size = document.getElementById("textSize").value;
                const color = document.getElementById("textColor").value;
                if (!val) return;
                setTexts(prev=>[...prev, { id: Date.now(), text: val, size: parseInt(size), color, x: 50, y: 50 }]);
                document.getElementById("textInput").value = "";
              }} style={{ background:"#1e40af", color:"#fff", border:"none", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontWeight:600 }}>Add</button>
            </div>
          </div>

          {activeEditLot && draftLots[activeEditLot] && (
            <>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <strong style={{ fontSize:15 }}>Editing: <span style={{ color:"#16a34a" }}>{activeEditLot}</span></strong>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={()=>{
                    if (window.confirm(`Delete lot ${activeEditLot}?`)) {
                      setDraftLots(prev=>{ const n={...prev}; delete n[activeEditLot]; return n; });
                      setActiveEditLot(null);
                    }
                  }} style={{ background:"#ef4444", color:"#fff", border:"none", padding:"6px 12px", borderRadius:8, cursor:"pointer", fontSize:12 }}>Delete</button>
                  <button onClick={()=>setActiveEditLot(null)} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", color:"#888" }}>✕</button>
                </div>
              </div>
              <div style={{ marginBottom:12 }}>
                <span style={{ fontSize:12, fontWeight:600, color:"#6b7280" }}>STATUS / COLOR</span>
                <div style={{ display:"flex", gap:8, marginTop:6, flexWrap:"wrap" }}>
                  {[["available","#16a34a","🟢 Available"],["occupied","#dc2626","🔴 Occupied"],["reserved","#ca8a04","🟡 Reserved"],["maintenance","#4b5563","⚫ Maintenance"],["for_sale","#ac67dd","🏠 For Sale"]].map(([s,c,label])=>(
                    <button key={s} onClick={()=>{ setStatuses(prev=>({...prev,[activeEditLot]:s})); if (s === "for_sale") ensureRealEstateListing(activeEditLot); }}
                      style={{ background: statuses[activeEditLot]===s ? c : "#f3f4f6", color: statuses[activeEditLot]===s ? "#fff" : "#374151", border:`2px solid ${c}`, padding:"6px 12px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom:10 }}>
                <span style={{ fontSize:12, fontWeight:600, color:"#6b7280" }}>CUSTOM COLOR</span>
                <div style={{ display:"flex", gap:8, marginTop:6, alignItems:"center" }}>
                  <input type="color" value={lotColors[activeEditLot] || "#16a34a"}
                    onChange={e=>setLotColors(prev=>({...prev,[activeEditLot]:e.target.value}))}
                    style={{ width:40, height:32, padding:2, border:"1px solid #d1d5db", borderRadius:8, cursor:"pointer" }} />
                  <span style={{ fontSize:12, color:"#6b7280" }}>Pick any color for this lot</span>
                  <button onClick={()=>setLotColors(prev=>{ const n={...prev}; delete n[activeEditLot]; return n; })}
                    style={{ background:"#f3f4f6", border:"1px solid #d1d5db", padding:"4px 10px", borderRadius:8, cursor:"pointer", fontSize:12 }}>Reset</button>
                </div>
              </div>
              <div style={{ marginBottom:10 }}>
                <span style={{ fontSize:12, fontWeight:600, color:"#6b7280" }}>ROTATION</span>
                <div style={{ display:"flex", gap:8, marginTop:6, alignItems:"center" }}>
                  <input type="range" min="0" max="360" value={rotations[activeEditLot] || 0}
                    onChange={e=>setRotations(prev=>({...prev,[activeEditLot]:parseInt(e.target.value)}))}
                    style={{ flex:1 }} />
                  <span style={{ fontSize:12, minWidth:35 }}>{rotations[activeEditLot] || 0}deg</span>
                  <button onClick={()=>setRotations(prev=>({...prev,[activeEditLot]:0}))}
                    style={{ background:"#f3f4f6", border:"1px solid #d1d5db", padding:"4px 10px", borderRadius:8, cursor:"pointer", fontSize:12 }}>Reset</button>
                </div>
              </div>
              <div style={{ marginBottom:10 }}>
                <span style={{ fontSize:12, fontWeight:600, color:"#6b7280" }}>SHAPE</span>
                <div style={{ display:"flex", gap:8, marginTop:6, flexWrap:"wrap" }}>
                  {["rectangle","rounded","circle","parallelogram-left","parallelogram-right","diamond","hexagon"].map(s=>(
                    <button key={s} onClick={()=>setLotShapes(prev=>({...prev,[activeEditLot]:s}))}
                      style={{ background: lotShapes[activeEditLot]===s?"#16a34a":"#f3f4f6", color: lotShapes[activeEditLot]===s?"#fff":"#374151", border:"1px solid #d1d5db", padding:"6px 12px", borderRadius:8, cursor:"pointer", fontSize:12 }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom:12, background:"#f0fdf4", borderRadius:10, padding:12 }}>
                <strong style={{ fontSize:13, color:"#166534" }}>Lot Details (visible to guests)</strong>
                {activeEditLot.startsWith("S") ? (
                  <>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:8 }}>
                      <div>
                        <label style={{ fontSize:11, color:"#6b7280",display:"block", marginBottom:3 }}>Type</label>
                        <select defaultValue={lotInfo[activeEditLot]?.lot_type || "outdoor"}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], lot_type:e.target.value}}))}
                          style={{ width:"100%", padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }}>
                          <option value="outdoor">Outdoor</option>
                          <option value="indoor">Indoor</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize:11, color:"#6b7280",display:"block", marginBottom:3 }}>Size</label>
                        <input type="text" defaultValue={lotInfo[activeEditLot]?.size || ""}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], size:e.target.value}}))}
                          placeholder="e.g. 20ft x 10ft"
                          style={{ width:"100%", padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }} />
                      </div>
                    </div>
                    <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:8 }}>
                      <input type="checkbox" id="hasElec" checked={lotInfo[activeEditLot]?.has_electricity || false}
                        onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], has_electricity:e.target.checked}}))} />
                      <label htmlFor="hasElec" style={{ fontSize:12, color:"#374151" }}>Has electricity</label>
                    </div>
                    {lotInfo[activeEditLot]?.has_electricity && (
                      <div style={{ marginTop:8 }}>
                        <label style={{ fontSize:11, color:"#6b7280",display:"block", marginBottom:3 }}>Amperage</label>
                        <select defaultValue={lotInfo[activeEditLot]?.amperage || 30}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], amperage:parseInt(e.target.value)}}))}
                          style={{ width:"100%", padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }}>
                          <option value={30}>30 Amp</option>
                          <option value={50}>50 Amp</option>
                          <option value={30.50}>30/50 Amp</option>
                        </select>
                      </div>
                    )}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginTop:8 }}>
                      <div>
                        <label style={{ fontSize:11, color:"#6b7280",display:"block", marginBottom:3 }}>Daily ($)</label>
                        <input type="number" defaultValue={lotInfo[activeEditLot]?.price_daily || 10}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], price_daily:parseFloat(e.target.value)}}))}
                          style={{ width:"100%", padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }} />
                      </div>
                      <div>
                        <label style={{ fontSize:11, color:"#6b7280",display:"block", marginBottom:3 }}>Monthly ($)</label>
                        <input type="number" defaultValue={lotInfo[activeEditLot]?.price_monthly || 100}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], price_monthly:parseFloat(e.target.value)}}))}
                          style={{ width:"100%", padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }} />
                      </div>
                      <div>
                        <label style={{ fontSize:11, color:"#6b7280",display:"block", marginBottom:3 }}>Yearly ($)</label>
                        <input type="number" defaultValue={lotInfo[activeEditLot]?.price_yearly || ""}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], price_yearly:parseFloat(e.target.value)}}))}
                          placeholder="optional"
                          style={{ width:"100%", padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }} />
                      </div>
                    </div>
                    <div style={{ marginTop:8 }}>
                      <label style={{ fontSize:11, color:"#6b7280", display:"block", marginBottom:3 }}>Description</label>
                      <textarea defaultValue={lotInfo[activeEditLot]?.description || ""}
                        onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], description:e.target.value}}))}
                        placeholder="e.g. Covered spot, near entrance..."
                        style={{ width:"100%", padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box", resize:"vertical", minHeight:60 }} />
                    </div>
                    <button onClick={async ()=>{
                      const info = lotInfo[activeEditLot] || {};
                      await saveLotInfo(PARK_ID, activeEditLot, {
                        lot_type: info.lot_type || "outdoor",
                        size: info.size || "",
                        has_electricity: info.has_electricity || false,
                        amperage: info.has_electricity ? (info.amperage || 30) : null,
                        price_daily: info.price_daily || 10,
                        price_monthly: info.price_monthly || 100,
                        price_yearly: info.price_yearly || null,
                        description: info.description || ""
                      });
                      alert("Lot info saved!");
                    }} style={{ marginTop:8, background:"#16a34a", color:"#fff", border:"none", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600, width:"100%" }}>
                      Save Lot Info
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:8 }}>
                      <div>
                        <label style={{ fontSize:11, color:"#6b7280",display:"block", marginBottom:3 }}>Max RV Length (ft)</label>
                        <input type="number" defaultValue={lotInfo[activeEditLot]?.max_length || 45}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], max_length:parseInt(e.target.value)}}))}
                          style={{ width:"100%", padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }} />
                      </div>
                      <div>
                        <label style={{ fontSize:11, color:"#6b7280",display:"block", marginBottom:3 }}>Amperage</label>
                        <select defaultValue={lotInfo[activeEditLot]?.amperage || 50}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], amperage:parseInt(e.target.value)}}))}
                          style={{ width:"100%", padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }}>
                          <option value={30}>30 Amp</option>
                          <option value={50}>50 Amp</option>
                          <option value={30.50}>30/50 Amp</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize:11, color:"#6b7280",display:"block", marginBottom:3 }}>Daily Price ($)</label>
                        <input type="number" defaultValue={lotInfo[activeEditLot]?.price_daily || 45}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], price_daily:parseFloat(e.target.value)}}))}
                          style={{ width:"100%", padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }} />
                      </div>
                      <div>
                        <label style={{ fontSize:11, color:"#6b7280",display:"block", marginBottom:3 }}>Monthly Price ($)</label>
                        <input type="number" defaultValue={lotInfo[activeEditLot]?.price_monthly || 650}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], price_monthly:parseFloat(e.target.value)}}))}
                          style={{ width:"100%", padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }} />
                      </div>
                      <div>
                        <label style={{ fontSize:11, color:"#6b7280",display:"block", marginBottom:3 }}>Weekly Price ($)</label>
                        <input type="number" defaultValue={lotInfo[activeEditLot]?.price_weekly || ""}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], price_weekly:parseFloat(e.target.value)}}))}
                          placeholder="optional"
                          style={{ width:"100%", padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }} />
                      </div>
                      <div>
                        <label style={{ fontSize:11, color:"#6b7280",display:"block", marginBottom:3 }}>Yearly Price ($)</label>
                        <input type="number" defaultValue={lotInfo[activeEditLot]?.price_yearly || ""}
                          onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], price_yearly:parseFloat(e.target.value)}}))}
                          placeholder="optional"
                          style={{ width:"100%", padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box" }} />
                      </div>
                    </div>
                    <div style={{ marginTop:8 }}>
                      <label style={{ fontSize:11, color:"#6b7280", display:"block", marginBottom:3 }}>Description</label>
                      <textarea defaultValue={lotInfo[activeEditLot]?.description || ""}
                        onChange={e=>setLotInfo(prev=>({...prev,[activeEditLot]:{...prev[activeEditLot], description:e.target.value}}))}
                        placeholder="e.g. Corner lot, extra space, near pool..."
                        style={{ width:"100%", padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box", resize:"vertical", minHeight:60 }} />
                    </div>
                    <button onClick={async ()=>{
                      const info = lotInfo[activeEditLot] || {};
                      await saveLotInfo(PARK_ID, activeEditLot, {
                        max_length: info.max_length || 45,
                        amperage: info.amperage || 50,
                        price_daily: info.price_daily || 45,
                        price_monthly: info.price_monthly || 650,
                        price_weekly: info.price_weekly || null,
                        price_yearly: info.price_yearly || null,
                        description: info.description || ""
                      });
                      alert("Lot info saved!");
                    }} style={{ marginTop:8, background:"#16a34a", color:"#fff", border:"none", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600, width:"100%" }}>
                      Save Lot Info
                    </button>
                  </>
                )}
              </div>
              <div style={{ background:"#f9fafb", borderRadius:8, padding:10, marginBottom:10 }}>
                <div style={{ fontSize:12, color:"#6b7280", marginBottom:4 }}>Coordinates:</div>
                <pre style={{ margin:0, fontSize:12, color:"#14532d", fontFamily:"monospace", userSelect:"all" }}>
                  {activeEditLot + ": [" + draftLots[activeEditLot].map(n=>n.toFixed(1)).join(", ") + "],"}
                </pre>
              </div>
            </>
          )}

          <button onClick={async ()=>{
            try {
              // Guardar emojis y shapes en Supabase
              await saveToSupabase('emojis', 'all', emojis);
              await saveToSupabase('shapes', 'all', lotShapes);
              await saveToSupabase('statuses', 'all', statuses);
              await saveToSupabase('texts', 'all', texts);
              await saveToSupabase('lotColors', 'all', lotColors);
              await saveToSupabase('rotations', 'all', rotations);
              await saveToSupabase('emojiRotations', 'all', emojiRotations);
              await saveToSupabase('textRotations', 'all', textRotations);

              // Get current file SHA
              const fileRes = await fetch('/api/save-to-github');
              const fileData = await fileRes.json();
              const sha = fileData.sha;
              const currentContent = new TextDecoder("utf-8").decode(Uint8Array.from(atob(fileData.content.replace(/\n/g,"")), c => c.charCodeAt(0)));
              // Replace LOTS in file
              const lotsStr = "const LOTS = {\n" + Object.entries(draftLots).map(([k,v])=>`  ${k}: [${v.map(n=>n.toFixed(1)).join(", ")}],`).join("\n") + "\n};";
              const newContent = currentContent.replace(/const LOTS = \{[\s\S]*?\};/, lotsStr);
              // Commit
              const updateRes = await fetch('/api/save-to-github', {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: "Update lot coordinates from map editor", content: btoa(unescape(encodeURIComponent(newContent))), sha })
              });
              if (updateRes.ok) {
                alert("Changes saved! Updates will appear everywhere in ~30 seconds.");
              } else {
                const err = await updateRes.json();
                alert("⚠️ Error: " + err.message);
              }
            } catch(e) {
              alert("⚠️ Error: " + e.message);
            }
          }} style={{ background:"#16a34a", color:"#fff", border:"none", padding:"10px 20px", borderRadius:8, cursor:"pointer", fontSize:14, fontWeight:600, width:"100%" }}>
            💾 Save All Changes
          </button>
        </div>
      )}

      {/* Booking modal */}
      {selected && (
        <BookingModal
          lot={selected.lot}
          status={selected.status}
          lotInfo={lotInfo[selected.lot]}
          parkSettings={parkSettings}
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
