import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import '../../core/theme/app_colors.dart';
import 'face_capture_screen.dart';

class FaceDeviceCheckScreen extends StatefulWidget {
  const FaceDeviceCheckScreen({super.key});

  @override
  State<FaceDeviceCheckScreen> createState() => _FaceDeviceCheckScreenState();
}

class _FaceDeviceCheckScreenState extends State<FaceDeviceCheckScreen> {
  bool _cameraPermissionGranted = false;
  bool _frontCameraAvailable = false;
  bool _checking = true;

  @override
  void initState() {
    super.initState();
    _checkDeviceAndPermissions();
  }

  Future<void> _checkDeviceAndPermissions() async {
    setState(() => _checking = true);

    // 1. Check camera permission
    var status = await Permission.camera.status;
    if (!status.isGranted) {
      status = await Permission.camera.request();
    }
    final granted = status.isGranted;

    // 2. Check front camera availability
    bool frontAvailable = false;
    try {
      final cameras = await availableCameras();
      frontAvailable = cameras.any((c) => c.lensDirection == CameraLensDirection.front);
    } catch (_) {}

    if (mounted) {
      setState(() {
        _cameraPermissionGranted = granted;
        _frontCameraAvailable = frontAvailable;
        _checking = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final readyToProceed = _cameraPermissionGranted && _frontCameraAvailable;

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
          'Camera Check',
          style: TextStyle(
            color: AppColors.ink,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16.0),
          child: Column(
            children: [
              const Spacer(),
              // Camera Icon
              Container(
                width: 100,
                height: 100,
                decoration: const BoxDecoration(
                  color: Color(0xFFFFF2F2),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.camera_alt_rounded,
                  size: 48,
                  color: AppColors.brandRed,
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'We need access to your camera to capture your face.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.inkSoft,
                  fontSize: 14,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 36),

              if (_checking)
                const CircularProgressIndicator(color: AppColors.brandRed)
              else ...[
                // Status Card 1: Camera Permission
                _buildStatusRow(
                  icon: Icons.person_outline_rounded,
                  title: 'Camera Permission',
                  subtitle: _cameraPermissionGranted ? 'Allowed' : 'Not allowed',
                  isOk: _cameraPermissionGranted,
                ),
                const SizedBox(height: 16),
                // Status Card 2: Camera Available
                _buildStatusRow(
                  icon: Icons.videocam_outlined,
                  title: 'Camera Available',
                  subtitle: _frontCameraAvailable ? 'Ready' : 'Front camera unavailable',
                  isOk: _frontCameraAvailable,
                ),
              ],

              const Spacer(),

              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: readyToProceed ? AppColors.brandRed : Colors.grey.shade400,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    elevation: 0,
                  ),
                  onPressed: readyToProceed
                      ? () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => const FaceCaptureScreen(),
                            ),
                          );
                        }
                      : _checkDeviceAndPermissions,
                  child: Text(
                    readyToProceed ? 'Continue' : 'Grant Permission & Retry',
                    style: const TextStyle(
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

  Widget _buildStatusRow({
    required IconData icon,
    required String title,
    required String subtitle,
    required bool isOk,
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
            child: Icon(icon, color: AppColors.ink, size: 20),
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
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: TextStyle(
                    color: isOk ? const Color(0xFF10B981) : AppColors.brandRed,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          Icon(
            isOk ? Icons.check_circle_rounded : Icons.cancel_rounded,
            color: isOk ? const Color(0xFF10B981) : AppColors.brandRed,
            size: 24,
          ),
        ],
      ),
    );
  }
}
