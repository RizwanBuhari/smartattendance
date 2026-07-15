// Data access for the locationPings collection — periodic 9AM-6PM background
// samples the mobile app sends, so anomalies (outside the geofence) surface
// here even between check-ins.
import { apiGet } from './api'

export async function getLocationAnomalies() {
  return apiGet('/location-pings/anomalies')
}

// Every location ping (inside or outside the geofence) for one employee.
// Used to build that employee's location heat-map in their report. Attendance
// and pings are keyed by `employeeId`, which may be the employee's doc id or
// their Firebase UID — so callers pass each key they know about.
export async function getLocationPingsForEmployee(employeeId) {
  return apiGet(`/location-pings?employeeId=${encodeURIComponent(employeeId)}`)
}
