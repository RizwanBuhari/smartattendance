import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/services/notifications.dart';
import '../../core/services/offsite_request_service.dart';
import '../../core/theme/app_colors.dart';
import 'offsite_qr_scanner_screen.dart';

class OffsiteActionScreen extends StatefulWidget {
  const OffsiteActionScreen({
    super.key,
    this.onNavigateToTab,
  });

  final ValueChanged<int>? onNavigateToTab;

  @override
  State<OffsiteActionScreen> createState() => _OffsiteActionScreenState();
}

class _OffsiteActionScreenState extends State<OffsiteActionScreen> {
  String? get _uid => FirebaseAuth.instance.currentUser?.uid;

  final TextEditingController _reasonController = TextEditingController();
  bool _submitting = false;
  Map<String, dynamic>? _employeeData;
  Map<String, dynamic>? _activeRequest;
  bool _isCheckedIn = false;

  StreamSubscription<QuerySnapshot>? _requestSub;
  StreamSubscription<QuerySnapshot>? _attendanceSub;
  StreamSubscription<QuerySnapshot>? _employeeSub;
  final List<StreamSubscription<DocumentSnapshot>> _locationSubscriptions = [];
  List<Map<String, dynamic>> _assignedLocations = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _reasonController.dispose();
    _requestSub?.cancel();
    _attendanceSub?.cancel();
    _employeeSub?.cancel();
    for (final sub in _locationSubscriptions) {
      sub.cancel();
    }
    super.dispose();
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
        setState(() {
          _employeeData = {'id': doc.id, ...data};
        });
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
            'name': locData['name'] ?? 'Dubai Worksite',
            'latitude': locData['latitude'],
            'longitude': locData['longitude'],
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

