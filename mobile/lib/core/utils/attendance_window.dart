// Client-side mirror of backend/src/attendance/attendance-window.util.ts.
// This is a UX hint only — it disables the button and explains why before the
// employee even taps it. The server re-checks independently and is what
// actually decides; a stale/offline copy of this can never grant access the
// backend wouldn't.

/// Same three roles employees.service.ts (backend) normalizes to.
String normalizeEmployeeRole(String? role) {
  if (role == 'siteAdmin' || role == 'site_supervisor') return 'site_supervisor';
  if (role == 'offsite_employee' || role == 'site_employee') return 'site_employee';
  return 'office_employee';
}

class AttendanceWindowCheck {
  final bool allowed;
  final String? from;
  final String? to;
  const AttendanceWindowCheck({required this.allowed, this.from, this.to});
}

int? _parseHHMM(String? value) {
  if (value == null) return null;
  final m = RegExp(r'^([01]\d|2[0-3]):([0-5]\d)$').firstMatch(value);
  if (m == null) return null;
  return int.parse(m.group(1)!) * 60 + int.parse(m.group(2)!);
}

/// [attendanceWindows] is the location doc's raw `attendanceWindows` field
/// (a nested map, or null/absent — both mean unrestricted). [action] is
/// 'checkIn' or 'checkOut'.
AttendanceWindowCheck checkAttendanceWindow({
  required dynamic attendanceWindows,
  required String role,
  required String action,
  DateTime? now,
}) {
  if (attendanceWindows is! Map) {
    return const AttendanceWindowCheck(allowed: true);
  }
  final roleWindows = attendanceWindows[role];
  if (roleWindows is! Map) {
    return const AttendanceWindowCheck(allowed: true);
  }
  final window = roleWindows[action];
  final from = window is Map ? window['from'] as String? : null;
  final to = window is Map ? window['to'] as String? : null;
  final fromMin = _parseHHMM(from);
  final toMin = _parseHHMM(to);
  if (fromMin == null || toMin == null || fromMin == toMin) {
    return const AttendanceWindowCheck(allowed: true);
  }

  final nowDt = now ?? DateTime.now();
  final nowMin = nowDt.hour * 60 + nowDt.minute;

  final inside =
      fromMin < toMin
          ? (nowMin >= fromMin && nowMin <= toMin)
          // Overnight window (e.g. 22:00 -> 06:00): wraps past midnight.
          : (nowMin >= fromMin || nowMin <= toMin);

  if (inside) return const AttendanceWindowCheck(allowed: true);
  return AttendanceWindowCheck(allowed: false, from: from, to: to);
}

/// "08:00" -> "8:00 AM".
String formatHHMM12(String hhmm) {
  final m = RegExp(r'^(\d{2}):(\d{2})$').firstMatch(hhmm);
  if (m == null) return hhmm;
  final hour24 = int.parse(m.group(1)!);
  final minute = m.group(2)!;
  final period = hour24 < 12 ? 'AM' : 'PM';
  final hour12 = hour24 % 12 == 0 ? 12 : hour24 % 12;
  return '$hour12:$minute $period';
}
