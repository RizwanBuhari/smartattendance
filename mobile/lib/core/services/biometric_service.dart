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
<<<<<<< HEAD
      final List<BiometricType> available = await _auth.getAvailableBiometrics();
=======
      final List<BiometricType> available =
          await _auth.getAvailableBiometrics();
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
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

<<<<<<< HEAD
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
=======
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
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
          useErrorDialogs: true,
          stickyAuth: true,
        ),
      );
    } on PlatformException catch (_) {
      return false;
    }
  }

<<<<<<< HEAD
  /// Fingerprint authentication method (enforces biometric hardware prompt).
  static Future<bool> authenticateFingerprint({
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
          biometricOnly: true,
          useErrorDialogs: true,
          stickyAuth: true,
        ),
      );
    } on PlatformException catch (_) {
      return false;
    }
=======
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
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
  }
}
