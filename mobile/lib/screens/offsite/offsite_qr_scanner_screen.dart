import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/services/device_id.dart';
import '../../core/services/offsite_request_service.dart';
import '../../core/theme/app_colors.dart';
import 'offsite_success_screen.dart';

class OffsiteQrScannerScreen extends StatefulWidget {
  final String requestId;
  const OffsiteQrScannerScreen({super.key, required this.requestId});

  @override
  State<OffsiteQrScannerScreen> createState() => _OffsiteQrScannerScreenState();
}

class _OffsiteQrScannerScreenState extends State<OffsiteQrScannerScreen> {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
  );
  bool _handled = false;
  bool _verifying = false;
  bool _flashOn = false;

  Future<void> _onDetect(String payload) async {
    if (_handled || _verifying) return;
    setState(() {
      _verifying = true;
    });

    // Pause scanner
    _controller.stop();

    try {
      // 1. Fetch fresh GPS coordinates
      Position? pos;
      try {
        pos = await Geolocator.getCurrentPosition(
          desiredAccuracy: LocationAccuracy.high,
          timeLimit: const Duration(seconds: 8),
        );
      } catch (_) {
        // Fallback to last known position if timeout
        pos = await Geolocator.getLastKnownPosition();
      }

      if (pos == null) {
        throw Exception('Unable to retrieve GPS coordinates. Please ensure location is enabled.');
      }

      // 2. Fetch device ID
      final devId = await DeviceId.get();

      // 3. Send payload to NestJS backend for verification
      final response = await OffsiteRequestService.verifyScannedQr(
        requestId: widget.requestId,
        scannedPayload: payload,
        latitude: pos.latitude,
        longitude: pos.longitude,
        gpsAccuracy: pos.accuracy,
        deviceId: devId,
      );

      if (response['accepted'] == true && mounted) {
        _handled = true;
        // Navigate to Success screen (Screen 6)
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => OffsiteSuccessScreen(attendanceRecord: response),
          ),
        );
      } else {
        throw Exception(response['message'] ?? 'Check-in verification failed.');
      }
    } catch (e) {
      if (mounted) {
        _showErrorDialog(e.toString());
      }
    } finally {
      if (mounted) {
        setState(() {
          _verifying = false;
        });
      }
    }
  }

  void _showErrorDialog(String errorMsg) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text('Check-in Failed'),
        content: Text(errorMsg),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              // Resume scanner
              if (mounted && !_handled) {
                _controller.start();
                setState(() {
                  _verifying = false;
                });
              }
            },
            child: const Text('Try Again', style: TextStyle(color: AppColors.brandRed)),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              Navigator.pop(context); // Go back to Offsite Home
            },
            child: const Text('Cancel', style: TextStyle(color: AppColors.inkSoft)),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // 1. Camera preview
          MobileScanner(
            controller: _controller,
            onDetect: (capture) {
              if (capture.barcodes.isEmpty) return;
              final code = capture.barcodes.first.rawValue;
              if (code != null) {
                _onDetect(code);
              }
            },
            errorBuilder: (context, error) => _buildErrorState(),
          ),
          
          // 2. Scanner Overlay Guides (Corners and scan line)
          if (!_verifying) _buildScannerOverlay(),

          // 3. Back Button and Flashlight control
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  IconButton(
                    icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white),
                    onPressed: () => Navigator.pop(context),
                  ),
                  IconButton(
                    icon: Icon(
                      _flashOn ? Icons.flash_on_rounded : Icons.flash_off_rounded,
                      color: Colors.white,
                    ),
                    onPressed: () {
                      _controller.toggleTorch();
                      setState(() {
                        _flashOn = !_flashOn;
                      });
                    },
                  ),
                ],
              ),
            ),
          ),

          // 4. Verifying Loader overlay
          if (_verifying)
            Container(
              color: Colors.black.withValues(alpha: 0.75),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const CircularProgressIndicator(color: AppColors.brandRed),
                    const SizedBox(height: 16),
                    const Text(
                      'Verifying Check-in...',
                      style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Checking GPS location and security token',
                      style: TextStyle(color: Colors.white70, fontSize: 13),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildScannerOverlay() {
    return LayoutBuilder(
      builder: (context, constraints) {
        final double width = constraints.maxWidth;
        final double height = constraints.maxHeight;
        final double scanSize = width * 0.7;

        return Stack(
          children: [
            // Darkened backgrounds outside the frame
            ColorFiltered(
              colorFilter: ColorFilter.mode(
                Colors.black.withValues(alpha: 0.5),
                BlendMode.srcOut,
              ),
              child: Stack(
                children: [
                  Container(color: Colors.black),
                  Center(
                    child: Container(
                      width: scanSize,
                      height: scanSize,
                      decoration: BoxDecoration(
                        color: Colors.red, // Arbitrary color required for srcOut filter
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            // White scanning corners
            Center(
              child: SizedBox(
                width: scanSize,
                height: scanSize,
                child: CustomPaint(
                  painter: _ScannerFramePainter(),
                ),
              ),
            ),
            // Floating instruction label
            Positioned(
              top: (height / 2) + (scanSize / 2) + 24,
              left: 16,
              right: 16,
              child: const Column(
                children: [
                  Text(
                    'Align QR code within the frame to scan',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600),
                  ),
                  SizedBox(height: 8),
                  Text(
                    'Hold your phone steady',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.no_photography_outlined, color: Colors.white70, size: 48),
            const SizedBox(height: 16),
            const Text(
              'Camera access denied',
              style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
            ),
            const SizedBox(height: 8),
            const Text(
              'Please allow camera permission in system Settings to check in offsite.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white70, fontSize: 13),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.brandRed),
              onPressed: () => Navigator.pop(context),
              child: const Text('Back to Home', style: TextStyle(color: Colors.white)),
            ),
          ],
        ),
      ),
    );
  }
}

class _ScannerFramePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white
      ..strokeWidth = 4
      ..style = PaintingStyle.stroke;

    const double cornerLength = 20;

    // Top Left
    canvas.drawLine(const Offset(0, 0), const Offset(cornerLength, 0), paint);
    canvas.drawLine(const Offset(0, 0), const Offset(0, cornerLength), paint);

    // Top Right
    canvas.drawLine(Offset(size.width, 0), Offset(size.width - cornerLength, 0), paint);
    canvas.drawLine(Offset(size.width, 0), Offset(size.width, cornerLength), paint);

    // Bottom Left
    canvas.drawLine(Offset(0, size.height), Offset(cornerLength, size.height), paint);
    canvas.drawLine(Offset(0, size.height), Offset(0, size.height - cornerLength), paint);

    // Bottom Right
    canvas.drawLine(Offset(size.width, size.height), Offset(size.width - cornerLength, size.height), paint);
    canvas.drawLine(Offset(size.width, size.height), Offset(size.width, size.height - cornerLength), paint);

    // Red horizontal scanning indicator line in center
    final linePaint = Paint()
      ..color = AppColors.brandRed
      ..strokeWidth = 2;
    canvas.drawLine(Offset(8, size.height / 2), Offset(size.width - 8, size.height / 2), linePaint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
