import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';

class FingerprintNotAvailableScreen extends StatelessWidget {
  final String assignedPolicy;
  final String fallbackReason;
  final bool allowFaceFallback;
  final bool allowDeviceCredentialFallback;
  final bool hasFace;

  const FingerprintNotAvailableScreen({
    super.key,
    required this.assignedPolicy,
    required this.fallbackReason,
    required this.allowFaceFallback,
    required this.allowDeviceCredentialFallback,
    required this.hasFace,
  });

  @override
  Widget build(BuildContext context) {
    final bool canUseBiometric = allowFaceFallback || hasFace;

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(
            Icons.arrow_back_ios_new,
            color: Colors.black,
            size: 18,
          ),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: RichText(
          text: const TextSpan(
            children: [
              TextSpan(
                text: 'CHECK-',
                style: TextStyle(
                  color: Colors.black,
                  fontWeight: FontWeight.w900,
                  fontSize: 18,
                  letterSpacing: 1.0,
                ),
              ),
              TextSpan(
                text: 'N',
                style: TextStyle(
                  color: AppColors.brandRed,
                  fontWeight: FontWeight.w900,
                  fontSize: 18,
                  letterSpacing: 1.0,
                ),
              ),
            ],
          ),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              const SizedBox(height: 16),
              // Soft red circular background with fingerprint icon
              Container(
                width: 140,
                height: 140,
                decoration: const BoxDecoration(
                  color: Color(0xFFFDE8E8),
                  shape: BoxShape.circle,
                ),
                child: const Center(
                  child: Icon(
                    Icons.fingerprint_rounded,
                    size: 72,
                    color: AppColors.brandRed,
                  ),
                ),
              ),
              const SizedBox(height: 28),
              const Text(
                'Fingerprint Authentication\nNot Available',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  color: Colors.black,
                  height: 1.25,
                ),
              ),
              const SizedBox(height: 24),
              // Short explanation card
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFFFDF2F2),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFFDE8E8)),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      margin: const EdgeInsets.only(top: 2),
                      child: const Icon(
                        Icons.info,
                        color: AppColors.brandRed,
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: const [
                          Text(
                            'Fingerprint is not available or not set up on this device.',
                            style: TextStyle(
                              fontSize: 13,
                              color: Colors.black87,
                              height: 1.35,
                            ),
                          ),
                          SizedBox(height: 6),
                          Text(
                            'You can use another authentication method to continue.',
                            style: TextStyle(
                              fontSize: 13,
                              color: Colors.black54,
                              height: 1.35,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 36),
              // Buttons Area
              if (canUseBiometric) ...[
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.brandRed,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      elevation: 0,
                    ),
                    onPressed: () => Navigator.of(context).pop('biometric'),
                    child: const Text(
                      'Continue with Available Biometric',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              if (allowDeviceCredentialFallback) ...[
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(
                        color: Color(0xFFD1D5DB),
                        width: 1.5,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      backgroundColor: Colors.white,
                    ),
                    onPressed:
                        () => Navigator.of(context).pop('device_credential'),
                    child: const Text(
                      'Continue with Device Authentication',
                      style: TextStyle(
                        color: Colors.black87,
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
              ] else if (!canUseBiometric) ...[
                const SizedBox(height: 20),
              ],
              TextButton(
                onPressed: () => Navigator.of(context).pop('open_settings'),
                child: const Text(
                  'Open Phone Settings',
                  style: TextStyle(
                    color: AppColors.brandRed,
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                  ),
                ),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }
}
