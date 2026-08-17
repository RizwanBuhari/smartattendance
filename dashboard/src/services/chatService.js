// Talks to the backend's dashboard assistant (POST /chat).
//
// The assistant is read-only and admin-guarded on the server, so there is
// nothing to guard here beyond what apiSend already does — it attaches the
// signed-in admin's Firebase ID token, and the backend decides from that.
import { apiSend } from './api'

/**
 * Ask the assistant a question.
 *
 * Resolves to { answer, toolsUsed }. `toolsUsed` lists the internal tools the
 * model actually called — an empty array on a data question means the reply
 * came from the prompt alone rather than from Firestore, which is worth
 * surfacing rather than hiding.
 */
export async function askAssistant(message) {
  return apiSend('POST', '/chat', { message })
}
