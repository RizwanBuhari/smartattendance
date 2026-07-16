// Shared, pure attendance-report logic used by BOTH the on-screen Reports page
// and the Excel export, so the workbook always matches what's shown on screen.
//
// A "report" is attendance (and, for the location tabs, background pings) scoped
// to one employee OR the whole company, over a daily / monthly / yearly period.
import { localDateISO, localTime } from './time'
import { punctuality, overtimeHours } from './attendance'

// Office timezone offset (Dubai, UTC+4) — matches the backend. Used only to
// decide which local day/month/year a record falls in.
export const TZ_OFFSET_MINUTES = 240
const HOUR = 3600000

export function tzOf(record) {
  return record?.tzOffsetMinutes ?? TZ_OFFSET_MINUTES
}

// Hours between two UTC timestamps as a number (null if the shift is still open).
export function hoursBetween(checkInUtc, checkOutUtc) {
  if (!checkInUtc || !checkOutUtc) return null
  return (new Date(checkOutUtc) - new Date(checkInUtc)) / HOUR
}

// "Now" in office-local time, as an ISO string, for default period values.
function nowLocalISO() {
  return new Date(Date.now() + TZ_OFFSET_MINUTES * 60000).toISOString()
}

// The default period value for a scope: today / this month / this year.
export function defaultPeriodValue(period) {
  const iso = nowLocalISO()
  if (period === 'daily') return iso.slice(0, 10) // YYYY-MM-DD
  if (period === 'monthly') return iso.slice(0, 7) // YYYY-MM
  return iso.slice(0, 4) // YYYY
}

const PERIOD_LABELS = { daily: 'Daily', monthly: 'Monthly', yearly: 'Yearly' }

// Turns a period + a specific value into: a human label, the date prefix to
// match on, and a matcher for a local 'YYYY-MM-DD' date. A missing value falls
// back to the current day/month/year.
export function periodInfo(period, value) {
  const prefix = value || defaultPeriodValue(period)
  return {
    period,
    prefix,
    label: `${PERIOD_LABELS[period] ?? 'Report'} — ${prefix}`,
    matches: (localDate) => !!localDate && localDate.startsWith(prefix),
  }
}

// The keys an employee's attendance/pings might be filed under: their doc id or
// their Firebase UID.
export function employeeKeys(employee) {
  return new Set([employee?.id, employee?.authUid].filter(Boolean))
}

// Attendance filtered to a scope (one employee or, when employee is null, the
// whole company) and a period.
export function filterRecords(attendance, { employee, info }) {
  const keys = employee ? employeeKeys(employee) : null
  return attendance.filter((r) => {
    if (!r.checkInUtc) return false
    if (keys && !keys.has(r.employeeId)) return false
    return info.matches(localDateISO(r.checkInUtc, tzOf(r)))
  })
}

// One display row per attendance session. Numeric fields stay numbers so the
// page can format them and Excel can do math on them.
export function timesheetRows(records) {
  return records.map((r) => {
    const tz = tzOf(r)
    const p = punctuality(r.checkInUtc, tz)
    return {
      id: r.id,
      employeeName: r.employeeName ?? '—',
      date: localDateISO(r.checkInUtc, tz),
      checkIn: localTime(r.checkInUtc, tz),
      checkOut: r.checkOutUtc ? localTime(r.checkOutUtc, tz) : null,
      workedHours: hoursBetween(r.checkInUtc, r.checkOutUtc),
      overtime: overtimeHours(r.checkInUtc, r.checkOutUtc),
      lateMinutes: p.lateMinutes,
      late: p.late,
      location: r.locationName ?? '—',
      flaggedOutside: !!r.flaggedOutside,
    }
  })
}

