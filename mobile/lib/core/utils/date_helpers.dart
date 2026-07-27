import 'package:cloud_firestore/cloud_firestore.dart';

/// Helper to safely extract String or DateTime from Firestore dynamic fields
/// (which can be ISO Strings or Cloud Firestore Timestamps).
class DateHelpers {
  DateHelpers._();

  static String? toIsoString(dynamic val) {
    if (val == null) return null;
    if (val is String) return val;
    if (val is Timestamp) return val.toDate().toIso8601String();
    return val.toString();
  }

  static DateTime? parse(dynamic val) {
    if (val == null) return null;
    if (val is Timestamp) return val.toDate();
    if (val is DateTime) return val;
    if (val is String) return DateTime.tryParse(val);
    return null;
  }

  static String formatDisplay(dynamic val, {String fallback = ''}) {
    final dt = parse(val);
    if (dt == null) return fallback;
    final local = dt.toLocal();
    final y = local.year;
    final m = local.month.toString().padLeft(2, '0');
    final d = local.day.toString().padLeft(2, '0');
    final h = local.hour.toString().padLeft(2, '0');
    final min = local.minute.toString().padLeft(2, '0');
    return '$y-$m-$d $h:$min';
  }
}
