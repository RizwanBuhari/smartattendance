// Firebase Cloud Messaging: how this phone gets told things while the app is
// not on screen.
//
// The distinction that matters: flutter_local_notifications can only raise a
// notification while this app's process is alive. A site admin whose phone is
// in their pocket has no process running, so the only thing that can reach them
// is a push delivered by the OS — which is what this wires up.
//
// The token is registered with our backend AFTER sign-in (so it is attached to
// the right employee) and removed on sign-out (so a shared phone stops getting
// the previous person's notifications).
import 'dart:developer' as developer;

import 'package:firebase_messaging/firebase_messaging.dart';

import 'api_client.dart';
import 'notifications.dart';

// Runs in its own isolate when a push arrives and the app is NOT running.
// Must be a top-level function annotated this way or Android cannot find it.
//
// Deliberately does almost nothing: Android has already drawn the notification
// from the `notification` block of the message by the time this runs, so
// re-showing it here would produce a duplicate.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  developer.log('Push (background): ${message.notification?.title}');
}

class PushService {
  PushService._();

  static String? _token;

  /// Asks permission, picks up the token, and keeps it in sync. Safe to call
  /// more than once — a second call just refreshes the registration.
  ///
  /// Call AFTER sign-in: the backend files the token against the employee the
  /// request is authenticated as.
  static Future<void> start() async {
    try {
      // iOS/Android 13+ gate notifications behind an explicit grant. On older
      // Android this resolves immediately as authorised.
      await FirebaseMessaging.instance.requestPermission();

      // Without this, a push arriving while the app is FOREGROUND is silently
      // swallowed on Android — the OS assumes the app will show its own UI.
      await FirebaseMessaging.instance
          .setForegroundNotificationPresentationOptions(
            alert: true,
            badge: true,
            sound: true,
          );

      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await _register(token);

      // Firebase rotates tokens (reinstall, restore, cache clear). Without this
      // listener the backend keeps a dead token and pushes stop arriving with
      // no visible error anywhere.
      FirebaseMessaging.instance.onTokenRefresh.listen(_register);

      // App open and on screen: no OS notification is drawn for us, so raise a
      // local one to match what the user would see if the app were closed.
      FirebaseMessaging.onMessage.listen((message) {
        final title = message.notification?.title;
        final body = message.notification?.body;
        if (title != null && body != null) {
          Notifications.showPush(title, body);
        }
      });
    } catch (e) {
      // Never let notification setup break signing in.
      developer.log('PushService: setup failed — $e');
    }
  }

  static Future<void> _register(String token) async {
    _token = token;
    try {
      await ApiClient.post('/devices/token', {
        'token': token,
        'platform': 'android',
      });
      developer.log('PushService: token registered');
    } catch (e) {
      developer.log('PushService: token registration failed — $e');
    }
  }

  /// Detaches this device from the signed-in employee. Called during sign-out,
  /// BEFORE the Firebase session ends — the request needs a valid token.
  static Future<void> stop() async {
    final token = _token ?? await FirebaseMessaging.instance.getToken();
    if (token == null) return;
    try {
      await ApiClient.delete('/devices/token', {'token': token});
    } catch (e) {
      developer.log('PushService: token removal failed — $e');
    }
    _token = null;
  }
}
