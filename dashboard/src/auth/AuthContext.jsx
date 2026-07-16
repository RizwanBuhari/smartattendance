// Holds the "who is logged in" state for the whole app — and, importantly,
// whether that person is an ADMIN. Only admins may use this dashboard: a normal
// employee (who registered via the mobile app) has a valid Firebase login but
// is NOT in the backend's admins list, so they're rejected here.
//
// Single active session: each login claims a fresh sessionId (stored in the
// backend's adminSessions/{uid} doc). While signed in, we watch that doc; if its
// sessionId changes to a different one — because the same account was used to
// log in elsewhere — this session is signed out and told what happened. So the
// account can only be actively logged in from one place at a time.
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { verifyAdmin, claimAdminSession } from '../services/adminService'

const AuthContext = createContext(null)

const sessionKey = (uid) => `adminSession:${uid}`

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  // Start in "loading" until Firebase restores any session AND we've checked
  // admin status, so we don't briefly flash the dashboard for a non-admin.
  const [loading, setLoading] = useState(true)
  // Set when we sign someone out because their account was used to log in
  // elsewhere — the login page shows it.
  const [sessionMessage, setSessionMessage] = useState('')

  // true between calling login() and the auth listener firing, so that listener
  // knows to CLAIM a new session (a fresh login takes over) rather than just
  // resume the existing one (a page reload).
  const pendingLoginRef = useRef(false)
  // The onSnapshot unsubscribe for the active-session watcher.
  const sessionWatchRef = useRef(null)

  useEffect(() => {
    function stopSessionWatch() {
      if (sessionWatchRef.current) {
        sessionWatchRef.current()
        sessionWatchRef.current = null
      }
    }

    // Watch adminSessions/{uid}. If the active sessionId becomes something other
    // than ours, another login took over — sign out and explain why.
    function startSessionWatch(uid, mySessionId) {
      stopSessionWatch()
      if (!mySessionId) return
      sessionWatchRef.current = onSnapshot(
        doc(db, 'adminSessions', uid),
        (snap) => {
          // Ignore local-cache emissions: right after a fresh login Firestore
          // may replay the previously cached (now stale) sessionId before the
          // server confirms the one we just claimed. Acting on that would kick
          // us out of our own new session. Only trust server-confirmed reads.
          if (snap.metadata.fromCache) return
          const active = snap.data()?.sessionId
          if (active && active !== mySessionId) {
            stopSessionWatch()
            localStorage.removeItem(sessionKey(uid))
            setSessionMessage(
              'You were signed out because your account was just used to log in on another device or browser.',
            )
            signOut(auth)
          }
        },
      )
    }

    // Fires on load (to restore a session) and on every login/logout.
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        stopSessionWatch()
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
      if (!admin) {
        await signOut(auth)
        stopSessionWatch()
        setUser(null)
        setIsAdmin(false)
        setLoading(false)
        return
      }

      // Establish this session. A fresh login (or a restore with no stored id)
      // claims a NEW session — which supersedes any other device. A plain reload
      // resumes the existing id, so the user's own other tabs aren't disturbed.
      const uid = currentUser.uid
      const wasLogin = pendingLoginRef.current
      pendingLoginRef.current = false
      let mySessionId = localStorage.getItem(sessionKey(uid))
      if (wasLogin || !mySessionId) {
        try {
          const res = await claimAdminSession()
          if (res?.ok && res.sessionId) {
            mySessionId = res.sessionId
            localStorage.setItem(sessionKey(uid), mySessionId)
          }
        } catch {
          // Backend unreachable — proceed without single-session enforcement
          // rather than blocking the admin from working.
        }
      }

      setUser(currentUser)
      setIsAdmin(true)
      setLoading(false)
      startSessionWatch(uid, mySessionId)
    })

    return () => {
      unsubscribe() // clean up the listener when the app unmounts
      stopSessionWatch()
    }
  }, [])

  // Signs in, then confirms admin status. Throws with code 'not-admin' if the
  // account is a valid login but not an admin, so the login page can show a
  // clear message.
  const login = async (email, password) => {
    setSessionMessage('') // clear any prior takeover notice as the attempt starts
    pendingLoginRef.current = true
    await signInWithEmailAndPassword(auth, email, password)
    const { isAdmin: admin } = await verifyAdmin()
    if (!admin) {
      pendingLoginRef.current = false
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
    <AuthContext.Provider
      value={{ user, isAdmin, loading, login, logout, sessionMessage }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// Small helper so components can just call useAuth() instead of useContext().
export function useAuth() {
  return useContext(AuthContext)
}
