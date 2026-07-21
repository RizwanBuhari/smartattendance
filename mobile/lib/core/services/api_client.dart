// Talks to the NestJS backend WITH the signed-in user's identity attached.
//
// Why this exists: the rest of the app calls `http.get(...)` directly and tells
// the server who it is by putting an id in the URL (`?authUid=...`) or the body.
// The server has no way to check that, so anyone could claim to be anyone.
//
// Every request from here carries the Firebase ID token instead. That token is
// signed by Google and verified by the backend (EmployeeGuard), so the server
// derives the caller's identity itself rather than trusting what we send.
//
// getIdToken() transparently refreshes the token when it is close to expiring,
// so there is no refresh logic to maintain here.
import 'dart:convert';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import '../constants/api_constants.dart';
import 'session_guard.dart';

// The backend's code for "another device took this account over". Kept as a
// constant on both sides so the string is never typed twice.
const String kSessionSuperseded = 'session-superseded';

class ApiException implements Exception {
  final int statusCode;
  final String message;
  // Set only for errors the app must react to rather than just display.
  final String? code;
  ApiException(this.statusCode, this.message, {this.code});

  bool get isSessionSuperseded => code == kSessionSuperseded;

  @override
  String toString() => message;
}

class ApiClient {
  static Future<Map<String, String>> _headers() async {
    final token = await FirebaseAuth.instance.currentUser?.getIdToken();
    // Identifies WHICH sign-in this is, not who the user is. The backend rejects
    // anything but the newest one, so an evicted device is locked out of the API
    // even if it never notices the Firestore session document change.
    final sessionId = await SessionGuard.currentId();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
      if (sessionId != null) 'X-Session-Id': sessionId,
    };
  }

  // Turns a non-2xx response into an ApiException carrying the backend's own
  // message, so the UI can show "Only a site admin can issue check-in codes."
  // rather than a bare status code.
  static dynamic _decode(http.Response res) {
    final body = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 200 && res.statusCode < 300) return body;

    String message = 'Request failed (${res.statusCode})';
    String? code;
    if (body is Map && body['message'] != null) {
      final m = body['message'];
      message = m is List ? m.join(', ') : m.toString();
      code = body['code']?.toString();
    }

    final error = ApiException(res.statusCode, message, code: code);
    // Another device signed in as this account. Tear this session down now
    // rather than leaving the app sitting on screens it can no longer refresh.
    // Fire-and-forget: the caller still gets the exception it was expecting.
    if (error.isSessionSuperseded) {
      SessionGuard.signOut();
    }
    throw error;
  }

  static Future<dynamic> get(String path) async {
    final res = await http.get(
      Uri.parse('${ApiConstants.baseUrl}$path'),
      headers: await _headers(),
    );
    return _decode(res);
  }

  static Future<dynamic> post(String path, [Map<String, dynamic>? body]) async {
    final res = await http.post(
      Uri.parse('${ApiConstants.baseUrl}$path'),
      headers: await _headers(),
      body: body == null ? null : jsonEncode(body),
    );
    return _decode(res);
  }

  static Future<dynamic> patch(String path, [Map<String, dynamic>? body]) async {
    final res = await http.patch(
      Uri.parse('${ApiConstants.baseUrl}$path'),
      headers: await _headers(),
      body: body == null ? null : jsonEncode(body),
    );
    return _decode(res);
  }
}
