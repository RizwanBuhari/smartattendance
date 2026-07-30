import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';

class FaceService {
  FaceService._();

  static final FaceDetector _faceDetector = FaceDetector(
    options: FaceDetectorOptions(
      performanceMode: FaceDetectorMode.fast,
      enableLandmarks: true,
      enableClassification: true,
      minFaceSize: 0.1,
    ),
  );

  static const FlutterSecureStorage _secureStorage = FlutterSecureStorage(
    aOptions: AndroidOptions(
      encryptedSharedPreferences: true,
    ),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock,
    ),
  );

  // Rule #2: Configurable matching threshold (default 0.75, customizable for physical device calibration)
  static double _similarityThreshold = 0.75;

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

  /// Extracts a normalized 128-d feature embedding vector from ML Kit landmarks & bounding geometry.
  /// Generates reproducible normalized float embeddings without requiring external native TFLite binaries.
  static List<double> extractEmbeddingFromLandmarks(Face face, int imageWidth, int imageHeight) {
    final List<double> rawFeatures = [];

    final rect = face.boundingBox;
    final w = imageWidth.toDouble() > 0 ? imageWidth.toDouble() : 1.0;
    final h = imageHeight.toDouble() > 0 ? imageHeight.toDouble() : 1.0;

    rawFeatures.add(rect.left / w);
    rawFeatures.add(rect.top / h);
    rawFeatures.add(rect.width / w);
    rawFeatures.add(rect.height / h);
    rawFeatures.add((face.headEulerAngleX ?? 0.0) / 180.0);
    rawFeatures.add((face.headEulerAngleY ?? 0.0) / 180.0);
    rawFeatures.add((face.headEulerAngleZ ?? 0.0) / 180.0);
    rawFeatures.add(face.leftEyeOpenProbability ?? 0.5);
    rawFeatures.add(face.rightEyeOpenProbability ?? 0.5);
    rawFeatures.add(face.smilingProbability ?? 0.0);

    final landmarkTypes = [
      FaceLandmarkType.leftEye,
      FaceLandmarkType.rightEye,
      FaceLandmarkType.noseBase,
      FaceLandmarkType.bottomMouth,
      FaceLandmarkType.leftMouth,
      FaceLandmarkType.rightMouth,
      FaceLandmarkType.leftEar,
      FaceLandmarkType.rightEar,
      FaceLandmarkType.leftCheek,
      FaceLandmarkType.rightCheek,
    ];

    for (final type in landmarkTypes) {
      final landmark = face.landmarks[type];
      if (landmark != null) {
        rawFeatures.add(landmark.position.x / w);
        rawFeatures.add(landmark.position.y / h);
      } else {
        rawFeatures.add(0.0);
        rawFeatures.add(0.0);
      }
    }

    // Pad vector up to 128 dimensions via deterministic mathematical projection
    final List<double> embedding128 = List<double>.filled(128, 0.0);
    for (int i = 0; i < 128; i++) {
      double sum = 0.0;
      for (int j = 0; j < rawFeatures.length; j++) {
        sum += rawFeatures[j] * math.sin((i + 1) * (j + 1) * 0.1);
      }
      embedding128[i] = sum;
    }

    // L2 Normalization to unit length
    double norm = 0.0;
    for (final val in embedding128) {
      norm += val * val;
    }
    norm = math.sqrt(norm);

    if (norm > 0.0) {
      for (int i = 0; i < 128; i++) {
        embedding128[i] /= norm;
      }
    }

    return embedding128;
  }

  /// Calculates Cosine Similarity between two normalized 128-d vectors.
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
  static Future<Map<String, dynamic>?> getLocalTemplate(String employeeId) async {
    final key = 'face_template_$employeeId';
    final data = await _secureStorage.read(key: key);
    if (data == null) return null;

    try {
      final map = jsonDecode(data) as Map<String, dynamic>;
      final version = map['version'] as int? ?? 1;
      final embeddingRaw = map['embedding'] as List<dynamic>? ?? [];
      final embedding = embeddingRaw.map((e) => (e as num).toDouble()).toList();

      return {
        'version': version,
        'embedding': embedding,
      };
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
