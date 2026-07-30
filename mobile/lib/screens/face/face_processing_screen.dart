import 'package:device_info_plus/device_info_plus.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'dart:io';
import '../../core/services/api_client.dart';
import '../../core/services/face_service.dart';
import '../../core/theme/app_colors.dart';
import 'face_setup_success_screen.dart';

class FaceProcessingScreen extends StatefulWidget {
  final List<double> finalEmbedding;

  const FaceProcessingScreen({
    super.key,
    required this.finalEmbedding,
  });

  @override
  State<FaceProcessingScreen> createState() => _FaceProcessingScreenState();
}

class _FaceProcessingScreenState extends State<FaceProcessingScreen> {
  @override
  void initState() {
    super.initState();
    _processRegistration();
  }

  Future<void> _processRegistration() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) {
      if (mounted) Navigator.of(context).pop();
      return;
    }

    try {
      // 1. Get hardware device info
      final deviceInfo = DeviceInfoPlugin();
      String deviceId = 'device_id_unknown';
      String deviceName = 'Mobile Phone';

      if (Platform.isAndroid) {
        final info = await deviceInfo.androidInfo;
        deviceId = info.id;
        deviceName = '${info.manufacturer} ${info.model}';
      } else if (Platform.isIOS) {
        final info = await deviceInfo.iosInfo;
        deviceId = info.identifierForVendor ?? 'ios_device';
        deviceName = '${info.name} (${info.model})';
      }

      // 2. Call backend face challenge & device registration
      final challengeRes = await ApiClient.post('/biometrics/face/challenge', {
        'action': 'face_setup',
        'deviceId': deviceId,
      }) as Map<String, dynamic>;

      final nonce = challengeRes['nonce'] as String;

      final regRes = await ApiClient.post('/biometrics/face/register-device', {
        'deviceId': deviceId,
        'deviceName': deviceName,
        'nonce': nonce,
      }) as Map<String, dynamic>;

      final setupVersion = regRes['faceSetupVersion'] as int? ?? 1;

      // 3. Save template locally in hardware-encrypted secure storage (Rule #3 & Rule #6)
      await FaceService.saveLocalTemplate(
        employeeId: uid,
        setupVersion: setupVersion,
        embedding: widget.finalEmbedding,
      );

      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => FaceSetupSuccessScreen(
              deviceName: deviceName,
              registrationTime: DateTime.now(),
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Registration failed: ${e.toString().replaceAll('Exception:', '')}')),
        );
        Navigator.of(context).pop();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Spacer(),
              // Animated Red Face Icon
              Container(
                width: 100,
                height: 100,
                decoration: const BoxDecoration(
                  color: Color(0xFFFFF2F2),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.face_retouching_natural_rounded,
                  size: 54,
                  color: AppColors.brandRed,
                ),
              ),
              const SizedBox(height: 32),
              const Text(
                'Verifying your face...',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.ink,
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'This will take a few seconds.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.inkSoft,
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 36),
              // Linear Red Progress Bar
              const ClipRRect(
                borderRadius: BorderRadius.all(Radius.circular(8)),
                child: LinearProgressIndicator(
                  minHeight: 6,
                  color: AppColors.brandRed,
                  backgroundColor: Color(0xFFFFE5E5),
                ),
              ),
              const Spacer(),
            ],
          ),
        ),
      ),
    );
  }
}
