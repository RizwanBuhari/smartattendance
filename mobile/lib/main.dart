import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';

import 'app.dart';
import 'core/services/location_tracker.dart';
import 'core/services/notifications.dart';
import 'core/services/push_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Make build failures READABLE on the device.
  //
  // In a release build Flutter's default error widget is a plain grey box, so
  // an exception thrown while building a screen looks identical to "the screen
  // is empty" — with no clue anywhere on the phone. Showing the message costs
  // nothing and turns a blank screen into something diagnosable.
  ErrorWidget.builder = (details) => Material(
    color: const Color(0xFFFFF3F3),
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'This screen failed to build',
              style: TextStyle(
                color: Color(0xFFB3261E),
                fontWeight: FontWeight.w700,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              details.exceptionAsString(),
              style: const TextStyle(
                color: Color(0xFF442726),
                fontSize: 12,
                height: 1.4,
              ),
            ),
          ],
        ),
      ),
    ),
  );

  // Firebase has to be up before the background message handler can be
  // registered, and that registration has to happen during startup — Android
  // looks it up when a push arrives with the app closed, long after any widget
  // could do it. app.dart calls initializeApp() again inside its bootstrapper;
  // that is harmless, as the second call just returns the existing app.
  try {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  } catch (_) {
    // The bootstrapper in app.dart reports initialisation failures properly;
    // crashing here would show a blank screen instead.
  }

  LocationTracker.initialize();
  Notifications.initialize();
  runApp(const SmartAttendanceUIApp());
}
