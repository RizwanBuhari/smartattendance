// The dashboard landing page — a live snapshot of attendance, modeled on the
// Bayzat HR dashboard: a friendly greeting hero with a "present today" ring,
// KPI stat tiles across the top, then a "who's on-site now" list. All figures
// are computed from the real employees + attendance data from the backend.
import { useEffect, useState } from 'react'
import { localTime, localDateISO, todayISO } from '../utils/time'
import { punctuality } from '../utils/attendance'
import {
  subscribeCollection,
  subscribeAnomalies,
} from '../services/realtime'
import PageLoader from '../components/PageLoader'

// "Amash Aal" -> "AA" for the avatar circle.
function initials(name = '') {
  const parts = name.split(' ').filter(Boolean).slice(0, 2)
  return parts.map((p) => p[0].toUpperCase()).join('') || '?'
}

// Warm, human greeting based on the admin's local time of day.
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

// "Thursday, 16 July 2026" — a friendly full date for the hero.
const longDate = new Date().toLocaleDateString(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

// Small inline SVG icons (Lucide-style, currentColor) — no emoji, so they
// inherit each tile's tone colour and stay crisp on any screen.
const Icon = {
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  presence: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="m16 11 2 2 4-4" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <path d="m9 16 2 2 4-4" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  ),
  mapPin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  coffee: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4Z" />
      <path d="M6 2v2M10 2v2M14 2v2" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  ),
}

// A compact SVG progress ring for the "present today" hero metric.
function Ring({ pct }) {
  const r = 52
  const c = 2 * Math.PI * r
  const offset = c * (1 - Math.max(0, Math.min(100, pct)) / 100)
  return (
    <svg className="ring" viewBox="0 0 120 120" role="img" aria-label={`${pct}% present today`}>
      <circle className="ring-track" cx="60" cy="60" r={r} />
      <circle
        className="ring-value"
        cx="60"
        cy="60"
        r={r}
        strokeDasharray={c}
        strokeDashoffset={offset}
      />
      <text className="ring-pct" x="60" y="58">{pct}%</text>
      <text className="ring-cap" x="60" y="76">present</text>
    </svg>
  )
}

