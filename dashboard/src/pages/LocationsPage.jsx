import { useEffect, useState } from 'react'
import {
  createLocation,
  updateLocation,
  deleteLocation,
} from '../services/locationsService'
import { subscribeCollection } from '../services/realtime'
import PageLoader from '../components/PageLoader'
import Spinner from '../components/Spinner'
import LocationMap from '../components/LocationMap'
import { useConfirm } from '../components/ConfirmProvider'

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

  // Inline edit state.
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(emptyLoc)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  // "New location" form state.
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(emptyLoc)
  const [creating, setCreating] = useState(false)

  // Realtime: the locations table streams from Firestore and updates on its own.
  useEffect(() => {
    const unsubscribe = subscribeCollection(
      'locations',
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
      window.alert('Latitude, longitude, and radius must be valid numbers.')
      return
    }
    setCreating(true)
    try {
      await createLocation(loc) // realtime listener adds it to the table
      setForm(emptyLoc)
      setShowCreate(false)
    } finally {
      setCreating(false)
    }
  }

  // --- Edit ---
  function startEdit(l) {
    setEditingId(l.id)
    setDraft({
      name: l.name ?? '',
      latitude: l.latitude,
      longitude: l.longitude,
      radiusMeters: l.radiusMeters,
    })
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(id) {
    const changes = {
      name: draft.name.trim(),
      latitude: Number(draft.latitude),
      longitude: Number(draft.longitude),
      radiusMeters: Number(draft.radiusMeters),
    }
    if (!numbersValid(changes)) {
      window.alert('Latitude, longitude, and radius must be valid numbers.')
      return
    }
    setSaving(true)
    try {
      await updateLocation(id, changes) // realtime listener reflects the edit
      cancelEdit()
    } finally {
      setSaving(false)
    }
  }

  // --- Delete ---
  async function removeLocation(l) {
    const ok = await confirm({
      title: `Delete "${l.name}"?`,
      message: `Employees approved only for this location will lose their site. This can't be undone.`,
      confirmText: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    setDeletingId(l.id)
    try {
      await deleteLocation(l.id) // realtime listener removes the row
    } finally {
      setDeletingId(null)
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

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Locations</h1>
        <button
          className="btn-sm btn-sm-primary"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? 'Close' : '+ New location'}
        </button>
      </div>
      <p className="page-hint">
        Approved work areas. Add, edit, or remove a site — changes save to the
        database and the mobile geofence uses them immediately.
      </p>

      {showCreate && (
        <form className="create-card" onSubmit={handleCreate}>
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

      {locations.length > 0 && (
        <LocationMap locations={locations} siteMarkers height={420} />
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Radius (m)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {locations.length === 0 && (
              <tr>
                <td colSpan={5} className="filter-empty">
                  No locations yet. Add one with “+ New location”.
                </td>
              </tr>
            )}
            {locations.map((l) =>
              editingId === l.id ? (
                <tr key={l.id}>
                  <td>
                    <input
                      className="loc-input"
                      type="text"
                      value={draft.name}
                      onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="loc-input"
                      type="number"
                      step="any"
                      value={draft.latitude}
                      onChange={(e) =>
                        setDraft({ ...draft, latitude: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="loc-input"
                      type="number"
                      step="any"
                      value={draft.longitude}
                      onChange={(e) =>
                        setDraft({ ...draft, longitude: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="loc-input"
                      type="number"
                      step="any"
                      value={draft.radiusMeters}
                      onChange={(e) =>
                        setDraft({ ...draft, radiusMeters: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn-sm btn-sm-primary"
                        onClick={() => saveEdit(l.id)}
                        disabled={saving}
                      >
                        {saving ? (
                          <>
                            <Spinner light /> Saving…
                          </>
                        ) : (
                          'Save'
                        )}
                      </button>
                      <button
                        className="btn-sm"
                        onClick={cancelEdit}
                        disabled={saving}
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td>{l.latitude}</td>
                  <td>{l.longitude}</td>
                  <td>{l.radiusMeters}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-sm" onClick={() => startEdit(l)}>
                        Edit
                      </button>
                      <button
                        className="btn-sm btn-sm-danger"
                        onClick={() => removeLocation(l)}
                        disabled={deletingId === l.id}
                      >
                        {deletingId === l.id ? <Spinner /> : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
