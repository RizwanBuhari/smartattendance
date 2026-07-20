import 'dart:convert';
import 'dart:developer' as developer;
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/widgets.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:native_geofence/native_geofence.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../constants/api_constants.dart';
import 'device_id.dart';
import 'notifications.dart';

const _wasOutsideKey = 'locationTracker.wasOutsideGeofence';

@pragma('vm:entry-point')
Future<void> nativeGeofenceTriggered(GeofenceCallbackParams params) async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await Firebase.initializeApp();
  } catch (_) {}

  final uid = FirebaseAuth.instance.currentUser?.uid;
  if (uid == null) {
    developer.log('NativeGeofenceCallback: skipped — no signed in user');
    return;
  }

  final deviceId = await DeviceId.get();
  final eventType = params.event;
  final nowStr = DateTime.now().toUtc().toIso8601String();

  double? lat;
  double? lng;
  double? accuracy;
  try {
    final pos = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.medium,
        timeLimit: Duration(seconds: 10),
      ),
    );
    lat = pos.latitude;
    lng = pos.longitude;
    accuracy = pos.accuracy;
  } catch (_) {}

  for (final geofence in params.geofences) {
    final idParts = geofence.id.split('_');
    if (idParts.length < 2) continue;
    final locationId = idParts[1];

    final prefs = await SharedPreferences.getInstance();

    // Check if the user is currently checked in on Firebase Firestore
    bool isCurrentlyCheckedIn = false;
    String? activeAttendanceId;
    try {
      final attSnap =
          await FirebaseFirestore.instance
              .collection('attendance_ids')
              .where('employeeId', isEqualTo: uid)
              .where('status', isEqualTo: 'checked_in')
              .limit(1)
              .get();
      if (attSnap.docs.isNotEmpty) {
        isCurrentlyCheckedIn = true;
        activeAttendanceId = attSnap.docs[0].id;
      }
    } catch (_) {}

    if (eventType == GeofenceEvent.enter) {
      final isReturn = isCurrentlyCheckedIn;
      final typeStr = isReturn ? 'RETURN' : 'ENTER';

      final eventData = {
        'employeeId': uid,
        'deviceId': deviceId,
        'locationId': locationId,
        'eventType': typeStr,
        'timestamp': nowStr,
        'source': 'NATIVE_GEOFENCE',
        if (lat != null && lng != null) 'latitude': lat,
        if (lat != null && lng != null) 'longitude': lng,
        if (accuracy != null) 'gpsAccuracy': accuracy,
      };

      await prefs.setString('geofence.activeLocationId', locationId);
      await prefs.setString('geofence.enteredAt', nowStr);
      await prefs.remove('geofence.dwellConfirmedAt');
      await prefs.setBool('geofence.isInside', true);
      await prefs.setBool(_wasOutsideKey, false);

      await _saveAndPostEvent(eventData);

      if (!isReturn) {
        await Notifications.showActionRejected(
          'Inside Work Area',
          'You entered the approved work area. You can now check in.',
        );
      }
    } else if (eventType == GeofenceEvent.dwell) {
      final enteredAt = prefs.getString('geofence.enteredAt') ?? nowStr;

      final eventData = {
        'employeeId': uid,
        'deviceId': deviceId,
        'locationId': locationId,
        'eventType': 'DWELL',
        'timestamp': nowStr,
        'enteredAt': enteredAt,
        'dwellConfirmedAt': nowStr,
        'source': 'NATIVE_GEOFENCE',
        if (lat != null && lng != null) 'latitude': lat,
        if (lat != null && lng != null) 'longitude': lng,
        if (accuracy != null) 'gpsAccuracy': accuracy,
      };
      if (activeAttendanceId != null) {
        eventData['attendanceId'] = activeAttendanceId;
      }

      await prefs.setString('geofence.dwellConfirmedAt', nowStr);
      await prefs.setBool('geofence.isInside', true);

      await _saveAndPostEvent(eventData);
    } else if (eventType == GeofenceEvent.exit) {
      final enteredAt = prefs.getString('geofence.enteredAt');
      final dwellConfirmedAt = prefs.getString('geofence.dwellConfirmedAt');
      final isBrief = (dwellConfirmedAt == null);

      int? durationSeconds;
      if (enteredAt != null) {
        final enteredDateTime = DateTime.parse(enteredAt);
        durationSeconds =
            DateTime.now().toUtc().difference(enteredDateTime).inSeconds;
      }

      final eventData = {
        'employeeId': uid,
        'deviceId': deviceId,
        'locationId': locationId,
        'eventType': 'EXIT',
        'timestamp': nowStr,
        'enteredAt': enteredAt,
        'dwellConfirmedAt': dwellConfirmedAt,
        'exitedAt': nowStr,
        'totalInsideDurationSeconds': durationSeconds,
        'source': 'NATIVE_GEOFENCE',
        'isBrief': isBrief,
        if (lat != null && lng != null) 'latitude': lat,
        if (lat != null && lng != null) 'longitude': lng,
        if (accuracy != null) 'gpsAccuracy': accuracy,
      };
      if (activeAttendanceId != null) {
        eventData['attendanceId'] = activeAttendanceId;
      }

      await prefs.remove('geofence.activeLocationId');
      await prefs.remove('geofence.enteredAt');
      await prefs.remove('geofence.dwellConfirmedAt');
      await prefs.setBool('geofence.isInside', false);
      await prefs.setBool(_wasOutsideKey, true);

      await _saveAndPostEvent(eventData);

      if (isCurrentlyCheckedIn) {
        await Notifications.showActionRejected(
          'Outside Work Area',
          'You left the approved work area while still checked in.',
        );
      }
    }
  }
}

