// Data access for attendance records.
//
// Right now this returns mock data. When the NestJS backend is ready, replace
// the function body with the commented-out API call.
import { mockAttendance } from './mockData'
// import { apiGet } from './api'

export async function getAttendance() {
  // return apiGet('/attendance')
  return Promise.resolve(mockAttendance)
}
