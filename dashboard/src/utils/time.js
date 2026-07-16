// Timestamps are always STORED in UTC. These helpers convert to a readable
// local time only for DISPLAY, using the timezone offset saved on each record.

// Formats a UTC ISO string into the record's local time, e.g. "2026-07-13 09:02".
export function formatLocal(utcString, tzOffsetMinutes = 0) {
  if (!utcString) return '—'
  const utc = new Date(utcString)
  const shifted = new Date(utc.getTime() + tzOffsetMinutes * 60000)
  const text = shifted.toISOString().replace('T', ' ').slice(0, 16)
  const sign = tzOffsetMinutes >= 0 ? '+' : '-'
  const hours = Math.abs(tzOffsetMinutes) / 60
  return `${text} (UTC${sign}${hours})`
}

// Formats an amount of hours for display: under an hour it drops to whole
// minutes ("42 m"); an hour or more stays in hours ("8.48 h").
export function formatHours(hours) {
  const hrs = hours || 0
  if (hrs < 1) return `${Math.round(hrs * 60)} m`
  return `${hrs.toFixed(2)} h`
}

// Worked hours between two UTC timestamps, e.g. "8.48 h" (or "42 m" for short
// shifts). The offset cancels out in a difference, so we can subtract the UTC
// values directly.
export function workedHours(checkInUtc, checkOutUtc) {
  if (!checkInUtc || !checkOutUtc) return '—'
  const ms = new Date(checkOutUtc) - new Date(checkInUtc)
  return formatHours(ms / 3600000)
}

// Just the local clock time from a UTC string, e.g. "08:02".
export function localTime(utcString, tzOffsetMinutes = 0) {
  if (!utcString) return '—'
  const shifted = new Date(new Date(utcString).getTime() + tzOffsetMinutes * 60000)
  return shifted.toISOString().slice(11, 16)
}

// The local calendar date of a UTC string, e.g. "2026-07-13".
export function localDateISO(utcString, tzOffsetMinutes = 0) {
  if (!utcString) return ''
  const shifted = new Date(new Date(utcString).getTime() + tzOffsetMinutes * 60000)
  return shifted.toISOString().slice(0, 10)
}

// Today's calendar date in the given offset, e.g. "2026-07-13".
export function todayISO(tzOffsetMinutes = 0) {
  const shifted = new Date(Date.now() + tzOffsetMinutes * 60000)
  return shifted.toISOString().slice(0, 10)
}

// Formats a whole-minute duration into a compact, human-readable string.
// Under an hour it stays in minutes ("42m"); once it reaches 60 minutes it
// rolls up into hours ("1h 7m", or just "2h" when there are no spare minutes).
export function formatDuration(minutes) {
  const m = Math.round(minutes || 0)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}
