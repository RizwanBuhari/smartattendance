import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';

class FaceService {
  FaceService._();

  static final FaceDetector _faceDetector = FaceDetector(
    options: FaceDetectorOptions(
      performanceMode: FaceDetectorMode.accurate,
      enableLandmarks: true,
      enableContours: true,
      enableClassification: true,
      minFaceSize: 0.1,
    ),
  );

  static const FlutterSecureStorage _secureStorage = FlutterSecureStorage(
<<<<<<< HEAD
    aOptions: AndroidOptions(
      encryptedSharedPreferences: true,
    ),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock,
    ),
=======
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
  );

  // Rule #2: Configurable matching threshold, customizable for physical device calibration.
  // The embedding below is a dense (~230-d) normalized facial contour shape vector, not a
  // handful of coarse ratios, so genuine same-person matches cluster much closer to 1.0 than
  // they did before — this default is a starting point and MUST be validated with real
  // multi-employee device testing before relying on it in production.
  static double _similarityThreshold = 0.92;

  static double get similarityThreshold => _similarityThreshold;

  static void setSimilarityThreshold(double threshold) {
    _similarityThreshold = threshold.clamp(0.0, 1.0);
  }

  /// Detect faces in an image using ML Kit.
  static Future<List<Face>> detectFaces(InputImage inputImage) async {
    try {
      return await _faceDetector.processImage(inputImage);
    } catch (e) {
      debugPrint('Face detection error: $e');
      return [];
    }
  }

  // Contours sampled to build the shape signature, and how many evenly
  // arc-length-spaced points to resample each one down/up to. A fixed count
  // per type guarantees every embedding has identical length regardless of
  // how many raw points ML Kit returns for a given frame.
  static const List<FaceContourType> _contourTypes = [
    FaceContourType.face,
    FaceContourType.leftEyebrowTop,
    FaceContourType.leftEyebrowBottom,
    FaceContourType.rightEyebrowTop,
    FaceContourType.rightEyebrowBottom,
    FaceContourType.leftEye,
    FaceContourType.rightEye,
    FaceContourType.upperLipTop,
    FaceContourType.upperLipBottom,
    FaceContourType.lowerLipTop,
    FaceContourType.lowerLipBottom,
    FaceContourType.noseBridge,
    FaceContourType.noseBottom,
  ];

  static const List<int> _contourSampleCounts = [
    20, // face oval
    8, 8, // left eyebrow top/bottom
    8, 8, // right eyebrow top/bottom
    10, 10, // left/right eye
    10, 8, // upper lip top/bottom
    8, 8, // lower lip top/bottom
    4, 4, // nose bridge/bottom
  ];

  /// Resamples a polyline to exactly [targetCount] evenly arc-length-spaced points.
