import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import Spinner from '../components/Spinner'
import LogoShine from '../components/LogoShine'

const REMEMBER_KEY = 'adminRememberedEmail'

export default function LoginPage() {
  const { login, sessionMessage } = useAuth()
  const navigate = useNavigate()

  // Prefill the email if it was remembered on this device last time.
  const rememberedEmail = localStorage.getItem(REMEMBER_KEY) || ''
  const [email, setEmail] = useState(rememberedEmail)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(Boolean(rememberedEmail))
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email, password)
      // Remember the email for next time (the browser's password manager
      // securely stores the password itself — we never persist it here).
      if (remember) localStorage.setItem(REMEMBER_KEY, email)
      else localStorage.removeItem(REMEMBER_KEY)
      navigate('/') // go to the dashboard on success
    } catch (err) {
      setError(
        err.code === 'not-admin'
          ? err.message
          : 'Invalid email or password.',
      )
    } finally {
      setBusy(false)
    }
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
        {/* Black logo on the light card, per the brand manual — with the
            Elsewedy-style sheen looping across it. */}
        <div className="login-logo-wrap">
          <LogoShine
            src="/elsewedy-logo-black.png"
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
        <p className="login-subtitle">Admin dashboard</p>

        {sessionMessage && !error && (
          <div className="notice notice-warn">{sessionMessage}</div>
        )}

        <label>
          Email
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus={!email}
          />
        </label>

        <label>
          Password
          <div className="password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
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
        </label>

        <label className="login-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember me on this device
        </label>

        {error && <div className="error">{error}</div>}

        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? (
            <>
              <Spinner light /> Signing in…
            </>
          ) : (
            'Sign in'
          )}
        </button>
      </form>
    </div>
  )
}