export default function OverviewPage() {
  const [employees, setEmployees] = useState([])
  const [attendance, setAttendance] = useState([])
  const [locationAnomalies, setLocationAnomalies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Realtime: Firestore pushes employee/attendance/anomaly changes to us live,
  // so every tile and list on this page updates on its own.
  useEffect(() => {
    const onErr = () => {
      setError(true)
      setLoading(false)
    }
    const unsubEmployees = subscribeCollection(
      'employees',
      (data) => setEmployees(data),
      onErr,
    )
    const unsubAttendance = subscribeCollection(
      'attendance',
      (data) => {
        setAttendance(data)
        setError(false)
        setLoading(false)
      },
      onErr,
    )
    const unsubAnomalies = subscribeAnomalies(
      (rows) => setLocationAnomalies(rows),
      onErr,
    )
    return () => {
      unsubEmployees()
      unsubAttendance()
      unsubAnomalies()
    }
  }, [])

  if (loading) return <PageLoader />
  if (error)
    return (
      <div className="error">
        Couldn't load live data. If this persists, your Firestore security rules
        may be blocking reads — publish firestore.rules (Firebase Console →
        Firestore → Rules).
      </div>
    )

  const onSite = attendance.filter((r) => r.status === 'checked_in')
  const checkedInToday = attendance.filter(
    (r) => localDateISO(r.checkInUtc, r.tzOffsetMinutes) === todayISO(r.tzOffsetMinutes),
  )
  const lateToday = checkedInToday.filter(
    (r) => punctuality(r.checkInUtc, r.tzOffsetMinutes).late,
  )
  const onTimeToday = checkedInToday.length - lateToday.length

  // Share of the workforce that has checked in today — the hero ring metric.
  const presentPct = employees.length
    ? Math.round((checkedInToday.length / employees.length) * 100)
    : 0

  const stats = [
    { label: 'Employees', value: employees.length, hint: 'total registered', icon: Icon.users, tone: 'brand' },
    { label: 'On-site now', value: onSite.length, hint: 'currently checked in', icon: Icon.presence, tone: 'good', accent: true },
    { label: 'Checked in today', value: checkedInToday.length, hint: 'across all sites', icon: Icon.calendar, tone: 'info' },
    {
      label: 'Late today',
      value: lateToday.length,
      hint: 'arrived after grace',
      icon: Icon.clock,
      tone: lateToday.length > 0 ? 'warn' : 'good',
    },
    {
      label: 'Anomalies',
      value: locationAnomalies.length,
      hint: 'outside approved area',
      icon: Icon.alert,
      tone: locationAnomalies.length > 0 ? 'alert' : 'good',
    },
  ]

  return (
    <div className="overview reveal">
      {/* Friendly greeting hero with the live "present today" ring. */}
      <section className="hero-card">
        <div className="hero-main">
          <p className="hero-eyebrow">{longDate}</p>
          <h1 className="hero-title">{greeting()}</h1>
          <p className="hero-sub">
            A live snapshot of attendance across all approved locations.
          </p>
          <div className="hero-chips">
            <span className="hero-chip hero-chip-good">
              <span className="live-dot" /> {onSite.length} on-site now
            </span>
            <span className="hero-chip">
              {onTimeToday} on time
            </span>
            {lateToday.length > 0 && (
              <span className="hero-chip hero-chip-warn">
                {lateToday.length} late
              </span>
            )}
          </div>
        </div>
        <div className="hero-ring">
          <Ring pct={presentPct} />
          <p className="hero-ring-cap">
            {checkedInToday.length} of {employees.length} employees today
          </p>
        </div>
      </section>

      <div className="stat-grid">
        {stats.map((s) => (
          <div key={s.label} className={`stat-tile stat-tone-${s.tone}`}>
            <div className="stat-top">
              <span className="stat-icon">{s.icon}</span>
            </div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-hint">{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="panel-row">
        <div className="panel">
          <div className="panel-header">
            <span className="panel-lead panel-lead-good">{Icon.presence}</span>
            <h2 className="panel-title">Who's on-site now</h2>
            <span className="panel-count">{onSite.length}</span>
          </div>

          {onSite.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">{Icon.coffee}</span>
              <p>No one is checked in right now.</p>
            </div>
          ) : (
            <ul className="onsite-list">
              {onSite.map((r) => (
                <li key={r.id} className="onsite-row">
                  <span className="avatar">{initials(r.employeeName)}</span>
                  <div className="onsite-main">
                    <div className="onsite-name">{r.employeeName}</div>
                    <div className="onsite-sub">{r.locationName ?? '—'}</div>
                  </div>
                  <div className="onsite-time">
                    <span className="live-dot" />
                    since {localTime(r.checkInUtc, r.tzOffsetMinutes)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="panel-lead panel-lead-alert">{Icon.alert}</span>
            <h2 className="panel-title">Anomalies</h2>
            <span className="panel-count">{locationAnomalies.length}</span>
          </div>

          {locationAnomalies.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon empty-icon-good">{Icon.check}</span>
              <p>No one has left their approved area today.</p>
            </div>
          ) : (
            <ul className="onsite-list">
              {locationAnomalies.map((r) => (
                <li key={r.id} className="onsite-row">
                  <span className="avatar avatar-alert">{initials(r.employeeName)}</span>
                  <div className="onsite-main">
                    <div className="onsite-name">{r.employeeName}</div>
                    <div className="onsite-sub">
                      {r.distanceMeters != null ? `${r.distanceMeters}m from ${r.locationName ?? 'approved area'}` : '—'}
                    </div>
                  </div>
                  <div className="onsite-time">
                    <span className="alert-dot" />
                    at {localTime(r.timestamp, r.tzOffsetMinutes)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
