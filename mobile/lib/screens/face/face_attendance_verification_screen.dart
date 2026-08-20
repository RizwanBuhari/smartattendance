import 'package:camera/camera.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'dart:io';
import '../../core/services/api_client.dart';
import '../../core/services/face_service.dart';
import '../../core/theme/app_colors.dart';

class FaceAttendanceVerificationResult {
  final bool success;
  final String? nonce;
  final String? deviceId;
  final String? errorMessage;
  final bool setupRequired;

  FaceAttendanceVerificationResult({
    required this.success,
    this.nonce,
    this.deviceId,
    this.errorMessage,
    this.setupRequired = false,
  });
}

class FaceAttendanceVerificationScreen extends StatefulWidget {
  final String action; // 'check_in' or 'check_out'
  final int serverSetupVersion;

  const FaceAttendanceVerificationScreen({
    super.key,
    required this.action,
    required this.serverSetupVersion,
  });

  @override
<<<<<<< HEAD
  State<FaceAttendanceVerificationScreen> createState() => _FaceAttendanceVerificationScreenState();
}

class _FaceAttendanceVerificationScreenState extends State<FaceAttendanceVerificationScreen> {
=======
  State<FaceAttendanceVerificationScreen> createState() =>
      _FaceAttendanceVerificationScreenState();
}

class _FaceAttendanceVerificationScreenState
    extends State<FaceAttendanceVerificationScreen> {
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
  CameraController? _controller;
  bool _initializing = true;
  bool _verifying = false;
  bool? _isSuccess; // null = pending, true = success, false = failed
  String _statusText = 'Look at the camera to verify your identity.';

  @override
  void initState() {
    super.initState();
    _initAndVerify();
  }

  Future<void> _initAndVerify() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) {
<<<<<<< HEAD
      _finishWithResult(FaceAttendanceVerificationResult(
        success: false,
        errorMessage: 'User authentication required.',
      ));
=======
      _finishWithResult(
        FaceAttendanceVerificationResult(
          success: false,
          errorMessage: 'User authentication required.',
        ),
      );
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
      return;
    }

    final localTemplate = await FaceService.getLocalTemplate(uid);
    List<double>? enrolledEmbedding;
    if (localTemplate != null) {
      final localVersion = localTemplate['version'] as int? ?? 1;
      if (localVersion < widget.serverSetupVersion) {
        await FaceService.deleteLocalTemplate(uid);
      } else {
<<<<<<< HEAD
        enrolledEmbedding = (localTemplate['embedding'] as List<dynamic>).cast<double>();
=======
        enrolledEmbedding =
            (localTemplate['embedding'] as List<dynamic>).cast<double>();
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
      }
    }

    // Init Camera
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

      setState(() {
        _initializing = false;
<<<<<<< HEAD
        _statusText = enrolledEmbedding == null
            ? 'First-Time Setup: Align face inside oval to register.'
            : 'Align face inside oval to verify identity.';
=======
        _statusText =
            enrolledEmbedding == null
                ? 'First-Time Setup: Align face inside oval to register.'
                : 'Align face inside oval to verify identity.';
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
      });

      _controller!.startImageStream((image) async {
        if (_initializing || _verifying) return;
        try {
          final inputImage = _inputImageFromCameraImage(image, frontCamera);
          if (inputImage == null) return;

          final faces = await FaceService.detectFaces(inputImage);
          if (faces.isNotEmpty && mounted && !_verifying) {
            final face = faces.first;
            _performFaceVerification(
              uid: uid,
              face: face,
              imageWidth: image.width,
              imageHeight: image.height,
              enrolledEmbedding: enrolledEmbedding,
            );
          }
        } catch (e) {
          if (mounted && !_verifying) {
            setState(() {
              _statusText = 'Position face inside the oval guide.';
            });
          }
        }
      });
    } catch (e) {
<<<<<<< HEAD
      _finishWithResult(FaceAttendanceVerificationResult(
        success: false,
        errorMessage: 'Failed to access camera: $e',
      ));
=======
      _finishWithResult(
        FaceAttendanceVerificationResult(
          success: false,
          errorMessage: 'Failed to access camera: $e',
        ),
      );
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
    }
  }

  static Uint8List _yuv420ToNv21(CameraImage image) {
    final width = image.width;
    final height = image.height;
    final yPlane = image.planes[0];
    final uPlane = image.planes[1];
    final vPlane = image.planes[2];

    final yBuffer = yPlane.bytes;
    final uBuffer = uPlane.bytes;
    final vBuffer = vPlane.bytes;

    final numPixels = (width * height * 1.5).toInt();
    final nv21 = Uint8List(numPixels);

    int idy = 0;
    for (int y = 0; y < height; y++) {
      final yOffset = y * yPlane.bytesPerRow;
      for (int x = 0; x < width; x++) {
        nv21[idy++] = yBuffer[yOffset + x];
      }
    }

    final uvHeight = height ~/ 2;
    final uvWidth = width ~/ 2;
    final uRowStride = uPlane.bytesPerRow;
    final vRowStride = vPlane.bytesPerRow;
    final uPixelStride = uPlane.bytesPerPixel ?? 2;
    final vPixelStride = vPlane.bytesPerPixel ?? 2;

    for (int y = 0; y < uvHeight; y++) {
      final uRowOffset = y * uRowStride;
      final vRowOffset = y * vRowStride;
      for (int x = 0; x < uvWidth; x++) {
        final vIndex = vRowOffset + x * vPixelStride;
        final uIndex = uRowOffset + x * uPixelStride;
        if (idy < numPixels) {
          nv21[idy++] = vIndex < vBuffer.length ? vBuffer[vIndex] : 0;
        }
        if (idy < numPixels) {
          nv21[idy++] = uIndex < uBuffer.length ? uBuffer[uIndex] : 0;
        }
      }
    }

    return nv21;
  }

