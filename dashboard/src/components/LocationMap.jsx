// A live, interactive Leaflet map for the Reports page — used two ways:
//   • mode="markers" — one coloured pin per location sample (green = inside the
//     approved area, red = outside), each with a popup.
//   • mode="heat"    — a density heat layer (green→red) via the leaflet.heat
//     plugin, so the busiest areas glow hottest.
//
// Tiles come from OpenStreetMap (no API key/billing). We use vector circle
// markers rather than image pins, so there are no marker-icon asset issues.
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// leaflet.heat augments the global L; expose it before the plugin is loaded.
if (typeof window !== 'undefined' && !window.L) window.L = L

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch])
}

// Dubai head office area — the default view until points load.
const DEFAULT_CENTER = [25.2048, 55.2708]

const PIN_INSIDE = '#2f9e44' // green — inside the approved area
const PIN_OUTSIDE = '#e03131' // red — outside

// A Google-Maps-style teardrop pin as an SVG divIcon, tinted by status. The
// anchor sits at the tip so the point marks the exact coordinate.
function pinIcon(color) {
  const html = `<svg width="28" height="40" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.27 21.73 0 14 0z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
    <circle cx="14" cy="14" r="5.5" fill="#ffffff"/>
  </svg>`
  return L.divIcon({
    html,
    className: 'map-pin',
    iconSize: [28, 40],
    iconAnchor: [14, 40],
    popupAnchor: [0, -34],
    tooltipAnchor: [0, -34],
  })
}

export default function LocationMap({
  points = [],
  locations = [],
  mode = 'markers',
  siteMarkers = false, // also drop a pin at each site's centre
  height = 460,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const sitesRef = useRef(null)

  // Create the map once.
  useEffect(() => {
    const map = L.map(containerRef.current, { scrollWheelZoom: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    map.setView(DEFAULT_CENTER, 10)
    mapRef.current = map
    // Tiles can render before layout settles; nudge Leaflet to remeasure.
    setTimeout(() => map.invalidateSize(), 0)
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
      sitesRef.current = null
    }
  }, [])

  // Draw / redraw the sample layer when the points or mode change.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let cancelled = false

    async function draw() {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
      if (!points.length) return

      if (mode === 'heat') {
        await import('leaflet.heat')
        if (cancelled || !mapRef.current) return
        const heat = L.heatLayer(
          points.map((p) => [p.lat, p.lng, 1]),
          { radius: 25, blur: 18, maxZoom: 17 },
        )
        heat.addTo(map)
        layerRef.current = heat
      } else {
        const group = L.layerGroup()
        for (const p of points) {
          const details = `<strong>${escapeHtml(p.employee)}</strong><br/>${escapeHtml(p.time)}<br/>${escapeHtml(p.location)}<br/>${p.inside ? 'Inside' : 'Outside'} · ${escapeHtml(p.source)}`
          L.marker([p.lat, p.lng], {
            icon: pinIcon(p.inside ? PIN_INSIDE : PIN_OUTSIDE),
          })
            // Hover shows a quick overview; click opens the same details.
            .bindTooltip(details, { direction: 'top' })
            .bindPopup(details)
            .addTo(group)
        }
        group.addTo(map)
        layerRef.current = group
      }
    }

    draw()
    return () => {
      cancelled = true
    }
  }, [points, mode])

  // Draw the admin's approved sites as geofence boundary outlines (no fill).
  // Kept in their own layer so they persist across point/mode changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (sitesRef.current) {
      map.removeLayer(sitesRef.current)
      sitesRef.current = null
    }
    const sites = locations.filter(
      (l) =>
        Number.isFinite(l.latitude) &&
        Number.isFinite(l.longitude) &&
        Number(l.radiusMeters) > 0,
    )
    if (!sites.length) return

    const group = L.layerGroup()
    for (const l of sites) {
      const radius = Number(l.radiusMeters)
      const label = `<strong>${escapeHtml(l.name)}</strong><br/>Approved area · ${radius} m radius<br/>${l.latitude}, ${l.longitude}`
      L.circle([l.latitude, l.longitude], {
        radius,
        color: '#1d4ed8',
        weight: 2,
        fill: false, // boundary only — no shaded interior
      })
        .bindTooltip(label, { direction: 'top', sticky: true })
        .bindPopup(label)
        .addTo(group)
      if (siteMarkers) {
        L.marker([l.latitude, l.longitude], { icon: pinIcon('#1d4ed8') })
          .bindTooltip(label, { direction: 'top' })
          .bindPopup(label)
          .addTo(group)
      }
    }
    group.addTo(map)
    sitesRef.current = group
  }, [locations, siteMarkers])

  // Frame the map to fit everything shown: samples + approved sites.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const coords = [
      ...points.map((p) => [p.lat, p.lng]),
      ...locations
        .filter((l) => Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
        .map((l) => [l.latitude, l.longitude]),
    ]
    if (!coords.length) return
    map.fitBounds(L.latLngBounds(coords), { padding: [40, 40], maxZoom: 16 })
  }, [points, locations])

  return <div ref={containerRef} className="report-map" style={{ height }} />
}
