import { useEffect, useState } from 'react'
import {
  createEmployee,
  deleteEmployee,
  createInvite,
  deleteCompanyCode,
  reactivateCompanyCode,
  setEmployeeLocations,
  setEmployeeStatus,
  setEmployeeRole,
  updateEmployeeSupervisor,
} from '../services/employeesService'
import { subscribeCollection } from '../services/realtime'
import Spinner from '../components/Spinner'
import PageLoader from '../components/PageLoader'
import PageHead from '../components/PageHead'
import { Icon } from '../components/icons'
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
  const [form, setForm] = useState({
    name: '',
    email: '',
    locationIds: [],
    role: 'onsite_employee',
    supervisorId: '',
    supervisorName: '',
  })
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
      'employees_ids',
      (data) => {
        setEmployees(data)
        setError(false)
        setLoading(false)
      },
      onErr,
    )
    const unsubLocations = subscribeCollection(
      'locations_ids',
      (data) => setLocations(data),
      onErr,
    )
    const unsubCodes = subscribeCollection(
      'company_Codes',
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
    // Drop ids that no longer resolve to a live location. A deleted location can
    // linger in an employee's assignedLocationIds; showing the raw id there is
    // just noise, so hide it rather than fall back to printing it.
    const names = ids
      .map((id) => locations.find((l) => l.id === id)?.name)
      .filter(Boolean)
    return names.length ? names.join(', ') : '—'
  }

  // --- Create/Edit employee ---
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

    // Validations
    if ((form.role === 'site_supervisor' || form.role === 'siteAdmin') && form.locationIds.length === 0) {
      alert('A Site Supervisor must have at least one assigned worksite.')
      return;
    }
    if (form.role === 'offsite_employee' && !form.supervisorId) {
      alert('An Offsite Employee must have an assigned supervisor.')
      return
    }
    if (form.role === 'offsite_employee' && form.supervisorId === editingId) {
      alert('An employee cannot be assigned as their own supervisor.')
      return
    }
    const selectedSup = employees.find(x => x.id === form.supervisorId)
    if (selectedSup && selectedSup.status !== 'active') {
      alert('Cannot assign a disabled employee as supervisor.')
      return
    }

    setCreating(true)
    try {
      if (editingId) {
        // Edit mode
        await setEmployeeLocations(editingId, form.locationIds)
        await setEmployeeRole(editingId, form.role)
        await updateEmployeeSupervisor(
          editingId,
          form.role === 'offsite_employee' ? form.supervisorId : null,
          form.role === 'offsite_employee' ? form.supervisorName : null
        )
        setFlash({ ok: true, text: `Employee ${form.name} updated successfully.` })
      } else {
        // Create mode
        await createEmployee({
          name: form.name.trim(),
          email: form.email.trim(),
          status: 'active',
          assignedLocationIds: form.locationIds,
          role: form.role,
          supervisorId: form.role === 'offsite_employee' ? form.supervisorId : null,
          supervisorName: form.role === 'offsite_employee' ? form.supervisorName : null,
        })
        setFlash({ ok: true, text: `Employee ${form.name} created successfully.` })
      }
      setForm({ name: '', email: '', locationIds: [], role: 'onsite_employee', supervisorId: '', supervisorName: '' })
      setEditingId(null)
      setShowCreate(false)
    } catch (err) {
      setFlash({ ok: false, text: err.message || 'Operation failed.' })
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

  // --- Edit employee details ---
  function startEdit(emp) {
    setEditingId(emp.id)
    setForm({
      name: emp.name || '',
      email: emp.email || '',
      locationIds: emp.assignedLocationIds || [],
      role: emp.role || 'onsite_employee',
      supervisorId: emp.supervisorId || '',
      supervisorName: emp.supervisorName || '',
    })
    setShowCreate(true)
  }

  function cancelEdit() {
    setEditingId(null)
    setForm({ name: '', email: '', locationIds: [], role: 'onsite_employee', supervisorId: '', supervisorName: '' })
    setShowCreate(false)
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

  // Role changes are now audited and processed inside the main create/edit form.

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
    <div className="reveal">
      <PageHead
        icon={Icon.users}
        title="Employees"
        hint="Create employees, invite them with a single-use code, enable/disable them, and assign approved locations. Check-ins are only accepted at an employee's approved locations."
        action={
          <button
            className="btn-sm btn-sm-primary"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? 'Close' : '+ New employee'}
          </button>
        }
      />

      {flash && (
        <div className={`notice ${flash.ok ? 'notice-ok' : 'notice-warn'}`}>
          {flash.text}
        </div>
      )}

      {showCreate && (
        <form className="create-card" onSubmit={handleCreate}>
          <h3>{editingId ? 'Edit Employee Details' : 'Create New Employee'}</h3>
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
                disabled={!!editingId}
              />
            </label>
          </div>

          <div className="mobile-access-role-section">
            <h3>Mobile Access & Role</h3>
            <div className="create-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <label>
                Role
                <select
                  value={form.role || 'onsite_employee'}
                  onChange={(e) => {
                    const r = e.target.value
                    setForm({
                      ...form,
                      role: r,
                      supervisorId: r === 'offsite_employee' ? form.supervisorId : '',
                      supervisorName: r === 'offsite_employee' ? form.supervisorName : '',
                    })
                  }}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--line)', marginTop: '4px' }}
                >
                  <option value="onsite_employee">Onsite Employee</option>
                  <option value="offsite_employee">Offsite Employee</option>
                  <option value="site_supervisor">Site Supervisor</option>
                </select>
              </label>

              {form.role === 'offsite_employee' ? (
                <label>
                  Assigned Supervisor
                  <select
                    value={form.supervisorId || ''}
                    onChange={(e) => {
                      const selected = employees.find((x) => x.id === e.target.value)
                      setForm({
                        ...form,
                        supervisorId: e.target.value,
                        supervisorName: selected ? selected.name : '',
                      })
                    }}
                    required={form.role === 'offsite_employee'}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--line)', marginTop: '4px' }}
                  >
                    <option value="">Select Supervisor...</option>
                    {employees
                      .filter((x) => (x.role === 'site_supervisor' || x.role === 'siteAdmin') && x.status === 'active' && x.id !== editingId)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                </label>
              ) : (
                <div style={{ marginTop: '24px', fontSize: '13px', color: 'var(--muted)' }}>
                  Supervisor assignment only applicable for Offsite Employees.
                </div>
              )}
            </div>

            {/* Previews container */}
            <div className="previews-container">
              <div className="preview-box">
                <strong>Permission Preview</strong>
                <ul>
                  <li>✓ canUseOnsiteAttendance</li>
                  {form.role === 'offsite_employee' && <li>✓ canRequestOffsiteCheckIn</li>}
                  {form.role === 'siteAdmin' && <li>✓ canApproveOffsiteRequests</li>}
                  <li>✓ canViewNotifications</li>
                  <li>✓ canViewHistory</li>
                  <li>✓ canManageProfile</li>
                </ul>
              </div>
              <div className="preview-box">
                <strong>Mobile Bottom-Nav Preview</strong>
                <div className="navbar-preview" style={{ marginTop: '8px' }}>
                  <span>Home</span> | <span>History</span> |{' '}
                  {form.role === 'offsite_employee' && (
                    <span className="nav-highlight">Offsite</span>
                  )}
                  {form.role === 'siteAdmin' && (
                    <span className="nav-highlight">Approvals</span>
                  )}
                  {' '} | <span>Notifications</span> | <span>Profile</span>
                </div>
              </div>
            </div>
          </div>

          <div className="create-locs" style={{ marginTop: '20px' }}>
            <span className="create-locs-label">
              {form.role === 'siteAdmin' ? 'Assigned worksites (at least one required)' : 'Approved locations'}
            </span>
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
                  <Spinner light /> Saving…
                </>
              ) : (
                editingId ? 'Save changes' : 'Create employee'
              )}
            </button>
            <button
              className="btn-sm"
              type="button"
              onClick={cancelEdit}
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
              <th>Role</th>
              <th>Approved locations</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shownEmployees.length === 0 && (
              <tr>
                <td colSpan={6} className="filter-empty">
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
                  <span className={`badge badge-${e.role || 'onsite_employee'}`}>
                    {e.role === 'siteAdmin'
                      ? 'Site Admin'
                      : (e.role === 'offsite_employee' || e.role === 'site_employee')
                      ? 'Offsite Employee'
                      : 'Onsite Employee'}
                  </span>
                </td>
                <td>
                  {locationNames(e.assignedLocationIds)}
                  {(e.role === 'site_employee' || e.role === 'offsite_employee') && e.supervisorName && (
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                      Supervisor: {e.supervisorName}
                    </div>
                  )}
                </td>
                <td>
                  <div className="row-actions">
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
                      Edit Details
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
          <div className="empty-state">
            <span className="empty-icon">{Icon.inbox}</span>
            <p>
              No codes yet. Generate one for a new user above, or generate a
              code for an existing employee from the table.
            </p>
          </div>
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
