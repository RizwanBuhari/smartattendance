// Data access for attendance records — now backed by the NestJS backend.
// These records are created by the mobile app's check-in/check-out.
import { apiGet } from './api'

export async function getAttendance() {
  return apiGet('/attendance')
}
