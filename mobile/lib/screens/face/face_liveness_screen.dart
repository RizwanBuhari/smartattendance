import 'dart:async';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import '../../core/services/face_service.dart';
import '../../core/theme/app_colors.dart';
import 'face_processing_screen.dart';

class FaceLivenessScreen extends StatefulWidget {
  final List<double> initialEmbedding;

  const FaceLivenessScreen({
    super.key,
    required this.initialEmbedding,
  });

  @override
  State<FaceLivenessScreen> createState() => _FaceLivenessScreenState();
}

class _FaceLivenessScreenState extends State<FaceLivenessScreen> {
  CameraController? _controller;
  bool _initializing = true;
  int _currentStep = 0; // 0: Blink, 1: Turn Left, 2: Turn Right, 3: Smile

  final List<String> _stepTitles = ['Blink', 'Turn Left', 'Turn Right', 'Smile'];
  final List<String> _stepInstructions = [
    'Blink your eyes',
    'Turn your head left',
    'Turn your head right',
    'Smile at the camera',
  ];

  @override
  void initState() {
    super.initState();
    _initCamera();
  }

  Future<void> _initCamera() async {
    try {
      final cameras = await availableCameras();
      final frontCamera = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );

      _controller = CameraController(
        frontCamera,
        ResolutionPreset.medium,
        enableAudio: false,
      );

      await _controller!.initialize();
      if (!mounted) return;

      setState(() => _initializing = false);

      _controller!.startImageStream((image) async {
        if (_initializing) return;
        final inputImage = _inputImageFromCameraImage(image, frontCamera);
        if (inputImage == null) return;

        final faces = await FaceService.detectFaces(inputImage);
        if (faces.isNotEmpty && mounted) {
          _evaluateLivenessStep(faces.first);
        }
      });
    } catch (_) {
      if (mounted) setState(() => _initializing = false);
    }
  }

  InputImage? _inputImageFromCameraImage(CameraImage image, CameraDescription camera) {
    final sensorOrientation = camera.sensorOrientation;
    final rotation = InputImageRotationValue.fromRawValue(sensorOrientation) ?? InputImageRotation.rotation0deg;
    final format = InputImageFormatValue.fromRawValue(image.format.raw) ?? InputImageFormat.nv21;

    final plane = image.planes.first;
    return InputImage.fromBytes(
      bytes: plane.bytes,
      metadata: InputImageMetadata(
        size: Size(image.width.toDouble(), image.height.toDouble()),
        rotation: rotation,
        format: format,
        bytesPerRow: plane.bytesPerRow,
      ),
    );
  }

  void _evaluateLivenessStep(Face face) {
    bool stepPassed = false;

    switch (_currentStep) {
      case 0: // Blink
        final leftOpen = face.leftEyeOpenProbability ?? 1.0;
        final rightOpen = face.rightEyeOpenProbability ?? 1.0;
        if (leftOpen < 0.3 || rightOpen < 0.3) {
          stepPassed = true;
        }
        break;
      case 1: // Turn Left
        final yaw = face.headEulerAngleY ?? 0.0;
        if (yaw > 12.0) stepPassed = true;
        break;
      case 2: // Turn Right
        final yaw = face.headEulerAngleY ?? 0.0;
        if (yaw < -12.0) stepPassed = true;
        break;
      case 3: // Smile
        final smile = face.smilingProbability ?? 0.0;
        if (smile > 0.4) stepPassed = true;
        break;
    }

    if (stepPassed && mounted) {
      if (_currentStep < 3) {
        setState(() {
          _currentStep++;
        });
      } else {
        // Complete liveness
        _controller?.stopImageStream();
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => FaceProcessingScreen(
              finalEmbedding: widget.initialEmbedding,
            ),
          ),
        );
      }
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

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
          'Liveness Check',
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
          padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 12.0),
          child: Column(
            children: [
              const Text(
                'Please follow the instructions',
                style: TextStyle(
                  color: AppColors.inkSoft,
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 16),

              // Camera Oval Frame
              Expanded(
                child: Center(
                  child: AspectRatio(
                    aspectRatio: 3 / 4,
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(160),
                        border: Border.all(
                          color: const Color(0xFF10B981),
                          width: 4,
                        ),
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(156),
                        child: _initializing || _controller == null || !_controller!.value.isInitialized
                            ? const Center(child: CircularProgressIndicator(color: AppColors.brandRed))
                            : CameraPreview(_controller!),
                      ),
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 20),

              // Action Green Pill
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 14),
                decoration: BoxDecoration(
                  color: const Color(0xFF10B981),
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Text(
                  _stepInstructions[_currentStep],
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),

              const SizedBox(height: 24),

              // Step Progress Numbers (1, 2, 3, 4)
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: List.generate(4, (index) {
                  final active = index == _currentStep;
                  final completed = index < _currentStep;

                  return Column(
                    children: [
                      Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: completed
                              ? const Color(0xFF10B981)
                              : (active ? AppColors.brandRed : const Color(0xFFF0F0F0)),
                        ),
                        child: Center(
                          child: completed
                              ? const Icon(Icons.check, color: Colors.white, size: 20)
                              : Text(
                                  '${index + 1}',
                                  style: TextStyle(
                                    color: active ? Colors.white : AppColors.inkSoft,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _stepTitles[index],
                        style: TextStyle(
                          color: active || completed ? AppColors.ink : AppColors.inkSoft,
                          fontSize: 11,
                          fontWeight: active ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                    ],
                  );
                }),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }
}
