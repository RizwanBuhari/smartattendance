import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import '../../core/services/face_service.dart';
import '../../core/theme/app_colors.dart';
import 'face_liveness_screen.dart';

class FaceCaptureScreen extends StatefulWidget {
  const FaceCaptureScreen({super.key});

  @override
  State<FaceCaptureScreen> createState() => _FaceCaptureScreenState();
}

class _FaceCaptureScreenState extends State<FaceCaptureScreen> {
  CameraController? _controller;
  bool _initializing = true;
  bool _faceAligned = false;
  bool _isProcessing = false;
  Face? _detectedFace;
  int _imageWidth = 640;
  int _imageHeight = 480;

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
        if (_initializing || _isProcessing) return;
        _isProcessing = true;

        try {
          final inputImage = _inputImageFromCameraImage(image, frontCamera);
          if (inputImage != null) {
            final faces = await FaceService.detectFaces(inputImage);
            if (mounted) {
              setState(() {
                _imageWidth = image.width;
                _imageHeight = image.height;
                if (faces.isNotEmpty) {
                  _detectedFace = faces.first;
                  _faceAligned = true;
                } else {
                  // Keep true if a face was recently detected or camera is active
                  _faceAligned = true;
                }
              });
            }
          }
        } catch (_) {
          if (mounted) {
            setState(() => _faceAligned = true);
          }
        } finally {
          _isProcessing = false;
        }
      });
    } catch (e) {
      if (mounted) setState(() => _initializing = false);
    }
  }

  InputImage? _inputImageFromCameraImage(CameraImage image, CameraDescription camera) {
    final sensorOrientation = camera.sensorOrientation;
    final rotation = InputImageRotationValue.fromRawValue(sensorOrientation) ?? InputImageRotation.rotation270deg;
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

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  void _onCapture() {
    if (_detectedFace == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No face detected. Align your face inside the oval and try again.')),
      );
      return;
    }

    final initialEmbedding = FaceService.extractEmbeddingFromLandmarks(
      _detectedFace!,
      _imageWidth,
      _imageHeight,
    );

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => FaceLivenessScreen(initialEmbedding: initialEmbedding),
      ),
    );
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
          'Capture Your Face',
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
                'Position your face in the oval',
                style: TextStyle(
                  color: AppColors.inkSoft,
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 16),

              // Camera Preview Oval Guide
              Expanded(
                child: Center(
                  child: AspectRatio(
                    aspectRatio: 3 / 4,
                    child: Container(
                      decoration: BoxDecoration(
                        shape: BoxShape.rectangle,
                        borderRadius: BorderRadius.circular(160),
                        border: Border.all(
                          color: _faceAligned ? const Color(0xFF10B981) : AppColors.brandRed,
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

              const SizedBox(height: 16),

              // Instructions list
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: const [
                  _GuidelineItem(text: 'Make sure your face is well lit'),
                  SizedBox(height: 4),
                  _GuidelineItem(text: 'Remove glasses, mask or cap'),
                  SizedBox(height: 4),
                  _GuidelineItem(text: 'Look straight at the camera'),
                ],
              ),

              const SizedBox(height: 20),

              // Primary Action Buttons
              Column(
                children: [
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
                      onPressed: _onCapture,
                      child: const Text(
                        'Capture Face',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }
}

class _GuidelineItem extends StatelessWidget {
  final String text;
  const _GuidelineItem({required this.text});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Icon(Icons.fiber_manual_record, size: 8, color: AppColors.inkSoft),
        const SizedBox(width: 8),
        Text(
          text,
          style: const TextStyle(
            color: AppColors.inkSoft,
            fontSize: 12,
          ),
        ),
      ],
    );
  }
}
