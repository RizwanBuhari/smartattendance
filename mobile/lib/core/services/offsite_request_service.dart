import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'api_client.dart';

class OffsiteRequestService {
  OffsiteRequestService._();

  static String? get _uid => FirebaseAuth.instance.currentUser?.uid;

  /**
   * Submit offsite request.
   */
  static Future<Map<String, dynamic>> createRequest(String worksiteId, String reason) async {
    final res = await ApiClient.post('/offsite-checkin/requests', {
      'worksiteId': worksiteId,
      'reason': reason,
    });
    return Map<String, dynamic>.from(res);
  }

  /**
   * Cancel pending request.
   */
  static Future<void> cancelRequest(String requestId) async {
    await ApiClient.post('/offsite-checkin/requests/$requestId/cancel');
  }

  /**
   * Supervisor accepts request.
   */
  static Future<void> acceptRequest(String requestId) async {
    await ApiClient.post('/offsite-checkin/requests/$requestId/accept');
  }

  /**
   * Supervisor rejects request.
   */
  static Future<void> rejectRequest(String requestId, String reason) async {
    await ApiClient.post('/offsite-checkin/requests/$requestId/reject', {
      'reason': reason,
    });
  }

  /**
   * Verify scanned QR payload with GPS location and device info on backend.
   */
  static Future<Map<String, dynamic>> verifyScannedQr({
    required String requestId,
    required String scannedPayload,
    required double latitude,
    required double longitude,
    double? gpsAccuracy,
    String? deviceId,
  }) async {
    final res = await ApiClient.post('/offsite-checkin/requests/$requestId/verify-qr', {
      'scannedPayload': scannedPayload,
      'latitude': latitude,
      'longitude': longitude,
      if (gpsAccuracy != null) 'gpsAccuracy': gpsAccuracy,
      if (deviceId != null) 'deviceId': deviceId,
    });
    return Map<String, dynamic>.from(res);
  }

  /**
   * Supervisor requests regeneration of QR code.
   */
  static Future<void> regenerateQr(String requestId) async {
    await ApiClient.post('/offsite-checkin/requests/$requestId/regenerate-qr');
  }

  /**
   * Stream employee's active requests.
   */
  static Stream<QuerySnapshot> getEmployeeRequestsStream() {
    final uid = _uid;
    if (uid == null) return const Stream.empty();
    return FirebaseFirestore.instance
        .collection('offsite_requests')
        .where('employeeUid', isEqualTo: uid)
        .snapshots();
  }

  /**
   * Stream supervisor's active requests.
   */
  static Stream<QuerySnapshot> getSupervisorRequestsStream() {
    final uid = _uid;
    if (uid == null) return const Stream.empty();
    return FirebaseFirestore.instance
        .collection('offsite_requests')
        .where('supervisorUid', isEqualTo: uid)
        .snapshots();
  }
}
