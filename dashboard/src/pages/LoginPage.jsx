import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { warmBackend } from '../services/api'
import Spinner from '../components/Spinner'
import LogoShine from '../components/LogoShine'

const REMEMBER_KEY = 'adminRememberedEmail'

// Icons shown inside the email / password fields.
const MailIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
)
const LockIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

export default function LoginPage() {
  const { login, sessionMessage } = useAuth()
  const navigate = useNavigate()

  // Prefill the email if it was remembered on this device last time.
  const rememberedEmail = localStorage.getItem(REMEMBER_KEY) || ''
  const [email, setEmail] = useState(rememberedEmail)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  // Warm the backend the moment the login page opens, so its Firestore
  // connection is ready by the time the admin clicks Sign in.
  useEffect(() => {
    warmBackend()
  }, [])

  // Sign-in can fail for three quite different reasons, and reporting them all
  // as "invalid password" sends people hunting for the wrong problem. In
  // particular a browser that cannot REACH the backend used to look identical
  // to a typo'd password.
  function describeLoginError(err) {
    // Rejected by our own admin check — it already carries a good message.
    if (err.code === 'not-admin') return err.message

    // Genuinely bad credentials (Firebase Auth codes).
    const badCredential = [
      'auth/invalid-credential',
      'auth/wrong-password',
      'auth/user-not-found',
      'auth/invalid-email',
    ]
    if (badCredential.includes(err.code)) return 'Invalid email or password.'

    if (err.code === 'auth/user-disabled') {
      return 'This account has been disabled. Contact your administrator.'
    }
    if (err.code === 'auth/too-many-requests') {
      return 'Too many attempts. Wait a few minutes and try again.'
    }

    // Anything else is almost always a connectivity problem: the sign-in
    // itself worked, but the browser could not reach the backend to check
    // whether this user is an admin.
    return (
      "Signed in, but couldn't reach the server to verify your account. " +
      'Check that the backend is running and reachable from this device.'
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    try {
      await login(email, password)
      // Remember the email for next time (the browser's password manager
      // securely stores the password itself — we never persist it here).
      localStorage.setItem(REMEMBER_KEY, email)
      navigate('/') // go to the dashboard on success
    } catch (err) {
      setError(describeLoginError(err))
    } finally {
      setBusy(false)
    }
  }

  function handleForgot() {
    setError('')
    setInfo('Please contact your system administrator to reset your password.')
  }

  return (
    <div className="center-screen">
      {/* Full-screen background video (employees entering the office). Muted +
          playsInline so it autoplays on mobile; loops silently. If it can't
          play, the red brand gradient behind it shows instead. */}
      <video
        className="login-bg-video"
        autoPlay
        muted
        loop
        playsInline
        src="/login-bg.mp4"
      />

      <form className="card login-card" onSubmit={handleSubmit}>
        {/* Black logo on the frosted card, per the brand manual — with the
            Elsewedy-style sheen looping across it. */}
        <div className="login-logo-wrap">
          <LogoShine
            src="/elsewedy-logo-transparent.png"
            alt="Elsewedy Electric"
            shine="light"
            imgClassName="login-logo"
            fallback={
              <span className="login-fallback" style={{ display: 'none' }}>
                Elsewedy Electric
              </span>
            }
          />
        </div>
        <h1 className="login-title">Check-N</h1>

        {sessionMessage && !error && (
          <div className="notice notice-warn">{sessionMessage}</div>
        )}
        {error && <div className="error">{error}</div>}
        {info && <div className="login-info">{info}</div>}

        <div className="login-field">
          <span className="login-field-icon">{MailIcon}</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            placeholder="Email address"
            aria-label="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus={!email}
          />
        </div>

        <div className="login-field has-toggle">
          <span className="login-field-icon">{LockIcon}</span>
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            placeholder="Password"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus={Boolean(email)}
          />
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            title={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <path d="M1 1l22 22" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>

        <button className="btn-primary login-submit" type="submit" disabled={busy}>
          {busy ? (
            <>
              <Spinner light /> Signing in…
            </>
          ) : (
            'Sign in'
          )}
        </button>

        <button type="button" className="login-forgot" onClick={handleForgot}>
          Forgot password?
        </button>
      </form>
    </div>
  )
}
