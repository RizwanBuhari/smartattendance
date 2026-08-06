import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import 'face_device_check_screen.dart';

class FaceSetupIntroScreen extends StatelessWidget {
  const FaceSetupIntroScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppColors.ink),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: const Text(
          'Face Recognition Setup',
          style: TextStyle(
            color: AppColors.ink,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16.0),
          child: Column(
            children: [
              const SizedBox(height: 12),
              // Icon Header
              Container(
                width: 90,
                height: 90,
                decoration: const BoxDecoration(
                  color: Color(0xFFFFF2F2),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.face_retouching_natural_rounded,
                  size: 48,
                  color: AppColors.brandRed,
                ),
              ),
              const SizedBox(height: 20),
              const Text(
                'Set up Face Recognition',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.ink,
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 10),
              const Text(
                'Check-N uses your device camera or system biometric face unlock to verify your identity before check-in and check-out.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.inkSoft,
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 24),

              // Privacy Cards List
              _buildPrivacyCard(
                icon: Icons.lock_outline_rounded,
                title: 'Your face data stays on your device',
                subtitle: 'Processed & encrypted locally in hardware storage.',
              ),
              const SizedBox(height: 10),
              _buildPrivacyCard(
                icon: Icons.shield_outlined,
                title: 'We never store or share face images',
                subtitle: 'No camera photographs are uploaded to servers.',
              ),
              const SizedBox(height: 10),
              _buildPrivacyCard(
                icon: Icons.restart_alt_rounded,
                title: 'You can remove or reset anytime',
                subtitle:
                    'HR / Admin can reset your biometric setup if needed.',
              ),

              const SizedBox(height: 24),

              // Primary Action Button
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
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const FaceDeviceCheckScreen(),
                      ),
                    );
                  },
                  child: const Text(
                    'Continue',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
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

  Widget _buildPrivacyCard({
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF9FAFB),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEEEEEE)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: const BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: AppColors.brandRed, size: 20),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: AppColors.inkSoft,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
