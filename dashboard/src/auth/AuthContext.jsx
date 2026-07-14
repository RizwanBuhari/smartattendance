// Holds the "who is logged in" state for the whole app — and, importantly,
// whether that person is an ADMIN. Only admins may use this dashboard: a normal
// employee (who registered via the mobile app) has a valid Firebase login but
// is NOT in the backend's admins list, so they're rejected here.
import { createContext, useContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { auth } from '../firebase'
import { verifyAdmin } from '../services/adminService'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  // Start in "loading" until Firebase restores any session AND we've checked
  // admin status, so we don't briefly flash the dashboard for a non-admin.
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fires on load (to restore a session) and on every login/logout.
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setUser(null)
        setIsAdmin(false)
        setLoading(false)
        return
      }
      // There IS a Firebase session — but only allow it through if the backend
      // confirms this email is an admin. Otherwise sign them straight back out.
      setLoading(true)
      let admin = false
      try {
        admin = (await verifyAdmin()).isAdmin
      } catch {
        admin = false // backend unreachable → deny, to be safe
      }
      if (admin) {
        setUser(currentUser)
        setIsAdmin(true)
      } else {
        await signOut(auth)
        setUser(null)
        setIsAdmin(false)
      }
      setLoading(false)
    })
    return unsubscribe // clean up the listener when the app unmounts
  }, [])

  // Signs in, then confirms admin status. Throws with code 'not-admin' if the
  // account is a valid login but not an admin, so the login page can show a
  // clear message.
  const login = async (email, password) => {
    await signInWithEmailAndPassword(auth, email, password)
    const { isAdmin: admin } = await verifyAdmin()
    if (!admin) {
      await signOut(auth)
      const err = new Error(
        'This account is not authorized to access the admin dashboard.',
      )
      err.code = 'not-admin'
      throw err
    }
  }

  const logout = () => signOut(auth)

  return (
    <AuthContext.Provider value={{ user, isAdmin, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// Small helper so components can just call useAuth() instead of useContext().
export function useAuth() {
  return useContext(AuthContext)
}