<<<<<<< HEAD
  InputImage? _inputImageFromCameraImage(CameraImage image, CameraDescription camera) {
    try {
      final sensorOrientation = camera.sensorOrientation;
      final rotation = InputImageRotationValue.fromRawValue(sensorOrientation) ?? InputImageRotation.rotation270deg;

      if (image.planes.isEmpty) return null;

      final Uint8List bytes = Platform.isAndroid
          ? _yuv420ToNv21(image)
          : image.planes.first.bytes;

      final format = Platform.isAndroid
          ? InputImageFormat.nv21
          : (InputImageFormatValue.fromRawValue(image.format.raw) ?? InputImageFormat.nv21);
=======
  InputImage? _inputImageFromCameraImage(
    CameraImage image,
    CameraDescription camera,
  ) {
    try {
      final sensorOrientation = camera.sensorOrientation;
      final rotation =
          InputImageRotationValue.fromRawValue(sensorOrientation) ??
          InputImageRotation.rotation270deg;

      if (image.planes.isEmpty) return null;

      final Uint8List bytes =
          Platform.isAndroid ? _yuv420ToNv21(image) : image.planes.first.bytes;

      final format =
          Platform.isAndroid
              ? InputImageFormat.nv21
              : (InputImageFormatValue.fromRawValue(image.format.raw) ??
                  InputImageFormat.nv21);
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c

      return InputImage.fromBytes(
        bytes: bytes,
        metadata: InputImageMetadata(
          size: Size(image.width.toDouble(), image.height.toDouble()),
          rotation: rotation,
          format: format,
          bytesPerRow: image.planes.first.bytesPerRow,
        ),
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> _performFaceVerification({
    required String uid,
    required Face face,
    required int imageWidth,
    required int imageHeight,
    required List<double>? enrolledEmbedding,
  }) async {
    try {
      _controller?.stopImageStream();
    } catch (_) {}

<<<<<<< HEAD
    final liveEmbedding = FaceService.extractEmbeddingFromLandmarks(face, imageWidth, imageHeight);
=======
    final liveEmbedding = FaceService.extractEmbeddingFromLandmarks(
      face,
      imageWidth,
      imageHeight,
    );
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
    bool isFirstTimeEnrolment = false;

    if (enrolledEmbedding == null) {
      isFirstTimeEnrolment = true;
      if (mounted) {
        setState(() {
          _verifying = true;
          _statusText = 'Registering your face identity...';
        });
      }

      await FaceService.saveLocalTemplate(
        employeeId: uid,
        setupVersion: widget.serverSetupVersion,
        embedding: liveEmbedding,
      );
    } else {
      if (mounted) {
        setState(() {
          _verifying = true;
          _statusText = 'Verifying face identity...';
        });
      }

<<<<<<< HEAD
      final similarity = FaceService.calculateCosineSimilarity(liveEmbedding, enrolledEmbedding);
=======
      final similarity = FaceService.calculateCosineSimilarity(
        liveEmbedding,
        enrolledEmbedding,
      );
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
      if (similarity < FaceService.similarityThreshold) {
        if (mounted) {
          setState(() {
            _verifying = false;
            _isSuccess = false;
<<<<<<< HEAD
            _statusText = 'Face match failed. Identity does not match registered employee.';
          });
        }
        await Future.delayed(const Duration(seconds: 2));
        _finishWithResult(FaceAttendanceVerificationResult(
          success: false,
          errorMessage: 'Face match failed. Identity does not match registered employee.',
        ));
=======
            _statusText =
                'Face match failed. Identity does not match registered employee.';
          });
        }
        await Future.delayed(const Duration(seconds: 2));
        _finishWithResult(
          FaceAttendanceVerificationResult(
            success: false,
            errorMessage:
                'Face match failed. Identity does not match registered employee.',
          ),
        );
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
        return;
      }
    }

    try {
      final deviceInfo = DeviceInfoPlugin();
      String deviceId = 'device_id_unknown';
      if (Platform.isAndroid) {
        final info = await deviceInfo.androidInfo;
        deviceId = info.id;
      } else if (Platform.isIOS) {
        final info = await deviceInfo.iosInfo;
        deviceId = info.identifierForVendor ?? 'ios_device';
      }

<<<<<<< HEAD
      final challengeRes = await ApiClient.post('/biometrics/face/challenge', {
        'action': widget.action,
        'deviceId': deviceId,
      }) as Map<String, dynamic>;
=======
      final challengeRes =
          await ApiClient.post('/biometrics/face/challenge', {
                'action': widget.action,
                'deviceId': deviceId,
              })
              as Map<String, dynamic>;
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c

      final nonce = challengeRes['nonce'] as String;

      if (mounted) {
        setState(() {
          _verifying = false;
          _isSuccess = true;
<<<<<<< HEAD
          _statusText = isFirstTimeEnrolment
              ? 'Face Registered Successfully!'
              : 'Face Verification Successful!';
=======
          _statusText =
              isFirstTimeEnrolment
                  ? 'Face Registered Successfully!'
                  : 'Face Verification Successful!';
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
        });
      }

      await Future.delayed(const Duration(milliseconds: 700));

<<<<<<< HEAD
      _finishWithResult(FaceAttendanceVerificationResult(
        success: true,
        nonce: nonce,
        deviceId: deviceId,
      ));
=======
      _finishWithResult(
        FaceAttendanceVerificationResult(
          success: true,
          nonce: nonce,
          deviceId: deviceId,
        ),
      );
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
    } catch (e) {
      final errorMsg = e.toString().replaceAll('Exception:', '').trim();
      if (mounted) {
        setState(() {
          _verifying = false;
          _isSuccess = false;
<<<<<<< HEAD
          _statusText = 'Verification error: ${errorMsg.isNotEmpty ? errorMsg : "Try again."}';
        });
      }
      await Future.delayed(const Duration(seconds: 2));
      _finishWithResult(FaceAttendanceVerificationResult(
        success: false,
        errorMessage: 'Face verification failed: $errorMsg',
      ));
=======
          _statusText =
              'Verification error: ${errorMsg.isNotEmpty ? errorMsg : "Try again."}';
        });
      }
      await Future.delayed(const Duration(seconds: 2));
      _finishWithResult(
        FaceAttendanceVerificationResult(
          success: false,
          errorMessage: 'Face verification failed: $errorMsg',
        ),
      );
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
    }
  }

  void _finishWithResult(FaceAttendanceVerificationResult result) {
    try {
      _controller?.dispose();
    } catch (_) {}
    if (mounted) {
      Navigator.of(context).pop(result);
    }
  }

  @override
  void dispose() {
    try {
      _controller?.dispose();
    } catch (_) {}
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final titleAction = widget.action == 'check_in' ? 'Check-in' : 'Check-out';
    final isSuccess = _isSuccess == true;
    final isFailed = _isSuccess == false;

<<<<<<< HEAD
    final bannerBg = isSuccess
        ? const Color(0xFFE8F5E9)
        : (isFailed ? const Color(0xFFFFEBEE) : const Color(0xFFF9FAFB));

    final bannerBorder = isSuccess
        ? const Color(0xFF81C784)
        : (isFailed ? const Color(0xFFE57373) : const Color(0xFFEEEEEE));

    final bannerTextColor = isSuccess
        ? const Color(0xFF2E7D32)
        : (isFailed ? const Color(0xFFC62828) : AppColors.ink);

    final ovalBorderColor = isSuccess
        ? const Color(0xFF10B981)
        : (isFailed ? AppColors.brandRed : const Color(0xFF10B981));
=======
    final bannerBg =
        isSuccess
            ? const Color(0xFFE8F5E9)
            : (isFailed ? const Color(0xFFFFEBEE) : const Color(0xFFF9FAFB));

    final bannerBorder =
        isSuccess
            ? const Color(0xFF81C784)
            : (isFailed ? const Color(0xFFE57373) : const Color(0xFFEEEEEE));

    final bannerTextColor =
        isSuccess
            ? const Color(0xFF2E7D32)
            : (isFailed ? const Color(0xFFC62828) : AppColors.ink);

    final ovalBorderColor =
        isSuccess
            ? const Color(0xFF10B981)
            : (isFailed ? AppColors.brandRed : const Color(0xFF10B981));
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppColors.ink),
<<<<<<< HEAD
          onPressed: () => Navigator.of(context).pop(
            FaceAttendanceVerificationResult(success: false, errorMessage: 'User cancelled'),
          ),
