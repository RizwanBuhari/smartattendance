import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';

import 'app.dart';
import 'core/services/location_tracker.dart';
import 'core/services/notifications.dart';
import 'core/services/push_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

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