// Totals across a set of records (a company, or one employee).
export function summarize(records) {
  const days = new Set()
  let hours = 0
  let ot = 0
  let late = 0
  let flagged = 0
  let open = 0
  for (const r of records) {
    const tz = tzOf(r)
    days.add(localDateISO(r.checkInUtc, tz))
    const worked = hoursBetween(r.checkInUtc, r.checkOutUtc)
    if (worked == null) open += 1
    hours += worked ?? 0
    ot += overtimeHours(r.checkInUtc, r.checkOutUtc)
    if (punctuality(r.checkInUtc, tz).late) late += 1
    if (r.flaggedOutside) flagged += 1
  }
  const dayCount = days.size
  return {
    sessions: records.length,
    daysPresent: dayCount,
    totalHours: hours,
    totalOvertime: ot,
    avgHoursPerDay: dayCount ? hours / dayCount : 0,
    lateSessions: late,
    flaggedSessions: flagged,
    openSessions: open,
  }
}

// The company breakdown: one summary row per employee, sorted by name.
export function summarizeByEmployee(records) {
  const groups = new Map()
  for (const r of records) {
    const key = r.employeeId ?? r.employeeName ?? '—'
    if (!groups.has(key)) {
      groups.set(key, { name: r.employeeName ?? '—', records: [] })
    }
    groups.get(key).records.push(r)
  }
  return [...groups.values()]
    .map((g) => ({ name: g.name, ...summarize(g.records) }))
    .sort((a, b) => (a.name > b.name ? 1 : -1))
}

// Every coordinate sample in the period: background pings + attendance
// check-in/out coordinates. `pings` are raw (all time); we filter to the period.
export function collectPoints(records, pings, info) {
  const points = []
  for (const p of pings) {
    const tz = p.tzOffsetMinutes ?? TZ_OFFSET_MINUTES
    const local = localDateISO(p.timestamp, tz)
    if (!info.matches(local)) continue
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue
    points.push({
      employee: p.employeeName ?? '—',
      time: `${local} ${localTime(p.timestamp, tz)}`,
      lat: p.lat,
      lng: p.lng,
      inside: !!p.insideGeofence,
      location: p.locationName ?? '—',
      source: 'Tracking ping',
    })
  }
  for (const r of records) {
    const tz = tzOf(r)
    const add = (coords, whichUtc, source) => {
      if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') return
      points.push({
        employee: r.employeeName ?? '—',
        time: `${localDateISO(whichUtc, tz)} ${localTime(whichUtc, tz)}`,
        lat: coords.lat,
        lng: coords.lng,
        inside: !r.flaggedOutside,
        location: r.locationName ?? '—',
        source,
      })
    }
    add(r.checkInCoords, r.checkInUtc, 'Check-in')
    add(r.checkOutCoords, r.checkOutUtc, 'Check-out')
  }
  points.sort((a, b) => (a.time < b.time ? 1 : -1))
  return points
}

export const HEAT_GRID = 12

// Bins location points into a GRID×GRID density matrix (row 0 = highest
// latitude), plus the bounds/steps needed to label and colour it. Returns null
// when there are no points.
export function buildHeatmapMatrix(points, grid = HEAT_GRID) {
  if (!points.length) return null
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  let minLat = Math.min(...lats)
  let maxLat = Math.max(...lats)
  let minLng = Math.min(...lngs)
  let maxLng = Math.max(...lngs)
  // Guard against a zero-width span (all points at one spot).
  if (maxLat - minLat < 1e-6) {
    minLat -= 0.0005
    maxLat += 0.0005
  }
  if (maxLng - minLng < 1e-6) {
    minLng -= 0.0005
    maxLng += 0.0005
  }
  const latStep = (maxLat - minLat) / grid
  const lngStep = (maxLng - minLng) / grid
  const matrix = Array.from({ length: grid }, () => Array(grid).fill(0))
  const clamp = (v) => Math.max(0, Math.min(grid - 1, v))
  let max = 0
  for (const p of points) {
    const row = clamp(Math.floor((maxLat - p.lat) / latStep)) // top = highest lat
    const col = clamp(Math.floor((p.lng - minLng) / lngStep))
    matrix[row][col] += 1
    if (matrix[row][col] > max) max = matrix[row][col]
  }
  return { matrix, grid, minLat, maxLat, minLng, maxLng, latStep, lngStep, max }
}
