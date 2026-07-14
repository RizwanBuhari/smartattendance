// Asks the backend whether the currently logged-in Firebase user is an admin.
// apiGet automatically attaches the user's Firebase ID token, which the backend
// verifies before checking the admins collection.
import { apiGet, apiSend } from './api'

export async function verifyAdmin() {
  return apiGet('/admins/verify')
}

// The logged-in admin's own editable profile (from the admins collection).
export async function getMyProfile() {
  return apiGet('/admins/me')
}

export async function updateMyProfile(changes) {
  return apiSend('PATCH', '/admins/me', changes)
}
