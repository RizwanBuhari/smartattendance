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

// Worked hours between two UTC timestamps, e.g. "8.48 h". The offset cancels
// out in a difference, so we can subtract the UTC values directly.
export function workedHours(checkInUtc, checkOutUtc) {
  if (!checkInUtc || !checkOutUtc) return '—'
  const ms = new Date(checkOutUtc) - new Date(checkInUtc)
  return `${(ms / 3600000).toFixed(2)} h`
}
