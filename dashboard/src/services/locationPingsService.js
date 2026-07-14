// Data access for the locationPings collection — periodic 9AM-6PM background
// samples the mobile app sends, so anomalies (outside the geofence) surface
// here even between check-ins.
import { apiGet } from './api'

export async function getLocationAnomalies() {
  return apiGet('/location-pings/anomalies')
}
