import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

// Persisted record of every alert this app has shown the employee (outside
// area during a shift, checkout under review, etc.), so the in-app
// Notifications screen can list them even after the OS tray notification
// itself has been dismissed or swiped away. Stored locally on the device,
// not synced to the backend — this is the employee's own view, not the
// admin's (that's the dashboard's Anomalies panel).
class NotificationEntry {
  const NotificationEntry({required this.title, required this.body, required this.time});

  final String title;
  final String body;
  final DateTime time;

  Map<String, dynamic> toJson() => {
        'title': title,
        'body': body,
        'time': time.toIso8601String(),
      };

  factory NotificationEntry.fromJson(Map<String, dynamic> json) => NotificationEntry(
        title: json['title'] as String,
        body: json['body'] as String,
        time: DateTime.parse(json['time'] as String),
      );
}

class NotificationHistory {
  NotificationHistory._();

  static const _key = 'notificationHistory';
  // Keeps the store from growing without bound over months of background pings.
  static const _maxEntries = 100;

  static Future<void> add(String title, String body) async {
    final prefs = await SharedPreferences.getInstance();
    final entries = await _readAll(prefs);
    entries.insert(0, NotificationEntry(title: title, body: body, time: DateTime.now()));
    await prefs.setStringList(
      _key,
      entries.take(_maxEntries).map((e) => jsonEncode(e.toJson())).toList(),
    );
  }

  static Future<List<NotificationEntry>> getAll() async {
    final prefs = await SharedPreferences.getInstance();
    return _readAll(prefs);
  }

  static Future<List<NotificationEntry>> _readAll(SharedPreferences prefs) async {
    final raw = prefs.getStringList(_key) ?? [];
    return raw
        .map((s) => NotificationEntry.fromJson(jsonDecode(s) as Map<String, dynamic>))
        .toList();
  }
}
