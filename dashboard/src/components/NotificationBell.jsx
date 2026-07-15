// Notification bell for the top utility strip: a bell icon with an unread-count
// badge that opens a dropdown of admin alerts (employees outside the geofence,
// late arrivals, forgotten check-outs, long shifts). Alerts are derived on the
// client from attendance + the live anomaly panel (see notificationsService).
//
// "Unread" is anything whose event time is newer than the last time the bell
// was opened; that timestamp is persisted in localStorage so the badge doesn't
// re-alarm on every refresh.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getNotifications } from '../services/notificationsService'
import { useAutoRefresh } from '../utils/useAutoRefresh'

const SEEN_KEY = 'notifsLastSeenAt'

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

export default function NotificationBell() {
  const navigate = useNavigate()
  const [notes, setNotes] = useState([])
  const [open, setOpen] = useState(false)
  const [lastSeen, setLastSeen] = useState(() =>
    Number(localStorage.getItem(SEEN_KEY) || 0),
  )

  const load = useCallback(async () => {
    try {
      setNotes(await getNotifications())
    } catch {
      // Leave the previous feed in place on a transient failure.
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Keep the feed fresh on focus + periodically, like the rest of the dashboard.
  useAutoRefresh(load)

  const unread = notes.filter(
    (n) => new Date(n.time).getTime() > lastSeen,
  ).length

  function toggle() {
    const next = !open
    setOpen(next)
    // Opening the panel marks everything currently shown as read.
    if (next) {
      const t = Date.now()
      localStorage.setItem(SEEN_KEY, String(t))
      setLastSeen(t)
    }
  }

  function openItem() {
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
              {notes.length > 0 && (
                <span className="notif-count">{notes.length}</span>
              )}
            </div>
            {notes.length === 0 ? (
              <div className="notif-empty">You're all caught up.</div>
            ) : (
              <ul className="notif-list">
                {notes.slice(0, 40).map((n) => (
                  <li key={n.id}>
                    <button className="notif-item" onClick={openItem}>
                      <span className={`notif-dot notif-${n.severity}`} />
                      <span className="notif-body">
                        <span className="notif-msg">{n.message}</span>
                        <span className="notif-time">{timeAgo(n.time)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
