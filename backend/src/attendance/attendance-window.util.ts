// Shared by AttendanceService and OffsiteCheckinService so an onsite and an
// offsite check-in at the same location, same role, obey identical hours.
import type { AttendanceWindows, TimeWindow } from '../locations/locations.service';

export type AttendanceRoleKey = 'office_employee' | 'site_employee' | 'site_supervisor';
export type AttendanceAction = 'checkIn' | 'checkOut';

export interface WindowCheckResult {
  allowed: boolean;
  /** Only set when `allowed` is false — the configured window that was missed. */
  window?: { from: string; to: string };
}

function parseHHMM(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Minutes since local midnight, using the same tz-offset resolution the rest
// of attendance already applies for display — "location hours" are wall-clock
// hours at that location, not a raw UTC comparison.
export function localMinutesOfDay(utcMs: number, tzOffsetMinutes: number): number {
  const local = utcMs + tzOffsetMinutes * 60000;
  const minutesSinceEpoch = Math.floor(local / 60000);
  return ((minutesSinceEpoch % 1440) + 1440) % 1440;
}

// Unconfigured (either end missing) or malformed -> unrestricted. Only a
// genuinely complete, valid pair can ever narrow access — see
// locations.service.ts's sanitizeAttendanceWindows, which already drops
// anything else before this ever runs.
export function isWithinWindow(
  window: TimeWindow | undefined,
  nowMinutesLocal: number,
): WindowCheckResult {
  const fromMin = parseHHMM(window?.from);
  const toMin = parseHHMM(window?.to);
  if (fromMin === null || toMin === null || fromMin === toMin) {
    return { allowed: true };
  }

  const inside =
    fromMin < toMin
      ? nowMinutesLocal >= fromMin && nowMinutesLocal <= toMin
      : // Overnight window (e.g. 22:00 -> 06:00): wraps past midnight.
        nowMinutesLocal >= fromMin || nowMinutesLocal <= toMin;

  return inside
    ? { allowed: true }
    : { allowed: false, window: { from: window!.from!, to: window!.to! } };
}

export function checkAttendanceWindow(
  windows: AttendanceWindows | undefined,
  role: AttendanceRoleKey,
  action: AttendanceAction,
  nowMinutesLocal: number,
): WindowCheckResult {
  const roleWindows = windows?.[role];
  const window = action === 'checkIn' ? roleWindows?.checkIn : roleWindows?.checkOut;
  return isWithinWindow(window, nowMinutesLocal);
}

// "08:00" -> "8:00 AM", for messages shown to the employee/admin.
export function formatHHMM(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const hour24 = Number(m[1]);
  const minute = m[2];
  const period = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${period}`;
}
