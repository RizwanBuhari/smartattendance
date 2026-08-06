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
  setEmployeeAttendanceMethod,
  updateEmployeeDetails,
  resetEmployeeBiometrics,
  resetEmployeeFaceBiometrics,
} from '../services/employeesService'
import { subscribeCollection } from '../services/realtime'
import Spinner from '../components/Spinner'
import PageLoader from '../components/PageLoader'
import PageHead from '../components/PageHead'
import { Icon } from '../components/icons'
import { useConfirm } from '../components/ConfirmProvider'
import { normalizeRole, roleLabel, isSupervisorRole, isSiteEmployeeRole } from '../utils/roles'

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
    role: 'office_employee',
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
    if (isSupervisorRole(form.role) && form.locationIds.length === 0) {
      alert('A Site Supervisor must have at least one assigned worksite.')
      return;
    }
    if (isSiteEmployeeRole(form.role) && !form.supervisorId) {
      alert('A Site employee must have an assigned supervisor.')
      return
    }
    if (isSiteEmployeeRole(form.role) && form.supervisorId === editingId) {
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
        // Edit mode (single atomic PATCH request)
        await updateEmployeeDetails(editingId, {
          assignedLocationIds: form.locationIds,
          role: form.role,
          attendanceMethod: form.attendanceMethod || 'geofence',
          supervisorId: isSiteEmployeeRole(form.role) ? form.supervisorId : null,
          supervisorName: isSiteEmployeeRole(form.role) ? form.supervisorName : null,
        })
        setFlash({ ok: true, text: `Employee ${form.name} updated successfully.` })
      } else {
        // Create mode
        await createEmployee({
          name: form.name.trim(),
          email: form.email.trim(),
          status: 'active',
          assignedLocationIds: form.locationIds,
          role: form.role,
          attendanceMethod: form.attendanceMethod || 'geofence',
          supervisorId: isSiteEmployeeRole(form.role) ? form.supervisorId : null,
          supervisorName: isSiteEmployeeRole(form.role) ? form.supervisorName : null,
        })
        setFlash({ ok: true, text: `Employee ${form.name} created successfully.` })
      }
      setForm({ name: '', email: '', locationIds: [], role: 'office_employee', supervisorId: '', supervisorName: '', attendanceMethod: 'geofence' })
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

  // --- Reset Biometrics ---
  async function resetBiometrics(emp) {
    const ok = await confirm({
      title: `Reset Biometric Setup for ${emp.name}?`,
      message: `This will clear ${emp.name}'s registered device binding (${emp.biometricDeviceName || 'mobile device'}). They will be required to complete biometric setup again on their phone.`,
      confirmText: 'Reset Setup',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(`bio:${emp.id}`)
    try {
      await resetEmployeeBiometrics(emp.id)
      setFlash({ ok: true, text: `Biometric setup reset for ${emp.name}.` })
    } catch (err) {
      setFlash({ ok: false, text: err.message || 'Failed to reset biometrics.' })
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
      // Normalize any legacy stored value to a canonical one so the form's
      // select (canonical values only) shows the right option.
      role: normalizeRole(emp.role),
      supervisorId: emp.supervisorId || '',
      supervisorName: emp.supervisorName || '',
      attendanceMethod: emp.attendanceMethod || 'geofence',
    })
    setShowCreate(true)
  }

  function cancelEdit() {
    setEditingId(null)
    setForm({ name: '', email: '', locationIds: [], role: 'office_employee', supervisorId: '', supervisorName: '', attendanceMethod: 'geofence' })
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

  // Requirement #3: supervisors/admins are shown in their OWN table, not mixed
  // in with normal staff. Classification uses normalizeRole so legacy values
  // (siteAdmin, onsite_/offsite_employee) land in the right group even before
  // the backend migration runs. The backend also enforces this via
  // GET /employees?scope=staff|supervisors.
  const staffEmployees = shownEmployees.filter((e) => !isSupervisorRole(e.role))
  const supervisorEmployees = shownEmployees.filter((e) => isSupervisorRole(e.role))

  // One row renderer shared by both tables.
  const renderEmployeeRow = (e) => (
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
        <span className={`badge badge-${normalizeRole(e.role)}`}>
          {roleLabel(e.role)}
        </span>
      </td>
      <td>
        {locationNames(e.assignedLocationIds)}
        {isSiteEmployeeRole(e.role) && e.supervisorName && (
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
            Supervisor: {e.supervisorName}
          </div>
        )}
      </td>
      <td>
        <div>
          <span className={`badge badge-${(e.attendanceMethod || 'geofence').replace(/_/g, '-')}`}>
            {e.attendanceMethod === 'fingerprint_geofence' || e.attendanceMethod === 'biometric_geofence'
              ? 'Fingerprint + Geofence'
              : e.attendanceMethod === 'fingerprint' || e.attendanceMethod === 'biometric'
              ? 'Fingerprint Only'
              : e.attendanceMethod === 'face'
              ? 'Face Recognition Only'
              : e.attendanceMethod === 'face_geofence'
              ? 'Face + Geofence'
              : e.attendanceMethod === 'supervisor_qr' || e.attendanceMethod === 'site_qr'
              ? 'Supervisor QR Code'
              : e.attendanceMethod === 'fingerprint_supervisor_qr' || e.attendanceMethod === 'biometric_qr'
              ? 'Fingerprint + Supervisor QR'
              : e.attendanceMethod === 'face_supervisor_qr'
              ? 'Face + Supervisor QR'
              : 'Geofence Only'}
          </span>
          {(e.attendanceMethod?.includes('fingerprint') || e.attendanceMethod?.includes('biometric')) && (
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
              FP: {e.biometricSetupCompleted ? `Active (${e.biometricDeviceName || 'Bound'})` : 'Pending Setup'}
            </div>
          )}
          {e.attendanceMethod?.includes('face') && (
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
              Face: {e.faceSetupCompleted ? `Active (${e.faceDeviceName || 'Bound'})` : 'Pending Setup'}
            </div>
          )}
        </div>
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
          {(e.biometricSetupCompleted || e.biometricDeviceId) && (
            <button
              className="btn-sm btn-sm-danger"
              onClick={() => resetBiometrics(e)}
              disabled={busy === `bio:${e.id}`}
              title="Reset fingerprint device setup"
            >
              {busy === `bio:${e.id}` ? <Spinner /> : 'Reset FP'}
            </button>
          )}
          {(e.faceSetupCompleted || e.faceDeviceId) && (
            <button
              className="btn-sm btn-sm-danger"
              onClick={async () => {
                if (!window.confirm(`Reset Face Recognition setup for ${e.name}? This will invalidate their local template.`)) return
                setBusy(`face:${e.id}`)
                try {
                  await resetEmployeeFaceBiometrics(e.id)
                } catch (err) {
                  alert(err.message || 'Failed to reset face setup.')
                } finally {
                  setBusy('')
                }
              }}
              disabled={busy === `face:${e.id}`}
              title="Reset face setup and increment template version"
            >
              {busy === `face:${e.id}` ? <Spinner /> : 'Reset Face'}
            </button>
          )}
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
  )

  // Renders a titled panel with the standard employee table for a given list.
  const renderEmployeeTable = (title, list, emptyText) => (
    <div className="panel shadow" style={{ marginBottom: '20px' }}>
      <div className="panel-header">
        <h2 className="panel-title">
          {title} <span className="badge badge-ontime">{list.length}</span>
        </h2>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Status</th>
            <th>Role</th>
            <th>Approved locations</th>
            <th>Method</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr>
              <td colSpan={7} className="filter-empty">
                {emptyText}
              </td>
            </tr>
          )}
          {list.map(renderEmployeeRow)}
        </tbody>
      </table>
    </div>
  )

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
                    const site = isSiteEmployeeRole(r)
                    setForm({
                      ...form,
                      role: r,
                      supervisorId: site ? form.supervisorId : '',
                      supervisorName: site ? form.supervisorName : '',
                    })
                  }}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--line)', marginTop: '4px' }}
                >
                  <option value="onsite_employee">Onsite Employee</option>
                  <option value="offsite_employee">Offsite Employee</option>
                  <option value="site_supervisor">Site Supervisor</option>
                </select>
              </label>

              <label>
                Authentication Policy
                <select
                  value={form.assignedAuthPolicy || form.attendanceMethod || 'geofence'}
                  onChange={(e) => setForm({ ...form, assignedAuthPolicy: e.target.value, attendanceMethod: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--line)', marginTop: '4px' }}
                >
                  <option value="geofence">Geofence Only</option>
                  <option value="strict_face">Strict Face Only (No Fallback)</option>
                  <option value="strict_fingerprint">Strict Fingerprint Only (No Fallback)</option>
                  <option value="face_preferred">Face Preferred (Fallback Allowed)</option>
                  <option value="fingerprint_preferred">Fingerprint Preferred (Fallback Allowed)</option>
                  <option value="any_biometric">Any Enrolled Biometric</option>
                  <option value="device_authentication">Device Authentication (Biometric or PIN)</option>
                  <option value="face_geofence">Face Preferred + Geofence</option>
                  <option value="fingerprint_geofence">Fingerprint Preferred + Geofence</option>
                  <option value="device_auth_geofence">Device Auth + Geofence</option>
                  <option value="face_supervisor_qr">Face Preferred + Supervisor QR</option>
                  <option value="fingerprint_supervisor_qr">Fingerprint Preferred + Supervisor QR</option>
                  <option value="device_auth_supervisor_qr">Device Auth + Supervisor QR</option>
                </select>
              </label>

              {(form.assignedAuthPolicy?.includes('face') || form.attendanceMethod?.includes('face')) && (
                <div style={{ gridColumn: 'span 2', padding: '12px 16px', background: '#FFFBEB', borderRadius: '8px', border: '1px solid #FCD34D', fontSize: '13px', color: '#92400E' }}>
                  <strong>⚠️ Advisory Notice:</strong> System face availability depends on the employee's phone hardware and OS support. If face unlock is unavailable, the configured fallback will be used and recorded.
                </div>
              )}

              <div style={{ gridColumn: 'span 2', marginTop: '12px' }}>
                <strong style={{ fontSize: '14px', display: 'block', marginBottom: '8px' }}>Fallback & Audit Settings</strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={form.allowFingerprintFallback ?? true}
                      onChange={(e) => setForm({ ...form, allowFingerprintFallback: e.target.checked })}
                    />
                    Allow Fingerprint Fallback
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={form.allowDeviceCredentialFallback ?? true}
                      onChange={(e) => setForm({ ...form, allowDeviceCredentialFallback: e.target.checked })}
                    />
                    Allow Device PIN/Pattern Fallback
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={form.notifyHrOnFallback ?? true}
                      onChange={(e) => setForm({ ...form, notifyHrOnFallback: e.target.checked })}
                    />
                    Notify HR when Fallback is used
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={form.blockAttendanceWhenFallbackUsed ?? false}
                      onChange={(e) => setForm({ ...form, blockAttendanceWhenFallbackUsed: e.target.checked })}
                    />
                    Block attendance when fallback is used
                  </label>
                </div>
              </div>

              {isSiteEmployeeRole(form.role) && (
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
                    required={isSiteEmployeeRole(form.role)}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--line)', marginTop: '4px' }}
                  >
                    <option value="">Select Supervisor...</option>
                    {employees
                      .filter((x) => isSupervisorRole(x.role) && x.status === 'active' && x.id !== editingId)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>

            {/* Previews container */}
            <div className="previews-container">
              <div className="preview-box">
                <strong>Permission Preview</strong>
                <ul>
                  <li>✓ canUseOfficeAttendance</li>
                  {isSiteEmployeeRole(form.role) && <li>✓ canRequestSiteCheckIn</li>}
                  {isSupervisorRole(form.role) && <li>✓ canApproveSiteRequests</li>}
                  <li>✓ canViewNotifications</li>
                  <li>✓ canViewHistory</li>
                  <li>✓ canManageProfile</li>
                </ul>
              </div>
              <div className="preview-box">
                <strong>Mobile Bottom-Nav Preview</strong>
                <div className="navbar-preview" style={{ marginTop: '8px' }}>
                  <span>Home</span> | <span>History</span> |{' '}
                  {isSiteEmployeeRole(form.role) && (
                    <span className="nav-highlight">Site</span>
                  )}
                  {isSupervisorRole(form.role) && (
                    <span className="nav-highlight">Approvals</span>
                  )}
                  {' '} | <span>Notifications</span> | <span>Profile</span>
                </div>
              </div>
            </div>
          </div>

          <div className="create-locs" style={{ marginTop: '20px' }}>
            <span className="create-locs-label">
              {isSupervisorRole(form.role) ? 'Assigned worksites (at least one required)' : 'Approved locations'}
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
                <Spinner light />
              ) : editingId ? (
                'Save Changes'
              ) : (
                'Create & Generate Code'
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

      <div className="search-bar">
        <input
          type="text"
          placeholder="Filter employees by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Employees (office + site) and Supervisors are shown separately so
          admins/supervisors never appear in the normal staff list. */}
      {renderEmployeeTable(
        'Employees',
        staffEmployees,
        query ? 'No employees match your search.' : 'No employees yet.',
      )}
      {renderEmployeeTable(
        'Supervisors & Admins',
        supervisorEmployees,
        query
          ? 'No supervisors match your search.'
          : 'No supervisors yet.',
      )}

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
