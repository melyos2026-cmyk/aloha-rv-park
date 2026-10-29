import { useState } from "react";

// Oct 22 (per Mely — "estilo Expedia"): search by dates above the map. Uses the same
// availability and prices as the lot calendar and checkout (/api/lot-data?type=search).
// Free lots light up on the map; tapping one opens the normal booking window with the
// dates already filled in.
//
// Oct 28 (per Mely): sits on the page above the map now, on white — so the card carries
// its own outline instead of leaning on the green behind it. Also asks for slide-outs,
// because the booking window requires them and turns away a lot that can't take them:
// without them here, a visitor picked a lot and only then found out it didn't fit.

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const addDays = (s, n) => {
  const d = new Date(s + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const nice = (s) => new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Oct 29 (per Mely — "muy infantil"): restyled like a travel-site search bar. Desktop: one
// horizontal bar (Arrival | Departure | RV length | Slide-outs | Search). Phone: a compact card
// of neat field boxes. Neutral borders, small grey labels, dark green only as the accent.
// Styling only — fields, values and behavior are the same as before.
const css = `
.ls-wrap{background:#fff;padding:20px 16px 22px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-text-size-adjust:100%;text-size-adjust:100%}
.ls-form{max-width:900px;margin:0 auto}
.ls-title{font-size:17px;font-weight:650;color:#111827;letter-spacing:-.01em;margin:0 0 10px}
.ls-bar{display:flex;align-items:stretch;background:#fff;border:1px solid #d1d5db;border-radius:12px;box-shadow:0 1px 2px rgba(16,24,40,.04),0 6px 20px rgba(16,24,40,.06)}
.ls-seg{position:relative;display:flex;flex-direction:column;justify-content:center;gap:2px;padding:9px 14px;min-width:0;border-right:1px solid #e5e7eb;cursor:text;transition:background .15s}
.ls-seg:first-child{border-radius:11px 0 0 11px}
.ls-seg:hover{background:#f9fafb}
.ls-seg:focus-within{background:#f6faf7;box-shadow:inset 0 -2px 0 #14532d}
.ls-date{flex:1.1 1 0}
.ls-len{flex:.8 1 0}
.ls-slide{flex:2 1 0}
.ls-lbl{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;color:#6b7280;line-height:1.2;white-space:nowrap}
.ls-lbl svg{flex:0 0 auto;color:#9ca3af}
.ls-in{width:100%;box-sizing:border-box;border:0;outline:0;background:transparent;padding:0;margin:0;font:inherit;font-size:15px;font-weight:500;color:#111827;height:24px;min-width:0;-webkit-appearance:none;appearance:none}
.ls-in::placeholder{color:#9ca3af;font-weight:400}
.ls-in::-webkit-calendar-picker-indicator{opacity:.55;cursor:pointer}
input.ls-in[type=number]{-moz-appearance:textfield}
input.ls-in[type=number]::-webkit-inner-spin-button,input.ls-in[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
select.ls-in{cursor:pointer;padding-right:18px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 2px center}
.ls-pair{display:flex;gap:20px}
.ls-pair label{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;cursor:pointer}
.ls-pair select.ls-in{min-width:58px}
.ls-sub{font-size:12px;color:#6b7280;white-space:nowrap}
.ls-btn-cell{display:flex;align-items:center;padding:6px}
.ls-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:100%;min-height:46px;padding:0 24px;border:0;border-radius:9px;background:#14532d;color:#fff;font:inherit;font-size:15px;font-weight:600;letter-spacing:.01em;cursor:pointer;white-space:nowrap;transition:background .15s,box-shadow .15s}
.ls-btn:hover{background:#0f3f22}
.ls-btn:focus-visible{outline:2px solid #14532d;outline-offset:2px}
.ls-btn[disabled]{opacity:.7;cursor:default}
.ls-note{margin:8px 2px 0;font-size:12px;color:#6b7280;line-height:1.45}
.ls-err{margin:8px 2px 0;font-size:13px;font-weight:500;color:#b91c1c}
.ls-res{max-width:900px;margin:14px auto 0}
.ls-res-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px}
.ls-res-title{margin:0;font-weight:600;color:#111827;font-size:15px}
.ls-clear{background:none;border:0;padding:0;color:#14532d;font:inherit;font-weight:500;font-size:13.5px;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.ls-res-sub{margin:4px 0 0;color:#6b7280;font-size:13px}
.ls-cards{display:flex;gap:10px;overflow-x:auto;padding:10px 2px 6px;-webkit-overflow-scrolling:touch}
.ls-card{flex:0 0 210px;text-align:left;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:0;overflow:hidden;cursor:pointer;font:inherit;box-shadow:0 1px 2px rgba(16,24,40,.04);transition:border-color .15s,box-shadow .15s}
.ls-card:hover{border-color:#14532d;box-shadow:0 4px 14px rgba(16,24,40,.08)}
@media (max-width:720px){
  .ls-wrap{padding:14px 12px 16px}
  .ls-title{font-size:16px;margin-bottom:10px}
  .ls-bar{display:grid;grid-template-columns:1fr 1fr;gap:8px;border:0;box-shadow:none;background:transparent;border-radius:0}
  .ls-seg,.ls-seg:first-child{border:1px solid #d1d5db;border-radius:10px;padding:8px 12px;background:#fff}
  .ls-seg:focus-within{border-color:#14532d;box-shadow:0 0 0 1px #14532d;background:#fff}
  .ls-len{grid-column:1 / -1}
  .ls-slide{grid-column:1 / -1}
  .ls-in{font-size:16px}
  .ls-pair{gap:0;margin-top:2px}
  .ls-pair label{flex-direction:column;align-items:stretch;gap:1px;padding-right:12px}
  .ls-pair label + label{padding:0 0 0 12px;border-left:1px solid #e5e7eb}
  .ls-sub{font-size:11.5px;color:#9ca3af}
  .ls-btn-cell{grid-column:1 / -1;padding:0}
  .ls-btn{width:100%;min-height:48px;border-radius:10px}
}
`;
const Ico = ({ d }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const CAL = <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>;
const RULER = <><path d="M3 15.5 15.5 3 21 8.5 8.5 21z" /><path d="m7 12 2 2M10 9l2 2M13 6l2 2" /></>;
const RV = <><path d="M2 17V7a2 2 0 0 1 2-2h11l5 5v7h-2" /><path d="M2 17h3M11 17h4" /><circle cx="8" cy="17" r="2" /><circle cx="17" cy="17" r="2" /><path d="M6 9h4v3H6z" /></>;
const SEARCH = <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>;
const SLIDE_OUT_OPTIONS = ["0", "1", "2", "3", "4+"];
// The lot's limit reads "Any" when that side is unlimited — same wording the office picks
// in the map editor, so "Any" here means "don't narrow the search".
const slideOutLimit = (max) => (!max || max === "Any" ? null : max);

export default function LotSearch({ parkId, onResults, onPick, search }) {
  const [arrival, setArrival] = useState("");
  const [departure, setDeparture] = useState("");
  const [rvLength, setRvLength] = useState("");
  const [driverSlideOuts, setDriverSlideOuts] = useState("");
  const [passengerSlideOuts, setPassengerSlideOuts] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(e) {
    e.preventDefault();
    setError("");
    if (!arrival || !departure) { setError("Choose your arrival and departure dates."); return; }
    if (departure <= arrival) { setError("Departure must be after arrival."); return; }
    setBusy(true);
    try {
      const q = new URLSearchParams({ type: "search", park_id: parkId, arrival, departure });
      if (rvLength) q.set("rv_length", rvLength);
      if (driverSlideOuts) q.set("driver_slide_outs", driverSlideOuts);
      if (passengerSlideOuts) q.set("passenger_slide_outs", passengerSlideOuts);
      const r = await fetch("/api/lot-data?" + q.toString());
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Search failed");
      onResults({ ...data, rvLength, driverSlideOuts, passengerSlideOuts });
    } catch (err) {
      setError(err.message || "Search failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const res = search?.results || [];
  return (
    <div className="ls-wrap">
      <style>{css}</style>
      <form onSubmit={run} className="ls-form">
        <div className="ls-title">Find an open lot for your dates</div>
        <div className="ls-bar">
          <label className="ls-seg ls-date">
            <span className="ls-lbl"><Ico d={CAL} />Arrival</span>
            <input type="date" className="ls-in" min={localToday()} value={arrival}
              onChange={(e) => { setArrival(e.target.value); if (departure && departure <= e.target.value) setDeparture(addDays(e.target.value, 1)); }} />
          </label>
          <label className="ls-seg ls-date">
            <span className="ls-lbl"><Ico d={CAL} />Departure</span>
            <input type="date" className="ls-in" min={arrival ? addDays(arrival, 1) : addDays(localToday(), 1)} value={departure} onChange={(e) => setDeparture(e.target.value)} />
          </label>
          <label className="ls-seg ls-len">
            <span className="ls-lbl"><Ico d={RULER} />RV length (ft)</span>
            <input type="number" inputMode="numeric" min="0" max="80" placeholder="e.g. 35" className="ls-in" value={rvLength} onChange={(e) => setRvLength(e.target.value)} />
          </label>
          <div className="ls-seg ls-slide">
            <span className="ls-lbl"><Ico d={RV} />Slide-outs</span>
            <div className="ls-pair">
              <label>
                <span className="ls-sub">Driver side</span>
                <select className="ls-in" aria-label="Driver side slide-outs" value={driverSlideOuts} onChange={(e) => setDriverSlideOuts(e.target.value)}>
                  <option value="">Any</option>
                  {SLIDE_OUT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label>
                <span className="ls-sub">Passenger side</span>
                <select className="ls-in" aria-label="Passenger side slide-outs" value={passengerSlideOuts} onChange={(e) => setPassengerSlideOuts(e.target.value)}>
                  <option value="">Any</option>
                  {SLIDE_OUT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="ls-btn-cell">
            <button type="submit" disabled={busy} className="ls-btn">
              <Ico d={SEARCH} />{busy ? "Searching…" : "Search"}
            </button>
          </div>
        </div>
        <p className="ls-note">
          Tell us your slide-outs and we'll only show lots with room for them.
        </p>
        {error && <p className="ls-err">{error}</p>}
      </form>

      {search && (
        <div className="ls-res">
          <div className="ls-res-head">
            <p className="ls-res-title">
              {res.length ? `${res.length} lot${res.length === 1 ? "" : "s"} open` : "No lots open"} · {nice(search.arrival)} – {nice(search.departure)} ({search.nights} night{search.nights === 1 ? "" : "s"})
            </p>
            <button type="button" onClick={() => onResults(null)} className="ls-clear">Clear search</button>
          </div>
          {res.length > 0 && <p className="ls-res-sub">Open lots are highlighted on the map. Tap a lot below or on the map to reserve.</p>}
          {!res.length && <p className="ls-res-sub">Try other dates{search.rvLength ? " or a shorter RV length" : ""}, or call the office.</p>}
          <div className="ls-cards">
            {res.map((r) => (
              <button key={r.lot} type="button" onClick={() => onPick(r.lot)} className="ls-card">
                {r.photo_url
                  ? <img src={r.photo_url} alt="" style={{ width: "100%", height: 96, objectFit: "cover", display: "block" }} />
                  : <div style={{ height: 4, background: "#14532d" }} />}
                <div style={{ padding: "10px 12px" }}>
                  <div style={{ fontWeight: 650, color: "#111827", fontSize: 15.5 }}>Lot {r.lot}</div>
                  <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 2 }}>
                    {[r.max_length_ft ? `Up to ${r.max_length_ft} ft` : null, r.amp_service ? `${String(r.amp_service).replace(/amp$/i, "")}${/a$/i.test(String(r.amp_service)) ? "" : " amp"}` : null].filter(Boolean).join(" · ") || "RV lot"}
                  </div>
                  {(slideOutLimit(r.max_driver_slide_outs) || slideOutLimit(r.max_passenger_slide_outs)) && (
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                      Slide-outs: {[
                        slideOutLimit(r.max_driver_slide_outs) ? `up to ${slideOutLimit(r.max_driver_slide_outs)} driver side` : null,
                        slideOutLimit(r.max_passenger_slide_outs) ? `up to ${slideOutLimit(r.max_passenger_slide_outs)} passenger side` : null,
                      ].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  <div style={{ marginTop: 6, fontSize: 14, color: "#111827" }}>
                    {r.apply ? <b>Long stay: apply online</b>
                      : r.total != null ? <><b>{money(r.total)}</b> <span style={{ color: "#6b7280", fontSize: 12 }}>total, before tax and fees</span></>
                      : <b>Call for price</b>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
