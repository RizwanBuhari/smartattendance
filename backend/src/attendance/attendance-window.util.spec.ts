// Proves the rule that decides whether check-in/check-out is allowed right
// now for a given location + role — the same function AttendanceService
// (onsite) and OffsiteCheckinService (offsite) both call, so this one spec
// covers the logic behind both enforcement points.
import {
  isWithinWindow,
  checkAttendanceWindow,
  localMinutesOfDay,
  formatHHMM,
} from './attendance-window.util';

describe('isWithinWindow', () => {
  it('is unrestricted when the window is undefined', () => {
    expect(isWithinWindow(undefined, 9 * 60).allowed).toBe(true);
  });

  it('is unrestricted when either end of the pair is missing', () => {
    expect(isWithinWindow({ from: '08:00' }, 9 * 60).allowed).toBe(true);
    expect(isWithinWindow({ to: '17:00' }, 9 * 60).allowed).toBe(true);
    expect(isWithinWindow({}, 9 * 60).allowed).toBe(true);
  });

  it('is unrestricted when a value is malformed', () => {
    expect(isWithinWindow({ from: '25:00', to: '17:00' }, 9 * 60).allowed).toBe(true);
    expect(isWithinWindow({ from: '8am', to: '17:00' }, 9 * 60).allowed).toBe(true);
  });

  it('is unrestricted when from equals to (treated as "no real window")', () => {
    expect(isWithinWindow({ from: '09:00', to: '09:00' }, 12 * 60).allowed).toBe(true);
  });

  it('allows exactly at the boundaries of a same-day window', () => {
    const w = { from: '08:00', to: '17:00' };
    expect(isWithinWindow(w, 8 * 60).allowed).toBe(true); // 08:00
    expect(isWithinWindow(w, 17 * 60).allowed).toBe(true); // 17:00
    expect(isWithinWindow(w, 12 * 60).allowed).toBe(true); // 12:00, mid-window
  });

  it('rejects outside a same-day window and names the configured hours', () => {
    const w = { from: '08:00', to: '17:00' };
    const before = isWithinWindow(w, 7 * 60 + 59);
    expect(before.allowed).toBe(false);
    expect(before.window).toEqual({ from: '08:00', to: '17:00' });

    const after = isWithinWindow(w, 17 * 60 + 1);
    expect(after.allowed).toBe(false);
  });

  it('handles an overnight window that wraps past midnight', () => {
    const w = { from: '22:00', to: '06:00' };
    expect(isWithinWindow(w, 23 * 60).allowed).toBe(true); // 23:00
    expect(isWithinWindow(w, 2 * 60).allowed).toBe(true); // 02:00
    expect(isWithinWindow(w, 6 * 60).allowed).toBe(true); // 06:00 boundary
    expect(isWithinWindow(w, 22 * 60).allowed).toBe(true); // 22:00 boundary
    expect(isWithinWindow(w, 12 * 60).allowed).toBe(false); // 12:00, well outside
  });
});

describe('checkAttendanceWindow', () => {
  const windows = {
    office_employee: {
      checkIn: { from: '08:00', to: '10:00' },
      checkOut: { from: '16:00', to: '19:00' },
    },
    site_employee: {
      checkIn: { from: '06:00', to: '08:00' },
      // no checkOut configured -> unrestricted
    },
  };

  it('applies the right role and action independently', () => {
    expect(checkAttendanceWindow(windows, 'office_employee', 'checkIn', 9 * 60).allowed).toBe(true);
    expect(checkAttendanceWindow(windows, 'office_employee', 'checkIn', 11 * 60).allowed).toBe(false);
    expect(checkAttendanceWindow(windows, 'office_employee', 'checkOut', 17 * 60).allowed).toBe(true);
    expect(checkAttendanceWindow(windows, 'office_employee', 'checkOut', 9 * 60).allowed).toBe(false);
  });

  it('is unrestricted for an action with no configured window', () => {
    expect(checkAttendanceWindow(windows, 'site_employee', 'checkOut', 3 * 60).allowed).toBe(true);
  });

  it('is unrestricted for a role with no entry at all (e.g. site_supervisor here)', () => {
    expect(checkAttendanceWindow(windows, 'site_supervisor', 'checkIn', 3 * 60).allowed).toBe(true);
  });

  it('is unrestricted when the whole windows map is undefined (unconfigured location)', () => {
    expect(checkAttendanceWindow(undefined, 'office_employee', 'checkIn', 9 * 60).allowed).toBe(true);
  });
});

describe('localMinutesOfDay', () => {
  it('converts a UTC instant to minutes-since-midnight in the given offset', () => {
    // 2026-01-02T04:30:00Z at UTC+4 -> 08:30 local -> 510 minutes.
    const utcMs = Date.parse('2026-01-02T04:30:00.000Z');
    expect(localMinutesOfDay(utcMs, 240)).toBe(8 * 60 + 30);
  });

  it('wraps correctly across the local midnight boundary', () => {
    // 2026-01-02T21:00:00Z at UTC+4 -> 01:00 local the next day -> 60 minutes.
    const utcMs = Date.parse('2026-01-02T21:00:00.000Z');
    expect(localMinutesOfDay(utcMs, 240)).toBe(60);
  });

  it('handles a negative offset', () => {
    // 2026-01-02T02:00:00Z at UTC-5 -> 21:00 the previous day -> 1260 minutes.
    const utcMs = Date.parse('2026-01-02T02:00:00.000Z');
    expect(localMinutesOfDay(utcMs, -300)).toBe(21 * 60);
  });
});

describe('formatHHMM', () => {
  it('formats midnight, noon, and ordinary times as 12-hour', () => {
    expect(formatHHMM('00:00')).toBe('12:00 AM');
    expect(formatHHMM('12:00')).toBe('12:00 PM');
    expect(formatHHMM('08:05')).toBe('8:05 AM');
    expect(formatHHMM('17:30')).toBe('5:30 PM');
    expect(formatHHMM('23:59')).toBe('11:59 PM');
  });
});
