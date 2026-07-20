import { useEffect, useState } from 'react'
import { deleteAttendance } from '../services/attendanceService'
import { subscribeAttendance } from '../services/realtime'
import {
  formatLocal,
  workedHours,
  formatHours,
  localDateISO,
  todayISO,
  formatDuration,
} from '../utils/time'
import { punctuality, overtimeHours, WORK_START } from '../utils/attendance'
import Spinner from '../components/Spinner'
import PageLoader from '../components/PageLoader'
import PageHead from '../components/PageHead'
import { Icon } from '../components/icons'
import { useConfirm } from '../components/ConfirmProvider'

const STATUS_LABELS = {
  checked_in: 'Checked in',
  checked_out: 'Checked out',
  left_area: 'Left area',
  rejected: 'Check-in rejected',
  rejected_checkout: 'Checkout rejected',
}

export default function AttendancePage() {
  const confirm = useConfirm()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  // Default to today's date so the page opens on the current day. The user can
  // pick another date, or clear the field to see every day at once.
  const [dateFilter, setDateFilter] = useState(() =>
    todayISO(-new Date().getTimezoneOffset()),
  )
  const [deletingId, setDeletingId] = useState(null)

  // Realtime: Firestore pushes every check-in/out to us via onSnapshot, so the
  // table updates on its own — no polling, no manual refresh.
  useEffect(() => {
    const unsubscribe = subscribeAttendance(
      (data) => {
        setRecords(data)
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

  async function removeRecord(r) {
    const who = r.employeeName ?? 'this employee'
    const ok = await confirm({
      title: 'Delete attendance record?',
      message: `This permanently removes the attendance record for ${who}. This can't be undone.`,
      confirmText: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    setDeletingId(r.id)
    try {
      // The delete goes through the backend; the realtime listener then removes
      // the row on its own once Firestore reflects the change.
      await deleteAttendance(r.id)
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
    { label: 'Records', value: filtered.length, hint: 'total shown', icon: Icon.list, tone: 'brand' },
    { label: 'On time', value: onTime, hint: 'within grace period', icon: Icon.check, tone: 'good' },
    { label: 'Late', value: late, hint: `after ${WORK_START} + grace`, icon: Icon.clock, tone: late > 0 ? 'warn' : 'good' },
    { label: 'Total hours', value: totalHours.toFixed(1), hint: 'completed shifts', icon: Icon.clock, tone: 'info' },
    { label: 'Overtime', value: formatHours(totalOvertime), hint: 'beyond standard day', icon: Icon.trendingUp, tone: 'brand' },
  ]

  return (
    <div className="reveal">
      <PageHead
        icon={Icon.calendar}
        title="Attendance"
        hint={`Times are stored in UTC and shown in each record's local time. Punctuality is measured against a ${WORK_START} start.`}
      />

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
          <div key={s.label} className={`stat-tile stat-tone-${s.tone}`}>
            <div className="stat-top">
              <span className="stat-icon">{s.icon}</span>
            </div>
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
                  <td>{ot > 0 ? `+${formatHours(ot)}` : '—'}</td>
                  <td>
                    {p.late ? (
                      <span className="badge badge-late">
                        Late {formatDuration(p.lateMinutes)}
                      </span>
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
                    {(() => {
                      // Out-of-radius checkout review state (pending until an
                      // admin decides on the Review page). Falls back to the
                      // legacy `checkoutFlagged` flag for older records.
                      const rv =
                        r.checkoutReview?.status ??
                        (r.checkoutFlagged ? 'pending' : null)
                      const flaggedCheckout = rv === 'pending' || rv === 'rejected'
                      const label =
                        rv === 'pending'
                          ? 'Checkout under review'
                          : rv === 'rejected'
                            ? (r.status === 'checked_in'
                              ? 'Checked in / checkout rejected'
                              : 'Checkout rejected')
                            : (STATUS_LABELS[r.status] ?? r.status)
                      return (
                        <span
                          className={`badge ${
                            flaggedCheckout || r.flaggedOutside || r.status === 'rejected' || r.status === 'rejected_checkout'
                              ? 'badge-flagged'
                              : `badge-${r.status}`
                          }`}
                          title={
                            r.status === 'rejected' || r.status === 'rejected_checkout'
                              ? 'This action was rejected because the employee was outside their approved locations.'
                              : flaggedCheckout
                                ? `Checked out ${r.checkoutReview?.distanceMeters ?? r.checkoutDistanceMeters ?? '?'}m from the approved area.`
                                : r.flaggedOutside
                                  ? 'A background location check caught this employee outside their approved area during this shift.'
                                  : undefined
                          }
                        >
                          {label}
                          {r.flaggedOutside && !flaggedCheckout ? ' ⚠' : ''}
                        </span>
                      )
                    })()}
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
