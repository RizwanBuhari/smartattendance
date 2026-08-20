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
  // login()'s in-flight verifyAdmin() promise, so the auth listener can reuse
  // that same result instead of making a second backend call on login.
  const loginVerifyRef = useRef(null)

  useEffect(() => {
    function stopSessionWatch() {
      if (sessionWatchRef.current) {
        sessionWatchRef.current()
        sessionWatchRef.current = null
      }
    }

    // Watch adminSessions/{uid}. If the active sessionId becomes something other
    // than ours, another login took over — sign out and explain why.
    //
    // Guarded against false positives: right after a login the doc can briefly
    // read a stale/other sessionId (the claim still propagating, or a double
    // auth-fire on a first-ever login). A REAL takeover is persistent, a blip is
    // not — so we only sign out if the mismatch survives a short confirmation
    // window, and cancel the moment our own id is seen again.
    function startSessionWatch(uid, mySessionId) {
      stopSessionWatch()
      if (!mySessionId) return
      let kickTimer = null
      const clearKick = () => {
        if (kickTimer) {
          clearTimeout(kickTimer)
          kickTimer = null
        }
      }
      const unsub = onSnapshot(doc(db, 'admin_Sessions', uid), (snap) => {
        // Ignore local-cache emissions; only trust server-confirmed reads.
        if (snap.metadata.fromCache) return
        const active = snap.data()?.sessionId
        if (!active || active === mySessionId) {
          clearKick() // our session is (still) the active one
          return
        }
        // A different id — wait to see if it sticks before signing out.
        if (!kickTimer) {
          kickTimer = setTimeout(() => {
            stopSessionWatch()
            localStorage.removeItem(sessionKey(uid))
            setSessionMessage(
              'You were signed out because your account was just used to log in on another device or browser.',
            )
            signOut(auth)
          }, 3000)
        }
      })
      // Store a cleanup that both cancels a pending kick and detaches the listener.
      sessionWatchRef.current = () => {
        clearKick()
        unsub()
      }
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
      const uid = currentUser.uid
      const wasLogin = pendingLoginRef.current
      pendingLoginRef.current = false
      const storedSessionId = localStorage.getItem(sessionKey(uid))

      // On a fresh login, reuse the verifyAdmin() call login() already started
      // (one backend round trip, not two); on a page restore, verify now.
      const verifyPromise = (wasLogin && loginVerifyRef.current) || verifyAdmin()
      loginVerifyRef.current = null
      let admin = false
      try {
        admin = (await verifyPromise).isAdmin
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

      // Admin confirmed. verifyAdmin() just stamped the `admin` custom claim on
      // this account, but the token in hand was minted BEFORE that — so force a
      // refresh to pick it up. firestore.rules grants the dashboard's direct
      // collection reads on that claim, and the listeners start as soon as we
      // setUser() below, so this has to happen first.
      try {
        await currentUser.getIdToken(true)
      } catch {
        // A refresh failure is not fatal on its own — the existing token may
        // already carry the claim. Let the listeners report it if not.
      }

      // Show the dashboard IMMEDIATELY. The single-session
      // claim + watcher are enforcement, not a prerequisite for rendering, so
      // they run in the BACKGROUND below and never delay the dashboard.
      setUser(currentUser)
      setIsAdmin(true)
      setLoading(false)

      // A fresh login (or a restore with no stored id) claims a new session that
      // supersedes other devices; a plain reload resumes the stored id, leaving
      // the user's own other tabs undisturbed.
      ;(async () => {
        let mySessionId = storedSessionId
        if (wasLogin || !mySessionId) {
          try {
            const res = await claimAdminSession()
            if (res?.ok && res.sessionId) {
              mySessionId = res.sessionId
              localStorage.setItem(sessionKey(uid), mySessionId)
            }
          } catch {
            // Backend unreachable — proceed without single-session enforcement.
          }
        }
        startSessionWatch(uid, mySessionId)
      })()
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
    // Kick off the admin check and stash the promise so the auth listener reuses
    // this same result instead of hitting the backend a second time.
    const verifyPromise = verifyAdmin()
    loginVerifyRef.current = verifyPromise
    const { isAdmin: admin } = await verifyPromise
    if (!admin) {
      pendingLoginRef.current = false
      loginVerifyRef.current = null
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
