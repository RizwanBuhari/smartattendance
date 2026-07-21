// Enforces "one account, one device" for the mobile app, for BOTH employees
// and site admins.
//
// This mirrors what the dashboard already does for admins (AuthContext +
// admin_Sessions): signing in mints a fresh sessionId on the server and
// overwrites the stored one. Every signed-in device watches that document, so
// the moment a newer sign-in replaces the id, the older device notices the
// mismatch and signs itself out.
//
// The check is server-authoritative — the id is minted by the backend during
// POST /auth/login (and /auth/register), so a client cannot mint or keep one on
// its own. Claiming the session is now part of signing in rather than a
// separate call the device could skip or fail.
import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'native_geofence_service.dart';

class SessionGuard {
  static const _key = 'session.id';
  static StreamSubscription<DocumentSnapshot>? _subscription;

  /// Remembers the session id the backend minted for this device at sign-in.
  /// Called by [AuthApi] — any other device signed in as this account has
  /// already been kicked out server-side by the time this runs.
  static Future<void> store(String sessionId) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, sessionId);
    _cached = sessionId;
  }

  // Kept in memory as well as in SharedPreferences because ApiClient attaches it
  // to every single request, and reading from disk each time would put an async
  // hop in front of all of them.
  static String? _cached;

  /// The id this device presents as `X-Session-Id`. The backend rejects any
  /// request that does not carry the CURRENT one, which is what makes eviction
  /// real rather than something the app agrees to do to itself.
  static Future<String?> currentId() async {
    if (_cached != null) return _cached;
    final prefs = await SharedPreferences.getInstance();
    _cached = prefs.getString(_key);
    return _cached;
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
    _cached = null;
    try {
      await NativeGeofenceService.removeAllGeofences();
    } catch (_) {
      // Never let geofence cleanup block signing out.
    }
    await FirebaseAuth.instance.signOut();
  }
}
