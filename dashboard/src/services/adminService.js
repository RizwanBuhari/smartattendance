// Asks the backend whether the currently logged-in Firebase user is an admin.
// apiGet automatically attaches the user's Firebase ID token, which the backend
// verifies before checking the admins collection.
import { apiGet, apiSend } from './api'

export async function verifyAdmin() {
  return apiGet('/admins/verify')
}

// Claims the single active session for this admin after login. The backend
// records the returned sessionId as THE active one; any other still-open
// session detects the change and signs itself out. Returns { ok, sessionId }.
export async function claimAdminSession() {
  return apiSend('POST', '/admins/session')
}

// The logged-in admin's own editable profile (from the admins collection).
export async function getMyProfile() {
  return apiGet('/admins/me')
}

export async function updateMyProfile(changes) {
  return apiSend('PATCH', '/admins/me', changes)
}
