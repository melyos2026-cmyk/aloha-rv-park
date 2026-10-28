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

const field = { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px", minWidth: 0 };
const lbl = { fontSize: 12, fontWeight: 700, color: "#166534", textTransform: "uppercase", letterSpacing: ".04em" };
const inp = { width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1.5px solid #bbf7d0", borderRadius: 10, fontSize: 16, background: "#fff", color: "#14532d" };
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
    <div style={{ background: "#fff", padding: "20px 16px 24px", boxSizing: "border-box" }}>
      <form onSubmit={run} style={{ maxWidth: 900, margin: "0 auto", background: "#fff", border: "1.5px solid #bbf7d0", borderRadius: 16, padding: 16, boxShadow: "0 2px 10px rgba(20,83,45,.06)" }}>
        <div style={{ fontFamily: "Georgia,serif", fontWeight: 800, fontSize: 18, color: "#14532d", marginBottom: 10 }}>Find an open lot for your dates</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <label style={field}>
            <span style={lbl}>Arrival</span>
            <input type="date" style={inp} min={localToday()} value={arrival}
              onChange={(e) => { setArrival(e.target.value); if (departure && departure <= e.target.value) setDeparture(addDays(e.target.value, 1)); }} />
          </label>
          <label style={field}>
            <span style={lbl}>Departure</span>
            <input type="date" style={inp} min={arrival ? addDays(arrival, 1) : addDays(localToday(), 1)} value={departure} onChange={(e) => setDeparture(e.target.value)} />
          </label>
          <label style={{ ...field, flex: "0 1 130px" }}>
            <span style={lbl}>RV length (ft)</span>
            <input type="number" inputMode="numeric" min="0" max="80" placeholder="e.g. 35" style={inp} value={rvLength} onChange={(e) => setRvLength(e.target.value)} />
          </label>
          <label style={{ ...field, flex: "1 1 150px" }}>
            <span style={lbl}>Driver side slide-outs</span>
            <select style={inp} value={driverSlideOuts} onChange={(e) => setDriverSlideOuts(e.target.value)}>
              <option value="">Any</option>
              {SLIDE_OUT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label style={{ ...field, flex: "1 1 150px" }}>
            <span style={lbl}>Passenger side slide-outs</span>
            <select style={inp} value={passengerSlideOuts} onChange={(e) => setPassengerSlideOuts(e.target.value)}>
              <option value="">Any</option>
              {SLIDE_OUT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy} style={{ flex: "1 1 120px", padding: "12px 18px", borderRadius: 10, border: "none", background: "#166534", color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", opacity: busy ? 0.7 : 1 }}>
            {busy ? "Searching…" : "Search"}
          </button>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "#4b5563" }}>
          Tell us your slide-outs and we'll only show lots with room for them.
        </p>
        {error && <p style={{ color: "#b91c1c", fontWeight: 600, fontSize: 14, margin: "10px 0 0" }}>{error}</p>}
      </form>

      {search && (
        <div style={{ maxWidth: 900, margin: "12px auto 0" }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <p style={{ margin: 0, fontWeight: 700, color: "#14532d", fontSize: 15 }}>
              {res.length ? `${res.length} lot${res.length === 1 ? "" : "s"} open` : "No lots open"} · {nice(search.arrival)} – {nice(search.departure)} ({search.nights} night{search.nights === 1 ? "" : "s"})
            </p>
            <button type="button" onClick={() => onResults(null)} style={{ background: "none", border: "none", color: "#166534", fontWeight: 700, textDecoration: "underline", cursor: "pointer", fontSize: 14 }}>Clear search</button>
          </div>
          {res.length > 0 && <p style={{ margin: "4px 0 0", color: "#4b5563", fontSize: 13 }}>Open lots are highlighted on the map. Tap a lot below or on the map to reserve.</p>}
          {!res.length && <p style={{ margin: "4px 0 0", color: "#4b5563", fontSize: 14 }}>Try other dates{search.rvLength ? " or a shorter RV length" : ""}, or call the office.</p>}
          <div style={{ display: "flex", gap: 10, overflowX: "auto", padding: "10px 2px 4px", WebkitOverflowScrolling: "touch" }}>
            {res.map((r) => (
              <button key={r.lot} type="button" onClick={() => onPick(r.lot)}
                style={{ flex: "0 0 210px", textAlign: "left", background: "#fff", border: "1.5px solid #bbf7d0", borderRadius: 14, padding: 0, overflow: "hidden", cursor: "pointer" }}>
                {r.photo_url
                  ? <img src={r.photo_url} alt="" style={{ width: "100%", height: 96, objectFit: "cover", display: "block" }} />
                  : <div style={{ height: 8, background: "#16a34a" }} />}
                <div style={{ padding: "10px 12px" }}>
                  <div style={{ fontWeight: 800, color: "#14532d", fontSize: 16 }}>Lot {r.lot}</div>
                  <div style={{ fontSize: 12.5, color: "#4b5563", marginTop: 2 }}>
                    {[r.max_length_ft ? `Up to ${r.max_length_ft} ft` : null, r.amp_service ? `${String(r.amp_service).replace(/amp$/i, "")}${/a$/i.test(String(r.amp_service)) ? "" : " amp"}` : null].filter(Boolean).join(" · ") || "RV lot"}
                  </div>
                  {(slideOutLimit(r.max_driver_slide_outs) || slideOutLimit(r.max_passenger_slide_outs)) && (
                    <div style={{ fontSize: 12, color: "#4b5563", marginTop: 2 }}>
                      Slide-outs: {[
                        slideOutLimit(r.max_driver_slide_outs) ? `up to ${slideOutLimit(r.max_driver_slide_outs)} driver side` : null,
                        slideOutLimit(r.max_passenger_slide_outs) ? `up to ${slideOutLimit(r.max_passenger_slide_outs)} passenger side` : null,
                      ].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  <div style={{ marginTop: 6, fontSize: 14, color: "#14532d" }}>
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