  Future<void> _submitCheckin() async {
    final worksiteId = (_employeeData?['assignedLocationIds'] as List<dynamic>?)?.first?.toString();
    if (worksiteId == null) {
      _showSnackbar('No approved worksite assigned to your profile.');
      return;
    }

    final reason = _reasonController.text.trim();
    setState(() => _submitting = true);

    try {
      await OffsiteRequestService.createRequest(worksiteId, reason.isEmpty ? 'Offsite assignment' : reason);
      final worksiteName = _assignedLocations.isNotEmpty ? _assignedLocations.first['name'] : 'Worksite';
      await Notifications.showOffsiteRequestSubmitted(worksiteName);
      _reasonController.clear();
      _showSnackbar('Offsite check-in request submitted to supervisor.', isSuccess: true);
    } catch (e) {
      _showSnackbar('Failed to submit request. Try again.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _submitCheckout() async {
    final worksiteId = (_employeeData?['assignedLocationIds'] as List<dynamic>?)?.first?.toString();
    if (worksiteId == null) {
      _showSnackbar('No approved worksite assigned to your profile.');
      return;
    }

    final reason = _reasonController.text.trim();
    setState(() => _submitting = true);

    try {
      await OffsiteRequestService.createCheckoutRequest(worksiteId, reason.isEmpty ? 'Offsite checkout' : reason);
      final worksiteName = _assignedLocations.isNotEmpty ? _assignedLocations.first['name'] : 'Worksite';
      await Notifications.showOffsiteRequestSubmitted(worksiteName);
      _reasonController.clear();
      _showSnackbar('Offsite checkout request submitted to supervisor.', isSuccess: true);
    } catch (e) {
      _showSnackbar('Failed to submit checkout request. Try again.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _showSnackbar(String msg, {bool isSuccess = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: isSuccess ? AppColors.okText : AppColors.alertText,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(16),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final worksiteName = _assignedLocations.isNotEmpty ? _assignedLocations.first['name'] : 'Assigned Worksite';
    final requestStatus = _activeRequest?['status'] as String?;
    final isPending = requestStatus == 'pending_approval';
    final isApproved = requestStatus == 'approved_waiting_qr' || requestStatus == 'qr_ready';
    final isCheckoutRequest = _activeRequest?['requestType'] == 'check_out';

    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FA),
      appBar: AppBar(
        title: const Text('Offsite Operations'),
        centerTitle: true,
        backgroundColor: AppColors.white,
        foregroundColor: AppColors.ink,
        elevation: 0.5,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 1. Status Overview Banner
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: _isCheckedIn ? const Color(0xFFE8F5E9) : const Color(0xFFFFF2F2),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: _isCheckedIn ? const Color(0xFFC8E6C9) : const Color(0xFFFFD5D5)),
                ),
                child: Row(
                  children: [
                    Icon(
                      _isCheckedIn ? Icons.check_circle_rounded : Icons.info_outline_rounded,
                      color: _isCheckedIn ? const Color(0xFF2E7D32) : AppColors.brandRed,
                      size: 24,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _isCheckedIn ? 'Status: Checked in Offsite' : 'Status: Not Checked in',
                            style: TextStyle(
                              color: _isCheckedIn ? const Color(0xFF2E7D32) : AppColors.brandRed,
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _isCheckedIn
                                ? 'You are currently active on offsite duty at $worksiteName.'
                                : 'Submit a check-in request to your supervisor below.',
                            style: const TextStyle(color: AppColors.inkSoft, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 16),

              // 2. Ready to Scan QR Card (if supervisor approved request)
              if (isApproved && _activeRequest != null) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: AppColors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.brandRed, width: 1.5),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x1A000000),
                        blurRadius: 16,
                        offset: Offset(0, 4),
                      ),
                    ],
                  ),
                  child: Column(
                    children: [
                      const Icon(Icons.qr_code_scanner_rounded, size: 48, color: AppColors.brandRed),
                      const SizedBox(height: 12),
                      Text(
                        isCheckoutRequest ? 'Checkout Request Approved!' : 'Check-in Request Approved!',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.ink),
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        'Scan your supervisor\'s generated QR code now to complete offsite attendance.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: AppColors.inkSoft, fontSize: 13),
                      ),
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        height: 48,
                        child: ElevatedButton.icon(
                          onPressed: () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => OffsiteQrScannerScreen(
                                  requestId: _activeRequest!['id'],
                                ),
                              ),
                            );
                          },
                          icon: const Icon(Icons.camera_alt_rounded, color: AppColors.white),
                          label: const Text('Scan Supervisor QR Code', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppColors.white)),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.brandRed,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],

              // 3. Pending Request Status Banner
              if (isPending) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF8E1),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFFFECB3)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.hourglass_top_rounded, color: Color(0xFFF57F17), size: 24),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              isCheckoutRequest ? 'Checkout Request Pending' : 'Check-in Request Pending',
                              style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFF57F17), fontSize: 14),
                            ),
                            const SizedBox(height: 2),
                            const Text(
                              'Your supervisor is reviewing your request. You will receive a notification once approved.',
                              style: TextStyle(color: AppColors.inkSoft, fontSize: 12),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],

              // 4. Dedicated Submit Request Card (Embedded directly on page)
              Container(
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
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: _isCheckedIn ? const Color(0xFFF0F0F0) : const Color(0xFFFFE5E5),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            _isCheckedIn ? Icons.logout_rounded : Icons.location_on_rounded,
                            color: _isCheckedIn ? AppColors.brandRed : AppColors.brandRed,
                            size: 22,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _isCheckedIn ? 'Submit Offsite Check-out' : 'Submit Offsite Check-in',
                                style: const TextStyle(
                                  fontSize: 17,
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.ink,
                                ),
                              ),
                              Text(
                                'Worksite: $worksiteName',
                                style: const TextStyle(color: AppColors.inkSoft, fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text(
                      _isCheckedIn
                          ? 'Specify your reason for checking out offsite:'
                          : 'Specify your reason or location details for working offsite:',
                      style: const TextStyle(color: AppColors.inkSoft, fontSize: 13),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _reasonController,
                      maxLines: 3,
                      enabled: !_submitting && !isPending && !isApproved,
                      decoration: InputDecoration(
                        hintText: _isCheckedIn
                            ? 'e.g. Completed offsite work shift at client location'
                            : 'e.g. Client meeting at Dubai Marina office',
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(color: AppColors.brandRed, width: 2),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: ElevatedButton(
                        onPressed: (_submitting || isPending || isApproved)
                            ? null
                            : (_isCheckedIn ? _submitCheckout : _submitCheckin),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.brandRed,
                          disabledBackgroundColor: const Color(0xFFE0E0E0),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        child: _submitting
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                              )
                            : Text(
                                _isCheckedIn ? 'Submit Check-out Request' : 'Submit Check-in Request',
                                style: const TextStyle(
                                  color: AppColors.white,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 15,
                                ),
                              ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
