/* Map of the finder's SEARCH RESULTS (before anything is saved), so a business can be checked — including its street view —
   before it is added. Only places with exact coordinates (OpenStreetMap listings) can be pinned. */
import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { cssColor, useTheme } from "../../ui/theme.js";
import { validCoords, locationLinks } from "../../lib/maps.js";

const US_CENTER = [39.5, -98.35];
function Fit({ points }){
  const map = useMap();
  useEffect(() => {
    if (!points.length){ map.setView(US_CENTER, 4); return; }
    if (points.length === 1){ map.setView(points[0], 16); return; }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.map(p => p.join(",")).join("|")]);
  return null;
}

export default function ResultsMap({ rows, selected, idFor, onToggle }){
  useTheme();                                   // re-resolve marker colours when the theme changes
  const placed = useMemo(() => rows.filter(r => validCoords(r.latitude, r.longitude)), [rows]);
  const unplaced = rows.length - placed.length;
  return (
    <div className="nc" aria-label="Map of search results">
      <div className="nc-card" style={{ overflow: "hidden" }}>
        <MapContainer center={US_CENTER} zoom={4} style={{ height: 520, width: "100%" }} scrollWheelZoom>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
          <Fit points={placed.map(r => [Number(r.latitude), Number(r.longitude)])} />
          {placed.map(r => {
            const key = idFor(r), sel = selected.includes(key), links = locationLinks(r);
            const color = cssColor(r.already ? "var(--k-text3)" : (r.fit?.color || "var(--k-gold)"));
            return (
              <CircleMarker key={key} center={[Number(r.latitude), Number(r.longitude)]} radius={sel ? 11 : 8}
                pathOptions={{ color: sel ? cssColor("var(--k-gold)") : color, weight: sel ? 4 : 2, fillColor: color, fillOpacity: .85 }}>
                <Popup>
                  <div style={{ minWidth: 210, font: "500 13px var(--nc-font)" }}>
                    <div style={{ font: "700 14px var(--nc-font)" }}>{r.companyName}</div>
                    {r.streetAddress && <div style={{ margin: "2px 0" }}>{r.streetAddress}</div>}
                    <div style={{ color: "var(--nc-text-2)", margin: "2px 0 10px" }}>
                      {r.fit ? `${r.fit.label} fit · ${r.fit.score}/100` : ""}{r.distanceMiles != null ? ` · ${r.distanceMiles} mi away` : ""}
                      {r.already ? " · already in your CRM" : r.match ? " · possible match in your CRM" : ""}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <a className="nc-btn ghost sm" href={links.streetView} target="_blank" rel="noopener noreferrer">Street View</a>
                      <a className="nc-btn ghost sm" href={links.map} target="_blank" rel="noopener noreferrer">Open in Maps</a>
                      <button type="button" className="nc-btn primary sm" disabled={r.already} onClick={() => onToggle(key)}>{sel ? "Selected ✓ (remove)" : "Select"}</button>
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
      <p className="td-muted" style={{ margin: "8px 2px 0" }}>
        {placed.length} of {rows.length} result{rows.length === 1 ? "" : "s"} {placed.length === 1 ? "has" : "have"} an exact location.
        {unplaced > 0 && " Nonprofit directory listings only give a city, so they appear in the list but not as pins."} Street View opens Google Maps in a new tab.
      </p>
    </div>
  );
}
