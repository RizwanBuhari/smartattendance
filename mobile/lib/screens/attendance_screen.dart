import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../core/constants/api_constants.dart';
import '../core/services/device_id.dart';
import '../core/services/notifications.dart';
import '../core/services/native_geofence_service.dart';
import '../core/theme/app_colors.dart';
import '../core/theme/app_theme.dart';
import '../core/widgets/brand_logo.dart';
import 'auth/auth_gate.dart';

const _kMaxAcceptableAccuracyMeters = 50.0;

class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({super.key, this.onNavigateToTab});

  final ValueChanged<int>? onNavigateToTab;

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen>
    with SingleTickerProviderStateMixin {
  String _currentStatus = "Not checked in";
  String _timestampMessage = "No history recorded yet.";
  String _backendResponse = "";
  bool _isCheckedIn = false;
  bool _isBusy = false;
  String _loadingStateLabel = "";

  List<Map<String, dynamic>> _history = [];
  bool _loadingHistory = true;
  String? _photoBase64;

  // Track button scales
  bool _isCheckInPressed = false;
  bool _isCheckOutPressed = false;

  String? get _employeeId => FirebaseAuth.instance.currentUser?.uid;

  StreamSubscription<QuerySnapshot>? _employeeSubscription;
  final List<StreamSubscription<DocumentSnapshot>> _locationSubscriptions = [];
  List<Map<String, dynamic>> _assignedLocations = [];

  @override
  void initState() {
    super.initState();
    _loadHistory();
    _loadAvatar();
    _setupLocationsListener();
  }

  @override
  void dispose() {
    _employeeSubscription?.cancel();
    for (final sub in _locationSubscriptions) {
      sub.cancel();
    }
    super.dispose();
  }

  void _setupLocationsListener() {
    final uid = _employeeId;
    if (uid == null) return;

    _employeeSubscription?.cancel();
    _employeeSubscription = FirebaseFirestore.instance
        .collection('employees_ids')
        .where('authUid', isEqualTo: uid)
        .limit(1)
        .snapshots()
        .listen((empSnap) {
          if (empSnap.docs.isEmpty) return;
          final data = empSnap.docs.first.data();
          final assigned = data['assignedLocationIds'] as List<dynamic>? ?? [];
          _listenToLocationDetails(assigned.map((e) => e.toString()).toList());
        });
  }

  void _listenToLocationDetails(List<String> assignedIds) {
    for (final sub in _locationSubscriptions) {
      sub.cancel();
    }
    _locationSubscriptions.clear();

    if (assignedIds.isEmpty) {
      if (mounted) {
        setState(() {
          _assignedLocations = [];
        });
      }
      return;
    }

    final List<Map<String, dynamic>> tempLocations = [];

    for (final locId in assignedIds) {
      final sub = FirebaseFirestore.instance
          .collection('locations_ids')
          .doc(locId)
          .snapshots()
          .listen((locSnap) {
            if (locSnap.exists) {
              final locData = locSnap.data()!;
              final locationInfo = {
                'id': locSnap.id,
                'name': locData['name'] ?? 'Approved Office',
                'latitude': locData['latitude'],
                'longitude': locData['longitude'],
                'radiusMeters': locData['radiusMeters'] ?? 100.0,
                'workingHours': locData['workingHours'] ?? '09:00 - 18:00',
              };

              final idx = tempLocations.indexWhere(
                (l) => l['id'] == locSnap.id,
              );
              if (idx != -1) {
                tempLocations[idx] = locationInfo;
              } else {
                tempLocations.add(locationInfo);
              }

              if (mounted) {
                setState(() {
                  _assignedLocations = List.from(tempLocations);
                });
              }
            }
          });
      _locationSubscriptions.add(sub);
    }
  }

  @override
  void didUpdateWidget(covariant AttendanceScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    _loadAvatar();
    _loadHistory();
  }

  Future<void> _loadAvatar() async {
    final id = _employeeId;
    if (id == null) return;
    try {
      final snapshot =
          await FirebaseFirestore.instance
              .collection('employees_ids')
              .where('authUid', isEqualTo: id)
              .limit(1)
              .get();
      if (snapshot.docs.isNotEmpty && mounted) {
        setState(
          () =>
              _photoBase64 =
                  snapshot.docs.first.data()['photoBase64'] as String?,
        );
      }
    } catch (e) {
      debugPrint('Avatar load failed: $e');
    }
  }

  void _showSnackBar(String message, {bool isSuccess = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(
              isSuccess
                  ? Icons.check_circle_outline_rounded
                  : Icons.error_outline_rounded,
              color: AppColors.white,
            ),
            const SizedBox(width: 12),
            Expanded(child: Text(message)),
          ],
        ),
        backgroundColor: isSuccess ? AppColors.okText : AppColors.alertText,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        margin: const EdgeInsets.all(16),
      ),
    );
  }

  Future<void> _loadHistory() async {
    final id = _employeeId;
    if (id == null) return;

    setState(() => _loadingHistory = true);
    try {
      final uri = Uri.parse(
        '${ApiConstants.baseUrl}/attendance?employeeId=$id',
      );
      final res = await http.get(uri);
      final list = (jsonDecode(res.body) as List).cast<Map<String, dynamic>>();
      final open = list.where((r) => r['status'] == 'checked_in');

      setState(() {
        _history = list;
        _isCheckedIn = open.isNotEmpty;
        _currentStatus =
            _isCheckedIn
                ? 'Checked in'
                : (list.isEmpty ? 'Not checked in' : 'Checked out');
        if (list.isNotEmpty) {
          final latest = list.first;
          final isOpen = latest['status'] == 'checked_in';
          final utc =
              (isOpen ? latest['checkInUtc'] : latest['checkOutUtc'])
                  as String?;
          if (utc != null) {
            final local = DateTime.parse(utc).toLocal();
            _timestampMessage =
                'Last action: ${isOpen ? 'check-in' : 'check-out'} at ${_formattedTime(local)}';
          }
        }
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loadingHistory = false);
    }
  }

  Future<Position?> _acquireLocation() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      _showSnackBar('Turn on location services to check in/out.');
      return null;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      _showSnackBar('Location permission is required to check in/out.');
      return null;
    }

    setState(() => _loadingStateLabel = "Checking accuracy…");
    var position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    );

    // Verify freshness (must be under 2 minutes old)
    var age = DateTime.now().difference(position.timestamp);
    if (age.inMinutes > 2) {
      _showSnackBar('Location reading was stale. Requesting fresh fix...');
      position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
    }

    if (position.accuracy > _kMaxAcceptableAccuracyMeters) {
      _showSnackBar(
        'GPS accuracy too low (±${position.accuracy.round()}m). Move to an open area and try again.',
      );
      return null;
    }

    return position;
  }

  String _formattedTime(DateTime time) {
    String two(int n) => n.toString().padLeft(2, '0');
    final hour =
        time.hour > 12 ? time.hour - 12 : (time.hour == 0 ? 12 : time.hour);
    final ampm = time.hour >= 12 ? 'PM' : 'AM';
    return '${two(hour)}:${two(time.minute)} $ampm';
  }

  Future<void> _handleCheckIn() => _performAction('check-in');
  Future<void> _handleCheckOut() => _performAction('check-out');

  Future<void> _performAction(String action) async {
    if (_isBusy) return;

    setState(() {
      _isBusy = true;
      _loadingStateLabel = "Getting location…";
      _backendResponse = "";
    });

    try {
      final employeeId = _employeeId;
      if (employeeId == null) {
        _showSnackBar('Not signed in — please log in again.');
        return;
      }

      final position = await _acquireLocation();
      if (position == null) {
        setState(() {
          _isBusy = false;
          _loadingStateLabel = "";
        });
        return;
      }

      setState(() => _loadingStateLabel = "Verifying work area…");
      final deviceId = await DeviceId.get();

      final prefs = await SharedPreferences.getInstance();
      final isInsideGeofence = prefs.getBool('geofence.isInside') ?? false;
      final dwellConfirmedAt = prefs.getString('geofence.dwellConfirmedAt');
      final isDwellConfirmed = (dwellConfirmedAt != null);
      final activeLocationId = prefs.getString('geofence.activeLocationId');

      final primaryLocation =
          _assignedLocations.isNotEmpty ? _assignedLocations.first : null;
      final locationName =
          primaryLocation != null
              ? primaryLocation['name'] as String? ?? 'Approved Office'
              : 'Approved Office';

      final uri = Uri.parse('${ApiConstants.baseUrl}/attendance/$action');
      final response = await http.post(
        uri,
        headers: {"Content-Type": "application/json"},
        body: jsonEncode({
          "employeeId": employeeId,
          "deviceId": deviceId,
          "latitude": position.latitude,
          "longitude": position.longitude,
          "gpsAccuracy": position.accuracy,
          "timestamp": DateTime.now().toUtc().toIso8601String(),
          "isInsideGeofence": isInsideGeofence,
          "isDwellConfirmed": isDwellConfirmed,
          "locationId":
              activeLocationId ??
              (primaryLocation != null ? primaryLocation['id'] : null),
        }),
      );

      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final accepted = body['accepted'] == true;
      final message =
          body['message'] as String? ?? (accepted ? 'Success.' : 'Rejected.');

      setState(() {
        _backendResponse = message;
        if (accepted) {
          _isCheckedIn = action == 'check-in';
          _currentStatus = _isCheckedIn ? 'Checked in' : 'Checked out';
          _timestampMessage =
              'Last action: $action at ${_formattedTime(DateTime.now())}';
          final isUnderReview =
              action == 'check-out' && body['checkoutFlagged'] == true;
          _showSnackBar(
            _isCheckedIn
                ? 'Checked in successfully.'
                : (isUnderReview
                    ? 'Checkout under review.'
                    : 'Checked out successfully.'),
            isSuccess: true,
          );

          if (_isCheckedIn) {
            Notifications.showCheckinSuccess(locationName);
          } else if (isUnderReview) {
            Notifications.showCheckoutUnderReview(
              body['distanceMeters'] as int?,
            );
          } else {
            Notifications.showCheckoutSuccess();
          }
        } else {
          _showSnackBar(message);
          Notifications.showActionRejected(
            action == 'check-in' ? 'Check-in Rejected' : 'Checkout Rejected',
            message,
          );
        }
      });

      if (accepted) {
        await _loadHistory();
      }
    } catch (e) {
      setState(
        () => _backendResponse = 'Connection failed. Is the server reachable?',
      );
    } finally {
      if (mounted) {
        setState(() {
          _isBusy = false;
          _loadingStateLabel = "";
        });
      }
    }
  }

  void _confirmLogout() {
    showDialog(
      context: context,
      builder:
          (context) => AlertDialog(
            title: const Text('Sign out?'),
            content: const Text(
              'You will need to sign in again to access Check-N.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text(
                  'Cancel',
                  style: TextStyle(color: AppColors.inkSoft),
                ),
              ),
              TextButton(
                onPressed: () async {
                  Navigator.pop(context);
                  final navigator = Navigator.of(context);
                  await NativeGeofenceService.removeAllGeofences();
                  await FirebaseAuth.instance.signOut();
                  navigator.pushAndRemoveUntil(
                    MaterialPageRoute(builder: (_) => const AuthGate()),
                    (route) => false,
                  );
                },
                child: const Text(
                  'Sign out',
                  style: TextStyle(
                    color: AppColors.brandRed,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final statusFg = _isCheckedIn ? AppColors.okText : AppColors.brandRed;
    final statusBg = _isCheckedIn ? AppColors.okBg : AppColors.brandRedSoft;

    final primaryLocation =
        _assignedLocations.isNotEmpty ? _assignedLocations.first : null;
    final locationName =
        primaryLocation != null
            ? primaryLocation['name'] as String
            : 'No Location Assigned';
    final locationRadius =
        primaryLocation != null
            ? '${(primaryLocation['radiusMeters'] as num).round()} meters'
            : 'N/A';
    final locationHours =
        primaryLocation != null
            ? primaryLocation['workingHours'] as String
            : 'N/A';

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        toolbarHeight: 80,
        backgroundColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        leadingWidth: 70,
        leading: Padding(
          padding: const EdgeInsets.only(left: 16, top: 12, bottom: 12),
          child: GestureDetector(
            onTap: () => widget.onNavigateToTab?.call(3),
            child: CircleAvatar(
              radius: 24,
              backgroundColor: AppColors.line,
              backgroundImage:
                  _photoBase64 != null
                      ? MemoryImage(base64Decode(_photoBase64!))
                      : null,
              child:
                  _photoBase64 == null
                      ? const Icon(
                        Icons.person_outline_rounded,
                        color: AppColors.inkSoft,
                      )
                      : null,
            ),
          ),
        ),
        title: const BrandLogo(width: 100),
        actions: [
          IconButton(
            tooltip: 'Log out',
            icon: const Icon(
              Icons.logout_rounded,
              size: 24,
              color: AppColors.ink,
            ),
            onPressed: _confirmLogout,
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => Future.wait([_loadHistory(), _loadAvatar()]),
        child:
            _loadingHistory
                ? _buildSkeleton()
                : ListView(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 24,
                    vertical: 8,
                  ),
                  children: [
                    // Current Status Card
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: cardDecoration(radius: 24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 48,
                                height: 48,
                                decoration: BoxDecoration(
                                  color: statusBg,
                                  shape: BoxShape.circle,
                                ),
                                child: Icon(
                                  _isCheckedIn
                                      ? Icons.check_circle_outline_rounded
                                      : Icons.login_rounded,
                                  color: statusFg,
                                  size: 24,
                                ),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text(
                                      "Current status",
                                      style: TextStyle(
                                        fontSize: 13,
                                        color: AppColors.inkSoft,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      _currentStatus,
                                      style: TextStyle(
                                        fontSize: 22,
                                        fontWeight: FontWeight.w700,
                                        color: statusFg,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          const Divider(color: AppColors.line),
                          const SizedBox(height: 8),
                          Text(
                            _isCheckedIn
                                ? "You are checked in. Keep the app running in the background for shift compliance."
                                : (_timestampMessage !=
                                        "No history recorded yet."
                                    ? _timestampMessage
                                    : "You haven't checked in yet. Tap 'Check in' when you arrive at your workplace."),
                            style: const TextStyle(
                              fontSize: 13,
                              color: AppColors.inkSoft,
                              height: 1.4,
                            ),
                          ),
                        ],
                      ),
                    ),

                    // Outside Geofence Warning Card
                    if (_backendResponse.isNotEmpty &&
                        _backendResponse.toLowerCase().contains("outside")) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: AppColors.alertBg,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: AppColors.alertText.withValues(alpha: 0.2),
                          ),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: const BoxDecoration(
                                color: AppColors.white,
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(
                                Icons.warning_amber_rounded,
                                color: AppColors.alertText,
                                size: 20,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    "You are outside your approved work area",
                                    style: TextStyle(
                                      color: AppColors.alertText,
                                      fontWeight: FontWeight.w700,
                                      fontSize: 14,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    _backendResponse,
                                    style: const TextStyle(
                                      color: AppColors.alertText,
                                      fontSize: 13,
                                      height: 1.4,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    // Inline response message (general info or checking accuracy status)
                    if (_isBusy && _loadingStateLabel.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 12,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.neutralBg,
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Row(
                          children: [
                            const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: AppColors.inkSoft,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Text(
                              _loadingStateLabel,
                              style: const TextStyle(
                                fontSize: 13,
                                color: AppColors.inkSoft,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    const SizedBox(height: 16),

                    // Approved Location Info Panel
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: cardDecoration(radius: 24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 44,
                                height: 44,
                                decoration: const BoxDecoration(
                                  color: AppColors.brandRedSoft,
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(
                                  Icons.location_on_outlined,
                                  color: AppColors.brandRed,
                                  size: 22,
                                ),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text(
                                      "Approved location",
                                      style: TextStyle(
                                        fontSize: 12,
                                        color: AppColors.inkSoft,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      locationName,
                                      style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w700,
                                        color: AppColors.ink,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          const Divider(color: AppColors.line),
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 24,
                            runSpacing: 12,
                            children: [
                              Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(
                                    Icons.radio_button_checked_rounded,
                                    color: AppColors.brandRed,
                                    size: 16,
                                  ),
                                  const SizedBox(width: 8),
                                  Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      const Text(
                                        "Geofence radius",
                                        style: TextStyle(
                                          fontSize: 11,
                                          color: AppColors.inkSoft,
                                        ),
                                      ),
                                      Text(
                                        locationRadius,
                                        style: const TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                          color: AppColors.ink,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                              Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(
                                    Icons.access_time_rounded,
                                    color: AppColors.brandRed,
                                    size: 16,
                                  ),
                                  const SizedBox(width: 8),
                                  Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      const Text(
                                        "Working hours",
                                        style: TextStyle(
                                          fontSize: 11,
                                          color: AppColors.inkSoft,
                                        ),
                                      ),
                                      Text(
                                        locationHours,
                                        style: const TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                          color: AppColors.ink,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 24),

                    // Check In Button
                    GestureDetector(
                      onTapDown:
                          (_) => setState(() => _isCheckInPressed = true),
                      onTapUp: (_) => setState(() => _isCheckInPressed = false),
                      onTapCancel:
                          () => setState(() => _isCheckInPressed = false),
                      onTap: (_isBusy || _isCheckedIn) ? null : _handleCheckIn,
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 100),
                        transform:
                            Matrix4.identity()..scaleByDouble(
                              _isCheckInPressed ? 0.98 : 1.0,
                              _isCheckInPressed ? 0.98 : 1.0,
                              1.0,
                              1.0,
                            ),
                        height: 64,
                        decoration: BoxDecoration(
                          color:
                              _isCheckedIn
                                  ? AppColors.muted.withValues(alpha: 0.3)
                                  : (_isCheckInPressed
                                      ? AppColors.brandRedHover
                                      : AppColors.brandRed),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Row(
                          children: [
                            const Icon(
                              Icons.login_rounded,
                              color: AppColors.white,
                              size: 24,
                            ),
                            const SizedBox(width: 12),
                            Container(
                              width: 1,
                              height: 28,
                              color: AppColors.white.withValues(alpha: 0.3),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    "Check in",
                                    style: TextStyle(
                                      color: AppColors.white,
                                      fontSize: 16,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  Text(
                                    "Record your arrival",
                                    style: TextStyle(
                                      color: AppColors.white.withValues(
                                        alpha: 0.8,
                                      ),
                                      fontSize: 11,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Container(
                              width: 28,
                              height: 28,
                              decoration: BoxDecoration(
                                color: AppColors.white.withValues(alpha: 0.2),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(
                                Icons.chevron_right_rounded,
                                color: AppColors.white,
                                size: 18,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 16),

                    // Check Out Button
                    GestureDetector(
                      onTapDown:
                          (_) => setState(() => _isCheckOutPressed = true),
                      onTapUp:
                          (_) => setState(() => _isCheckOutPressed = false),
                      onTapCancel:
                          () => setState(() => _isCheckOutPressed = false),
                      onTap:
                          (_isBusy || !_isCheckedIn) ? null : _handleCheckOut,
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 100),
                        transform:
                            Matrix4.identity()..scaleByDouble(
                              _isCheckOutPressed ? 0.98 : 1.0,
                              _isCheckOutPressed ? 0.98 : 1.0,
                              1.0,
                              1.0,
                            ),
                        height: 64,
                        decoration: BoxDecoration(
                          color: AppColors.white,
                          border: Border.all(
                            color:
                                !_isCheckedIn
                                    ? AppColors.line
                                    : AppColors.brandRed,
                            width: 1.4,
                          ),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Row(
                          children: [
                            Icon(
                              Icons.logout_rounded,
                              color:
                                  !_isCheckedIn
                                      ? AppColors.muted
                                      : AppColors.brandRed,
                              size: 24,
                            ),
                            const SizedBox(width: 12),
                            Container(
                              width: 1,
                              height: 28,
                              color:
                                  !_isCheckedIn
                                      ? AppColors.line
                                      : AppColors.brandRed.withValues(
                                        alpha: 0.2,
                                      ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    "Check out",
                                    style: TextStyle(
                                      color:
                                          !_isCheckedIn
                                              ? AppColors.muted
                                              : AppColors.brandRed,
                                      fontSize: 16,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  Text(
                                    "Record your departure",
                                    style: TextStyle(
                                      color: (!_isCheckedIn
                                              ? AppColors.muted
                                              : AppColors.inkSoft)
                                          .withValues(alpha: 0.8),
                                      fontSize: 11,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Icon(
                              Icons.chevron_right_rounded,
                              color:
                                  !_isCheckedIn
                                      ? AppColors.muted
                                      : AppColors.brandRed,
                              size: 18,
                            ),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 32),

                    // Recent Activity
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Recent activity',
                          style: Theme.of(
                            context,
                          ).textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.w700,
                            fontSize: 18,
                          ),
                        ),
                        GestureDetector(
                          onTap: () => widget.onNavigateToTab?.call(1),
                          child: const Text(
                            'View all',
                            style: TextStyle(
                              color: AppColors.brandRed,
                              fontWeight: FontWeight.w600,
                              fontSize: 14,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    _buildHistory(),
                    const SizedBox(height: 100),
                  ],
                ),
      ),
    );
  }

  Widget _buildSkeleton() {
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
      children: [
        _skeletonTile(height: 130),
        const SizedBox(height: 16),
        _skeletonTile(height: 130),
        const SizedBox(height: 24),
        _skeletonTile(height: 64),
        const SizedBox(height: 16),
        _skeletonTile(height: 64),
        const SizedBox(height: 32),
        _skeletonTile(height: 24, widthFactor: 0.4),
        const SizedBox(height: 12),
        _skeletonTile(height: 80),
        const SizedBox(height: 10),
        _skeletonTile(height: 80),
      ],
    );
  }

  Widget _skeletonTile({required double height, double widthFactor = 1.0}) {
    return FractionallySizedBox(
      widthFactor: widthFactor,
      child: AnimatedContainer(
        duration: const Duration(seconds: 1),
        height: height,
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.line.withValues(alpha: 0.5)),
        ),
      ),
    );
  }

  Widget _buildHistory() {
    if (_history.isEmpty) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 40),
        decoration: panelDecoration(radius: 20),
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: const BoxDecoration(
                color: AppColors.brandRedSoft,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.calendar_month_outlined,
                color: AppColors.brandRed,
                size: 24,
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'No attendance recorded yet.',
              style: TextStyle(
                color: AppColors.ink,
                fontWeight: FontWeight.w600,
                fontSize: 15,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 4),
            const Text(
              'Your check-in and check-out history will appear here.',
              style: TextStyle(color: AppColors.inkSoft, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    final activities = <_Activity>[];
    for (final record in _history) {
      final locationName = record['locationName'] as String? ?? '—';
      final checkInUtc = record['checkInUtc'] as String?;
      final checkOutUtc = record['checkOutUtc'] as String?;
      if (checkInUtc != null) {
        activities.add(
          _Activity(
            locationName: locationName,
            time: DateTime.parse(checkInUtc),
            isCheckIn: true,
          ),
        );
      }
      if (checkOutUtc != null) {
        activities.add(
          _Activity(
            locationName: locationName,
            time: DateTime.parse(checkOutUtc),
            isCheckIn: false,
          ),
        );
      }
    }
    activities.sort((a, b) => b.time.compareTo(a.time));

    return Column(
      children: [
        for (final activity in activities.take(5)) ...[
          _HistoryRow(activity: activity),
          const SizedBox(height: 10),
        ],
      ],
    );
  }

  BoxDecoration cardDecoration({double radius = 16}) {
    return BoxDecoration(
      color: AppColors.panel,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: AppColors.line.withValues(alpha: 0.5)),
      boxShadow: const [
        BoxShadow(
          color: Color(0x12000000),
          blurRadius: 24,
          offset: Offset(0, 6),
        ),
      ],
    );
  }
}

class _Activity {
  const _Activity({
    required this.locationName,
    required this.time,
    required this.isCheckIn,
  });

  final String locationName;
  final DateTime time;
  final bool isCheckIn;
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.activity});

  final _Activity activity;

  @override
  Widget build(BuildContext context) {
    final isCheckIn = activity.isCheckIn;
    final local = activity.time.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    final hour =
        local.hour > 12 ? local.hour - 12 : (local.hour == 0 ? 12 : local.hour);
    final ampm = local.hour >= 12 ? 'PM' : 'AM';
    final timeStr = '${two(hour)}:${two(local.minute)} $ampm';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: panelDecoration(radius: 16),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: isCheckIn ? AppColors.okBg : AppColors.neutralBg,
              shape: BoxShape.circle,
            ),
            child: Icon(
              isCheckIn ? Icons.login_rounded : Icons.logout_rounded,
              size: 18,
              color: isCheckIn ? AppColors.okText : AppColors.neutralText,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  activity.locationName,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  timeStr,
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.inkSoft,
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: isCheckIn ? AppColors.okBg : AppColors.neutralBg,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              isCheckIn ? 'Checked in' : 'Checked out',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: isCheckIn ? AppColors.okText : AppColors.neutralText,
              ),
            ),
          ),
        ],
      ),
    );
  }

  BoxDecoration panelDecoration({double radius = 16}) {
    return BoxDecoration(
      color: AppColors.panel,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: AppColors.line.withValues(alpha: 0.4)),
      boxShadow: const [
        BoxShadow(
          color: Color(0x08000000),
          blurRadius: 16,
          offset: Offset(0, 4),
        ),
      ],
    );
  }
}
