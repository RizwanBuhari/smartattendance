import { useEffect, useState } from 'react'
import {
  getEmployees,
  createEmployee,
  createInvite,
  getCompanyCodes,
  deleteCompanyCode,
  setEmployeeLocations,
  setEmployeeStatus,
} from '../services/employeesService'
import { getLocations } from '../services/locationsService'

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text)
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([])
  const [locations, setLocations] = useState([])
  const [companyCodes, setCompanyCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Which employee's locations are being edited, and the in-progress selection.
  const [editingId, setEditingId] = useState(null)
  const [draftIds, setDraftIds] = useState([])
  const [saving, setSaving] = useState(false)

  // "New employee" form state.
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', locationIds: [] })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    Promise.all([getEmployees(), getLocations(), getCompanyCodes()])
      .then(([emps, locs, codes]) => {
        setEmployees(emps)
        setLocations(locs)
        setCompanyCodes(codes)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  // Reduce the company_codes collection to one status per employee:
  // 'used' (joined) wins over 'pending' (invite sent).
  const inviteStatusByEmployee = {}
  for (const c of companyCodes) {
    if (!c.employeeId) continue
    if (c.used) inviteStatusByEmployee[c.employeeId] = 'used'
    else if (inviteStatusByEmployee[c.employeeId] !== 'used') {
      inviteStatusByEmployee[c.employeeId] = 'pending'
    }
  }

  function employeeName(id) {
    return employees.find((e) => e.id === id)?.name
  }

  // Turn ['loc1'] into 'Dubai Head Office'.
  function locationNames(ids) {
    if (!ids?.length) return '—'
    return ids
      .map((id) => locations.find((l) => l.id === id)?.name ?? id)
      .join(', ')
  }

  // --- Create employee ---
  function toggleFormLocation(id) {
    setForm((f) => ({
      ...f,
      locationIds: f.locationIds.includes(id)
        ? f.locationIds.filter((x) => x !== id)
        : [...f.locationIds, id],
    }))
  }

  async function handleCreate(e) {
    e.preventDefault()
    setCreating(true)
    try {
      const created = await createEmployee({
        name: form.name.trim(),
        email: form.email.trim(),
        status: 'active',
        assignedLocationIds: form.locationIds,
      })
      setEmployees((prev) => [...prev, created])
      setForm({ name: '', email: '', locationIds: [] })
      setShowCreate(false)
    } finally {
      setCreating(false)
    }
  }

  // --- Codes ---
  async function generateForEmployee(emp) {
    const res = await createInvite(emp.id)
    // Replace any previous unused code for this employee with the new one.
    setCompanyCodes((prev) => [
      ...prev.filter((c) => !(c.employeeId === emp.id && !c.used)),
      { id: res.id, employeeId: emp.id, code: res.code, used: false },
    ])
  }

  async function generateStandalone() {
    const res = await createInvite() // no employee — for a brand-new user
    setCompanyCodes((prev) => [
      ...prev,
      { id: res.id, employeeId: null, code: res.code, used: false },
    ])
  }

  async function removeCode(c) {
    if (!window.confirm(`Remove code ${c.code}? This can't be undone.`)) return
    await deleteCompanyCode(c.id)
    setCompanyCodes((prev) => prev.filter((x) => x.id !== c.id))
  }

  // --- Edit approved locations ---
  function startEdit(emp) {
    setEditingId(emp.id)
    setDraftIds(emp.assignedLocationIds ?? [])
  }

  function cancelEdit() {
    setEditingId(null)
    setDraftIds([])
  }

  function toggleDraft(id) {
    setDraftIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  async function saveEdit(id) {
    setSaving(true)
    try {
      await setEmployeeLocations(id, draftIds)
      setEmployees((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, assignedLocationIds: draftIds } : e,
        ),
      )
      cancelEdit()
    } finally {
      setSaving(false)
    }
  }

  // --- Enable / disable ---
  async function toggleStatus(emp) {
    const next = emp.status === 'active' ? 'disabled' : 'active'
    await setEmployeeStatus(emp.id, next)
    setEmployees((prev) =>
      prev.map((e) => (e.id === emp.id ? { ...e, status: next } : e)),
    )
  }

  if (loading) return <p>Loading employees…</p>
  if (error)
    return (
      <div className="error">
        Couldn't reach the server. Make sure the backend is running on port 3000.
      </div>
    )

  // Unused codes first, so available codes are easy to find.
  const sortedCodes = [...companyCodes].sort((a, b) =>
    a.used === b.used ? 0 : a.used ? 1 : -1,
  )

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Employees</h1>
        <button
          className="btn-sm btn-sm-primary"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? 'Close' : '+ New employee'}
        </button>
      </div>
      <p className="page-hint">
        Create employees, invite them with a single-use code, enable/disable
        them, and assign approved locations. Check-ins are only accepted at an
        employee's approved locations.
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
                required
                autoFocus
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </label>
          </div>

          <div className="create-locs">
            <span className="create-locs-label">Approved locations</span>
            {locations.length === 0 ? (
              <span className="loc-empty">
                No locations yet — add one on the Locations page.
              </span>
            ) : (
              <div className="loc-picker">
                {locations.map((l) => (
                  <label key={l.id} className="loc-option">
                    <input
                      type="checkbox"
                      checked={form.locationIds.includes(l.id)}
                      onChange={() => toggleFormLocation(l.id)}
                    />
                    {l.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="row-actions">
            <button
              className="btn-sm btn-sm-primary"
              type="submit"
              disabled={creating}
            >
              {creating ? 'Creating…' : 'Create employee'}
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

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Approved locations</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{e.email}</td>
                <td>
                  <div className="status-cell">
                    <span className={`badge badge-${e.status}`}>{e.status}</span>
                    {inviteStatusByEmployee[e.id] === 'pending' && (
                      <span className="badge badge-late">invite sent</span>
                    )}
                    {inviteStatusByEmployee[e.id] === 'used' && (
                      <span className="badge badge-ontime">joined</span>
                    )}
                  </div>
                </td>
                <td>
                  {editingId === e.id ? (
                    <div className="loc-picker">
                      {locations.length === 0 ? (
                        <span className="loc-empty">
                          No locations yet — add one on the Locations page.
                        </span>
                      ) : (
                        locations.map((l) => (
                          <label key={l.id} className="loc-option">
                            <input
                              type="checkbox"
                              checked={draftIds.includes(l.id)}
                              onChange={() => toggleDraft(l.id)}
                            />
                            {l.name}
                          </label>
                        ))
                      )}
                    </div>
                  ) : (
                    locationNames(e.assignedLocationIds)
                  )}
                </td>
                <td>
                  <div className="row-actions">
                    {editingId === e.id ? (
                      <>
                        <button
                          className="btn-sm btn-sm-primary"
                          onClick={() => saveEdit(e.id)}
                          disabled={saving}
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          className="btn-sm"
                          onClick={cancelEdit}
                          disabled={saving}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn-sm"
                          onClick={() => generateForEmployee(e)}
                        >
                          {inviteStatusByEmployee[e.id] === 'pending'
                            ? 'Regenerate code'
                            : 'Generate code'}
                        </button>
                        <button className="btn-sm" onClick={() => startEdit(e)}>
                          Edit locations
                        </button>
                        <button
                          className="btn-sm"
                          onClick={() => toggleStatus(e)}
                        >
                          {e.status === 'active' ? 'Disable' : 'Enable'}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Access codes — persistent, so a generated code stays visible. */}
      <div className="panel codes-panel">
        <div className="panel-header">
          <h2 className="panel-title">Access codes</h2>
          <button className="btn-sm btn-sm-primary" onClick={generateStandalone}>
            + Generate code for new user
          </button>
        </div>
        {sortedCodes.length === 0 ? (
          <p className="empty-state">
            No codes yet. Generate one for a new user above, or generate a code
            for an existing employee from the table.
          </p>
        ) : (
          <ul className="code-list">
            {sortedCodes.map((c) => (
              <li
                key={c.id ?? c.code}
                className={`code-row${c.used ? ' code-used' : ''}`}
              >
                <span className="code-value">{c.code}</span>
                <span className="code-for">
                  {c.employeeId
                    ? (employeeName(c.employeeId) ?? 'Employee')
                    : 'New user'}
                </span>
                {c.used ? (
                  <span className="badge badge-checked_out">used</span>
                ) : (
                  <span className="badge badge-ontime">available</span>
                )}
                <div className="row-actions">
                  {!c.used && (
                    <button
                      className="btn-sm"
                      onClick={() => copyToClipboard(c.code)}
                    >
                      Copy
                    </button>
                  )}
                  <button
                    className="btn-sm btn-sm-danger"
                    onClick={() => removeCode(c)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
