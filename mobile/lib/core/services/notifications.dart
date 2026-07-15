import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'notification_history.dart';

// Local (on-device) notifications — tells the EMPLOYEE they've wandered
// outside their approved work area, or that a checkout is under review.
// Distinct from the dashboard's admin-facing alert (see
// LocationPingsService.findAnomalies on the backend) — this one is for the
// person carrying the phone, not the admin.
//
// Must be (re-)initialized in every isolate that uses it, including the
// background WorkManager isolate — it has no memory in common with the
// main app isolate, same reason Firebase gets re-initialized there too.
class Notifications {
  Notifications._();

  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _initialized = false;

  static Future<void> initialize() async {
    if (_initialized) return;
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    await _plugin.initialize(const InitializationSettings(android: androidSettings));
    _initialized = true;
  }

  // Android 13+ requires this explicit runtime grant before any notification
  // can show at all — a separate permission from location, so it needs its
  // own request regardless of the "Always" location flow.
  static Future<void> requestPermission() async {
    await initialize();
    await _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.requestNotificationsPermission();
  }

  // Shows the OS tray notification AND records it in NotificationHistory, so
  // it's still visible in-app (see NotificationsScreen) after the tray
  // notification itself is dismissed. A fresh id per call means repeat
  // alerts stack as separate tray notifications instead of overwriting each
  // other — each one is a genuinely new event worth seeing.
  static Future<void> _notify(String title, String body) async {
    await initialize();
    const details = NotificationDetails(
      android: AndroidNotificationDetails(
        'geofence_alerts',
        'Location alerts',
        channelDescription: "Tells you when you've left your approved work area.",
        importance: Importance.high,
        priority: Priority.high,
      ),
    );
    final id = DateTime.now().millisecondsSinceEpoch.remainder(1 << 31);
    await _plugin.show(id, title, body, details);
    await NotificationHistory.add(title, body);
  }

  static Future<void> showOutsideAreaAlert() => _notify(
        'Outside approved area',
        "You appear to be outside your approved work location.",
      );

  static Future<void> showCheckoutUnderReview(int? distanceMeters) => _notify(
        'Checkout under review',
        distanceMeters != null
            ? "You checked out ${distanceMeters}m from your approved area. Your admin will review this checkout."
            : "You checked out outside your approved area. Your admin will review this checkout.",
      );
}
