import { useEffect, useState } from 'react'
import { getEmployees } from '../services/employeesService'
import { getLocations } from '../services/locationsService'

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load both at once so we can show location NAMES instead of raw ids.
    Promise.all([getEmployees(), getLocations()]).then(([emps, locs]) => {
      setEmployees(emps)
      setLocations(locs)
      setLoading(false)
    })
  }, [])

  // Turn ['loc1'] into 'Dubai Head Office'.
  function locationNames(ids) {
    if (!ids?.length) return '—'
    return ids
      .map((id) => locations.find((l) => l.id === id)?.name ?? id)
      .join(', ')
  }

  if (loading) return <p>Loading employees…</p>

  return (
    <div>
      <h1 className="page-title">Employees</h1>
      <p className="page-hint">
        Create, invite, and disable employees; assign approved locations.
        (Actions are stubbed until the backend is connected.)
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Approved locations</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{e.email}</td>
                <td>
                  <span className={`badge badge-${e.status}`}>{e.status}</span>
                </td>
                <td>{locationNames(e.assignedLocationIds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
