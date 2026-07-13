// Holds the "who is logged in" state for the whole app.
//
// React Context lets any component read the current user (or call
// login/logout) without passing props down through every level.
import { createContext, useContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { auth } from '../firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // We start in "loading" until Firebase tells us whether there's an existing
  // session. Without this, a logged-in admin refreshing the page would be
  // briefly bounced to /login before Firebase restores their session.
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fires once on load (to restore a session) and again on every login/logout.
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setLoading(false)
    })
    return unsubscribe // clean up the listener when the app unmounts
  }, [])

  const login = (email, password) =>
    signInWithEmailAndPassword(auth, email, password)

  const logout = () => signOut(auth)

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// Small helper so components can just call useAuth() instead of useContext().
export function useAuth() {
  return useContext(AuthContext)
}
