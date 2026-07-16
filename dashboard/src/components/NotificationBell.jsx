// Notification bell for the top utility strip: a bell icon with an unread-count
// badge that opens a dropdown of admin alerts (employees outside the geofence,
// late arrivals, forgotten check-outs, long shifts). Alerts are derived on the
// client from attendance + the live anomaly panel (see notificationsService).
//
// Read state, matching how people expect a bell to behave:
//   • The OUTSIDE badge counts every UNREAD notification, so the number is
//     visible up front — before the panel is ever opened — and only drops as
//     each notification is actually read.
//   • Each notification tracks its own read state. Opening a specific
//     notification marks just that one read; both the badge and the in-panel
//     count reflect how many are still unread.
//
// When a brand-new notification arrives while the page is open, it also slides
// in as a toast in the top-right corner and auto-dismisses.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { buildNotifications } from '../services/notificationsService'
import { subscribeAttendance, subscribeAnomalies } from '../services/realtime'

// Bump the suffix to reset everyone's read state (e.g. so every existing
// notification resurfaces as unread).
const READ_KEY = 'notifsReadIds_v2'
const TOAST_MS = 6000 // how long a toast lingers before auto-dismissing

// "3m ago", "2h ago", "5d ago".
function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// Short header shown on the toast, by urgency.
const TOAST_TITLE = { high: 'Alert', medium: 'Reminder', low: 'Notice' }

export default function NotificationBell() {
  const navigate = useNavigate()
  const [notes, setNotes] = useState([])
  const [open, setOpen] = useState(false)
  const [toasts, setToasts] = useState([])
  // Ids of notifications the admin has individually opened. Persisted so a
  // refresh doesn't resurface them as unread.
  const [readIds, setReadIds] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]'))
    } catch {
      return new Set()
    }
  })

  // Every id we've already reacted to, plus the moment we mounted. Together they
  // let us toast only notifications for events that happen after load — the
  // initial backlog is seeded silently on the first build.
  const knownIdsRef = useRef(new Set())
  const mountTimeRef = useRef(Date.now())

  // Realtime: the feed rebuilds itself the instant attendance or an anomaly
  // changes, by listening to both and recomputing the notifications.
  useEffect(() => {
    let attendance = []
    let anomalies = []
    let ready = false
    const rebuild = () => {
      if (ready) setNotes(buildNotifications(attendance, anomalies))
    }
    const unsubAttendance = subscribeAttendance((data) => {
      attendance = data
      ready = true
      rebuild()
    })
    const unsubAnomalies = subscribeAnomalies((data) => {
      anomalies = data
      rebuild()
    })
    return () => {
      unsubAttendance()
      unsubAnomalies()
    }
  }, [])

  // Detect notifications we haven't seen before and pop a toast for the ones
  // whose underlying event is genuinely new (fired after we mounted). Backlog
  // items loaded at startup carry old timestamps, so they seed silently.
  useEffect(() => {
    const known = knownIdsRef.current
    const fresh = notes.filter((n) => !known.has(n.id))
    notes.forEach((n) => known.add(n.id))
    if (!fresh.length) return

    const popped = fresh.filter(
      (n) =>
        new Date(n.time).getTime() > mountTimeRef.current && !readIds.has(n.id),
    )
    if (!popped.length) return

    setToasts((prev) => {
      const merged = [...popped, ...prev]
      const seen = new Set()
      return merged.filter((n) => !seen.has(n.id) && seen.add(n.id)).slice(0, 4)
    })
    popped.forEach((n) =>
      setTimeout(() => dismissToast(n.id), TOAST_MS),
    )
  }, [notes]) // eslint-disable-line react-hooks/exhaustive-deps

  function dismissToast(id) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  function markRead(id) {
    setReadIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      localStorage.setItem(READ_KEY, JSON.stringify([...next]))
      return next
    })
  }

  // Unread = notifications not yet individually opened. Drives both the outside
  // badge and the in-panel count.
  const unread = notes.filter((n) => !readIds.has(n.id)).length

  function toggle() {
    setOpen((o) => !o)
  }

  // Opening a specific notification marks just that one read, then jumps to the
  // attendance page for the detail.
  function openItem(note) {
    markRead(note.id)
    dismissToast(note.id)
    setOpen(false)
    navigate('/attendance')
  }

  return (
    <div className="notif-wrap">
      <button
        className="notif-btn"
        onClick={toggle}
        title="Notifications"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <>
          <div className="notif-backdrop" onClick={() => setOpen(false)} />
          <div className="notif-menu" role="menu">
            <div className="notif-menu-head">
              <span>Notifications</span>
              {unread > 0 && <span className="notif-count">{unread}</span>}
            </div>
            {notes.length === 0 ? (
              <div className="notif-empty">You're all caught up.</div>
            ) : (
              <ul className="notif-list">
                {notes.slice(0, 40).map((n) => {
                  const isRead = readIds.has(n.id)
                  return (
                    <li key={n.id}>
                      <button
                        className={`notif-item ${
                          isRead ? 'notif-item-read' : 'notif-item-unread'
                        }`}
                        onClick={() => openItem(n)}
                      >
                        <span className={`notif-dot notif-${n.severity}`} />
                        <span className="notif-body">
                          <span className="notif-msg">{n.message}</span>
                          <span className="notif-time">{timeAgo(n.time)}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {toasts.length > 0 && (
        <div className="notif-toasts">
          {toasts.map((n) => (
            <div
              key={n.id}
              className={`notif-toast notif-${n.severity}`}
              role="alert"
              onClick={() => openItem(n)}
            >
              <span className={`notif-dot notif-${n.severity}`} />
              <span className="notif-toast-body">
                <span className="notif-toast-title">
                  {TOAST_TITLE[n.severity] ?? 'Notice'}
                </span>
                <span className="notif-toast-msg">{n.message}</span>
                <span className="notif-time">{timeAgo(n.time)}</span>
              </span>
              <button
                className="notif-toast-close"
                aria-label="Dismiss"
                onClick={(e) => {
                  e.stopPropagation()
                  dismissToast(n.id)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
