// Data access for approved work locations — now backed by the NestJS backend.
import { apiGet, apiSend } from './api'

export async function getLocations() {
  return apiGet('/locations')
}

export async function createLocation(location) {
  return apiSend('POST', '/locations', location)
}

// Updates a location's fields (name / latitude / longitude / radiusMeters).
export async function updateLocation(id, changes) {
  return apiSend('PATCH', `/locations/${id}`, changes)
}

export async function deleteLocation(id) {
  return apiSend('DELETE', `/locations/${id}`)
}
