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

  /// Checks if at least one fingerprint or biometric credential is enrolled in OS settings.
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

  /// Authenticates using fingerprint ONLY (no PIN, pattern, or passcode fallback).
  static Future<bool> authenticateFingerprint({
    required String localizedReason,
  }) async {
    try {
      final bool isHardwareAvailable = await isHardwareSupported();
      final bool isEnrolled = await hasEnrolledBiometrics();

      if (!isHardwareAvailable || !isEnrolled) {
        return false;
      }

      return await _auth.authenticate(
        localizedReason: localizedReason,
        options: const AuthenticationOptions(
          biometricOnly: true,
          useErrorDialogs: true,
          stickyAuth: true,
        ),
      );
    } on PlatformException catch (_) {
      return false;
    }
  }
}
