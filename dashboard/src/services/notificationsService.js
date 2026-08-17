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
import { formatAuthMethod, formatFallbackReason } from '../utils/authLabels'

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

// A Firestore server timestamp lands on the client as a Timestamp OBJECT
// (or null, briefly, before the server round-trip resolves it) — never mix
// that into a field this module sorts/formats as a plain ISO string. See the
// check-in fallback note below for what happens when you do.
function isoOf(value, fallback) {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString()
  if (typeof value === 'string') return value
  return fallback
}

// Pure builder: turns already-fetched attendance records + live anomalies +
// "Contact HR" escalations into the de-duplicated notification feed, newest
// event first. Used by the realtime notification bell (which feeds it live
// onSnapshot data).
export function buildNotifications(attendance, anomalies, helpRequests = []) {
  const now = Date.now()
  const notes = []

  for (const r of attendance) {
    const tz = tzOf(r)
    const inMs = r.checkInUtc ? new Date(r.checkInUtc).getTime() : 0
    if (!inMs) continue
    const ageDays = (now - inMs) / DAY

    // Attendance Fallback Used Notification (Check-in)
    if (r.fallbackUsed && ageDays <= 7) {
      const humanAssigned = formatAuthMethod(r.preferredAuthMethod || r.assignedAuthPolicy || 'face')
      const humanActual = formatAuthMethod(r.authMethodUsed || 'device_authentication')
      const humanReason = formatFallbackReason(r.fallbackReason)

      notes.push({
        id: `fallback-in:${r.id}`,
        type: 'attendance_fallback',
        severity: 'high',
        employeeName: r.employeeName,
        // Not r.fallbackUsedAt: that field is a Firestore server Timestamp
        // OBJECT (subscribeAttendance passes doc.data() through raw, with no
        // Timestamp->string conversion), and mixing it into a field this
        // module sorts/formats as a plain ISO string breaks both — the note
        // still gets created, it just sorts unpredictably and can end up
        // effectively invisible. checkInUtc is always a real ISO string and,
        // for this event, near-identical in practice.
        time: r.checkInUtc,
        title: 'Attendance Fallback Used',
        message: `${r.employeeName} checked in using ${humanActual} instead of the assigned ${humanAssigned} method. Reason: ${humanReason}.`,
        attendanceId: r.id,
        assignedMethod: humanAssigned,
        actualMethod: humanActual,
        fallbackReason: humanReason,
        worksiteName: r.locationName,
      })
    }

    // Attendance Fallback Used Notification (Checkout)
    if (r.checkoutFallbackUsed && ageDays <= 7) {
      const humanAssigned = formatAuthMethod(r.preferredAuthMethod || r.assignedAuthPolicy || 'face')
      const humanActual = formatAuthMethod(r.checkoutAuthMethodUsed || 'device_authentication')
      const humanReason = formatFallbackReason(r.checkoutFallbackReason)

      notes.push({
        id: `fallback-out:${r.id}`,
        type: 'attendance_fallback',
        severity: 'high',
        employeeName: r.employeeName,
        time: r.checkOutUtc || r.checkInUtc,
        title: 'Attendance Fallback Used',
        message: `${r.employeeName} checked out using ${humanActual} instead of the assigned ${humanAssigned} method. Reason: ${humanReason}.`,
        attendanceId: r.id,
        assignedMethod: humanAssigned,
        actualMethod: humanActual,
        fallbackReason: humanReason,
        worksiteName: r.locationName,
      })
    }

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

    // Check-in success / failure notifications (suppressed if fallback was used)
    if (r.status === 'checked_in' && !r.fallbackUsed && ageDays <= 2) {
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

    // Checkout success / failure / review decision notifications (suppressed if checkout fallback was used)
    if (r.status === 'checked_out' && !r.checkoutFallbackUsed && r.checkOutUtc && ageDays <= 2) {
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

  // Currently outside or recently returned to the geofence (from the last 24h).
  for (const a of anomalies) {
    if (a.eventType === 'RETURN') {
      notes.push({
        id: `ret:${a.id}`,
        type: 'returned-now',
        severity: 'low',
        employeeName: a.employeeName,
        time: a.timestamp,
        message: `${a.employeeName} has returned to the office radius.`,
      })
    } else {
      const away = a.distanceMeters ? ` (~${Math.round(a.distanceMeters)} m away)` : ''
      const reasonText = a.reason ? ` — Reason: "${a.reason}"` : ''
      notes.push({
        id: `anom:${a.id}`,
        type: 'outside-now',
        severity: 'high',
        employeeName: a.employeeName,
        time: a.timestamp,
        message: `${a.employeeName} is out of working radius${away}${reasonText}.`,
      })
    }
  }

  // "Contact HR" escalations from a fallback-not-available screen — raised
  // once per tap by BiometricsService.requestHelp, independent of any
  // attendance record (the employee may not have completed check-in/out at
  // all when they hit this).
  for (const h of helpRequests) {
    notes.push({
      id: `help:${h.id}`,
      type: 'auth_help_requested',
      severity: 'high',
      employeeName: h.employeeName,
      time: isoOf(h.createdAt, new Date().toISOString()),
      title: h.title || 'Authentication Help Requested',
      message: h.message || `${h.employeeName} needs help completing attendance verification.`,
    })
  }

  notes.sort((x, y) => (x.time < y.time ? 1 : -1))
  return notes
}
