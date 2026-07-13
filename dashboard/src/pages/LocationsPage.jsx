import { useEffect, useState } from 'react'
import { getLocations } from '../services/locationsService'

export default function LocationsPage() {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getLocations().then((data) => {
      setLocations(data)
      setLoading(false)
    })
  }, [])

  if (loading) return <p>Loading locations…</p>

  return (
    <div>
      <h1 className="page-title">Locations</h1>
      <p className="page-hint">
        Approved work areas. Each has a centre point and an allowed radius used
        for geofencing. (Create/edit/delete come once the backend is connected.)
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Radius (m)</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>{l.latitude}</td>
                <td>{l.longitude}</td>
                <td>{l.radiusMeters}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
