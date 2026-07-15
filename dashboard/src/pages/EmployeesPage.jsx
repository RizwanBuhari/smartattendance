import { useCallback, useEffect, useState } from 'react'
import {
  getEmployees,
  createEmployee,
  deleteEmployee,
  createInvite,
  getCompanyCodes,
  deleteCompanyCode,
  setEmployeeLocations,
  setEmployeeStatus,
} from '../services/employeesService'
import { getLocations } from '../services/locationsService'
import { downloadEmployeeReport } from '../services/reportService'
import { useAutoRefresh } from '../utils/useAutoRefresh'
import Spinner from '../components/Spinner'
import PageLoader from '../components/PageLoader'

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text)
}

export default function EmployeesPage() {
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

  // Per-row report download: which employee's daily/monthly/yearly picker is
  // open, and which employee's report (if any) is currently being generated.
  const [reportMenuId, setReportMenuId] = useState(null)
  const [reportBusyId, setReportBusyId] = useState(null)

  const load = useCallback(async () => {
    try {
      const [emps, locs, codes] = await Promise.all([
        getEmployees(),
        getLocations(),
        getCompanyCodes(),
      ])
      setEmployees(emps)
      setLocations(locs)
      setCompanyCodes(codes)
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  // Keep the table in sync with the database (on focus + periodically), so a
  // deleted employee/code disappears without a manual refresh.
  useAutoRefresh(load)

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
    setBusy(`gen:${emp.id}`)
    try {
      const res = await createInvite(emp.id)
      // Replace any previous unused code for this employee with the new one.
      setCompanyCodes((prev) => [
        ...prev.filter((c) => !(c.employeeId === emp.id && !c.used)),
        { id: res.id, employeeId: emp.id, code: res.code, used: false },
      ])
    } finally {
      setBusy(null)
    }
  }

  // --- Report ---
  async function handleDownloadReport(emp, period) {
    setReportBusyId(emp.id)
    try {
      await downloadEmployeeReport(emp, period)
      setReportMenuId(null)
    } catch (err) {
      console.error('Report generation failed:', err)
      window.alert(
        `Couldn't generate the report: ${err?.message ?? err}. Make sure the backend is running.`,
      )
    } finally {
      setReportBusyId(null)
    }
  }

  async function generateStandalone() {
    setBusy('gennew')
    try {
      const res = await createInvite() // no employee — for a brand-new user
      setCompanyCodes((prev) => [
        ...prev,
        { id: res.id, employeeId: null, code: res.code, used: false },
      ])
    } finally {
      setBusy(null)
    }
  }

  async function removeCode(c) {
    if (!window.confirm(`Remove code ${c.code}? This can't be undone.`)) return
    setBusy(`code:${c.id}`)
    try {
      await deleteCompanyCode(c.id)
      setCompanyCodes((prev) => prev.filter((x) => x.id !== c.id))
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

  // --- Delete ---
  async function removeEmployee(emp) {
    if (
      !window.confirm(
        `Delete ${emp.name}? This removes their record and invite codes. This can't be undone.`,
      )
    )
      return
    setBusy(`del:${emp.id}`)
    try {
      await deleteEmployee(emp.id)
      setEmployees((prev) => prev.filter((e) => e.id !== emp.id))
      setCompanyCodes((prev) => prev.filter((c) => c.employeeId !== emp.id))
    } finally {
      setBusy(null)
    }
  }

  // --- Enable / disable ---
  async function toggleStatus(emp) {
    setBusy(`status:${emp.id}`)
    try {
      const next = emp.status === 'active' ? 'disabled' : 'active'
      await setEmployeeStatus(emp.id, next)
      setEmployees((prev) =>
        prev.map((e) => (e.id === emp.id ? { ...e, status: next } : e)),
      )
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <PageLoader />
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
                          onClick={() =>
                            setReportMenuId((id) => (id === e.id ? null : e.id))
                          }
                          disabled={reportBusyId === e.id}
                        >
                          {reportBusyId === e.id ? (
                            <>
                              <Spinner /> Report…
                            </>
                          ) : (
                            '⬇ Report'
                          )}
                        </button>
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
                  {editingId !== e.id &&
                    reportMenuId === e.id &&
                    reportBusyId !== e.id && (
                      <div className="report-inline">
                        <span className="report-menu-label">Report period</span>
                        <button
                          className="btn-sm"
                          onClick={() => handleDownloadReport(e, 'daily')}
                        >
                          Daily
                        </button>
                        <button
                          className="btn-sm"
                          onClick={() => handleDownloadReport(e, 'monthly')}
                        >
                          Monthly
                        </button>
                        <button
                          className="btn-sm"
                          onClick={() => handleDownloadReport(e, 'yearly')}
                        >
                          Yearly
                        </button>
                      </div>
                    )}
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
