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

class ApiException implements Exception {
  final int statusCode;
  final String message;
  ApiException(this.statusCode, this.message);

  @override
  String toString() => message;
}

class ApiClient {
  static Future<Map<String, String>> _headers() async {
    final token = await FirebaseAuth.instance.currentUser?.getIdToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  // Turns a non-2xx response into an ApiException carrying the backend's own
  // message, so the UI can show "Only a site admin can issue check-in codes."
  // rather than a bare status code.
  static dynamic _decode(http.Response res) {
    final body = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 200 && res.statusCode < 300) return body;

    String message = 'Request failed (${res.statusCode})';
    if (body is Map && body['message'] != null) {
      final m = body['message'];
      message = m is List ? m.join(', ') : m.toString();
    }
    throw ApiException(res.statusCode, message);
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
}
