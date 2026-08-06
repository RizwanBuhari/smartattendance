import 'dart:io';
import 'package:flutter/material.dart';
import 'package:local_auth/local_auth.dart';
import 'biometric_service.dart';
import '../../screens/auth_fallback/face_not_available_screen.dart';
import '../../screens/auth_fallback/fingerprint_not_available_screen.dart';
import '../../screens/auth_fallback/device_lock_not_configured_screen.dart';
import '../../screens/auth_fallback/authentication_not_supported_screen.dart';

class HardwareAuthResult {
  final bool success;
  final String assignedAuthPolicy;
  final String preferredAuthMethod;
  final String authMethodUsed;
  final bool fallbackUsed;
  final String? fallbackReason;
  final String? errorMessage;

  HardwareAuthResult({
    required this.success,
    required this.assignedAuthPolicy,
    required this.preferredAuthMethod,
    required this.authMethodUsed,
    this.fallbackUsed = false,
    this.fallbackReason,
    this.errorMessage,
  });
}

class HardwareAuthRouter {
  HardwareAuthRouter._();

  /// Evaluates HR policy against device capabilities and executes system authentication or fallback screens.
  static Future<HardwareAuthResult> evaluateAndAuthenticate({
    required BuildContext context,
    required String rawPolicy,
    required String actionReason,
  }) async {
    final policy = _normalizePolicy(rawPolicy);

    final bool isLockSet = await BiometricService.isDeviceLockConfigured();
    final bool hasFace = await BiometricService.hasEnrolledFace();
    final bool hasFingerprint = await BiometricService.hasEnrolledFingerprint();
    final List<BiometricType> availableBiometrics =
        await BiometricService.getAvailableBiometrics();

    final String preferredMethod = _determinePreferredMethod(policy);

    // 1. Check Device Lock configuration first
    if (!isLockSet) {
      if (context.mounted) {
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder:
                (_) => DeviceLockNotConfiguredScreen(
                  hasFace: hasFace,
                  hasFingerprint: hasFingerprint,
                ),
          ),
        );
      }
      return HardwareAuthResult(
        success: false,
        assignedAuthPolicy: policy,
        preferredAuthMethod: preferredMethod,
        authMethodUsed: 'none',
        fallbackUsed: false,
        fallbackReason: 'device_lock_not_configured',
        errorMessage: 'Device screen lock (PIN/Pattern) is not configured.',
      );
    }

    // 2. Strict Policies
    if (policy == 'strict_face') {
      if (Platform.isIOS && hasFace) {
        final success = await BiometricService.authenticateNative(
          localizedReason: actionReason,
          biometricOnly: true,
        );
        return HardwareAuthResult(
          success: success,
          assignedAuthPolicy: policy,
          preferredAuthMethod: 'face',
          authMethodUsed: 'system_face',
          fallbackUsed: false,
        );
      } else {
        // Block strict_face on Android or devices without guaranteed Face ID
        if (context.mounted) {
          await Navigator.of(context).push(
            MaterialPageRoute(
              builder:
                  (_) => FaceNotAvailableScreen(
                    assignedPolicy: policy,
                    fallbackReason:
                        hasFace
                            ? 'face_only_not_guaranteed'
                            : 'face_not_supported',
                    allowFingerprintFallback: false,
                    allowDeviceCredentialFallback: false,
                    hasFingerprint: hasFingerprint,
                  ),
            ),
          );
        }
        return HardwareAuthResult(
          success: false,
          assignedAuthPolicy: policy,
          preferredAuthMethod: 'face',
          authMethodUsed: 'none',
          fallbackUsed: false,
          fallbackReason: 'strict_policy_unsupported',
          errorMessage:
              'Strict Face Authentication is not supported on this device.',
        );
      }
    }

    if (policy == 'strict_fingerprint') {
      if (hasFingerprint) {
        final success = await BiometricService.authenticateNative(
          localizedReason: actionReason,
          biometricOnly: true,
        );
        final String methodUsed =
            Platform.isIOS ? 'fingerprint' : 'device_authentication';
        return HardwareAuthResult(
          success: success,
          assignedAuthPolicy: policy,
          preferredAuthMethod: 'fingerprint',
          authMethodUsed: methodUsed,
          fallbackUsed: false,
        );
      } else {
        if (context.mounted) {
          await Navigator.of(context).push(
            MaterialPageRoute(
              builder:
                  (_) => FingerprintNotAvailableScreen(
                    assignedPolicy: policy,
                    fallbackReason: 'fingerprint_not_supported',
                    allowFaceFallback: false,
                    allowDeviceCredentialFallback: false,
                    hasFace: hasFace,
                  ),
            ),
          );
        }
        return HardwareAuthResult(
          success: false,
          assignedAuthPolicy: policy,
          preferredAuthMethod: 'fingerprint',
          authMethodUsed: 'none',
          fallbackUsed: false,
          fallbackReason: 'strict_policy_unsupported',
          errorMessage:
              'Strict Fingerprint Authentication is not supported on this device.',
        );
      }
    }

    // 3. Face Preferred Policy
    if (policy == 'face_preferred') {
      // Only attempt the "compliant" path when face is actually enrolled —
      // local_auth's biometricOnly prompt can't tell us WHICH biometric the
      // user authenticated with, so if face isn't enrolled at all, any
      // success here is guaranteed to be a different biometric (fingerprint,
      // etc.), not face. Letting that count as non-fallback used to hide a
      // real method substitution from HR entirely.
      if (hasFace) {
        final success = await BiometricService.authenticateNative(
          localizedReason: actionReason,
          biometricOnly: true,
        );
        if (success) {
          final methodUsed =
              Platform.isIOS ? 'system_face' : 'device_authentication';
          return HardwareAuthResult(
            success: true,
            assignedAuthPolicy: policy,
            preferredAuthMethod: 'face',
            authMethodUsed: methodUsed,
            fallbackUsed: false,
          );
        }
      }

      // Face unavailable or prompt failed/cancelled $\rightarrow$ Open Fallback Screen
      if (context.mounted) {
        final fallbackSelection = await Navigator.of(context).push<String>(
          MaterialPageRoute(
            builder:
                (_) => FaceNotAvailableScreen(
                  assignedPolicy: policy,
                  fallbackReason:
                      hasFace ? 'face_prompt_cancelled' : 'face_not_supported',
                  allowFingerprintFallback: hasFingerprint,
                  allowDeviceCredentialFallback: isLockSet,
                  hasFingerprint: hasFingerprint,
                ),
          ),
        );

        if (fallbackSelection == 'biometric') {
          final success = await BiometricService.authenticateNative(
            localizedReason: actionReason,
            biometricOnly: true,
          );
          final methodUsed =
              Platform.isIOS
                  ? (hasFingerprint ? 'fingerprint' : 'system_face')
                  : 'device_authentication';
          return HardwareAuthResult(
            success: success,
            assignedAuthPolicy: policy,
            preferredAuthMethod: 'face',
            authMethodUsed: methodUsed,
            fallbackUsed: true,
            fallbackReason: 'face_unavailable_biometric_used',
          );
        } else if (fallbackSelection == 'device_credential') {
          final success = await BiometricService.authenticateNative(
            localizedReason: actionReason,
            biometricOnly: false,
          );
          final methodUsed =
              Platform.isIOS ? 'device_credential' : 'device_authentication';
          return HardwareAuthResult(
            success: success,
            assignedAuthPolicy: policy,
            preferredAuthMethod: 'face',
            authMethodUsed: methodUsed,
            fallbackUsed: true,
            fallbackReason: 'face_unavailable_device_credential_used',
          );
        }
      }

      return HardwareAuthResult(
        success: false,
        assignedAuthPolicy: policy,
        preferredAuthMethod: 'face',
        authMethodUsed: 'none',
        fallbackUsed: false,
        fallbackReason: 'authentication_cancelled',
        errorMessage: 'Face authentication cancelled or unavailable.',
      );
    }

    // 4. Fingerprint Preferred Policy
    if (policy == 'fingerprint_preferred') {
      if (hasFingerprint) {
        final success = await BiometricService.authenticateNative(
          localizedReason: actionReason,
          biometricOnly: true,
        );
        if (success) {
          final methodUsed =
              Platform.isIOS ? 'fingerprint' : 'device_authentication';
          return HardwareAuthResult(
            success: true,
            assignedAuthPolicy: policy,
            preferredAuthMethod: 'fingerprint',
            authMethodUsed: methodUsed,
            fallbackUsed: false,
          );
        }
      }

      // Fingerprint unavailable $\rightarrow$ Open Fallback Screen
      if (context.mounted) {
        final fallbackSelection = await Navigator.of(context).push<String>(
          MaterialPageRoute(
            builder:
                (_) => FingerprintNotAvailableScreen(
                  assignedPolicy: policy,
                  fallbackReason: 'fingerprint_not_supported',
                  allowFaceFallback: hasFace,
                  allowDeviceCredentialFallback: isLockSet,
                  hasFace: hasFace,
                ),
          ),
        );

        if (fallbackSelection == 'face' || fallbackSelection == 'biometric') {
          final success = await BiometricService.authenticateNative(
            localizedReason: actionReason,
            biometricOnly: true,
          );
          final methodUsed =
              Platform.isIOS ? 'system_face' : 'device_authentication';
          return HardwareAuthResult(
            success: success,
            assignedAuthPolicy: policy,
            preferredAuthMethod: 'fingerprint',
            authMethodUsed: methodUsed,
            fallbackUsed: true,
            fallbackReason: 'fingerprint_unavailable_face_used',
          );
        } else if (fallbackSelection == 'device_credential') {
          final success = await BiometricService.authenticateNative(
            localizedReason: actionReason,
            biometricOnly: false,
          );
          final methodUsed =
              Platform.isIOS ? 'device_credential' : 'device_authentication';
          return HardwareAuthResult(
            success: success,
            assignedAuthPolicy: policy,
            preferredAuthMethod: 'fingerprint',
            authMethodUsed: methodUsed,
            fallbackUsed: true,
            fallbackReason: 'fingerprint_unavailable_device_credential_used',
          );
        }
      }

      return HardwareAuthResult(
        success: false,
        assignedAuthPolicy: policy,
        preferredAuthMethod: 'fingerprint',
        authMethodUsed: 'none',
        fallbackUsed: false,
        fallbackReason: 'authentication_cancelled',
        errorMessage: 'Fingerprint authentication cancelled or unavailable.',
      );
    }

    // 5. Any Biometric Policy
    if (policy == 'any_biometric') {
      if (availableBiometrics.isNotEmpty) {
        final success = await BiometricService.authenticateNative(
          localizedReason: actionReason,
          biometricOnly: true,
        );
        final methodUsed =
            Platform.isIOS
                ? (hasFace ? 'system_face' : 'fingerprint')
                : 'device_authentication';
        return HardwareAuthResult(
          success: success,
          assignedAuthPolicy: policy,
          preferredAuthMethod: 'any_biometric',
          authMethodUsed: methodUsed,
          fallbackUsed: false,
        );
      } else {
        if (context.mounted) {
          await Navigator.of(context).push(
            MaterialPageRoute(
              builder:
                  (_) => AuthenticationNotSupportedScreen(
                    hasFace: hasFace,
                    hasFingerprint: hasFingerprint,
                    isLockConfigured: isLockSet,
                  ),
            ),
          );
        }
        return HardwareAuthResult(
          success: false,
          assignedAuthPolicy: policy,
          preferredAuthMethod: 'any_biometric',
          authMethodUsed: 'none',
          fallbackUsed: false,
          fallbackReason: 'no_biometric_enrolled',
          errorMessage: 'No enrolled biometric authentication available.',
        );
      }
    }

    // 6. Generic Device Authentication Policy (Default for device_authentication & fallbacks)
    if (isLockSet) {
      final success = await BiometricService.authenticateNative(
        localizedReason: actionReason,
        biometricOnly: false,
      );
      final methodUsed =
          Platform.isIOS
              ? (hasFace
                  ? 'system_face'
                  : (hasFingerprint ? 'fingerprint' : 'device_credential'))
              : 'device_authentication';

      return HardwareAuthResult(
        success: success,
        assignedAuthPolicy: policy,
        preferredAuthMethod: 'device_authentication',
        authMethodUsed: methodUsed,
        fallbackUsed: false,
      );
    }

    // Unsupported device state
    if (context.mounted) {
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder:
              (_) => AuthenticationNotSupportedScreen(
                hasFace: hasFace,
                hasFingerprint: hasFingerprint,
                isLockConfigured: isLockSet,
              ),
        ),
      );
    }

    return HardwareAuthResult(
      success: false,
      assignedAuthPolicy: policy,
      preferredAuthMethod: preferredMethod,
      authMethodUsed: 'none',
      fallbackUsed: false,
      fallbackReason: 'device_unsupported',
      errorMessage:
          'This device cannot complete the required attendance verification.',
    );
  }

  static String _normalizePolicy(String raw) {
    final lower = raw.toLowerCase().trim();
    if (lower.contains('strict_face')) return 'strict_face';
    if (lower.contains('strict_fingerprint')) return 'strict_fingerprint';
    if (lower.contains('face_preferred')) return 'face_preferred';
    if (lower.contains('fingerprint_preferred')) return 'fingerprint_preferred';
    if (lower.contains('any_biometric')) return 'any_biometric';
    if (lower.contains('device_authentication') ||
        lower.contains('device_auth'))
      return 'device_authentication';
    if (lower.contains('face')) return 'face_preferred';
    if (lower.contains('fingerprint') || lower.contains('biometric'))
      return 'fingerprint_preferred';
    return 'device_authentication';
  }

  static String _determinePreferredMethod(String policy) {
    if (policy.contains('face')) return 'face';
    if (policy.contains('fingerprint')) return 'fingerprint';
    return 'device_authentication';
  }
}
