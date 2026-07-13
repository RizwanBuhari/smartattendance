// The dashboard landing page — a live snapshot of attendance, modeled on the
// Bayzat HR dashboard: KPI stat tiles across the top, then a "who's on-site
// now" list. All figures are computed from the real employees + attendance
// data coming from the backend.
import { useEffect, useState } from 'react'
import { getEmployees } from '../services/employeesService'
import { getAttendance } from '../services/attendanceService'
import { localTime, localDateISO, todayISO } from '../utils/time'
import { punctuality } from '../utils/attendance'

// "Amash Aal" -> "AA" for the avatar circle.
function initials(name = '') {
  const parts = name.split(' ').filter(Boolean).slice(0, 2)
  return parts.map((p) => p[0].toUpperCase()).join('') || '?'
}

export default function OverviewPage() {
  const [employees, setEmployees] = useState([])
  const [attendance, setAttendance] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    Promise.all([getEmployees(), getAttendance()])
      .then(([emps, att]) => {
        setEmployees(emps)
        setAttendance(att)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p>Loading overview…</p>
  if (error)
    return (
      <div className="error">
        Couldn't reach the server. Make sure the backend is running on port 3000.
      </div>
    )

  const onSite = attendance.filter((r) => r.status === 'checked_in')
  const checkedInToday = attendance.filter(
    (r) => localDateISO(r.checkInUtc, r.tzOffsetMinutes) === todayISO(r.tzOffsetMinutes),
  )
  const anomalies = attendance.filter((r) => r.status === 'left_area')
  const lateToday = checkedInToday.filter(
    (r) => punctuality(r.checkInUtc, r.tzOffsetMinutes).late,
  )

  const stats = [
    { label: 'Employees', value: employees.length, hint: 'total registered' },
    { label: 'On-site now', value: onSite.length, hint: 'currently checked in', accent: true },
    { label: 'Checked in today', value: checkedInToday.length, hint: 'across all sites' },
    {
      label: 'Late today',
      value: lateToday.length,
      hint: 'arrived after grace',
      alert: lateToday.length > 0,
    },
    {
      label: 'Anomalies',
      value: anomalies.length,
      hint: 'left approved area',
      alert: anomalies.length > 0,
    },
  ]

  return (
    <div>
      <h1 className="page-title">Overview</h1>
      <p className="page-hint">
        A live snapshot of attendance across all approved locations.
      </p>

      <div className="stat-grid">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`stat-tile${s.accent ? ' stat-accent' : ''}${
              s.alert ? ' stat-alert' : ''
            }`}
          >
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-hint">{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Who's on-site now</h2>
          <span className="panel-count">{onSite.length}</span>
        </div>

        {onSite.length === 0 ? (
          <p className="empty-state">No one is checked in right now.</p>
        ) : (
          <ul className="onsite-list">
            {onSite.map((r) => (
              <li key={r.id} className="onsite-row">
                <span className="avatar">{initials(r.employeeName)}</span>
                <div className="onsite-main">
                  <div className="onsite-name">{r.employeeName}</div>
                  <div className="onsite-sub">{r.locationName ?? '—'}</div>
                </div>
                <div className="onsite-time">
                  <span className="live-dot" />
                  since {localTime(r.checkInUtc, r.tzOffsetMinutes)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
