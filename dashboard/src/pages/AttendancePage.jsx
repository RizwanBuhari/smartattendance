import { useCallback, useEffect, useState } from 'react'
import { getAttendance, deleteAttendance } from '../services/attendanceService'
import { formatLocal, workedHours, localDateISO } from '../utils/time'
import { punctuality, overtimeHours, WORK_START } from '../utils/attendance'
import { useAutoRefresh } from '../utils/useAutoRefresh'
import Spinner from '../components/Spinner'
import PageLoader from '../components/PageLoader'

// Human-readable label + colour for each attendance status.
const STATUS_LABELS = {
  checked_in: 'Checked in',
  checked_out: 'Checked out',
  left_area: 'Left area',
}

export default function AttendancePage() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(async () => {
    try {
      const data = await getAttendance()
      setRecords(data)
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  // Keep records in sync with the database (on focus + periodically).
  useAutoRefresh(load)

  async function removeRecord(r) {
    const who = r.employeeName ?? 'this employee'
    if (!window.confirm(`Delete this attendance record for ${who}?`)) return
    setDeletingId(r.id)
    try {
      await deleteAttendance(r.id)
      setRecords((prev) => prev.filter((x) => x.id !== r.id))
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <PageLoader />
  if (error)
    return (
      <div className="error">
        Couldn't reach the server. Make sure the backend is running on port 3000.
      </div>
    )

  // Apply the search + status + date filters.
  const query = search.trim().toLowerCase()
  const filtered = records.filter((r) => {
    if (query && !(r.employeeName || '').toLowerCase().includes(query))
      return false
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    if (
      dateFilter &&
      localDateISO(r.checkInUtc, r.tzOffsetMinutes) !== dateFilter
    )
      return false
    return true
  })

  // Timesheet summary (Bayzat-style): totals across the filtered records.
  const onTime = filtered.filter(
    (r) => !punctuality(r.checkInUtc, r.tzOffsetMinutes).late,
  ).length
  const late = filtered.length - onTime
  const totalHours = filtered.reduce((sum, r) => {
    if (!r.checkInUtc || !r.checkOutUtc) return sum
    return sum + (new Date(r.checkOutUtc) - new Date(r.checkInUtc)) / 3600000
  }, 0)
  const totalOvertime = filtered.reduce(
    (sum, r) => sum + overtimeHours(r.checkInUtc, r.checkOutUtc),
    0,
  )

  const summary = [
    { label: 'Records', value: filtered.length, hint: 'total shown' },
    { label: 'On time', value: onTime, hint: 'within grace period' },
    { label: 'Late', value: late, hint: `after ${WORK_START} + grace`, alert: late > 0 },
    { label: 'Total hours', value: totalHours.toFixed(1), hint: 'completed shifts', accent: true },
    { label: 'Overtime', value: `${totalOvertime.toFixed(1)}h`, hint: 'beyond standard day' },
  ]

  return (
    <div>
      <h1 className="page-title">Attendance</h1>
      <p className="page-hint">
        Times are stored in UTC and shown in each record's local time.
        Punctuality is measured against a {WORK_START} start.
      </p>

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
            placeholder="Search by employee…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="checked_in">Checked in</option>
          <option value="checked_out">Checked out</option>
          <option value="left_area">Left area</option>
        </select>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
        />
      </div>

      <div className="stat-grid">
        {summary.map((s) => (
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

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th>Worked</th>
              <th>Overtime</th>
              <th>Punctuality</th>
              <th>GPS accuracy</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="filter-empty">
                  No attendance records match your filters.
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const p = punctuality(r.checkInUtc, r.tzOffsetMinutes)
              const ot = overtimeHours(r.checkInUtc, r.checkOutUtc)
              return (
                <tr key={r.id}>
                  <td>{r.employeeName}</td>
                  <td>{formatLocal(r.checkInUtc, r.tzOffsetMinutes)}</td>
                  <td>{formatLocal(r.checkOutUtc, r.tzOffsetMinutes)}</td>
                  <td>{workedHours(r.checkInUtc, r.checkOutUtc)}</td>
                  <td>{ot > 0 ? `+${ot.toFixed(2)} h` : '—'}</td>
                  <td>
                    {p.late ? (
                      <span className="badge badge-late">Late {p.lateMinutes}m</span>
                    ) : (
                      <span className="badge badge-ontime">On time</span>
                    )}
                  </td>
                  <td>
                    {r.gpsAccuracy != null
                      ? `±${Math.round(r.gpsAccuracy)} m`
                      : '—'}
                  </td>
                  <td>
                    <span
                      className={`badge ${r.flaggedOutside ? 'badge-flagged' : `badge-${r.status}`}`}
                      title={
                        r.flaggedOutside
                          ? 'A background location check caught this employee outside their approved area during this shift.'
                          : undefined
                      }
                    >
                      {STATUS_LABELS[r.status] ?? r.status}
                      {r.flaggedOutside ? ' ⚠' : ''}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn-sm btn-sm-danger"
                      onClick={() => removeRecord(r)}
                      disabled={deletingId === r.id}
                    >
                      {deletingId === r.id ? <Spinner /> : 'Remove'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
