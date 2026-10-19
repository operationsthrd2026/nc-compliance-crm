import { useMemo, useState, useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { DEFAULT_NC_COORDS } from "../../constants.js";
import { groupByPlace, coordsOf, jitter, placeOf } from "../../lib/geo.js";
import { TIERS } from "../../lib/scoring.js";
import { Btn, EmptyState } from "../../ui/kit.jsx";

// tier colour for a group's AVERAGE score (same thresholds as individual scores)
const tierOfAvg = avg => avg >= 70 ? "hot" : avg >= 50 ? "strong" : avg >= 30 ? "possible" : "low";

function Fit({ points, focus }){
  const map = useMap();
  useEffect(() => {
    if (focus){ map.flyTo(focus, 11, { duration: .7 }); return; }
    if (!points.length){ map.setView(DEFAULT_NC_COORDS, 7); return; }
    if (points.length === 1){ map.setView(points[0], 10); return; }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 9 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.map(p => p.join(",")).join("|"), focus && focus.join(",")]);
  return null;
}

export default function TerritoryMap({ rows, scoreOf, onPickMarket, onOpen }){
  const [pins, setPins] = useState(false);
  const [focus, setFocus] = useState(null);
  const { places, unplaced } = useMemo(() => groupByPlace(rows), [rows]);

  const stats = useMemo(() => [...places.entries()].map(([place, list]) => {
    const scores = list.map(p => scoreOf(p));
    const avg = Math.round(scores.reduce((a, s) => a + s.score, 0) / scores.length);
    const tier = tierOfAvg(avg);
    return {
      place, list, n: list.length, avg, tier, coords: coordsOf(place),
      hot: scores.filter(s => s.tier === "hot" || s.tier === "strong").length,
      ready: list.filter(p => p.currentStatus === "NEW" && /@/.test(p.emailPhone || "") && !p.doNotRespond).length,
      replied: list.filter(p => p.replyReceived).length,
      top: [...list].sort((a, b) => scoreOf(b).score - scoreOf(a).score).slice(0, 5),
    };
  }).sort((a, b) => b.n - a.n), [places, scoreOf]);

  if (!rows.length) return <EmptyState icon="🗺️" title="Nothing to map">No prospects match the current filters.</EmptyState>;
  if (!stats.length) return <EmptyState icon="🗺️" title="No locations to show">None of these prospects has a recognised North Carolina market or city yet ({unplaced} unplaced). Set a Market on a prospect to place it on the map.</EmptyState>;

  const max = Math.max(...stats.map(s => s.n));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 14, alignItems: "start" }} className="nc-map-grid">
      <div className="nc-card" style={{ overflow: "hidden", position: "relative" }}>
        <MapContainer center={DEFAULT_NC_COORDS} zoom={7} style={{ height: 560, width: "100%" }} scrollWheelZoom={true}>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
          <Fit points={stats.map(s => s.coords)} focus={focus} />
          {stats.map(s => {
            const color = TIERS[s.tier].color;
            return (
              <CircleMarker key={s.place} center={s.coords} radius={12 + 22 * Math.sqrt(s.n / max)} pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: .28 }}
                eventHandlers={{ click: () => {} }}>
                <Tooltip permanent direction="center" className="nc-count-tip"><b style={{ color: "#F0F4FF", fontSize: 12 }}>{s.n}</b></Tooltip>
                <Popup>
                  <div style={{ minWidth: 210 }}>
                    <div style={{ font: "800 14px var(--nc-font)", marginBottom: 2 }}>{s.place}</div>
                    <div style={{ color: "var(--nc-text-2)", marginBottom: 8 }}>{s.n} prospect{s.n === 1 ? "" : "s"} · avg fit <b style={{ color }}>{s.avg}</b> · {s.hot} hot/strong · {s.ready} ready for Touch 1</div>
                    {s.top.map(p => <div key={p.id} className="nc-trunc" style={{ padding: "3px 0", cursor: "pointer", color: "var(--nc-gold-l)" }} onClick={() => onOpen(p)}>{scoreOf(p).score} · {p.companyName}</div>)}
                    <Btn variant="primary" size="sm" style={{ marginTop: 10, width: "100%" }} onClick={() => onPickMarket(s.place)}>Show {s.n} in table →</Btn>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
          {pins && stats.flatMap(s => s.list.map(p => {
            const sc = scoreOf(p); return (
              <CircleMarker key={p.id} center={jitter(s.coords, p.id)} radius={5} pathOptions={{ color: sc.color, weight: 1, fillColor: sc.color, fillOpacity: .9 }}>
                <Popup><div style={{ minWidth: 170 }}><div style={{ font: "700 13px var(--nc-font)" }}>{p.companyName}</div><div style={{ color: "var(--nc-text-2)", margin: "2px 0 8px" }}>{sc.label} fit · {sc.score}/100<br />{p.vertical || "No industry"}</div><Btn size="sm" variant="primary" onClick={() => onOpen(p)}>Open</Btn></div></Popup>
              </CircleMarker>);
          }))}
        </MapContainer>
        <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 400, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["hot", "strong", "possible", "low"].map(t => <span key={t} className="nc-chip" style={{ background: "rgba(11,20,38,.85)", color: TIERS[t].color, borderColor: `${TIERS[t].color}55` }}>● {TIERS[t].label}</span>)}
        </div>
      </div>

      <div className="nc-card" style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ font: "800 13px var(--nc-font)" }}>Territories</div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", font: "500 11.5px var(--nc-font)", color: "var(--nc-text-2)", cursor: "pointer" }}>
            <input type="checkbox" className="nc-check" checked={pins} onChange={e => setPins(e.target.checked)} />Show each prospect
          </label>
        </div>
        <div style={{ display: "grid", gap: 4, maxHeight: 470, overflowY: "auto" }}>
          {stats.map(s => (
            <button key={s.place} type="button" className="nc-menu-item" style={{ display: "block", padding: "9px 10px" }} onClick={() => setFocus(s.coords)}>
              <div style={{ display: "flex", justifyContent: "space-between", font: "700 12.5px var(--nc-font)" }}><span>{s.place}</span><span>{s.n}</span></div>
              <div className="nc-bar" style={{ margin: "6px 0 5px" }}><i style={{ width: `${(s.n / max) * 100}%`, background: TIERS[s.tier].color }} /></div>
              <div style={{ font: "500 11px var(--nc-font)", color: "var(--nc-text-3)" }}>avg fit {s.avg} · {s.hot} hot/strong · {s.ready} ready</div>
            </button>
          ))}
        </div>
        {unplaced > 0 && <div style={{ marginTop: 10, font: "500 11.5px/1.45 var(--nc-font)", color: "var(--nc-amber)" }}>{unplaced} prospect{unplaced === 1 ? "" : "s"} can't be placed (no recognised market/city).</div>}
      </div>
    </div>
  );
}

export { placeOf };
