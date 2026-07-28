import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/services/api_client.dart';
import '../../core/services/biometric_service.dart';
import '../../core/services/device_id.dart';
import '../../core/theme/app_colors.dart';

class BiometricSetupScreen extends StatefulWidget {
  const BiometricSetupScreen({super.key});

  @override
  State<BiometricSetupScreen> createState() => _BiometricSetupScreenState();
}

class _BiometricSetupScreenState extends State<BiometricSetupScreen> {
  int _currentStep = 1; // 1: Intro, 2: Device Check, 3: Verify, 4: Success
  bool _hardwareAvailable = false;
  bool _hasEnrolledBiometrics = false;
  bool _isLoading = false;
  String? _deviceName;
  String? _registrationDate;

  @override
  void initState() {
    super.initState();
    _checkDeviceCapabilities();
  }

  Future<void> _checkDeviceCapabilities() async {
    setState(() => _isLoading = true);
    final isHardware = await BiometricService.isHardwareSupported();
    final hasEnrolled = await BiometricService.hasEnrolledBiometrics();

    if (mounted) {
      setState(() {
        _hardwareAvailable = isHardware;
        _hasEnrolledBiometrics = hasEnrolled;
        _isLoading = false;
      });
    }
  }

  Future<void> _startFingerprintVerification() async {
    setState(() => _currentStep = 3);
    final authenticated = await BiometricService.authenticateFingerprint(
      localizedReason: 'Use your fingerprint to continue setup.',
    );

    if (!mounted) return;

    if (authenticated) {
      await _registerDeviceWithBackend();
    } else {
      setState(() => _currentStep = 2);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Fingerprint verification was cancelled or failed.'),
          backgroundColor: AppColors.alertText,
        ),
      );
    }
  }

  Future<void> _registerDeviceWithBackend() async {
    setState(() => _isLoading = true);
    try {
      final deviceId = await DeviceId.get();
      final deviceName = 'Mobile Device (${deviceId.substring(0, 6)})';

      // 1. Get backend challenge nonce
      String? nonce;
      try {
        final challengeRes = await ApiClient.post('/biometrics/challenge', {});
        nonce = challengeRes['challengeNonce'] as String?;
      } catch (_) {}

      // 2. Register device with backend
      await ApiClient.post('/biometrics/register-device', {
        'deviceId': deviceId,
        'deviceName': deviceName,
        if (nonce != null) 'challengeNonce': nonce,
      });

      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('biometricSetupCompleted', true);
      await prefs.setString('biometricDeviceId', deviceId);

      final nowStr = DateTime.now().toLocal().toString().split('.')[0];

      if (mounted) {
        setState(() {
          _deviceName = deviceName;
          _registrationDate = nowStr;
          _currentStep = 4;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _currentStep = 2;
          _isLoading = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Registration failed: ${e.toString()}'),
            backgroundColor: AppColors.alertText,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: AppColors.ink),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: const Text(
          'Biometric Setup',
          style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.bold),
        ),
        centerTitle: true,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: AppColors.brandRed))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(24.0),
              child: _buildStepContent(),
            ),
    );
  }

  Widget _buildStepContent() {
    switch (_currentStep) {
      case 1:
        return _buildStep1Intro();
      case 2:
        return _buildStep2DeviceCheck();
      case 3:
        return _buildStep3Verify();
      case 4:
        return _buildStep4Success();
      default:
        return _buildStep1Intro();
    }
  }

  // --- Step 1: Intro ---
  Widget _buildStep1Intro() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        const SizedBox(height: 20),
        Container(
          width: 90,
          height: 90,
          decoration: BoxDecoration(
            color: AppColors.brandRedSoft,
            shape: BoxShape.circle,
          ),
          child: const Icon(
            Icons.fingerprint_rounded,
            size: 56,
            color: AppColors.brandRed,
          ),
        ),
        const SizedBox(height: 24),
        const Text(
          'Enable Fingerprint\nfor Attendance',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.bold,
            color: AppColors.ink,
            height: 1.2,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'Check-N uses your device fingerprint to verify it’s you before check-in or check-out.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 14, color: AppColors.inkSoft, height: 1.4),
        ),
        const SizedBox(height: 36),

        _buildFeatureItem(
          icon: Icons.fingerprint,
          title: 'Uses fingerprint already enrolled on this device',
          subtitle: 'No need to record new fingerprints.',
        ),
        const SizedBox(height: 16),
        _buildFeatureItem(
          icon: Icons.security,
          title: 'We never collect or store your fingerprint data',
          subtitle: 'Verification happens purely on your phone OS.',
        ),
        const SizedBox(height: 16),
        _buildFeatureItem(
          icon: Icons.phonelink_setup,
          title: 'You can reset or remove device anytime',
          subtitle: 'HR can assist if you change phones.',
        ),
        const SizedBox(height: 48),

        SizedBox(
          width: double.infinity,
          height: 52,
          child: ElevatedButton(
            onPressed: () => setState(() => _currentStep = 2),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.brandRed,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: const Text(
              'Continue',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildFeatureItem({
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: AppColors.neutralBg,
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: AppColors.brandRed, size: 22),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: AppColors.ink),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: TextStyle(fontSize: 12, color: AppColors.inkSoft),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // --- Step 2: Device Check ---
  Widget _buildStep2DeviceCheck() {
    final bool isReady = _hardwareAvailable && _hasEnrolledBiometrics;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        const SizedBox(height: 20),
        Container(
          width: 80,
          height: 80,
          decoration: BoxDecoration(
            color: isReady ? AppColors.okBg : AppColors.lateBg,
            shape: BoxShape.circle,
          ),
          child: Icon(
            isReady ? Icons.check_circle_outline : Icons.warning_amber_rounded,
            size: 50,
            color: isReady ? AppColors.okText : AppColors.lateText,
          ),
        ),
        const SizedBox(height: 20),
        Text(
          isReady ? 'Device is Ready' : 'Setup Required',
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.ink),
        ),
        const SizedBox(height: 8),
        Text(
          isReady
              ? 'Your device supports fingerprint authentication.'
              : 'Please enroll a fingerprint in your device Settings to continue.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 14, color: AppColors.inkSoft),
        ),
        const SizedBox(height: 32),

        // Card 1: Hardware
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.line),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              Icon(
                Icons.fingerprint,
                color: _hardwareAvailable ? AppColors.brandRed : AppColors.muted,
                size: 28,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Fingerprint Hardware', style: TextStyle(fontWeight: FontWeight.bold, color: AppColors.ink)),
                    Text(
                      _hardwareAvailable ? 'Available' : 'Not supported on this device',
                      style: TextStyle(
                        fontSize: 13,
                        color: _hardwareAvailable ? AppColors.okText : AppColors.alertText,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),

        // Card 2: Enrolled prints
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.line),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              Icon(
                Icons.person_outline,
                color: _hasEnrolledBiometrics ? Colors.blue[700] : AppColors.muted,
                size: 28,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Enrolled Fingerprints', style: TextStyle(fontWeight: FontWeight.bold, color: AppColors.ink)),
                    Text(
                      _hasEnrolledBiometrics
                          ? 'Enrolled & ready on device'
                          : 'No enrolled fingerprints found in OS',
                      style: TextStyle(
                        fontSize: 13,
                        color: _hasEnrolledBiometrics ? AppColors.okText : AppColors.alertText,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 48),

        SizedBox(
          width: double.infinity,
          height: 52,
          child: ElevatedButton(
            onPressed: isReady ? _startFingerprintVerification : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.brandRed,
              disabledBackgroundColor: AppColors.line,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: const Text(
              'Verify Fingerprint',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
            ),
          ),
        ),
        if (!_hasEnrolledBiometrics) ...[
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: OutlinedButton(
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text(
                      'Open Android/iOS System Settings -> Security -> Biometrics to enroll your fingerprint.',
                    ),
                  ),
                );
              },
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: AppColors.brandRed),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text(
                'Open Device Settings',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppColors.brandRed),
              ),
            ),
          ),
        ],
      ],
    );
  }

  // --- Step 3: Verify Prompt ---
  Widget _buildStep3Verify() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        const SizedBox(height: 40),
        const Text(
          'Verify Your Fingerprint',
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.ink),
        ),
        const SizedBox(height: 48),

        Container(
          width: 120,
          height: 120,
          decoration: BoxDecoration(
            color: AppColors.brandRedSoft,
            shape: BoxShape.circle,
          ),
          child: const Icon(
            Icons.fingerprint,
            size: 80,
            color: AppColors.brandRed,
          ),
        ),
        const SizedBox(height: 36),
        Text(
          'Use your fingerprint to continue setup.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 15, color: AppColors.inkSoft),
        ),
        const SizedBox(height: 80),

        TextButton(
          onPressed: () => setState(() => _currentStep = 2),
          child: const Text(
            'Cancel',
            style: TextStyle(color: AppColors.muted, fontSize: 16, fontWeight: FontWeight.bold),
          ),
        ),
      ],
    );
  }

  // --- Step 4: Setup Success ---
  Widget _buildStep4Success() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        const SizedBox(height: 30),
        Container(
          width: 90,
          height: 90,
          decoration: const BoxDecoration(
            color: AppColors.okText,
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.check_rounded, size: 60, color: Colors.white),
        ),
        const SizedBox(height: 24),
        const Text(
          'Biometric Setup\nSuccessful!',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, height: 1.2, color: AppColors.ink),
        ),
        const SizedBox(height: 10),
        Text(
          'This device is now registered for biometric attendance.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 14, color: AppColors.inkSoft),
        ),
        const SizedBox(height: 36),

        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.line),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              const Icon(Icons.smartphone_rounded, color: AppColors.brandRed, size: 28),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Device', style: TextStyle(fontSize: 12, color: AppColors.inkSoft)),
                    const SizedBox(height: 2),
                    Text(_deviceName ?? 'Registered Device', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppColors.ink)),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),

        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.line),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              const Icon(Icons.event_available_rounded, color: AppColors.brandRed, size: 28),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Registered On', style: TextStyle(fontSize: 12, color: AppColors.inkSoft)),
                    const SizedBox(height: 2),
                    Text(_registrationDate ?? 'Just Now', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppColors.ink)),
                  ],
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 48),

        SizedBox(
          width: double.infinity,
          height: 52,
          child: ElevatedButton(
            onPressed: () => Navigator.of(context).pop(),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.brandRed,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: const Text(
              'Done',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }
}
