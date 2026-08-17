// Proves the client-side hint that greys out/enables the check-in and
// check-out buttons on attendance_screen.dart and offsite_action_screen.dart.
// This mirrors backend/src/attendance/attendance-window.util.ts — the server
// is what actually decides; this is what the button reflects before the
// employee even taps it.
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/utils/attendance_window.dart';

void main() {
  group('normalizeEmployeeRole', () {
    test('maps legacy and canonical role strings to the three canonical roles', () {
      expect(normalizeEmployeeRole('siteAdmin'), 'site_supervisor');
      expect(normalizeEmployeeRole('site_supervisor'), 'site_supervisor');
      expect(normalizeEmployeeRole('offsite_employee'), 'site_employee');
      expect(normalizeEmployeeRole('site_employee'), 'site_employee');
      expect(normalizeEmployeeRole('office_employee'), 'office_employee');
      expect(normalizeEmployeeRole(null), 'office_employee');
      expect(normalizeEmployeeRole('something_unexpected'), 'office_employee');
    });
  });

  group('checkAttendanceWindow', () {
    test('is unrestricted when attendanceWindows is null/absent', () {
      final result = checkAttendanceWindow(
        attendanceWindows: null,
        role: 'office_employee',
        action: 'checkIn',
        now: DateTime(2026, 1, 2, 9, 0),
      );
      expect(result.allowed, true);
    });

    test('is unrestricted when the role has no entry', () {
      final windows = {
        'site_employee': {
          'checkIn': {'from': '06:00', 'to': '08:00'},
        },
      };
      final result = checkAttendanceWindow(
        attendanceWindows: windows,
        role: 'office_employee',
        action: 'checkIn',
        now: DateTime(2026, 1, 2, 3, 0),
      );
      expect(result.allowed, true);
    });

    test('is unrestricted when only one end of the pair is set', () {
      final windows = {
        'office_employee': {
          'checkIn': {'from': '08:00'}, // 'to' missing
        },
      };
      final result = checkAttendanceWindow(
        attendanceWindows: windows,
        role: 'office_employee',
        action: 'checkIn',
        now: DateTime(2026, 1, 2, 15, 0),
      );
      expect(result.allowed, true);
    });

    test('allows check-in inside a same-day window, rejects outside it', () {
      final windows = {
        'office_employee': {
          'checkIn': {'from': '08:00', 'to': '10:00'},
        },
      };

      final inside = checkAttendanceWindow(
        attendanceWindows: windows,
        role: 'office_employee',
        action: 'checkIn',
        now: DateTime(2026, 1, 2, 9, 0),
      );
      expect(inside.allowed, true);

      final tooEarly = checkAttendanceWindow(
        attendanceWindows: windows,
        role: 'office_employee',
        action: 'checkIn',
        now: DateTime(2026, 1, 2, 7, 59),
      );
      expect(tooEarly.allowed, false);
      expect(tooEarly.from, '08:00');
      expect(tooEarly.to, '10:00');

      final tooLate = checkAttendanceWindow(
        attendanceWindows: windows,
        role: 'office_employee',
        action: 'checkIn',
        now: DateTime(2026, 1, 2, 10, 1),
      );
      expect(tooLate.allowed, false);
    });

    test('checkOut only allowed once checked in AND inside its own window (independent of checkIn)', () {
      final windows = {
        'office_employee': {
          'checkIn': {'from': '08:00', 'to': '10:00'},
          'checkOut': {'from': '16:00', 'to': '19:00'},
        },
      };

      // Mid-afternoon: check-in window long closed, checkout window not open yet.
      final midday = checkAttendanceWindow(
        attendanceWindows: windows,
        role: 'office_employee',
        action: 'checkOut',
        now: DateTime(2026, 1, 2, 13, 0),
      );
      expect(midday.allowed, false);

      final duringCheckout = checkAttendanceWindow(
        attendanceWindows: windows,
        role: 'office_employee',
        action: 'checkOut',
        now: DateTime(2026, 1, 2, 17, 0),
      );
      expect(duringCheckout.allowed, true);
    });

    test('handles an overnight window that wraps past midnight', () {
      final windows = {
        'site_employee': {
          'checkOut': {'from': '22:00', 'to': '06:00'},
        },
      };

      final lateNight = checkAttendanceWindow(
        attendanceWindows: windows,
        role: 'site_employee',
        action: 'checkOut',
        now: DateTime(2026, 1, 2, 23, 30),
      );
      expect(lateNight.allowed, true);

      final earlyMorning = checkAttendanceWindow(
        attendanceWindows: windows,
        role: 'site_employee',
        action: 'checkOut',
        now: DateTime(2026, 1, 2, 3, 0),
      );
      expect(earlyMorning.allowed, true);

      final midday = checkAttendanceWindow(
        attendanceWindows: windows,
        role: 'site_employee',
        action: 'checkOut',
        now: DateTime(2026, 1, 2, 12, 0),
      );
      expect(midday.allowed, false);
    });
  });

  group('formatHHMM12', () {
    test('formats 24h "HH:MM" as 12h with AM/PM', () {
      expect(formatHHMM12('00:00'), '12:00 AM');
      expect(formatHHMM12('08:05'), '8:05 AM');
      expect(formatHHMM12('12:00'), '12:00 PM');
      expect(formatHHMM12('17:30'), '5:30 PM');
      expect(formatHHMM12('23:59'), '11:59 PM');
    });
  });
}
