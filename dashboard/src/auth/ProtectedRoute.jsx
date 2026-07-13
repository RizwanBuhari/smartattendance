// Wraps any route that should only be visible to a logged-in admin.
// If nobody is logged in, it redirects to the login page.
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  // Wait for Firebase to check for an existing session before deciding.
  if (loading) {
    return <div className="center-screen">Loading…</div>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}
