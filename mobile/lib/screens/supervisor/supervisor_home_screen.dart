import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/services/api_client.dart';
import '../../core/services/device_id.dart';
import '../../core/services/notifications.dart';
import '../../core/services/offsite_request_service.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/app_header.dart';
import '../../core/widgets/approved_location_card.dart';
import '../../core/widgets/recent_activity_section.dart';
import '../auth/auth_gate.dart';
import '../scan_code_screen.dart';

class SupervisorHomeScreen extends StatefulWidget {
  const SupervisorHomeScreen({
    super.key,
    required this.onNavigateToTab,
  });

  final ValueChanged<int> onNavigateToTab;

  @override
  State<SupervisorHomeScreen> createState() => _SupervisorHomeScreenState();
}

class _SupervisorHomeScreenState extends State<SupervisorHomeScreen> {
  String? get _employeeId => FirebaseAuth.instance.currentUser?.uid;

  String _currentStatus = "Not checked in";
  bool _isCheckedIn = false;
  bool _isBusy = false;
  String? _photoBase64;
  final int _unreadNotificationsCount = 0;
  int _pendingApprovalsCount = 0;

  List<Map<String, dynamic>> _history = [];
  bool _loadingHistory = true;

  StreamSubscription<QuerySnapshot>? _employeeSub;
  StreamSubscription<QuerySnapshot>? _requestsSub;
  final List<StreamSubscription<DocumentSnapshot>> _locationSubscriptions = [];
  List<Map<String, dynamic>> _assignedLocations = [];

  @override
  void initState() {
    super.initState();
    _loadHistory();
    _loadAvatar();
    _setupListeners();
  }

  @override
  void dispose() {
    _employeeSub?.cancel();
    _requestsSub?.cancel();
    for (final sub in _locationSubscriptions) {
      sub.cancel();
    }
    super.dispose();
  }

  Future<void> _loadAvatar() async {
    final id = _employeeId;
    if (id == null) return;
    try {
      final snapshot = await FirebaseFirestore.instance
          .collection('employees_ids')
          .where('authUid', isEqualTo: id)
          .limit(1)
          .get();
      if (snapshot.docs.isNotEmpty && mounted) {
        setState(() {
          _photoBase64 = snapshot.docs.first.data()['photoBase64'] as String?;
        });
      }
    } catch (_) {}
  }

  void _setupListeners() {
    final uid = _employeeId;
    if (uid == null) return;

    _employeeSub?.cancel();
    _employeeSub = FirebaseFirestore.instance
        .collection('employees_ids')
        .where('authUid', isEqualTo: uid)
        .limit(1)
        .snapshots()
        .listen((empSnap) {
      if (empSnap.docs.isEmpty) return;
      final doc = empSnap.docs.first;
      final data = doc.data();
      final assigned = data['assignedLocationIds'] as List<dynamic>? ?? [];
      _listenToLocationDetails(assigned.map((e) => e.toString()).toList());
      _listenToPendingApprovals(doc.id);
    });
  }

  void _listenToPendingApprovals(String supervisorId) {
    _requestsSub?.cancel();
    _requestsSub = OffsiteRequestService.getSupervisorRequestsStream(supervisorId).listen((snap) {
      int pending = 0;
      for (final doc in snap.docs) {
        final data = doc.data() as Map<String, dynamic>;
        if (data['status'] == 'pending_approval') {
          pending++;
        }
      }
      if (mounted) {
        setState(() {
          _pendingApprovalsCount = pending;
        });
      }
    });
  }

  void _listenToLocationDetails(List<String> assignedIds) {
    for (final sub in _locationSubscriptions) {
      sub.cancel();
    }
    _locationSubscriptions.clear();

    if (assignedIds.isEmpty) {
      if (mounted) setState(() => _assignedLocations = []);
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
            'name': locData['name'] ?? 'Dubai Head Office',
            'latitude': locData['latitude'],
            'longitude': locData['longitude'],
            'radiusMeters': locData['radiusMeters'] ?? 100.0,
            'workingHours': locData['workingHours'] ?? '9:00 AM – 6:00 PM',
          };

          final idx = tempLocations.indexWhere((l) => l['id'] == locSnap.id);
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

  Future<void> _loadHistory() async {
    final id = _employeeId;
    if (id == null) return;

    setState(() => _loadingHistory = true);
    try {
      final list = (await ApiClient.get('/attendance/me') as List).cast<Map<String, dynamic>>();
      final open = list.where((r) => r['status'] == 'checked_in');

      if (mounted) {
        setState(() {
          _history = list;
          _isCheckedIn = open.isNotEmpty;
          _currentStatus = _isCheckedIn ? 'Checked in' : 'Not checked in';
        });
      }
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
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      _showSnackBar('Location permission is required to check in/out.');
      return null;
    }

    var position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    );

    if (position.accuracy > 50.0) {
      _showSnackBar('GPS accuracy too low (±${position.accuracy.round()}m). Move to an open area.');
      return null;
    }

    return position;
  }

