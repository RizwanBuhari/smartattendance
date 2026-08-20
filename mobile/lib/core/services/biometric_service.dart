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
      final List<BiometricType> available =
          await _auth.getAvailableBiometrics();
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

  /// Checks if the phone has a secure screen lock (PIN, Pattern, Password, or Biometrics) configured.
  static Future<bool> isDeviceLockConfigured() async {
    try {
      final bool isSupported = await _auth.isDeviceSupported();
      final bool canCheck = await _auth.canCheckBiometrics;
      return isSupported || canCheck;
    } on PlatformException catch (_) {
      return false;
    }
  }

  /// Checks if Face ID / System Face Unlock (including Android Class 2/3 face) is enrolled in OS settings.
  static Future<bool> hasEnrolledFace() async {
    try {
      final List<BiometricType> available =
          await _auth.getAvailableBiometrics();
      return available.contains(BiometricType.face) ||
          available.contains(BiometricType.weak);
    } on PlatformException catch (_) {
      return false;
    }
  }

  /// Checks if Fingerprint / Touch ID is enrolled in OS settings.
  static Future<bool> hasEnrolledFingerprint() async {
    try {
      final List<BiometricType> available =
          await _auth.getAvailableBiometrics();
      return available.contains(BiometricType.fingerprint) ||
          available.contains(BiometricType.strong);
    } on PlatformException catch (_) {
      return false;
    }
  }

  /// Low-level native OS authentication call.
  static Future<bool> authenticateNative({
    required String localizedReason,
    bool biometricOnly = false,
  }) async {
    try {
      return await _auth.authenticate(
        localizedReason: localizedReason,
        options: AuthenticationOptions(
          biometricOnly: biometricOnly,
          useErrorDialogs: true,
          stickyAuth: true,
        ),
      );
    } on PlatformException catch (_) {
      return false;
    }
  }

  /// Fingerprint authentication helper method.
  static Future<bool> authenticateFingerprint({
    required String localizedReason,
  }) async {
    return authenticateNative(
      localizedReason: localizedReason,
      biometricOnly: true,
    );
  }

  /// Face/biometric authentication helper method.
  static Future<bool> authenticateFaceOrBiometrics({
    required String localizedReason,
  }) async {
    return authenticateNative(
      localizedReason: localizedReason,
      biometricOnly: false,
    );
  }
}
