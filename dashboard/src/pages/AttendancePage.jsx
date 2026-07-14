import { useEffect, useState } from 'react'
import { getAttendance, deleteAttendance } from '../services/attendanceService'
import { formatLocal, workedHours } from '../utils/time'
import { punctuality, overtimeHours, WORK_START } from '../utils/attendance'

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

  useEffect(() => {
    getAttendance()
      .then(setRecords)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  async function removeRecord(r) {
    const who = r.employeeName ?? 'this employee'
    if (!window.confirm(`Delete this attendance record for ${who}?`)) return
    await deleteAttendance(r.id)
    setRecords((prev) => prev.filter((x) => x.id !== r.id))
  }

  if (loading) return <p>Loading attendance…</p>
  if (error)
    return (
      <div className="error">
        Couldn't reach the server. Make sure the backend is running on port 3000.
      </div>
    )

  // Timesheet summary (Bayzat-style): totals across the shown records.
  const onTime = records.filter(
    (r) => !punctuality(r.checkInUtc, r.tzOffsetMinutes).late,
  ).length
  const late = records.length - onTime
  const totalHours = records.reduce((sum, r) => {
    if (!r.checkInUtc || !r.checkOutUtc) return sum
    return sum + (new Date(r.checkOutUtc) - new Date(r.checkInUtc)) / 3600000
  }, 0)
  const totalOvertime = records.reduce(
    (sum, r) => sum + overtimeHours(r.checkInUtc, r.checkOutUtc),
    0,
  )

  const summary = [
    { label: 'Records', value: records.length, hint: 'total shown' },
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
            {records.map((r) => {
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
                    <span className={`badge badge-${r.status}`}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn-sm btn-sm-danger"
                      onClick={() => removeRecord(r)}
                    >
                      Remove
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