Future<void> _saveAndPostEvent(Map<String, dynamic> eventData) async {
  bool posted = false;
  try {
    final uri = Uri.parse('${ApiConstants.baseUrl}/geofence-events');
    final response = await http
        .post(
          uri,
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(eventData),
        )
        .timeout(const Duration(seconds: 15));

    if (response.statusCode == 200 || response.statusCode == 201) {
      posted = true;
      developer.log(
        'NativeGeofenceCallback: successfully synced event ${eventData['eventType']}',
      );
    }
  } catch (e) {
    developer.log('NativeGeofenceCallback: sync failed with error — $e');
  }

  if (!posted) {
    final prefs = await SharedPreferences.getInstance();
    final queue = prefs.getStringList('geofence.offlineQueue') ?? [];
    queue.add(jsonEncode(eventData));
    await prefs.setStringList('geofence.offlineQueue', queue);
    developer.log(
      'NativeGeofenceCallback: saved event ${eventData['eventType']} to offline queue',
    );
  }
}

class NativeGeofenceService {
  NativeGeofenceService._();

  static Future<void> initialize() async {
    try {
      await NativeGeofenceManager.instance.initialize();
      developer.log('NativeGeofenceService: initialized plugin');
    } catch (e) {
      developer.log('NativeGeofenceService: failed initialization — $e');
    }
  }

  static Future<void> syncGeofences(
    List<Map<String, dynamic>> locations,
  ) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;

    await removeAllGeofences();

    for (final loc in locations) {
      final docId = loc['id'] as String;
      final lat = (loc['latitude'] as num).toDouble();
      final lng = (loc['longitude'] as num).toDouble();
      final radius = (loc['radiusMeters'] as num).toDouble();

      final geofence = Geofence(
        id: '${uid}_$docId',
        location: Location(latitude: lat, longitude: lng),
        radiusMeters: radius,
        triggers: {
          GeofenceEvent.enter,
          GeofenceEvent.exit,
          GeofenceEvent.dwell,
        },
        iosSettings: const IosGeofenceSettings(initialTrigger: true),
        androidSettings: const AndroidGeofenceSettings(
          initialTriggers: {GeofenceEvent.enter},
          loiteringDelay: Duration(
            minutes: 5,
          ), // default loitering delay is 5 minutes
          notificationResponsiveness: Duration(seconds: 30),
        ),
      );

      try {
        await NativeGeofenceManager.instance.createGeofence(
          geofence,
          nativeGeofenceTriggered,
        );
        developer.log('NativeGeofenceService: registered geofence $docId');
      } catch (e) {
        developer.log(
          'NativeGeofenceService: registration failed for $docId — $e',
        );
      }
    }
  }

  static Future<void> removeAllGeofences() async {
    try {
      await NativeGeofenceManager.instance.removeAllGeofences();
      developer.log('NativeGeofenceService: removed all registered geofences');
    } catch (e) {
      developer.log('NativeGeofenceService: failed to remove geofences — $e');
    }
  }

  static Future<void> syncOfflineQueue() async {
    final prefs = await SharedPreferences.getInstance();
    final queue = prefs.getStringList('geofence.offlineQueue') ?? [];
    if (queue.isEmpty) return;

    developer.log(
      'NativeGeofenceService: syncing ${queue.length} offline events...',
    );
    final remaining = <String>[];

    for (final eventStr in queue) {
      try {
        final eventData = jsonDecode(eventStr) as Map<String, dynamic>;
        final uri = Uri.parse('${ApiConstants.baseUrl}/geofence-events');
        final response = await http
            .post(
              uri,
              headers: {'Content-Type': 'application/json'},
              body: jsonEncode(eventData),
            )
            .timeout(const Duration(seconds: 15));

        if (response.statusCode == 200 || response.statusCode == 201) {
          developer.log(
            'NativeGeofenceService: successfully synced event ${eventData['eventType']} from queue',
          );
        } else {
          remaining.add(eventStr);
        }
      } catch (e) {
        developer.log(
          'NativeGeofenceService: failed to sync queued event — $e',
        );
        remaining.add(eventStr);
      }
    }

    await prefs.setStringList('geofence.offlineQueue', remaining);
  }
}
