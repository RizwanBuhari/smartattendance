import 'dart:developer' as developer;

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

  /// The Android channel used for check-in approval pushes.
  ///
  /// This exact string is also set as `channelId` on the FCM message by the
  /// backend (PushService). If the two ever drift, Android drops the push into
  /// a default low-importance channel and it arrives with no sound — which
  /// looks exactly like "push isn't working".
  static const String alertsChannelId = 'checkn_alerts';

  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _initialized = false;

  static Future<void> initialize() async {
    if (_initialized) return;
    const androidSettings = AndroidInitializationSettings(
      '@mipmap/ic_launcher',
    );
    await _plugin.initialize(
      const InitializationSettings(android: androidSettings),
    );

    // Create the approvals channel up front. On Android 8+ a notification
    // naming a channel that does not exist is DROPPED — and a push arriving
    // while the app is closed is drawn by the OS, not by us, so there is no
    // later opportunity to create it. It has to exist before the first push.
    await _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.createNotificationChannel(
          const AndroidNotificationChannel(
            alertsChannelId,
            'Check-in approvals',
            description:
                'Tells a site admin when someone is waiting for a check-in code.',
            importance: Importance.max,
          ),
        );

    _initialized = true;
  }

  // Android 13+ requires this explicit runtime grant before any notification
  // can show at all — a separate permission from location, so it needs its
  // own request regardless of the "Always" location flow.
  static Future<void> requestPermission() async {
    await initialize();
    final granted =
        await _plugin
            .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin
            >()
            ?.requestNotificationsPermission();
    developer.log(
      'Notifications: POST_NOTIFICATIONS permission granted = $granted',
    );
  }

  // Shows the OS tray notification AND records it in NotificationHistory, so
  // it's still visible in-app (see NotificationsScreen) after the tray
  // notification itself is dismissed. A fresh id per call means repeat
  // alerts stack as separate tray notifications instead of overwriting each
  // other — each one is a genuinely new event worth seeing.
  //
  // The tray notification and the history record are deliberately
  // independent: if showing the OS notification fails (e.g. the user denied
  // the POST_NOTIFICATIONS permission), that must not also silently swallow
  // the history entry — the in-app log is meant to be the reliable record.
  static Future<void> _notify(
    String title,
    String body, {
    AndroidNotificationDetails? android,
  }) async {
    await initialize();
    final details = NotificationDetails(
      android:
          android ??
          const AndroidNotificationDetails(
            'geofence_alerts',
            'Location alerts',
            channelDescription:
                "Tells you when you've left your approved work area.",
            importance: Importance.high,
            priority: Priority.high,
          ),
    );
    final id = DateTime.now().millisecondsSinceEpoch.remainder(1 << 31);
    try {
      await _plugin.show(id, title, body, details);
    } catch (e) {
      developer.log('Notifications: failed to show tray notification — $e');
    }
    await NotificationHistory.add(title, body);
    developer.log('Notifications: recorded "$title" to history');
  }

  static Future<void> showOutsideAreaAlert([int? distanceMeters]) => _notify(
    'Outside Approved Radius',
    distanceMeters != null
        ? "You are identified outside the approved radius by ${distanceMeters}m."
        : "You are identified outside the approved radius.",
  );

  static Future<void> showBackInAreaAlert() => _notify(
    'Back in approved area',
    "You're back within your approved work location.",
  );

  static Future<void> showCheckoutUnderReview(int? distanceMeters) => _notify(
    'Checkout under review',
    distanceMeters != null
        ? "You checked out ${distanceMeters}m from your approved area. Your admin will review this checkout."
        : "You checked out outside your approved area. Your admin will review this checkout.",
  );

  static Future<void> showCheckinSuccess(String locationName) => _notify(
    'Check-in Successful',
    'You have successfully checked in at $locationName.',
  );

  static Future<void> showCheckoutSuccess() =>
      _notify('Checkout Successful', 'You have successfully checked out.');

  static Future<void> showCheckoutReviewApproved(String dateDisplay) => _notify(
    'Checkout Approved',
    'Your checkout on $dateDisplay was approved by the admin.',
  );

  static Future<void> showCheckoutReviewRejected(
    String dateDisplay,
    String? reason,
  ) => _notify(
    'Checkout Rejected',
    reason != null && reason.isNotEmpty
        ? 'Your checkout was rejected. You are still checked in. (Reason: $reason)'
        : 'Your checkout was rejected. You are still checked in.',
  );

  // A push that arrived while the app is on screen. Android draws nothing in
  // that case, so we mirror it locally — and it lands in NotificationHistory
  // like everything else, so a site admin who misses the moment can still find
  // out that someone was waiting.
  //
  // The channel id MUST match the one the backend sets on the FCM message
  // (PushService.sendToEmployees), or Android files pushes into a default
  // low-importance channel and they arrive silently.
  static Future<void> showPush(String title, String body) => _notify(
    title,
    body,
    android: const AndroidNotificationDetails(
      alertsChannelId,
      'Check-in approvals',
      channelDescription:
          'Tells a site admin when someone is waiting for a check-in code.',
      importance: Importance.max,
      priority: Priority.high,
    ),
  );

  static Future<void> showActionRejected(String title, String body) =>
      _notify(title, body);

  static Future<void> showOffsiteRequestSubmitted(String worksiteName) => _notify(
    'Offsite Request Submitted',
    'Your check-in request for $worksiteName has been submitted to your supervisor.',
  );

  static Future<void> showOffsiteRequestApproved(String worksiteName) => _notify(
    'Offsite Request Approved',
    'Your offsite request for $worksiteName was approved. Ready to scan QR code.',
  );

  static Future<void> showOffsiteRequestRejected(String worksiteName, String? reason) => _notify(
    'Offsite Request Rejected',
    reason != null && reason.isNotEmpty
        ? 'Your offsite request for $worksiteName was rejected. (Reason: $reason)'
        : 'Your offsite request for $worksiteName was rejected.',
  );

  static Future<void> showNewOffsiteRequestReceived(String employeeName, String worksiteName) => _notify(
    'New Offsite Request',
    '$employeeName has requested offsite check-in for $worksiteName.',
  );

  static Future<void> showOffsiteCheckinSuccess(String worksiteName) => _notify(
    'Offsite Check-in Successful',
    'You checked in successfully at $worksiteName via Supervisor QR.',
  );

  static Future<void> showQrExpired() => _notify(
    'QR Code Expired',
    'The supervisor QR code has expired. Please ask them to regenerate it.',
  );
}
