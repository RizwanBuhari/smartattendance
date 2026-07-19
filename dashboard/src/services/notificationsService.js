// Derives the admin's notification feed from data the backend already exposes —
// there's no dedicated notifications collection yet, so we compute the alerts
// on the fly from attendance records and the live location-anomaly panel.
//
// Each notification is { id, type, severity, employeeName, message, time }.
// `time` is a UTC ISO string (when the underlying event happened) and drives
// both the sort order and the unread badge (anything newer than the last time
// the bell was opened counts as unread).
import { formatLocal, formatDuration } from '../utils/time'
import { punctuality } from '../utils/attendance'

const TZ_OFFSET_MINUTES = 240
const HOUR = 3600000
const DAY = 24 * HOUR

// How long an open (still checked-in) session may run before it's treated as a
// forgotten check-out, and how long a shift must be to count as excessive.
const MISSING_CHECKOUT_HOURS = 16
const LONG_SHIFT_HOURS = 12

function tzOf(record) {
  return record.tzOffsetMinutes ?? TZ_OFFSET_MINUTES
}

// Pure builder: turns already-fetched attendance records + live anomalies into
// the de-duplicated notification feed, newest event first. Used by the realtime
// notification bell (which feeds it live onSnapshot data).
export function buildNotifications(attendance, anomalies) {
  const now = Date.now()
  const notes = []

  for (const r of attendance) {
    const tz = tzOf(r)
    const inMs = r.checkInUtc ? new Date(r.checkInUtc).getTime() : 0
    if (!inMs) continue
    const ageDays = (now - inMs) / DAY

    // Left the approved area mid-shift (a background ping caught them outside).
    if (r.flaggedOutside && ageDays <= 7) {
      notes.push({
        id: `flag:${r.id}`,
        type: 'geofence',
        severity: 'high',
        employeeName: r.employeeName,
        time: r.checkInUtc,
        message: `${r.employeeName} was identified outside the approved radius during a shift.`,
      })
    }

    // Check-in success / failure notifications
    if (r.status === 'checked_in' && ageDays <= 2) {
      notes.push({
        id: `accept-in:${r.id}`,
        type: 'checkin-accepted',
        severity: 'low',
        employeeName: r.employeeName,
        time: r.checkInUtc,
        message: `${r.employeeName} checked in successfully.`,
      })
    } else if (r.status === 'rejected' && ageDays <= 2) {
      notes.push({
        id: `reject-in:${r.id}`,
        type: 'checkin-rejected',
        severity: 'high',
        employeeName: r.employeeName,
        time: r.checkInUtc,
        message: `${r.employeeName}'s check-in was rejected (outside approved locations).`,
      })
    }

    // Checkout success / failure / review decision notifications
    if (r.status === 'checked_out' && r.checkOutUtc && ageDays <= 2) {
      if (!r.checkoutReview || r.checkoutReview.status === 'accepted') {
        notes.push({
          id: `accept-out:${r.id}`,
          type: 'checkout-accepted',
          severity: 'low',
          employeeName: r.employeeName,
          time: r.checkOutUtc,
          message: `${r.employeeName} checked out successfully.`,
        })
      } else if (r.checkoutReview.status === 'rejected') {
        notes.push({
          id: `reject-out:${r.id}`,
          type: 'checkout-rejected',
          severity: 'high',
          employeeName: r.employeeName,
          time: r.checkOutUtc,
          message: `${r.employeeName}'s checkout was rejected by admin.`,
        })
      }
    } else if (r.status === 'rejected_checkout' && ageDays <= 2) {
      notes.push({
        id: `reject-out-fail:${r.id}`,
        type: 'checkout-rejected-fail',
        severity: 'high',
        employeeName: r.employeeName,
        time: r.checkInUtc,
        message: `${r.employeeName}'s checkout attempt was rejected (outside approved locations).`,
      })
    }

    if (r.status === 'rejected' || r.status === 'rejected_checkout') continue;

    // Still checked in long after they started — likely a forgotten check-out.
    if (r.status === 'checked_in' && now - inMs > MISSING_CHECKOUT_HOURS * HOUR) {
      notes.push({
        id: `open:${r.id}`,
        type: 'missing-checkout',
        severity: 'medium',
        employeeName: r.employeeName,
        time: r.checkInUtc,
        message: `${r.employeeName} has been checked in since ${formatLocal(r.checkInUtc, tz)} with no check-out.`,
      })
    }

    // Late arrival (recent only, so the feed doesn't fill with old tardiness).
    if (ageDays <= 2 && (r.status === 'checked_in' || r.status === 'checked_out')) {
      const p = punctuality(r.checkInUtc, tz)
      if (p.late) {
        notes.push({
          id: `late:${r.id}`,
          type: 'late',
          severity: 'low',
          employeeName: r.employeeName,
          time: r.checkInUtc,
          message: `${r.employeeName} arrived ${formatDuration(p.lateMinutes)} late.`,
        })
      }
    }

    // Unusually long completed shift.
    if (r.checkOutUtc && ageDays <= 7 && r.status === 'checked_out') {
      const worked = (new Date(r.checkOutUtc) - inMs) / HOUR
      if (worked >= LONG_SHIFT_HOURS) {
        notes.push({
          id: `ot:${r.id}`,
          type: 'overtime',
          severity: 'low',
          employeeName: r.employeeName,
          time: r.checkOutUtc,
          message: `${r.employeeName} logged a very long shift (${worked.toFixed(1)} h).`,
        })
      }
    }
  }

  // Currently outside the geofence (one entry per employee, from the last 24h).
  for (const a of anomalies) {
    const away = a.distanceMeters ? ` (~${Math.round(a.distanceMeters)} m away)` : ''
    notes.push({
      id: `anom:${a.id}`,
      type: 'outside-now',
      severity: 'high',
      employeeName: a.employeeName,
      time: a.timestamp,
      message: `${a.employeeName} is currently outside their approved area${away}.`,
    })
  }

  notes.sort((x, y) => (x.time < y.time ? 1 : -1))
  return notes
}
