import { useEffect, useState } from 'react'
import {
  createLocation,
  updateLocation,
  deleteLocation,
} from '../services/locationsService'
import { subscribeCollection } from '../services/realtime'
import PageLoader from '../components/PageLoader'
import Spinner from '../components/Spinner'
import PageHead from '../components/PageHead'
import { Icon } from '../components/icons'
import LocationCard from '../components/LocationCard'
import LocationMap from '../components/LocationMap'
import ErrorBoundary from '../components/ErrorBoundary'
import { useConfirm } from '../components/ConfirmProvider'

// Format lat/long for a card, e.g. "25.1331° N, 55.3874° E".
function formatCoords(loc) {
  if (loc == null) return ''
  const lat = Number(loc.latitude)
  const lng = Number(loc.longitude)
  if (Number.isNaN(lat) || Number.isNaN(lng)) return ''
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`
}

const emptyLoc = { name: '', latitude: '', longitude: '', radiusMeters: '' }

// True if lat/lng/radius are all valid numbers.
function numbersValid(loc) {
  return ![loc.latitude, loc.longitude, loc.radiusMeters].some(Number.isNaN)
}

export default function LocationsPage() {
  const confirm = useConfirm()
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Which location's detail view is open (null = the card grid).
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(emptyLoc)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // "New location" form state.
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(emptyLoc)
  const [creating, setCreating] = useState(false)
  // Inline validation message (shown near the form, not a browser alert).
  const [formError, setFormError] = useState('')

  const NUMBERS_MSG = 'Latitude, longitude, and radius must be valid numbers.'

  // Realtime: the locations stream from Firestore and update on their own.
  useEffect(() => {
    const unsubscribe = subscribeCollection(
      'locations_ids',
      (data) => {
        setLocations(data)
        setError(false)
        setLoading(false)
      },
      () => {
        setError(true)
        setLoading(false)
      },
    )
    return unsubscribe
  }, [])

  const selected = locations.find((l) => l.id === selectedId) || null

  // --- Create ---
  async function handleCreate(e) {
    e.preventDefault()
    const loc = {
      name: form.name.trim(),
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      radiusMeters: Number(form.radiusMeters),
    }
    if (!numbersValid(loc)) {
      setFormError(NUMBERS_MSG)
      return
    }
    setFormError('')
    setCreating(true)
    try {
      await createLocation(loc) // realtime listener adds it to the grid
      setForm(emptyLoc)
      setShowCreate(false)
    } finally {
      setCreating(false)
    }
  }

  // --- Open / close the detail view ---
  function openDetail(l) {
    setSelectedId(l.id)
    setDraft({
      name: l.name ?? '',
      latitude: l.latitude,
      longitude: l.longitude,
      radiusMeters: l.radiusMeters,
      type: l.type ?? 'office',
    })
  }

  function closeDetail() {
    setSelectedId(null)
  }

  // --- Save edits from the detail view ---
  async function saveDetail() {
    const changes = {
      name: draft.name.trim(),
      latitude: Number(draft.latitude),
      longitude: Number(draft.longitude),
      radiusMeters: Number(draft.radiusMeters),
      type: draft.type === 'site' ? 'site' : 'office',
    }
    if (!numbersValid(changes)) {
      setFormError(NUMBERS_MSG)
      return
    }
    setFormError('')
    setSaving(true)
    try {
      await updateLocation(selectedId, changes) // realtime reflects the edit
    } finally {
      setSaving(false)
    }
  }

  // --- Delete from the detail view ---
  async function removeSelected() {
    if (!selected) return
    const ok = await confirm({
      title: `Delete "${selected.name}"?`,
      message: `Employees approved only for this location will lose their site. This can't be undone.`,
      confirmText: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    setDeleting(true)
    try {
      await deleteLocation(selected.id)
      closeDetail() // back to the grid; realtime removes the card
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <PageLoader />
  if (error)
    return (
      <div className="error">
        Couldn't load live data. If this persists, your Firestore security rules
        may be blocking reads — publish firestore.rules (Firebase Console →
        Firestore → Rules).
      </div>
    )

  // ---------- Detail view: real interactive map + edit / delete ----------
  if (selected) {
    return (
      <div className="reveal">
        <PageHead
          icon={Icon.mapPin}
          title={selected.name || 'Location'}
          tone="good"
          hint="Pan and zoom the map to inspect the approved area. Edit the details below or delete this site."
          action={
            <button className="btn-sm" onClick={closeDetail}>
              ← Back to locations
            </button>
          }
        />

        <ErrorBoundary
          fallback={<div className="error">Couldn't render the map.</div>}
        >
          <LocationMap locations={[selected]} siteMarkers height={440} />
        </ErrorBoundary>

        <form
          className="create-card"
          onSubmit={(e) => {
            e.preventDefault()
            saveDetail()
          }}
        >
          {formError && <div className="error">{formError}</div>}
          <div className="create-grid">
            <label>
              Name
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
              />
            </label>
            <label>
              Latitude
              <input
                type="number"
                step="any"
                value={draft.latitude}
                onChange={(e) => setDraft({ ...draft, latitude: e.target.value })}
                required
              />
            </label>
            <label>
              Longitude
              <input
                type="number"
                step="any"
                value={draft.longitude}
                onChange={(e) =>
                  setDraft({ ...draft, longitude: e.target.value })
                }
                required
              />
            </label>
            <label>
              Radius (m)
              <input
                type="number"
                step="any"
                value={draft.radiusMeters}
                onChange={(e) =>
                  setDraft({ ...draft, radiusMeters: e.target.value })
                }
                required
              />
            </label>
            <label>
              Type
              {/* Drives how strict check-in is here. A 'site' additionally
                  requires a QR code scanned from a site admin; an 'office'
                  is geofence-only, which is the original behaviour. */}
              <select
                value={draft.type ?? 'office'}
                onChange={(e) => setDraft({ ...draft, type: e.target.value })}
              >
                <option value="office">Office — geofence only</option>
                <option value="site">Site — geofence + QR approval</option>
              </select>
            </label>
          </div>

          <div className="row-actions">
            <button
              className="btn-sm btn-sm-primary"
              type="submit"
              disabled={saving || deleting}
            >
              {saving ? (
                <>
                  <Spinner light /> Saving…
                </>
              ) : (
                'Save changes'
              )}
            </button>
            <button
              className="btn-sm btn-sm-danger"
              type="button"
              onClick={removeSelected}
              disabled={saving || deleting}
            >
              {deleting ? (
                <>
                  <Spinner light /> Deleting…
                </>
              ) : (
                'Delete location'
              )}
            </button>
          </div>
        </form>
      </div>
    )
  }

  // ---------- Grid view: cards only ----------
  return (
    <div className="reveal">
      <PageHead
        icon={Icon.mapPin}
        title="Locations"
        tone="good"
        hint="Approved work areas. Click a card to open its map and edit or delete the site."
        action={
          <button
            className="btn-sm btn-sm-primary"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? 'Close' : '+ New location'}
          </button>
        }
      />

      {showCreate && (
        <form className="create-card" onSubmit={handleCreate}>
          {formError && <div className="error">{formError}</div>}
          <div className="create-grid">
            <label>
              Name
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Dubai Head Office"
                required
                autoFocus
              />
            </label>
            <label>
              Latitude
              <input
                type="number"
                step="any"
                value={form.latitude}
                onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                placeholder="e.g. 25.133093"
                required
              />
            </label>
            <label>
              Longitude
              <input
                type="number"
                step="any"
                value={form.longitude}
                onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                placeholder="e.g. 55.387385"
                required
              />
            </label>
            <label>
              Radius (m)
              <input
                type="number"
                step="any"
                value={form.radiusMeters}
                onChange={(e) =>
                  setForm({ ...form, radiusMeters: e.target.value })
                }
                placeholder="e.g. 150"
                required
              />
            </label>
          </div>

          <div className="row-actions">
            <button
              className="btn-sm btn-sm-primary"
              type="submit"
              disabled={creating}
            >
              {creating ? (
                <>
                  <Spinner light /> Creating…
                </>
              ) : (
                'Create location'
              )}
            </button>
            <button
              className="btn-sm"
              type="button"
              onClick={() => setShowCreate(false)}
              disabled={creating}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {locations.length === 0 ? (
        <p className="filter-empty">
          No locations yet. Add one with “+ New location”.
        </p>
      ) : (
        <ErrorBoundary>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 16,
              marginBottom: 8,
            }}
          >
            {locations.map((l) => (
              <LocationCard
                key={l.id}
                name={l.name}
                latitude={l.latitude}
                longitude={l.longitude}
                radiusMeters={l.radiusMeters}
                coordinates={formatCoords(l)}
                onOpen={() => openDetail(l)}
              />
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 20px' }}>
            Maps © OpenStreetMap contributors
          </p>
        </ErrorBoundary>
      )}
    </div>
  )
}
