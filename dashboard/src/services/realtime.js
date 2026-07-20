// Realtime Firestore listeners (onSnapshot) for the dashboard — the built-in
// Firebase feature that pushes changes to the client instantly, so the UI
// updates the moment an employee checks in/out, with no polling.
//
// Reads note: a listener is charged the documents ONCE when it attaches, then
// +1 read per document that changes. That's far cheaper than polling (which
// re-reads the whole collection every interval).
//
// Writes/deletes still go through the NestJS backend; these are read-only.
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'

// Generic: streams a whole collection, mapping each doc to { ...data, id }.
// onData(items) fires on every change; returns an unsubscribe function.
export function subscribeCollection(name, onData, onError) {
  return onSnapshot(
    collection(db, name),
    (snap) => onData(snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }))),
    onError,
  )
}

// Streams the pending out-of-radius checkouts for the Review page (mirrors the
// backend's getReviews: attendance where checkoutReview.status == 'pending').
export function subscribeCheckoutReviews(onData, onError) {
  return onSnapshot(
    query(
      collection(db, 'attendance_ids'),
      where('checkoutReview.status', '==', 'pending'),
    ),
    (snap) => {
      const rows = snap.docs
        .map((doc) => ({ ...doc.data(), id: doc.id }))
        .sort((a, b) => (a.checkInUtc < b.checkInUtc ? 1 : -1))
      onData(rows)
    },
    onError,
  )
}

// Streams the live "who's outside their approved area" list (mirrors the
// backend's findAnomalies): the latest out-of-geofence ping per employee in the
// last 24h, kept only for employees who currently have an open shift.
export function subscribeAnomalies(onData, onError) {
  const DAY_MS = 24 * 60 * 60 * 1000
  let onShift = new Set()
  let outPings = []
  let hasAttendance = false
  let hasPings = false

  const recompute = () => {
    const since = new Date(Date.now() - DAY_MS).toISOString()
    const recent = outPings
      .filter((p) => p.timestamp >= since)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    const seen = new Set()
    const latest = []
    for (const p of recent) {
      if (seen.has(p.employeeId)) continue
      seen.add(p.employeeId)
      if (onShift.has(p.employeeId)) latest.push(p)
    }
    onData(latest)
  }

  const unsubAttendance = onSnapshot(
    query(collection(db, 'attendance_ids'), where('status', '==', 'checked_in')),
    (snap) => {
      onShift = new Set(snap.docs.map((doc) => doc.data().employeeId))
      hasAttendance = true
      if (hasPings) recompute()
    },
    onError,
  )
  const unsubPings = onSnapshot(
    query(collection(db, 'geofence_Events'), where('eventType', '==', 'EXIT')),
    (snap) => {
      outPings = snap.docs.map((doc) => {
        const data = doc.data()
        return {
          id: doc.id,
          employeeId: data.employeeId,
          employeeName: data.employeeName,
          timestamp: data.timestamp,
          lat: data.latitude,
          lng: data.longitude,
          gpsAccuracy: data.gpsAccuracy,
          insideGeofence: false,
          locationName: data.locationName,
          distanceMeters: null,
        }
      })
      hasPings = true
      if (hasAttendance) recompute()
    },
    onError,
  )

  return () => {
    unsubAttendance()
    unsubPings()
  }
}

// Subscribes to attendance in realtime and, like the backend's findAll, marks
// each record with `flaggedOutside` (true when a background location ping caught
// that employee outside their approved area during the session). It does this by
// also listening to the out-of-geofence pings and cross-referencing timestamps.
//
// Calls onData(records) with the newest-first list on every change, and
// onError(err) if a listener fails (e.g. Firestore rules deny the read).
// Returns an unsubscribe function — call it on unmount.
export function subscribeAttendance(onData, onError) {
  let attendanceDocs = []
  let anomaliesByEmployee = new Map()
  let hasAttendance = false

  const recompute = () => {
    const now = new Date().toISOString()
    const records = attendanceDocs
      .slice()
      .sort((a, b) => (a.checkInUtc < b.checkInUtc ? 1 : -1))
      .map((d) => {
        const windowEnd = d.checkOutUtc ?? now
        const pingFlagged = (anomaliesByEmployee.get(d.employeeId) ?? []).some(
          (ts) => ts >= d.checkInUtc && ts <= windowEnd,
        )
        // Mirror the backend (AttendanceService.sortMap): a session counts as
        // "outside" if a background ping caught them out during it, OR the
        // checkout itself was made outside the radius. (Accepting an
        // out-of-radius checkout clears checkoutFlagged, so it stops counting.)
        const flaggedOutside = pingFlagged || d.checkoutFlagged === true
        return { ...d, flaggedOutside }
      })
    onData(records)
  }

  const unsubAttendance = onSnapshot(
    collection(db, 'attendance_ids'),
    (snap) => {
      attendanceDocs = snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }))
      hasAttendance = true
      recompute()
    },
    onError,
  )

  // Only the out-of-geofence pings matter for the flag — a small, filtered set.
  const unsubPings = onSnapshot(
    query(collection(db, 'geofence_Events'), where('eventType', '==', 'EXIT')),
    (snap) => {
      const map = new Map()
      for (const doc of snap.docs) {
        const { employeeId, timestamp } = doc.data()
        const list = map.get(employeeId)
        if (list) list.push(timestamp)
        else map.set(employeeId, [timestamp])
      }
      anomaliesByEmployee = map
      if (hasAttendance) recompute()
    },
    onError,
  )

  return () => {
    unsubAttendance()
    unsubPings()
  }
}
