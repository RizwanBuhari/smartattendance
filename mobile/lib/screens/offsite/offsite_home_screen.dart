import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/services/api_client.dart';
import '../../core/services/notifications.dart';
import '../../core/services/offsite_request_service.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/app_header.dart';
import '../../core/widgets/approved_location_card.dart';
import '../../core/widgets/recent_activity_section.dart';
import '../auth/auth_gate.dart';
import 'offsite_qr_scanner_screen.dart';

class OffsiteHomeScreen extends StatefulWidget {
  const OffsiteHomeScreen({
    super.key,
    this.onNavigateToTab,
  });

  final ValueChanged<int>? onNavigateToTab;

  @override
  State<OffsiteHomeScreen> createState() => _OffsiteHomeScreenState();
}

class _OffsiteHomeScreenState extends State<OffsiteHomeScreen> {
  String? get _uid => FirebaseAuth.instance.currentUser?.uid;

  Map<String, dynamic>? _activeRequest;
  bool _isCheckedIn = false;
  String? _photoBase64;
  final int _unreadNotificationsCount = 0;

  List<Map<String, dynamic>> _history = [];
  bool _loadingHistory = true;

  StreamSubscription<QuerySnapshot>? _requestSub;
  StreamSubscription<QuerySnapshot>? _attendanceSub;
  StreamSubscription<QuerySnapshot>? _employeeSub;
  final List<StreamSubscription<DocumentSnapshot>> _locationSubscriptions = [];
  List<Map<String, dynamic>> _assignedLocations = [];

  @override
  void initState() {
    super.initState();
    _loadData();
    _loadHistory();
    _loadAvatar();
  }

  @override
  void dispose() {
    _requestSub?.cancel();
    _attendanceSub?.cancel();
    _employeeSub?.cancel();
    for (final sub in _locationSubscriptions) {
      sub.cancel();
    }
    super.dispose();
  }

  Future<void> _loadAvatar() async {
    final id = _uid;
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

  Future<void> _loadHistory() async {
    final id = _uid;
    if (id == null) return;

    setState(() => _loadingHistory = true);
    try {
      final list = (await ApiClient.get('/attendance/me') as List).cast<Map<String, dynamic>>();
      if (mounted) {
        setState(() {
          _history = list;
        });
      }
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loadingHistory = false);
    }
  }

  Future<void> _loadData() async {
    final uid = _uid;
    if (uid == null) return;

    _employeeSub?.cancel();
    _employeeSub = FirebaseFirestore.instance
        .collection('employees_ids')
        .where('authUid', isEqualTo: uid)
        .limit(1)
        .snapshots()
        .listen((empSnap) {
      if (empSnap.docs.isNotEmpty && mounted) {
        final doc = empSnap.docs.first;
        final data = doc.data();
        final assigned = data['assignedLocationIds'] as List<dynamic>? ?? [];
        _listenToLocationDetails(assigned.map((e) => e.toString()).toList());
        _listenToAttendance(doc.id, uid);
      }
    });

    _listenToAttendance(uid, uid);

    _requestSub = OffsiteRequestService.getEmployeeRequestsStream().listen((snap) async {
      if (snap.docs.isEmpty) {
        if (mounted) {
          setState(() {
            _activeRequest = null;
          });
        }
        return;
      }
      final docs = snap.docs.map((d) => {'id': d.id, ...d.data() as Map<String, dynamic>}).toList();
      docs.sort((a, b) {
        final rawA = a['requestedAt'];
        final rawB = b['requestedAt'];
        final dtA = rawA is Timestamp ? rawA.toDate() : (rawA is String ? DateTime.tryParse(rawA) : null);
        final dtB = rawB is Timestamp ? rawB.toDate() : (rawB is String ? DateTime.tryParse(rawB) : null);
        if (dtA == null && dtB == null) return 0;
        if (dtA == null) return 1;
        if (dtB == null) return -1;
        return dtB.compareTo(dtA);
      });

      final mostRecent = docs.first;
      final status = mostRecent['status'] as String;

      if (mounted) {
        final previousRequest = _activeRequest;
        setState(() {
          _activeRequest = mostRecent;
        });

        if (previousRequest != null && previousRequest['id'] == mostRecent['id']) {
          final oldStatus = previousRequest['status'] as String;
          if (oldStatus != status) {
            final worksiteName = mostRecent['worksiteName'] ?? 'Assigned Worksite';
            final prefs = await SharedPreferences.getInstance();
            final notifiedKeys = prefs.getStringList('notifiedOffsiteKeys') ?? [];
            final notifiedSet = notifiedKeys.toSet();
            final notifyKey = '${mostRecent['id']}_$status';

            if (!notifiedSet.contains(notifyKey)) {
              notifiedSet.add(notifyKey);
              await prefs.setStringList('notifiedOffsiteKeys', notifiedSet.toList());

              if (status == 'rejected') {
                final reason = mostRecent['rejectionReason'] as String?;
                await Notifications.showOffsiteRequestRejected(worksiteName, reason);
              } else if (status == 'approved_waiting_qr' || status == 'qr_ready') {
                await Notifications.showOffsiteRequestApproved(worksiteName);
              } else if (status == 'completed') {
                await Notifications.showOffsiteCheckinSuccess(worksiteName);
                await _loadHistory();
              }
            }
          }
        }
      }
    });
  }

