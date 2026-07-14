import { useCallback, useEffect, useState } from 'react'
import { getLocations } from '../services/locationsService'
import { useAutoRefresh } from '../utils/useAutoRefresh'
import PageLoader from '../components/PageLoader'

export default function LocationsPage() {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const data = await getLocations()
    setLocations(data)
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  // Keep the list in sync with the database (on focus + periodically).
  useAutoRefresh(load)

  if (loading) return <PageLoader />

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
