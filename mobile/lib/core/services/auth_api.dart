// Signing in and signing up, both through the NestJS backend.
//
// The app used to call FirebaseAuth.signInWithEmailAndPassword() straight from
// the device, so the server had no say in whether a sign-in was allowed and no
// idea one had happened. Now the credentials go to POST /auth/login, the
// backend applies its own rules (the account maps to an active employee, this
// device takes over the session), and it replies with a CUSTOM TOKEN.
//
// Exchanging that token via signInWithCustomToken() below gives the Firebase
// SDK an ordinary signed-in session, which is what keeps everything downstream
// working untouched: AuthGate still watches authStateChanges(), ApiClient still
// attaches a fresh ID token, and the realtime Firestore streams still read.
//
// These are the only calls in the app made WITHOUT a token — by definition,
// there is no token yet when you are signing in.
import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import '../constants/api_constants.dart';
import 'api_client.dart' show ApiException;
import 'session_guard.dart';

class AuthApi {
  static Future<Map<String, dynamic>> _post(
    String path,
    Map<String, dynamic> body,
  ) async {
    final http.Response res;
    try {
      res = await http.post(
        Uri.parse('${ApiConstants.baseUrl}$path'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );
    } catch (_) {
      // The backend is unreachable — a different problem from being rejected
      // by it, and worth a different message on screen.
      throw ApiException(0, 'Unable to reach the server. Check your connection.');
    }

    final decoded = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return (decoded as Map).cast<String, dynamic>();
    }

    // Surface the backend's own wording ("This account has been disabled.")
    // rather than a bare status code.
    String message = 'Request failed (${res.statusCode})';
    if (decoded is Map && decoded['message'] != null) {
      final m = decoded['message'];
      message = m is List ? m.join(', ') : m.toString();
    }
    throw ApiException(res.statusCode, message);
  }

  // Turns the backend's reply into a live Firebase session. Shared by login and
  // register so the two can never diverge in how they finish signing in.
  static Future<void> _completeSignIn(Map<String, dynamic> result) async {
    final customToken = result['customToken']?.toString();
    if (customToken == null) {
      throw ApiException(500, 'The server did not return a sign-in token.');
    }
    await FirebaseAuth.instance.signInWithCustomToken(customToken);

    // The backend already claimed this device as THE active session; we just
    // remember which id is ours so SessionGuard.watch() can spot a takeover.
    final sessionId = result['sessionId']?.toString();
    if (sessionId != null) {
      await SessionGuard.store(sessionId);
    }
  }

  /// Signs in. Throws [ApiException] carrying a message fit to show the user.
  static Future<void> login({
    required String email,
    required String password,
  }) async {
    final result = await _post('/auth/login', {
      'email': email,
      'password': password,
    });
    await _completeSignIn(result);
  }

  /// Creates the Firebase account AND the employee record in one backend call,
  /// then signs in. Because the backend does all of it, a half-finished
  /// registration (a login with no employee behind it) is no longer possible —
  /// it rolls the account back if the employee record cannot be written.
  ///
  /// [code] is the company code. The backend validates and consumes it here —
  /// the earlier check-code screen is only a preview, so registration cannot be
  /// completed by skipping it or by sending a code that was never issued.
  ///
  /// No employeeId is sent: which employee record this login attaches to is
  /// read from the code server-side. Letting the client name it would let
  /// anyone attach their login to a colleague's record.
  static Future<void> register({
    required String email,
    required String password,
    required String name,
    required String nationality,
    required String code,
  }) async {
    final result = await _post('/auth/register', {
      'email': email,
      'password': password,
      'name': name,
      'nationality': nationality,
      'code': code,
    });
    await _completeSignIn(result);
  }

  /// Asks the backend to email a reset link. It always reports success, even
  /// for an unknown address — otherwise the screen would tell a stranger which
  /// emails have accounts.
  static Future<void> sendPasswordReset(String email) async {
    await _post('/auth/password-reset', {'email': email});
  }
}
