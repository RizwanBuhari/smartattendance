// Enforces "one account, one device" for the mobile app, for BOTH employees
// and site admins.
//
// This mirrors what the dashboard already does for admins (AuthContext +
// admin_Sessions): signing in mints a fresh sessionId on the server and
// overwrites the stored one. Every signed-in device watches that document, so
// the moment a newer sign-in replaces the id, the older device notices the
// mismatch and signs itself out.
//
// The check is server-authoritative — the id is minted by POST /otp/session
// behind EmployeeGuard, so a client cannot mint or keep one on its own.
import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';
import 'native_geofence_service.dart';

class SessionGuard {
  static const _key = 'session.id';
  static StreamSubscription<DocumentSnapshot>? _subscription;

  /// Claims this device as THE active session. Call right after a successful
  /// sign-in. Any other device signed in as this account is kicked out.
  static Future<void> claim() async {
    try {
      final res = await ApiClient.post('/otp/session');
      final sessionId = res['sessionId']?.toString();
      if (sessionId == null) return;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, sessionId);
    } catch (_) {
      // Offline or backend down: don't block sign-in over this. The watcher
      // below simply has nothing to compare against until the next sign-in.
    }
  }

  /// Watches for another device taking over this account. [onEvicted] runs on
  /// the UI side so it can navigate back to the login screen.
  static Future<void> watch({
    required String employeeDocId,
    required Future<void> Function() onEvicted,
  }) async {
    await stop();
    final prefs = await SharedPreferences.getInstance();
    final mySession = prefs.getString(_key);
    // Nothing to compare against — claim() never completed.
    if (mySession == null) return;

    _subscription = FirebaseFirestore.instance
        .collection('employee_Sessions')
        .doc(employeeDocId)
        .snapshots()
        .listen((snap) async {
          if (!snap.exists) return;
          final active = snap.data()?['sessionId']?.toString();
          // Only a DIFFERENT id means someone else took over. A missing value
          // is ignored so a partial write can never sign everyone out.
          if (active == null || active == mySession) return;
          await signOut();
          await onEvicted();
        });
  }

  static Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
  }

  /// Shared sign-out: stops watching, clears geofences, and ends the Firebase
  /// session. Used by both the manual "Sign out" button and eviction, so the
  /// two can never clean up differently.
  static Future<void> signOut() async {
    await stop();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
    try {
      await NativeGeofenceService.removeAllGeofences();
    } catch (_) {
      // Never let geofence cleanup block signing out.
    }
    await FirebaseAuth.instance.signOut();
  }
}
