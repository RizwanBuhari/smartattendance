import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';

class BiometricService {
  static final LocalAuthentication _auth = LocalAuthentication();

  /// Checks if the device has biometric hardware capable of checking biometrics.
  static Future<bool> isHardwareSupported() async {
    try {
      final bool canCheck = await _auth.canCheckBiometrics;
      final bool isSupported = await _auth.isDeviceSupported();
      return canCheck || isSupported;
    } on PlatformException catch (_) {
      return false;
    }
  }

  /// Checks if at least one fingerprint or face credential is enrolled in OS settings.
  static Future<bool> hasEnrolledBiometrics() async {
    try {
      final List<BiometricType> available = await _auth.getAvailableBiometrics();
      return available.isNotEmpty;
    } on PlatformException catch (_) {
      return false;
    }
  }

  /// Gets count or list of enrolled biometric types.
  static Future<List<BiometricType>> getAvailableBiometrics() async {
    try {
      return await _auth.getAvailableBiometrics();
    } on PlatformException catch (_) {
      return [];
    }
  }

  /// Authenticates using system Face Unlock or Fingerprint (allows Class 2 Face Unlock).
  static Future<bool> authenticateFaceOrBiometrics({
    required String localizedReason,
  }) async {
    try {
      final bool isHardwareAvailable = await isHardwareSupported();
      if (!isHardwareAvailable) {
        return false;
      }

      return await _auth.authenticate(
        localizedReason: localizedReason,
        options: const AuthenticationOptions(
          biometricOnly: false, // Allows system Face Unlock registered in phone settings
          useErrorDialogs: true,
          stickyAuth: true,
        ),
      );
    } on PlatformException catch (_) {
      return false;
    }
  }

  /// Legacy fingerprint authentication method.
  static Future<bool> authenticateFingerprint({
    required String localizedReason,
  }) async {
    return authenticateFaceOrBiometrics(localizedReason: localizedReason);
  }
}
