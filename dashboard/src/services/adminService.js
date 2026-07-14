// Asks the backend whether the currently logged-in Firebase user is an admin.
// apiGet automatically attaches the user's Firebase ID token, which the backend
// verifies before checking the admins collection.
import { apiGet } from './api'

export async function verifyAdmin() {
  return apiGet('/admins/verify')
}