  void _listenToAttendance(String empDocId, String authUid) {
    _attendanceSub?.cancel();
    _attendanceSub = FirebaseFirestore.instance
        .collection('attendance_ids')
        .where('employeeId', whereIn: [empDocId, authUid])
        .where('status', isEqualTo: 'checked_in')
        .snapshots()
        .listen((snap) {
      if (mounted) {
        setState(() {
          _isCheckedIn = snap.docs.isNotEmpty;
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

    final requestStatus = _activeRequest?['status'] as String?;
    final isPending = requestStatus == 'pending_approval';
    final isApproved = requestStatus == 'approved_waiting_qr' || requestStatus == 'qr_ready';

    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FA),
      body: SafeArea(
        child: Column(
          children: [
            // Top App Header
            AppHeader(
              photoBase64: _photoBase64,
              unreadNotificationCount: _unreadNotificationsCount,
              onProfileTap: () => widget.onNavigateToTab?.call(4),
              onNotificationsTap: () => widget.onNavigateToTab?.call(3),
              onLogoutTap: _confirmLogout,
            ),

            // Main Content Area
            Expanded(
              child: RefreshIndicator(
                color: AppColors.brandRed,
                onRefresh: () async {
                  await _loadData();
                  await _loadHistory();
                  await _loadAvatar();
                },
                child: SingleChildScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                  child: Column(
                    children: [
                      // 1. Offsite Status Card
                      _buildOffsiteStatusCard(isPending, isApproved),

                      const SizedBox(height: 16),

                      // 2. Approved Location Card
                      ApprovedLocationCard(
                        locationName: locName,
                        geofenceRadius: radiusStr,
                        workingHours: workingHoursStr,
                      ),

                      const SizedBox(height: 20),

                      // 3. Offsite Actions Section
                      _buildOffsiteActionsSection(isPending, isApproved),

                      const SizedBox(height: 20),

                      // 4. Recent Activity Section
                      RecentActivitySection(
                        history: _history,
                        isLoading: _loadingHistory,
                        emptySubtitle: 'Your offsite check-in and check-out history will appear here.',
                        onViewAllTap: () => widget.onNavigateToTab?.call(1),
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

  Widget _buildOffsiteStatusCard(bool isPending, bool isApproved) {
    String mainStatus = "Not checked in";
    String helperText = "You haven't checked in yet.\nRequest check-in to start your offsite work.";

    if (_isCheckedIn) {
      mainStatus = "Checked in";
      helperText = "You are currently checked in offsite.";
    } else if (isPending) {
      mainStatus = "Request Pending";
      helperText = "Your offsite check-in request is waiting for supervisor approval.";
    } else if (isApproved) {
      mainStatus = "Approved — Ready to Scan";
      helperText = "Your request was approved! Scan your supervisor's QR code to complete check-in.";
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF2F2),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFFFE0E0)),
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
                      'Offsite status',
                      style: TextStyle(
                        color: AppColors.brandRed,
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      mainStatus,
                      style: const TextStyle(
                        color: AppColors.ink,
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFE5E5),
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
          const Divider(height: 1, color: Color(0xFFFFD5D5)),
          const SizedBox(height: 14),
          Text(
            helperText,
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

  Widget _buildOffsiteActionsSection(bool isPending, bool isApproved) {
    final canRequestCheckIn = !_isCheckedIn && !isPending && !isApproved;
    final checkInActive = canRequestCheckIn || isApproved;
    final checkOutActive = _isCheckedIn && !isPending && !isApproved;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Offsite actions',
          style: TextStyle(
            color: AppColors.ink,
            fontSize: 17,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            // Left Button: Request Check-in
            Expanded(
              child: GestureDetector(
                onTap: () {
                  if (isApproved && _activeRequest != null) {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => OffsiteQrScannerScreen(
                          requestId: _activeRequest!['id'],
                        ),
                      ),
                    );
                  } else {
                    widget.onNavigateToTab?.call(2);
                  }
                },
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: checkInActive ? const Color(0xFFFFF2F2) : const Color(0xFFF8F9FA),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: checkInActive ? const Color(0xFFFFE0E0) : const Color(0xFFEEEEEE)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: checkInActive ? const Color(0xFFFFE5E5) : const Color(0xFFF0F0F0),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          isApproved ? Icons.qr_code_scanner_rounded : Icons.login_rounded,
                          color: checkInActive ? AppColors.brandRed : AppColors.inkSoft,
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              isApproved ? 'Scan QR Code' : 'Request Check-in',
                              style: TextStyle(
                                color: checkInActive ? AppColors.brandRed : AppColors.inkSoft,
                                fontSize: 14,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              isApproved
                                  ? 'Tap to scan supervisor QR'
                                  : (isPending
                                      ? 'Request under review'
                                      : (_isCheckedIn ? 'Already checked in' : 'Request approval to check-in')),
                              style: const TextStyle(
                                color: AppColors.inkSoft,
                                fontSize: 11,
                              ),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: checkInActive ? const Color(0xFFFFE5E5) : const Color(0xFFF0F0F0),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.chevron_right_rounded,
                          color: checkInActive ? AppColors.brandRed : AppColors.inkSoft,
                          size: 16,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(width: 12),
            // Right Button: Request Check-out
            Expanded(
              child: GestureDetector(
                onTap: () {
                  widget.onNavigateToTab?.call(2);
                },
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: checkOutActive ? const Color(0xFFFFF2F2) : const Color(0xFFF8F9FA),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: checkOutActive ? const Color(0xFFFFE0E0) : const Color(0xFFEEEEEE)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: checkOutActive ? const Color(0xFFFFE5E5) : const Color(0xFFF0F0F0),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.logout_rounded,
                          color: checkOutActive ? AppColors.brandRed : AppColors.inkSoft,
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Request Check-out',
                              style: TextStyle(
                                color: checkOutActive ? AppColors.brandRed : AppColors.inkSoft,
                                fontSize: 14,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              checkOutActive ? 'Request approval to checkout' : 'Available after you check-in',
                              style: const TextStyle(
                                color: AppColors.inkSoft,
                                fontSize: 11,
                              ),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: checkOutActive ? const Color(0xFFFFE5E5) : const Color(0xFFF0F0F0),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.chevron_right_rounded,
                          color: checkOutActive ? AppColors.brandRed : AppColors.inkSoft,
                          size: 16,
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
    );
  }
}
