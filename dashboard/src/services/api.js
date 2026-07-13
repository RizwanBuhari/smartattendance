// Thin wrapper for talking to the NestJS backend.
//
// Every request carries the logged-in admin's Firebase ID token in the
// Authorization header. The backend will verify that token with the Firebase
// Admin SDK to confirm WHO is calling before trusting the request.
//
// Nothing uses this yet — the service files return mock data for now. When the
// backend is ready, switch each service over to apiGet / apiSend.
import { auth } from '../firebase'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

async function authHeaders() {
  const token = await auth.currentUser?.getIdToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
  return res.json()
}

export async function apiSend(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`)
  return res.json()
}
