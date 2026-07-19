import 'dart:convert';
import 'dart:developer' as developer;

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/widgets.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmanager/workmanager.dart';

import '../constants/api_constants.dart';
import 'notifications.dart';

// Persisted across isolates/app restarts so the notification only fires on
// the inside->outside TRANSITION, not on every repeat ping while someone
// stays outside for hours — that would just be spam.
const _wasOutsideKey = 'locationTracker.wasOutsideGeofence';

const _taskName = 'periodic-location-ping';
const _testTaskName = 'test-location-ping';

// TESTING AID — flip to true to verify the background flow in minutes
// instead of waiting out the real interval. WorkManager's 15-minute floor
// only applies to its PERIODIC task type; a chain of short ONE-OFF tasks
// (each re-registering the next one when it finishes) isn't subject to that
// floor, so this can go well below 15 minutes for a quick test.
//
// Flip back to false before considering this done — the periodic schedule
// is the right choice for real use, since it doesn't depend on every single
// run successfully re-registering the next one (a one-off chain silently
// stops if a run is killed before it reschedules; periodic just keeps going
// regardless).
const bool useFastTestInterval = true;
const Duration testInterval = Duration(seconds: 30);

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
        developer.log(
          'LocationTracker: skipped — outside 9AM-6PM (hour=${now.hour})',
        );
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
        developer.log(
          'LocationTracker: skipped — permission is $permission, not always',
        );
        return true;
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
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

      if (response.statusCode == 200 || response.statusCode == 201) {
        final body = jsonDecode(response.body) as Map<String, dynamic>;
        final insideGeofence = body['insideGeofence'] as bool?;
        final distanceMeters = body['distanceMeters'] as int?;
        if (insideGeofence != null) {
          final prefs = await SharedPreferences.getInstance();
          final wasOutside = prefs.getBool(_wasOutsideKey) ?? false;
          if (!insideGeofence) {
            developer.log(
              'LocationTracker: outside geofence — notifying employee',
            );
            await Notifications.showOutsideAreaAlert(distanceMeters);
          } else if (insideGeofence && wasOutside) {
            developer.log(
              'LocationTracker: back inside geofence — notifying employee',
            );
            await Notifications.showBackInAreaAlert();
          }
          await prefs.setBool(_wasOutsideKey, !insideGeofence);
        }
      }

      return true;
    } catch (e) {
      developer.log('LocationTracker: failed — $e');
      // Let WorkManager retry with its backoff policy rather than crash the
      // background isolate.
      return false;
    } finally {
      // Test mode only: chain the next short one-off run. Runs regardless of
      // skip/success/failure above, same as the periodic task would.
      if (useFastTestInterval) {
        await Workmanager().registerOneOffTask(
          _testTaskName,
          _testTaskName,
          initialDelay: testInterval,
          constraints: Constraints(networkType: NetworkType.connected),
          existingWorkPolicy: ExistingWorkPolicy.replace,
        );
      }
    }
  });
}

// Registers the background ping. Safe to call every time the app confirms
// "Always" permission (e.g. on every LocationPermissionGate rebuild) —
// ExistingPeriodicWorkPolicy.update makes repeat calls a no-op rather than
// stacking duplicate schedules.
class LocationTracker {
  LocationTracker._();

  static Future<void> initialize() async {
    await Workmanager().initialize(locationTrackerCallbackDispatcher);
  }

  static Future<void> schedule() async {
    if (useFastTestInterval) {
      await Workmanager().registerOneOffTask(
        _testTaskName,
        _testTaskName,
        initialDelay: testInterval,
        constraints: Constraints(networkType: NetworkType.connected),
        existingWorkPolicy: ExistingWorkPolicy.keep,
      );
      return;
    }

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
