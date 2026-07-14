import 'dart:convert';
import 'dart:developer' as developer;

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/widgets.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:workmanager/workmanager.dart';

import '../constants/api_constants.dart';

const _taskName = 'periodic-location-ping';

// Runs in a background isolate the OS spawns on its own schedule — it has no
// memory in common with the running app, so everything (Flutter bindings,
// Firebase) has to be initialized fresh here.
//
// Logs every step via dart:developer (shows in Logcat tagged "flutter", same
// as the app's normal debugPrint output) so it's possible to confirm from
// Logcat alone whether the periodic task is actually firing, and why it
// skipped if it did.
@pragma('vm:entry-point')
void locationTrackerCallbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    developer.log('LocationTracker: task fired at ${DateTime.now()}');
    try {
      final now = DateTime.now();
      // Server-side enforces this too (defense in depth) — but checking
      // here first avoids burning a GPS fix + network call for nothing.
      if (now.hour < 9 || now.hour >= 18) {
        developer.log('LocationTracker: skipped — outside 9AM-6PM (hour=${now.hour})');
        return true;
      }

      WidgetsFlutterBinding.ensureInitialized();
      await Firebase.initializeApp();

      // authStateChanges() rehydrates from the native SDK's persisted
      // session — currentUser can be unset for a moment right after a cold
      // init, so we wait for the first emission instead of reading it
      // synchronously.
      final user = await FirebaseAuth.instance.authStateChanges().first;
      if (user == null) {
        developer.log('LocationTracker: skipped — not signed in');
        return true;
      }

      if (!await Geolocator.isLocationServiceEnabled()) {
        developer.log('LocationTracker: skipped — location services off');
        return true;
      }
      final permission = await Geolocator.checkPermission();
      if (permission != LocationPermission.always) {
        developer.log('LocationTracker: skipped — permission is $permission, not always');
        return true;
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );

      final uri = Uri.parse('${ApiConstants.baseUrl}/location-pings');
      final response = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'employeeId': user.uid,
              'latitude': position.latitude,
              'longitude': position.longitude,
              'gpsAccuracy': position.accuracy,
              'timestamp': DateTime.now().toUtc().toIso8601String(),
            }),
          )
          .timeout(const Duration(seconds: 20));
      developer.log(
        'LocationTracker: POST $uri -> ${response.statusCode} '
        '(lat=${position.latitude}, lng=${position.longitude})',
      );

      return true;
    } catch (e) {
      developer.log('LocationTracker: failed — $e');
      // Let WorkManager retry with its backoff policy rather than crash the
      // background isolate.
      return false;
    }
  });
}

// Registers the periodic background ping. Safe to call every time the app
// confirms "Always" permission (e.g. on every LocationPermissionGate
// rebuild) — ExistingPeriodicWorkPolicy.update makes repeat calls a no-op
// rather than stacking duplicate schedules.
class LocationTracker {
  LocationTracker._();

  static Future<void> initialize() async {
    await Workmanager().initialize(locationTrackerCallbackDispatcher);
  }

  static Future<void> schedule() async {
    await Workmanager().registerPeriodicTask(
      _taskName,
      _taskName,
      // Android enforces a 15-minute floor on periodic work regardless of
      // what's requested here — there is no way to get true 10-minute
      // background execution without a persistent foreground-service
      // notification, which this deliberately avoids.
      frequency: const Duration(minutes: 15),
      constraints: Constraints(networkType: NetworkType.connected),
      existingWorkPolicy: ExistingPeriodicWorkPolicy.update,
    );
  }
}
