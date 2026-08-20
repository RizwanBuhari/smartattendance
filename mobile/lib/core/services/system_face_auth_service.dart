import 'dart:io';
import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';
import 'api_client.dart';
import 'device_id.dart';

class SystemFaceAuthResult {
  final bool success;
  final String? nonce;
  final String? deviceId;
  final String? errorMessage;

  SystemFaceAuthResult({
    required this.success,
    this.nonce,
    this.deviceId,
    this.errorMessage,
  });
}

class SystemFaceAuthService {
  SystemFaceAuthService._();

  static final LocalAuthentication _auth = LocalAuthentication();
  static bool _isAuthenticating = false;

  /// Checks whether system biometrics (Face ID on iOS / Face Unlock on Android) is enrolled in phone settings.
  static Future<bool> isFaceBiometricEnrolled() async {
    try {
      final bool canCheck = await _auth.canCheckBiometrics;
      final bool isSupported = await _auth.isDeviceSupported();
      if (!canCheck && !isSupported) return false;

      final List<BiometricType> available =
          await _auth.getAvailableBiometrics();
      if (Platform.isIOS) {
        return available.contains(BiometricType.face);
      }
      return available.isNotEmpty;
    } on PlatformException catch (_) {
      return false;
    }
  }

  /// Strict System Face Authentication for face-only employees.
  /// Rejects Fingerprint, PIN, Pattern, or Passcode fallbacks.
  static Future<SystemFaceAuthResult> authenticateAndGetChallenge({
    required String action, // 'check_in' or 'check_out'
  }) async {
    if (_isAuthenticating) {
      return SystemFaceAuthResult(
        success: false,
        errorMessage: 'Face authentication is already in progress.',
      );
    }

    _isAuthenticating = true;

    try {
      final bool canCheck = await _auth.canCheckBiometrics;
      final bool isSupported = await _auth.isDeviceSupported();

      if (!canCheck && !isSupported) {
        return SystemFaceAuthResult(
          success: false,
          errorMessage: 'Biometric hardware is not available on this device.',
        );
      }

      final List<BiometricType> available =
          await _auth.getAvailableBiometrics();
      final bool hasBiometrics =
          Platform.isIOS
              ? available.contains(BiometricType.face)
              : available.isNotEmpty;

      if (!hasBiometrics) {
        return SystemFaceAuthResult(
          success: false,
          errorMessage:
              Platform.isIOS
                  ? 'Face ID is not enrolled on this iPhone. Please set up Face ID in iOS Settings.'
                  : 'System Face Unlock is not registered on this phone. Please enroll Face Unlock in Android Settings.',
        );
      }

      final deviceId = await DeviceId.get();

      // Request 60s server challenge nonce
      final challengeRes =
          await ApiClient.post('/biometrics/face/challenge', {
                'action': action,
                'deviceId': deviceId,
              })
              as Map<String, dynamic>;

      final nonce = challengeRes['nonce'] as String?;
      final actionTitle = action == 'check_in' ? 'Check-In' : 'Check-Out';

      // Trigger native OS Face Biometric authentication prompt (biometricOnly: true prevents PIN/passcode/fingerprint)
      final bool authenticated = await _auth.authenticate(
        localizedReason: 'Verify your face to complete $actionTitle.',
        options: const AuthenticationOptions(
          biometricOnly: true, // Strict biometric (Face)
          useErrorDialogs: true,
          stickyAuth: true,
        ),
      );

      if (!authenticated) {
        return SystemFaceAuthResult(
          success: false,
          errorMessage: 'Face authentication was cancelled or failed.',
        );
      }

      // Auto-register face device if needed on backend
      try {
        await ApiClient.post('/biometrics/face/register', {
          'deviceId': deviceId,
          'deviceName':
              Platform.isAndroid ? 'Android System Face' : 'iOS Face ID',
          'nonce': nonce,
        });
      } catch (_) {}

      return SystemFaceAuthResult(
        success: true,
        nonce: nonce,
        deviceId: deviceId,
      );
    } on PlatformException catch (e) {
      return SystemFaceAuthResult(
        success: false,
        errorMessage: 'Face authentication error: ${e.message}',
      );
    } catch (e) {
      return SystemFaceAuthResult(
        success: false,
        errorMessage:
            'Face verification error: ${e.toString().replaceAll('Exception:', '')}',
      );
    } finally {
      _isAuthenticating = false;
    }
  }
}
