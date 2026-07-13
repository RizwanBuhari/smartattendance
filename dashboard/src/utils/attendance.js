// Company attendance policy + time-intelligence helpers, modeled on Bayzat's
// attendance module (late detection, overtime, punctuality).
//
// Tune these constants to match the real HR rules for Elsewedy Electric.
// Dubai office official hours: 9:00 AM – 6:00 PM (a 9-hour day).
export const WORK_START = '09:00' // expected local check-in time (24h)
export const WORK_END = '18:00' // official end of the working day
export const GRACE_MINUTES = 10 // grace period before a check-in counts as late
export const STANDARD_HOURS = 9 // standard working hours per day (09:00-18:00); overtime beyond this

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// Minutes since midnight of a UTC timestamp, in the record's local time.
function localMinutesOfDay(utcString, tzOffsetMinutes = 0) {
  const shifted = new Date(new Date(utcString).getTime() + tzOffsetMinutes * 60000)
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

// Was this check-in late? Returns { late, lateMinutes }, where lateMinutes is
// how many minutes past the scheduled start (0 when on time or early).
export function punctuality(checkInUtc, tzOffsetMinutes = 0) {
  if (!checkInUtc) return { late: false, lateMinutes: 0 }
  const scheduled = toMinutes(WORK_START)
  const arrived = localMinutesOfDay(checkInUtc, tzOffsetMinutes)
  const diff = arrived - scheduled
  return { late: diff > GRACE_MINUTES, lateMinutes: Math.max(0, diff) }
}

// Hours worked beyond the standard day (0 if still open or under standard).
export function overtimeHours(checkInUtc, checkOutUtc) {
  if (!checkInUtc || !checkOutUtc) return 0
  const hrs = (new Date(checkOutUtc) - new Date(checkInUtc)) / 3600000
  return Math.max(0, hrs - STANDARD_HOURS)
}