  Future<void> _performAction(String action) async {
    if (_isBusy) return;

    setState(() => _isBusy = true);

    try {
      final position = await _acquireLocation();
      if (position == null) return;

      final deviceId = await DeviceId.get();
      final prefs = await SharedPreferences.getInstance();
      final isInsideGeofence = prefs.getBool('geofence.isInside') ?? false;
      final dwellConfirmedAt = prefs.getString('geofence.dwellConfirmedAt');
      final isDwellConfirmed = (dwellConfirmedAt != null);
      final activeLocationId = prefs.getString('geofence.activeLocationId');

      final primaryLocation = _assignedLocations.isNotEmpty ? _assignedLocations.first : null;
      final locationName = primaryLocation != null ? primaryLocation['name'] as String? ?? 'Dubai Head Office' : 'Dubai Head Office';

      Future<Map<String, dynamic>> send({String? code}) async =>
          await ApiClient.post('/attendance/$action', {
            "deviceId": deviceId,
            "latitude": position.latitude,
            "longitude": position.longitude,
            "gpsAccuracy": position.accuracy,
            "timestamp": DateTime.now().toUtc().toIso8601String(),
            "isInsideGeofence": isInsideGeofence,
            "isDwellConfirmed": isDwellConfirmed,
            "locationId": activeLocationId ?? (primaryLocation != null ? primaryLocation['id'] : null),
            if (code != null) "code": code,
          }) as Map<String, dynamic>;

      Map<String, dynamic> body = await send();

      if (body['codeRequired'] == true && mounted) {
        final scanned = await Navigator.of(context).push<String>(
          MaterialPageRoute(builder: (_) => const ScanCodeScreen()),
        );
        if (scanned == null) {
          _showSnackBar('Check-in cancelled — no code scanned.');
          return;
        }
        body = await send(code: scanned);
      }

      final accepted = body['accepted'] == true;
      final message = body['message'] as String? ?? (accepted ? 'Success.' : 'Rejected.');

      if (mounted) {
        if (accepted) {
          _isCheckedIn = action == 'check-in';
          _currentStatus = _isCheckedIn ? 'Checked in' : 'Not checked in';
          final isUnderReview = action == 'check-out' && body['checkoutFlagged'] == true;
          _showSnackBar(
            _isCheckedIn ? 'Checked in successfully.' : (isUnderReview ? 'Checkout under review.' : 'Checked out successfully.'),
            isSuccess: true,
          );

          if (_isCheckedIn) {
            Notifications.showCheckinSuccess(locationName);
          } else if (isUnderReview) {
            Notifications.showCheckoutUnderReview(body['distanceMeters'] as int?);
          } else {
            Notifications.showCheckoutSuccess();
          }
          await _loadHistory();
        } else {
          _showSnackBar(message);
        }
      }
    } catch (_) {
      _showSnackBar('Connection failed. Is backend reachable?');
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  void _showSnackBar(String message, {bool isSuccess = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isSuccess ? AppColors.okText : AppColors.alertText,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(16),
      ),
    );
  }

  void _confirmLogout() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text('You will need to sign in again to access Check-N.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel', style: TextStyle(color: AppColors.inkSoft)),
          ),
          TextButton(
            onPressed: () async {
              Navigator.pop(context);
              await FirebaseAuth.instance.signOut();
              if (context.mounted) {
                Navigator.of(context).pushAndRemoveUntil(
                  MaterialPageRoute(builder: (_) => const AuthGate()),
                  (route) => false,
                );
              }
            },
            child: const Text('Sign out', style: TextStyle(color: AppColors.brandRed, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final primaryLoc = _assignedLocations.isNotEmpty ? _assignedLocations.first : null;
    final locName = primaryLoc?['name'] as String? ?? 'Dubai Head Office';
    final radiusStr = '${(primaryLoc?['radiusMeters'] as num? ?? 100).round()} meters';
    final workingHoursStr = primaryLoc?['workingHours'] as String? ?? '9:00 AM – 6:00 PM';

    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FA),
      body: SafeArea(
        child: Column(
          children: [
            // Top App Header
            AppHeader(
              photoBase64: _photoBase64,
              unreadNotificationCount: _unreadNotificationsCount,
              onProfileTap: () => widget.onNavigateToTab(4),
              onNotificationsTap: () => widget.onNavigateToTab(3),
              onLogoutTap: _confirmLogout,
            ),

            // Main Content Area
            Expanded(
              child: RefreshIndicator(
                color: AppColors.brandRed,
                onRefresh: () async {
                  await _loadHistory();
                  await _loadAvatar();
                },
                child: SingleChildScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                  child: Column(
                    children: [
                      // 1. Current Status Card
                      _buildCurrentStatusCard(),

                      const SizedBox(height: 16),

                      // 2. Supervisor Actions Card
                      _buildSupervisorActionsCard(),

                      const SizedBox(height: 16),

                      // 3. Approved Location Card
                      ApprovedLocationCard(
                        locationName: locName,
                        geofenceRadius: radiusStr,
                        workingHours: workingHoursStr,
                      ),

                      const SizedBox(height: 20),

                      // 4. Recent Activity Section
                      RecentActivitySection(
                        history: _history,
                        isLoading: _loadingHistory,
                        onViewAllTap: () => widget.onNavigateToTab(1),
                      ),

                      const SizedBox(height: 24),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCurrentStatusCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A000000),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: const BoxDecoration(
                  color: AppColors.brandRed,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.apartment_rounded,
                  color: AppColors.white,
                  size: 24,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Current status',
                      style: TextStyle(
                        color: AppColors.inkSoft,
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _currentStatus,
                      style: TextStyle(
                        color: _isCheckedIn ? const Color(0xFF2E7D32) : AppColors.brandRed,
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
              // Offsite Pill Badge
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF2F2),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Text(
                  'Offsite',
                  style: TextStyle(
                    color: AppColors.brandRed,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          const Divider(height: 1, color: Color(0xFFEEEEEE)),
          const SizedBox(height: 14),
          Text(
            _isCheckedIn
                ? 'You are currently checked in at your assigned workplace.'
                : "You haven't checked in yet. Tap 'Check in' when you arrive at your workplace.",
            style: const TextStyle(
              color: AppColors.inkSoft,
              fontSize: 13,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSupervisorActionsCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A000000),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: const BoxDecoration(
                  color: AppColors.brandRed,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.assignment_outlined,
                  color: AppColors.white,
                  size: 24,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Supervisor actions',
                      style: TextStyle(
                        color: AppColors.inkSoft,
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '$_pendingApprovalsCount pending approvals',
                      style: const TextStyle(
                        color: AppColors.ink,
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 2),
                    const Text(
                      'Review and manage team requests.',
                      style: TextStyle(
                        color: AppColors.inkSoft,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Primary "Go to approvals" button
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              onPressed: () => widget.onNavigateToTab(2),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.brandRed,
                foregroundColor: AppColors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 16),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: const [
                      Icon(Icons.groups_rounded, size: 22, color: AppColors.white),
                      SizedBox(width: 12),
                      Text(
                        'Go to approvals',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                  Container(
                    padding: const EdgeInsets.all(4),
                    decoration: const BoxDecoration(
                      color: Color(0x33FFFFFF),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.chevron_right_rounded,
                      size: 20,
                      color: AppColors.white,
                    ),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 14),

          // 2 Horizontally Aligned Buttons: Check in / Check out
          Row(
            children: [
              // Check in button
              Expanded(
                child: SizedBox(
                  height: 56,
                  child: ElevatedButton(
                    onPressed: (_isCheckedIn || _isBusy) ? null : () => _performAction('check-in'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _isCheckedIn ? const Color(0xFFEFEFEF) : AppColors.brandRed,
                      foregroundColor: _isCheckedIn ? AppColors.inkSoft : AppColors.white,
                      disabledBackgroundColor: const Color(0xFFF5F5F5),
                      disabledForegroundColor: AppColors.inkSoft,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          Icons.login_rounded,
                          size: 22,
                          color: _isCheckedIn ? AppColors.inkSoft : AppColors.white,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Check in',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.bold,
                                  color: _isCheckedIn ? AppColors.inkSoft : AppColors.white,
                                ),
                              ),
                              const Text(
                                'Record your arrival',
                                style: TextStyle(
                                  fontSize: 10,
                                  color: Color(0xCCFFFFFF),
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.all(4),
                          decoration: BoxDecoration(
                            color: _isCheckedIn ? Colors.transparent : const Color(0x33FFFFFF),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            Icons.chevron_right_rounded,
                            size: 18,
                            color: _isCheckedIn ? AppColors.inkSoft : AppColors.white,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              // Check out button
              Expanded(
                child: SizedBox(
                  height: 56,
                  child: OutlinedButton(
                    onPressed: (!_isCheckedIn || _isBusy) ? null : () => _performAction('check-out'),
                    style: OutlinedButton.styleFrom(
                      backgroundColor: _isCheckedIn ? AppColors.white : const Color(0xFFF8F9FA),
                      foregroundColor: AppColors.ink,
                      side: BorderSide(
                        color: _isCheckedIn ? const Color(0xFFE0E0E0) : const Color(0xFFEEEEEE),
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          Icons.logout_rounded,
                          size: 22,
                          color: _isCheckedIn ? AppColors.ink : AppColors.inkSoft,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Check out',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.bold,
                                  color: _isCheckedIn ? AppColors.ink : AppColors.inkSoft,
                                ),
                              ),
                              const Text(
                                'Record your departure',
                                style: TextStyle(
                                  fontSize: 10,
                                  color: AppColors.inkSoft,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.all(4),
                          decoration: const BoxDecoration(
                            color: Color(0xFFF0F0F0),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.chevron_right_rounded,
                            size: 18,
                            color: AppColors.ink,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
