import { useEffect, useState } from 'react'
import {
  createEmployee,
  deleteEmployee,
  createInvite,
  deleteCompanyCode,
  reactivateCompanyCode,
  setEmployeeLocations,
  setEmployeeStatus,
} from '../services/employeesService'
import { subscribeCollection } from '../services/realtime'
import Spinner from '../components/Spinner'
import PageLoader from '../components/PageLoader'
import { useConfirm } from '../components/ConfirmProvider'

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text)
}

export default function EmployeesPage() {
  const confirm = useConfirm()
  const [employees, setEmployees] = useState([])
  const [locations, setLocations] = useState([])
  const [companyCodes, setCompanyCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  // Key of the row/code action currently running (for its spinner), e.g.
  // `gen:<id>`, `gennew`, `status:<id>`, `del:<id>`, `code:<id>`.
  const [busy, setBusy] = useState(null)

  // Which employee's locations are being edited, and the in-progress selection.
  const [editingId, setEditingId] = useState(null)
  const [draftIds, setDraftIds] = useState([])
  const [saving, setSaving] = useState(false)

  // "New employee" form state.
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', locationIds: [] })
  const [creating, setCreating] = useState(false)

  // Transient banner after generating a code (e.g. "Code emailed to …").
  const [flash, setFlash] = useState(null)

  // Realtime: employees, locations, and access codes all stream from Firestore,
  // so the table and codes list update on their own after any change.
  useEffect(() => {
    const onErr = () => {
      setError(true)
      setLoading(false)
    }
    const unsubEmployees = subscribeCollection(
      'employees',
      (data) => {
        setEmployees(data)
        setError(false)
        setLoading(false)
      },
      onErr,
    )
    const unsubLocations = subscribeCollection(
      'locations',
      (data) => setLocations(data),
      onErr,
    )
    const unsubCodes = subscribeCollection(
      'company_codes',
      (data) => setCompanyCodes(data),
      onErr,
    )
    return () => {
      unsubEmployees()
      unsubLocations()
      unsubCodes()
    }
  }, [])

  // Auto-dismiss the flash banner a few seconds after it appears.
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 6000)
    return () => clearTimeout(t)
  }, [flash])

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
      // The realtime listener adds the new employee to the table on its own.
      await createEmployee({
        name: form.name.trim(),
        email: form.email.trim(),
        status: 'active',
        assignedLocationIds: form.locationIds,
      })
      setForm({ name: '', email: '', locationIds: [] })
      setShowCreate(false)
    } finally {
      setCreating(false)
    }
  }

  // --- Codes ---
  async function generateForEmployee(emp) {
    setBusy(`gen:${emp.id}`)
    try {
      // The new code appears in the list via the realtime listener.
      const res = await createInvite(emp.id)
      // Let the admin know whether the code was emailed to the employee.
      if (!emp.email) {
        setFlash({ ok: true, text: `Code generated for ${emp.name}.` })
      } else if (res.emailSent) {
        setFlash({ ok: true, text: `Code emailed to ${emp.email}.` })
      } else {
        setFlash({
          ok: false,
          text: `Code generated, but the email to ${emp.email} couldn't be sent — share it manually (check the backend's SMTP settings).`,
        })
      }
    } finally {
      setBusy(null)
    }
  }

  async function generateStandalone() {
    setBusy('gennew')
    try {
      // The realtime listener adds the new code to the list.
      await createInvite() // no employee — for a brand-new user
    } finally {
      setBusy(null)
    }
  }

  async function removeCode(c) {
    const ok = await confirm({
      title: 'Remove access code?',
      message: `Code ${c.code} will be permanently removed and can no longer be used. This can't be undone.`,
      confirmText: 'Remove code',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(`code:${c.id}`)
    try {
      await deleteCompanyCode(c.id)
    } finally {
      setBusy(null)
    }
  }

  // Re-enable a used code so the employee can enter it again — for someone who
  // entered their code (which consumes it) but never finished registering.
  async function reactivateCode(c) {
    const ok = await confirm({
      title: 'Reactivate this code?',
      message: `Code ${c.code} will become usable again so ${employeeName(c.employeeId) ?? 'the employee'} can re-enter it to register.`,
      confirmText: 'Reactivate',
    })
    if (!ok) return
    setBusy(`code:${c.id}`)
    try {
      await reactivateCompanyCode(c.id) // realtime listener flips the badge back
    } finally {
      setBusy(null)
    }
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
      cancelEdit() // the realtime listener reflects the new locations
    } finally {
      setSaving(false)
    }
  }

  // --- Delete ---
  async function removeEmployee(emp) {
    const ok = await confirm({
      title: `Delete ${emp.name}?`,
      message: `This permanently removes ${emp.name}'s record and any invite codes. This can't be undone.`,
      confirmText: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(`del:${emp.id}`)
    try {
      // The listeners drop the employee and their codes once Firestore updates.
      await deleteEmployee(emp.id)
    } finally {
      setBusy(null)
    }
  }

  // --- Enable / disable ---
  async function toggleStatus(emp) {
    const disabling = emp.status === 'active'
    // Disabling locks the employee out — confirm it. Re-enabling is harmless, so
    // it goes through without a prompt.
    if (disabling) {
      const ok = await confirm({
        title: `Disable ${emp.name}?`,
        message: `${emp.name} won't be able to check in or out until you re-enable them.`,
        confirmText: 'Disable',
        tone: 'danger',
      })
      if (!ok) return
    }
    setBusy(`status:${emp.id}`)
    try {
      const next = disabling ? 'disabled' : 'active'
      await setEmployeeStatus(emp.id, next) // realtime listener updates the badge
    } finally {
      setBusy(null)
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

  // Unused codes first, so available codes are easy to find.
  const sortedCodes = [...companyCodes].sort((a, b) =>
    a.used === b.used ? 0 : a.used ? 1 : -1,
  )

  const query = search.trim().toLowerCase()
  const shownEmployees = query
    ? employees.filter(
        (e) =>
          (e.name || '').toLowerCase().includes(query) ||
          (e.email || '').toLowerCase().includes(query),
      )
    : employees

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

      {flash && (
        <div className={`notice ${flash.ok ? 'notice-ok' : 'notice-warn'}`}>
          {flash.text}
        </div>
      )}

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
              {creating ? (
                <>
                  <Spinner light /> Creating…
                </>
              ) : (
                'Create employee'
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

      <div className="filter-bar">
        <div className="search-field">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search employees by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

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
            {shownEmployees.length === 0 && (
              <tr>
                <td colSpan={5} className="filter-empty">
                  {query
                    ? 'No employees match your search.'
                    : 'No employees yet.'}
                </td>
              </tr>
            )}
            {shownEmployees.map((e) => (
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
                      </>
                    ) : (
                      <>
                        <button
                          className="btn-sm"
                          onClick={() => generateForEmployee(e)}
                          disabled={busy === `gen:${e.id}`}
                        >
                          {busy === `gen:${e.id}` ? (
                            <Spinner />
                          ) : inviteStatusByEmployee[e.id] === 'pending' ? (
                            'Regenerate code'
                          ) : (
                            'Generate code'
                          )}
                        </button>
                        <button className="btn-sm" onClick={() => startEdit(e)}>
                          Edit locations
                        </button>
                        <button
                          className="btn-sm"
                          onClick={() => toggleStatus(e)}
                          disabled={busy === `status:${e.id}`}
                        >
                          {busy === `status:${e.id}` ? (
                            <Spinner />
                          ) : e.status === 'active' ? (
                            'Disable'
                          ) : (
                            'Enable'
                          )}
                        </button>
                        <button
                          className="btn-sm btn-sm-danger"
                          onClick={() => removeEmployee(e)}
                          disabled={busy === `del:${e.id}`}
                        >
                          {busy === `del:${e.id}` ? <Spinner /> : 'Delete'}
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
          <button
            className="btn-sm btn-sm-primary"
            onClick={generateStandalone}
            disabled={busy === 'gennew'}
          >
            {busy === 'gennew' ? (
              <Spinner light />
            ) : (
              '+ Generate code for new user'
            )}
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
                  {c.used ? (
                    <button
                      className="btn-sm"
                      onClick={() => reactivateCode(c)}
                      disabled={busy === `code:${c.id}`}
                    >
                      {busy === `code:${c.id}` ? <Spinner /> : 'Reactivate'}
                    </button>
                  ) : (
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
                    disabled={busy === `code:${c.id}`}
                  >
                    {busy === `code:${c.id}` ? <Spinner /> : 'Remove'}
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
