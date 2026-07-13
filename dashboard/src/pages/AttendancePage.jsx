import { useEffect, useState } from 'react'
import { getAttendance } from '../services/attendanceService'
import { formatLocal, workedHours } from '../utils/time'

// Human-readable label + colour for each attendance status.
const STATUS_LABELS = {
  checked_in: 'Checked in',
  checked_out: 'Checked out',
  left_area: 'Left area',
}

export default function AttendancePage() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAttendance().then((data) => {
      setRecords(data)
      setLoading(false)
    })
  }, [])

  if (loading) return <p>Loading attendance…</p>

  return (
    <div>
      <h1 className="page-title">Attendance</h1>
      <p className="page-hint">
        Times are stored in UTC and shown here in each record's local time.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th>Worked</th>
              <th>GPS accuracy</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td>{r.employeeName}</td>
                <td>{formatLocal(r.checkInUtc, r.tzOffsetMinutes)}</td>
                <td>{formatLocal(r.checkOutUtc, r.tzOffsetMinutes)}</td>
                <td>{workedHours(r.checkInUtc, r.checkOutUtc)}</td>
                <td>±{r.gpsAccuracy} m</td>
                <td>
                  <span className={`badge badge-${r.status}`}>
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
