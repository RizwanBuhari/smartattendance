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

// Out-of-radius checkouts awaiting an admin decision (the Review page).
export async function getCheckoutReviews() {
  return apiGet('/attendance/reviews')
}

// Approve an out-of-radius checkout — records it as a normal checkout.
export async function acceptCheckoutReview(id) {
  return apiSend('POST', `/attendance/${id}/review/accept`)
}

// Reject an out-of-radius checkout — keeps it marked as an improper checkout.
export async function rejectCheckoutReview(id) {
  return apiSend('POST', `/attendance/${id}/review/reject`)
}