<<<<<<< HEAD
  static List<math.Point<double>> _resamplePolyline(List<math.Point<int>>? points, int targetCount) {
    if (points == null || points.length < 2) {
      return List<math.Point<double>>.filled(targetCount, const math.Point(0.0, 0.0));
    }

    final pts = points.map((p) => math.Point<double>(p.x.toDouble(), p.y.toDouble())).toList();
=======
  static List<math.Point<double>> _resamplePolyline(
    List<math.Point<int>>? points,
    int targetCount,
  ) {
    if (points == null || points.length < 2) {
      return List<math.Point<double>>.filled(
        targetCount,
        const math.Point(0.0, 0.0),
      );
    }

    final pts =
        points
            .map((p) => math.Point<double>(p.x.toDouble(), p.y.toDouble()))
            .toList();
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c

    final segmentLengths = <double>[];
    double totalLength = 0.0;
    for (int i = 0; i < pts.length - 1; i++) {
      final d = pts[i].distanceTo(pts[i + 1]);
      segmentLengths.add(d);
      totalLength += d;
    }

    if (totalLength <= 0.0) {
      return List<math.Point<double>>.filled(targetCount, pts.first);
    }

    final resampled = <math.Point<double>>[];
    for (int i = 0; i < targetCount; i++) {
      final targetDist = totalLength * i / (targetCount - 1);
      double accumulated = 0.0;
      math.Point<double> result = pts.last;
      for (int seg = 0; seg < segmentLengths.length; seg++) {
        final segLen = segmentLengths[seg];
<<<<<<< HEAD
        if (accumulated + segLen >= targetDist || seg == segmentLengths.length - 1) {
          final t = segLen > 0 ? ((targetDist - accumulated) / segLen).clamp(0.0, 1.0) : 0.0;
=======
        if (accumulated + segLen >= targetDist ||
            seg == segmentLengths.length - 1) {
          final t =
              segLen > 0
                  ? ((targetDist - accumulated) / segLen).clamp(0.0, 1.0)
                  : 0.0;
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
          final p0 = pts[seg];
          final p1 = pts[seg + 1];
          result = math.Point<double>(
            p0.x + (p1.x - p0.x) * t,
            p0.y + (p1.y - p0.y) * t,
          );
          break;
        }
        accumulated += segLen;
      }
      resampled.add(result);
    }

    return resampled;
  }

  /// Extracts a normalized facial contour shape-signature vector.
  ///
  /// Uses ML Kit's dense face contours (jawline, eyebrows, eyes, lips, nose —
  /// ~114 points) rather than the ~10 sparse landmark points, so the actual
  /// shape of each person's features is captured instead of a few coarse
  /// proportion ratios (which are too similar across different people to be
  /// a reliable identifier on their own). Every point is expressed relative
  /// to the eye line: origin at the eye midpoint, rotated so the eye line is
  /// horizontal, scaled by interpupillary distance — making the signature
  /// invariant to camera distance, in-plane head tilt, and image resolution.
<<<<<<< HEAD
  static List<double> extractEmbeddingFromLandmarks(Face face, int imageWidth, int imageHeight) {
=======
  static List<double> extractEmbeddingFromLandmarks(
    Face face,
    int imageWidth,
    int imageHeight,
  ) {
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
    final leftEye = face.landmarks[FaceLandmarkType.leftEye]?.position;
    final rightEye = face.landmarks[FaceLandmarkType.rightEye]?.position;

    double originX = 0.0, originY = 0.0, rollRad = 0.0, eyeDist = 1.0;
    if (leftEye != null && rightEye != null) {
      originX = (leftEye.x + rightEye.x) / 2.0;
      originY = (leftEye.y + rightEye.y) / 2.0;
      final dx = (rightEye.x - leftEye.x).toDouble();
      final dy = (rightEye.y - leftEye.y).toDouble();
      eyeDist = math.sqrt(dx * dx + dy * dy);
      rollRad = math.atan2(dy, dx);
    }
    if (eyeDist <= 1.0) eyeDist = 1.0;

    final cosR = math.cos(-rollRad);
    final sinR = math.sin(-rollRad);

    math.Point<double> normalize(math.Point<double> p) {
      final tx = p.x - originX;
      final ty = p.y - originY;
      final rx = tx * cosR - ty * sinR;
      final ry = tx * sinR + ty * cosR;
      return math.Point<double>(rx / eyeDist, ry / eyeDist);
    }

    final List<double> shape = [];
    for (int i = 0; i < _contourTypes.length; i++) {
      final contour = face.contours[_contourTypes[i]]?.points;
      final resampled = _resamplePolyline(contour, _contourSampleCounts[i]);
      for (final p in resampled) {
        final n = normalize(p);
        shape.add(n.x);
        shape.add(n.y);
      }
    }

    // Resting head-pose angles add a little extra discriminative signal
    // without affecting vector length across captures.
    shape.add((face.headEulerAngleX ?? 0.0) / 90.0);
    shape.add((face.headEulerAngleY ?? 0.0) / 90.0);

    // L2 normalization to unit length
    double norm = 0.0;
    for (final val in shape) {
      norm += val * val;
    }
    norm = math.sqrt(norm);

    if (norm > 0.0) {
      for (int i = 0; i < shape.length; i++) {
        shape[i] /= norm;
      }
    }

    return shape;
  }

  /// Calculates Cosine Similarity between two normalized shape vectors of equal length.
  /// Returns a score between -1.0 and 1.0 (higher = stronger match).
  static double calculateCosineSimilarity(List<double> v1, List<double> v2) {
    if (v1.length != v2.length || v1.isEmpty) return 0.0;

    double dotProduct = 0.0;
    double normA = 0.0;
    double normB = 0.0;

    for (int i = 0; i < v1.length; i++) {
      dotProduct += v1[i] * v2[i];
      normA += v1[i] * v1[i];
      normB += v2[i] * v2[i];
    }

    final denom = math.sqrt(normA) * math.sqrt(normB);
    if (denom == 0.0) return 0.0;

    return dotProduct / denom;
  }

  /// Saves enrolled template in hardware-encrypted secure storage (`flutter_secure_storage`).
  /// Rule #3: Never stored in SharedPreferences, Firestore, or plain text logs.
  static Future<void> saveLocalTemplate({
    required String employeeId,
    required int setupVersion,
    required List<double> embedding,
  }) async {
    final key = 'face_template_$employeeId';
    final payload = jsonEncode({
      'version': setupVersion,
      'embedding': embedding,
      'createdAt': DateTime.now().toIso8601String(),
    });

    await _secureStorage.write(key: key, value: payload);
  }

  /// Retrieves local template from hardware-backed encrypted storage.
<<<<<<< HEAD
  static Future<Map<String, dynamic>?> getLocalTemplate(String employeeId) async {
=======
  static Future<Map<String, dynamic>?> getLocalTemplate(
    String employeeId,
  ) async {
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
    final key = 'face_template_$employeeId';
    final data = await _secureStorage.read(key: key);
    if (data == null) return null;

    try {
      final map = jsonDecode(data) as Map<String, dynamic>;
      final version = map['version'] as int? ?? 1;
      final embeddingRaw = map['embedding'] as List<dynamic>? ?? [];
      final embedding = embeddingRaw.map((e) => (e as num).toDouble()).toList();

<<<<<<< HEAD
      return {
        'version': version,
        'embedding': embedding,
      };
=======
      return {'version': version, 'embedding': embedding};
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
    } catch (_) {
      return null;
    }
  }

  /// Deletes local template from hardware-backed secure storage upon Admin Reset (Rule #5).
  static Future<void> deleteLocalTemplate(String employeeId) async {
    final key = 'face_template_$employeeId';
    await _secureStorage.delete(key: key);
  }

  /// Checks whether a local face template is saved for this employee.
  static Future<bool> hasLocalTemplate(String employeeId) async {
    final template = await getLocalTemplate(employeeId);
    return template != null;
  }

  static void dispose() {
    _faceDetector.close();
  }
}