=======
          onPressed:
              () => Navigator.of(context).pop(
                FaceAttendanceVerificationResult(
                  success: false,
                  errorMessage: 'User cancelled',
                ),
              ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
        ),
        title: const Text(
          'Verify Your Face',
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
              Text(
                'Look at the camera to verify your identity for $titleAction.',
                textAlign: TextAlign.center,
<<<<<<< HEAD
                style: const TextStyle(
                  color: AppColors.inkSoft,
                  fontSize: 14,
                ),
=======
                style: const TextStyle(color: AppColors.inkSoft, fontSize: 14),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
              ),
              const SizedBox(height: 16),

              // Camera Oval Guide
              Expanded(
                child: Center(
                  child: AspectRatio(
                    aspectRatio: 3 / 4,
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(160),
<<<<<<< HEAD
                        border: Border.all(
                          color: ovalBorderColor,
                          width: 4,
                        ),
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(156),
                        child: _initializing || _controller == null || !_controller!.value.isInitialized
                            ? const Center(child: CircularProgressIndicator(color: AppColors.brandRed))
                            : CameraPreview(_controller!),
=======
                        border: Border.all(color: ovalBorderColor, width: 4),
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(156),
                        child:
                            _initializing ||
                                    _controller == null ||
                                    !_controller!.value.isInitialized
                                ? const Center(
                                  child: CircularProgressIndicator(
                                    color: AppColors.brandRed,
                                  ),
                                )
                                : CameraPreview(_controller!),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                      ),
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 20),

              // Status Banner Box (Success / Error / Scanning)
              AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: bannerBg,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: bannerBorder),
                ),
                child: Row(
                  children: [
                    if (_verifying)
                      const SizedBox(
                        width: 20,
                        height: 20,
<<<<<<< HEAD
                        child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.brandRed),
                      )
                    else if (isSuccess)
                      const Icon(Icons.check_circle_rounded, color: Color(0xFF2E7D32), size: 22)
                    else if (isFailed)
                      const Icon(Icons.error_outline_rounded, color: Color(0xFFC62828), size: 22)
                    else
                      const Icon(Icons.info_outline_rounded, color: AppColors.brandRed, size: 20),
=======
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: AppColors.brandRed,
                        ),
                      )
                    else if (isSuccess)
                      const Icon(
                        Icons.check_circle_rounded,
                        color: Color(0xFF2E7D32),
                        size: 22,
                      )
                    else if (isFailed)
                      const Icon(
                        Icons.error_outline_rounded,
                        color: Color(0xFFC62828),
                        size: 22,
                      )
                    else
                      const Icon(
                        Icons.info_outline_rounded,
                        color: AppColors.brandRed,
                        size: 20,
                      ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _statusText,
                        style: TextStyle(
                          color: bannerTextColor,
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 16),

              // Cancel Button
              SizedBox(
                width: double.infinity,
                height: 52,
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
<<<<<<< HEAD
                    side: const BorderSide(color: AppColors.brandRed, width: 1.5),
=======
                    side: const BorderSide(
                      color: AppColors.brandRed,
                      width: 1.5,
                    ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
<<<<<<< HEAD
                  onPressed: () => Navigator.of(context).pop(
                    FaceAttendanceVerificationResult(success: false, errorMessage: 'Cancelled'),
                  ),
=======
                  onPressed:
                      () => Navigator.of(context).pop(
                        FaceAttendanceVerificationResult(
                          success: false,
                          errorMessage: 'Cancelled',
                        ),
                      ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                  child: const Text(
                    'Cancel',
                    style: TextStyle(
                      color: AppColors.brandRed,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }
}
