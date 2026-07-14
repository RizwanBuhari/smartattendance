// Wraps any route that should only be visible to a logged-in admin.
// If nobody is logged in, it redirects to the login page.
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function ProtectedRoute({ children }) {
  const { user, isAdmin, loading } = useAuth()

  // Wait for Firebase to check for an existing session (and the admin check)
  // before deciding.
  if (loading) {
    return <div className="center-screen">Loading…</div>
  }

  // Must be logged in AND an admin. A non-admin never gets past here.
  if (!user || !isAdmin) {
    return <Navigate to="/login" replace />
  }

  return children
}
