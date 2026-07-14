// Data access for attendance records — now backed by the NestJS backend.
// These records are created by the mobile app's check-in/check-out.
import { apiGet, apiSend } from './api'

export async function getAttendance() {
  return apiGet('/attendance')
}

// Admin removes a record (e.g. to clean up duplicates).
export async function deleteAttendance(id) {
  return apiSend('DELETE', `/attendance/${id}`)
}
