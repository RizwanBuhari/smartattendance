// A compact "location" card showing a real OpenStreetMap preview (Leaflet) of a
// single site, with its marker and geofence circle. One card is rendered per
// location on the Locations page.
//
// Adapted for this project's stack (Vite + React 19 + plain JSX, no Tailwind /
// shadcn): all styling uses inline styles driven by the Elsewedy design tokens
// in index.css (--panel, --line, --ink, --muted) with the brand red accent.
//
// The embedded map is intentionally NON-interactive (no drag / zoom) so it reads
// as a preview. Tiles come from OpenStreetMap (no API key). Attribution is shown
// once under the grid on the page, so per-card attribution is disabled to keep
// the small cards clean.
//
// NOTE: the card uses only a flat 2D hover lift — NOT a 3D tilt. Leaflet renders
// its tile panes with translate3d, and a `preserve-3d` / `perspective` parent
// pushes those tiles off the visible plane, so the map would show up blank.
import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Elsewedy brand accent (replaces the original emerald).
const ACCENT = '#ce1b28'

// A small teardrop pin as an SVG divIcon, tip anchored on the coordinate.
function pinIcon(color) {
  const html = `<svg width="24" height="34" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.27 21.73 0 14 0z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
    <circle cx="14" cy="14" r="5.5" fill="#ffffff"/>
  </svg>`
  return L.divIcon({
    html,
    className: 'loc-card-pin',
    iconSize: [24, 34],
    iconAnchor: [12, 34],
  })
}

export default function LocationCard({
  name = 'Location',
  latitude,
  longitude,
  radiusMeters,
  coordinates = '',
  onOpen,
  className = '',
}) {
  const mapElRef = useRef(null) // the Leaflet mount point
  const mapRef = useRef(null)
  const layerRef = useRef(null)

  const lat = Number(latitude)
  const lng = Number(longitude)
  const radius = Number(radiusMeters)
  const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lng)

  // Create the (non-interactive) map once. Guarded so a Leaflet failure or the
  // React StrictMode double-invoke of effects can never throw up to React (which
  // would unmount the whole app and blank the page).
  useEffect(() => {
    const el = mapElRef.current
    if (!el || mapRef.current) return

    let map
    try {
      map = L.map(el, {
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        zoomControl: false,
        attributionControl: false, // credited once beneath the grid instead
      })
      // A view MUST be set before adding layers, otherwise Leaflet has no
      // projection origin yet and throws (layerPointToLatLng of undefined),
      // leaving the map grey with no tiles. The draw effect refines this below.
      map.setView(hasCoords ? [lat, lng] : [25.2048, 55.2708], 13)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map)
    } catch (err) {
      console.error('LocationCard: map init failed', err)
      return
    }
    mapRef.current = map

    // Remeasure after layout settles (the page has an entrance animation, and
    // tiles can mount before the card reaches its final size).
    const timers = [0, 250, 600].map((ms) =>
      setTimeout(() => {
        if (mapRef.current) mapRef.current.invalidateSize()
      }, ms),
    )

    return () => {
      timers.forEach(clearTimeout)
      try {
        map.remove()
      } catch {
        /* already torn down */
      }
      mapRef.current = null
      layerRef.current = null
    }
    // Intentionally created once; the draw effect below re-frames on coord change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Draw / redraw the pin + geofence and frame the view when coords change.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    try {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
      if (!hasCoords) {
        map.setView([25.2048, 55.2708], 10) // Dubai fallback
        return
      }

      const group = L.layerGroup()
      L.marker([lat, lng], { icon: pinIcon(ACCENT) }).addTo(group)

      if (Number.isFinite(radius) && radius > 0) {
        const circle = L.circle([lat, lng], {
          radius,
          color: ACCENT,
          weight: 2,
          fillColor: ACCENT,
          fillOpacity: 0.12,
        }).addTo(group)
        group.addTo(map)
        layerRef.current = group
        map.fitBounds(circle.getBounds(), { padding: [16, 16], maxZoom: 17 })
      } else {
        group.addTo(map)
        layerRef.current = group
        map.setView([lat, lng], 15)
      }
    } catch (err) {
      console.error('LocationCard: draw failed', err)
    }
  }, [lat, lng, radius, hasCoords])

  return (
    <motion.div
      className={className}
      style={{
        position: 'relative',
        userSelect: 'none',
        width: '100%',
        cursor: onOpen ? 'pointer' : 'default',
      }}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (onOpen && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 16,
          height: 190,
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          boxShadow: '0 6px 20px rgba(33, 33, 33, 0.06)',
        }}
      >
        {/* Real OpenStreetMap tiles */}
        <div ref={mapElRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />

        {/* Legibility scrim so the overlaid text reads over the map */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            pointerEvents: 'none',
            background:
              'linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.12) 45%, rgba(0,0,0,0) 70%)',
          }}
        />

        {/* Overlay content */}
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: 14,
            pointerEvents: 'none',
          }}
        >
          {/* Top row: map glyph + Live pill */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <span
              style={{
                display: 'inline-flex',
                width: 26,
                height: 26,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.9)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
              }}
            >
              <svg
                width="15" height="15" viewBox="0 0 24 24" fill="none"
                stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
                <line x1="9" x2="9" y1="3" y2="18" />
                <line x1="15" x2="15" y1="6" y2="21" />
              </svg>
            </span>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.9)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 999, background: ACCENT }} />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--ink)',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                Live
              </span>
            </div>
          </div>

          {/* Bottom: name + coords + accent underline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h3
              style={{
                color: '#fff',
                fontWeight: 600,
                fontSize: 15,
                letterSpacing: '-0.01em',
                margin: 0,
                textShadow: '0 1px 3px rgba(0,0,0,0.5)',
              }}
            >
              {name}
            </h3>
            {coordinates && (
              <p
                style={{
                  color: 'rgba(255,255,255,0.85)',
                  fontSize: 11,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  margin: 0,
                  textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                }}
              >
                {coordinates}
              </p>
            )}
            <motion.div
              style={{
                height: 2,
                borderRadius: 2,
                background: `linear-gradient(to right, ${ACCENT}, rgba(206,27,40,0.4), transparent)`,
                originX: 0,
              }}
              initial={{ scaleX: 0.3 }}
              whileHover={{ scaleX: 1 }}
              animate={{ scaleX: 0.4 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  )
}
