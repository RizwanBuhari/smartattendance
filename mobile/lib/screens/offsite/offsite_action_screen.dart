import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/services/notifications.dart';
import '../../core/services/offsite_request_service.dart';
<<<<<<< HEAD
import '../../core/services/biometric_service.dart';
import '../biometric/biometric_setup_screen.dart';
import '../face/face_attendance_verification_screen.dart';
import '../../core/theme/app_colors.dart';
import 'offsite_qr_scanner_screen.dart';

class OffsiteActionScreen extends StatefulWidget {
  const OffsiteActionScreen({
    super.key,
    this.onNavigateToTab,
  });
=======
import '../../core/services/hardware_auth_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/attendance_window.dart';
import 'offsite_qr_scanner_screen.dart';

class OffsiteActionScreen extends StatefulWidget {
  const OffsiteActionScreen({super.key, this.onNavigateToTab});
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c

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
<<<<<<< HEAD
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
=======
          if (empSnap.docs.isNotEmpty && mounted) {
            final doc = empSnap.docs.first;
            final data = doc.data();
            setState(() {
              _employeeData = {'id': doc.id, ...data};
            });
            final assigned =
                data['assignedLocationIds'] as List<dynamic>? ?? [];
            _listenToLocationDetails(
              assigned.map((e) => e.toString()).toList(),
            );
            _listenToAttendance(doc.id, uid);
          }
        });

    _listenToAttendance(uid, uid);

    _requestSub = OffsiteRequestService.getEmployeeRequestsStream().listen((
      snap,
    ) async {
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
      if (snap.docs.isEmpty) {
        if (mounted) {
          setState(() {
            _activeRequest = null;
          });
        }
        return;
      }
<<<<<<< HEAD
      final docs = snap.docs.map((d) => {'id': d.id, ...d.data() as Map<String, dynamic>}).toList();
      docs.sort((a, b) {
        final rawA = a['requestedAt'];
        final rawB = b['requestedAt'];
        final dtA = rawA is Timestamp ? rawA.toDate() : (rawA is String ? DateTime.tryParse(rawA) : null);
        final dtB = rawB is Timestamp ? rawB.toDate() : (rawB is String ? DateTime.tryParse(rawB) : null);
=======
      final docs =
          snap.docs
              .map((d) => {'id': d.id, ...d.data() as Map<String, dynamic>})
              .toList();
      docs.sort((a, b) {
        final rawA = a['requestedAt'];
        final rawB = b['requestedAt'];
        final dtA =
            rawA is Timestamp
                ? rawA.toDate()
                : (rawA is String ? DateTime.tryParse(rawA) : null);
        final dtB =
            rawB is Timestamp
                ? rawB.toDate()
                : (rawB is String ? DateTime.tryParse(rawB) : null);
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
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

<<<<<<< HEAD
        if (previousRequest != null && previousRequest['id'] == mostRecent['id']) {
          final oldStatus = previousRequest['status'] as String;
          if (oldStatus != status) {
            final worksiteName = mostRecent['worksiteName'] ?? 'Assigned Worksite';
            final prefs = await SharedPreferences.getInstance();
            final notifiedKeys = prefs.getStringList('notifiedOffsiteKeys') ?? [];
=======
        if (previousRequest != null &&
            previousRequest['id'] == mostRecent['id']) {
          final oldStatus = previousRequest['status'] as String;
          if (oldStatus != status) {
            final worksiteName =
                mostRecent['worksiteName'] ?? 'Assigned Worksite';
            final prefs = await SharedPreferences.getInstance();
            final notifiedKeys =
                prefs.getStringList('notifiedOffsiteKeys') ?? [];
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
            final notifiedSet = notifiedKeys.toSet();
            final notifyKey = '${mostRecent['id']}_$status';

            if (!notifiedSet.contains(notifyKey)) {
              notifiedSet.add(notifyKey);
<<<<<<< HEAD
              await prefs.setStringList('notifiedOffsiteKeys', notifiedSet.toList());

              if (status == 'rejected') {
                final reason = mostRecent['rejectionReason'] as String?;
                await Notifications.showOffsiteRequestRejected(worksiteName, reason);
              } else if (status == 'approved_waiting_qr' || status == 'qr_ready') {
=======
              await prefs.setStringList(
                'notifiedOffsiteKeys',
                notifiedSet.toList(),
              );

              if (status == 'rejected') {
                final reason = mostRecent['rejectionReason'] as String?;
                await Notifications.showOffsiteRequestRejected(
                  worksiteName,
                  reason,
                );
              } else if (status == 'approved_waiting_qr' ||
                  status == 'qr_ready') {
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
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
    final ids = {empDocId, authUid}.where((id) => id.isNotEmpty).toList();
    if (ids.isEmpty) return;

    _attendanceSub = FirebaseFirestore.instance
        .collection('attendance_ids')
        .where('employeeId', whereIn: ids)
        .where('status', isEqualTo: 'checked_in')
        .snapshots()
        .listen((snap) {
<<<<<<< HEAD
      if (mounted) {
        final checkedIn = snap.docs.isNotEmpty;
        setState(() {
          _isCheckedIn = checkedIn;
        });
        if (checkedIn) {
          Notifications.scheduleCheckoutReminder();
        } else {
          Notifications.cancelCheckoutReminder();
        }
      }
    });
=======
          if (mounted) {
            final checkedIn = snap.docs.isNotEmpty;
            setState(() {
              _isCheckedIn = checkedIn;
            });
            if (checkedIn) {
              Notifications.scheduleCheckoutReminder();
            } else {
              Notifications.cancelCheckoutReminder();
            }
          }
        });
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
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
<<<<<<< HEAD
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
=======
            if (locSnap.exists) {
              final locData = locSnap.data()!;
              final locationInfo = {
                'id': locSnap.id,
                'name': locData['name'] ?? 'Dubai Worksite',
                'latitude': locData['latitude'],
                'longitude': locData['longitude'],
                'attendanceWindows': locData['attendanceWindows'],
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
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
      _locationSubscriptions.add(sub);
    }
  }

<<<<<<< HEAD
  void _showBiometricSetupDialog() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Biometric Setup Required'),
        content: const Text(
          'Your assigned attendance method requires biometric verification. Please complete biometric setup on this device before submitting your request.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.brandRed),
            onPressed: () {
              Navigator.of(ctx).pop();
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const BiometricSetupScreen()),
              );
            },
            child: const Text('Setup Now', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  Future<void> _submitCheckin() async {
    final worksiteId = (_employeeData?['assignedLocationIds'] as List<dynamic>?)?.first?.toString();
=======
  Future<void> _submitCheckin() async {
    final worksiteId =
        (_employeeData?['assignedLocationIds'] as List<dynamic>?)?.first
            ?.toString();
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
    if (worksiteId == null) {
      _showSnackbar('No approved worksite assigned to your profile.');
      return;
    }

<<<<<<< HEAD
    final method = _employeeData?['attendanceMethod']?.toString() ?? 'geofence';
    final bool requiresFingerprint = method.contains('fingerprint') || method.contains('biometric');
    final bool requiresFace = method.contains('face');

    if (requiresFace) {
      final int faceSetupVersion = _employeeData?['faceSetupVersion'] as int? ?? 1;
      final result = await Navigator.of(context).push<FaceAttendanceVerificationResult>(
        MaterialPageRoute(
          builder: (_) => FaceAttendanceVerificationScreen(
            action: 'check_in',
            serverSetupVersion: faceSetupVersion,
          ),
        ),
      );

      if (result == null || !result.success) {
        _showSnackbar(result?.errorMessage ?? 'Face verification cancelled or failed.');
        return;
      }
    } else if (requiresFingerprint) {
      final bool setupCompleted = _employeeData?['biometricSetupCompleted'] == true;
      if (!setupCompleted) {
        _showBiometricSetupDialog();
        return;
      }

      final authenticated = await BiometricService.authenticateFingerprint(
        localizedReason: 'Verify your fingerprint to submit offsite check-in request.',
      );

      if (!authenticated) {
        _showSnackbar('Biometric authentication cancelled or failed.');
        return;
      }
=======
    final rawPolicy =
        _employeeData?['assignedAuthPolicy']?.toString() ??
        _employeeData?['attendanceMethod']?.toString() ??
        'geofence';

    final authResult = await HardwareAuthRouter.evaluateAndAuthenticate(
      context: context,
      rawPolicy: rawPolicy,
      actionReason: 'Verify identity to submit offsite check-in request.',
      allowFingerprintFallback:
          _employeeData?['allowFingerprintFallback'] ?? true,
      allowDeviceCredentialFallback:
          _employeeData?['allowDeviceCredentialFallback'] ?? true,
      blockAttendanceWhenFallbackUsed:
          _employeeData?['blockAttendanceWhenFallbackUsed'] ?? false,
    );

    if (!authResult.success) {
      if (authResult.errorMessage != null &&
          authResult.errorMessage!.isNotEmpty) {
        _showSnackbar(authResult.errorMessage!);
      }
      return;
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
    }

    final reason = _reasonController.text.trim();
    setState(() => _submitting = true);

    try {
<<<<<<< HEAD
      await OffsiteRequestService.createRequest(worksiteId, reason.isEmpty ? 'Offsite assignment' : reason);
      final worksiteName = _assignedLocations.isNotEmpty ? _assignedLocations.first['name'] : 'Worksite';
      await Notifications.showOffsiteRequestSubmitted(worksiteName);
      _reasonController.clear();
      _showSnackbar('Offsite check-in request submitted to supervisor.', isSuccess: true);
    } catch (e) {
      final msg = e.toString().replaceAll('Exception:', '').trim();
      _showSnackbar(msg.isNotEmpty ? msg : 'Failed to submit request. Try again.');
=======
      await OffsiteRequestService.createRequest(
        worksiteId,
        reason.isEmpty ? 'Offsite assignment' : reason,
        authMethodUsed: authResult.authMethodUsed,
        fallbackUsed: authResult.fallbackUsed,
        fallbackReason: authResult.fallbackReason,
      );
      final worksiteName =
          _assignedLocations.isNotEmpty
              ? _assignedLocations.first['name']
              : 'Worksite';
      await Notifications.showOffsiteRequestSubmitted(worksiteName);
      _reasonController.clear();
      _showSnackbar(
        'Offsite check-in request submitted to supervisor.',
        isSuccess: true,
      );
    } catch (e) {
      final msg = e.toString().replaceAll('Exception:', '').trim();
      _showSnackbar(
        msg.isNotEmpty ? msg : 'Failed to submit request. Try again.',
      );
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _submitCheckout() async {
<<<<<<< HEAD
    final worksiteId = (_employeeData?['assignedLocationIds'] as List<dynamic>?)?.first?.toString();
=======
    final worksiteId =
        (_employeeData?['assignedLocationIds'] as List<dynamic>?)?.first
            ?.toString();
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
    if (worksiteId == null) {
      _showSnackbar('No approved worksite assigned to your profile.');
      return;
    }

<<<<<<< HEAD
    final method = _employeeData?['attendanceMethod']?.toString() ?? 'geofence';
    final bool requiresFingerprint = method.contains('fingerprint') || method.contains('biometric');
    final bool requiresFace = method.contains('face');

    if (requiresFace) {
      final int faceSetupVersion = _employeeData?['faceSetupVersion'] as int? ?? 1;
      final result = await Navigator.of(context).push<FaceAttendanceVerificationResult>(
        MaterialPageRoute(
          builder: (_) => FaceAttendanceVerificationScreen(
            action: 'check_out',
            serverSetupVersion: faceSetupVersion,
          ),
        ),
      );

      if (result == null || !result.success) {
        _showSnackbar(result?.errorMessage ?? 'Face verification cancelled or failed.');
        return;
      }
    } else if (requiresFingerprint) {
      final bool setupCompleted = _employeeData?['biometricSetupCompleted'] == true;
      if (!setupCompleted) {
        _showBiometricSetupDialog();
        return;
      }

      final authenticated = await BiometricService.authenticateFingerprint(
        localizedReason: 'Verify your fingerprint to submit offsite checkout request.',
      );

      if (!authenticated) {
        _showSnackbar('Biometric authentication cancelled or failed.');
        return;
      }
=======
    final rawPolicy =
        _employeeData?['assignedAuthPolicy']?.toString() ??
        _employeeData?['attendanceMethod']?.toString() ??
        'geofence';

    final authResult = await HardwareAuthRouter.evaluateAndAuthenticate(
      context: context,
      rawPolicy: rawPolicy,
      actionReason: 'Verify identity to submit offsite checkout request.',
      allowFingerprintFallback:
          _employeeData?['allowFingerprintFallback'] ?? true,
      allowDeviceCredentialFallback:
          _employeeData?['allowDeviceCredentialFallback'] ?? true,
      blockAttendanceWhenFallbackUsed:
          _employeeData?['blockAttendanceWhenFallbackUsed'] ?? false,
    );

    if (!authResult.success) {
      if (authResult.errorMessage != null &&
          authResult.errorMessage!.isNotEmpty) {
        _showSnackbar(authResult.errorMessage!);
      }
      return;
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
    }

    final reason = _reasonController.text.trim();
    setState(() => _submitting = true);

    try {
<<<<<<< HEAD
      await OffsiteRequestService.createCheckoutRequest(worksiteId, reason.isEmpty ? 'Offsite checkout' : reason);
      final worksiteName = _assignedLocations.isNotEmpty ? _assignedLocations.first['name'] : 'Worksite';
      await Notifications.showOffsiteRequestSubmitted(worksiteName);
      _reasonController.clear();
      _showSnackbar('Offsite checkout request submitted to supervisor.', isSuccess: true);
    } catch (e) {
      final msg = e.toString().replaceAll('Exception:', '').trim();
      _showSnackbar(msg.isNotEmpty ? msg : 'Failed to submit checkout request. Try again.');
=======
      await OffsiteRequestService.createCheckoutRequest(
        worksiteId,
        reason.isEmpty ? 'Offsite checkout' : reason,
        authMethodUsed: authResult.authMethodUsed,
        fallbackUsed: authResult.fallbackUsed,
        fallbackReason: authResult.fallbackReason,
      );
      final worksiteName =
          _assignedLocations.isNotEmpty
              ? _assignedLocations.first['name']
              : 'Worksite';
      await Notifications.showOffsiteRequestSubmitted(worksiteName);
      _reasonController.clear();
      _showSnackbar(
        'Offsite checkout request submitted to supervisor.',
        isSuccess: true,
      );
    } catch (e) {
      final msg = e.toString().replaceAll('Exception:', '').trim();
      _showSnackbar(
        msg.isNotEmpty ? msg : 'Failed to submit checkout request. Try again.',
      );
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
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
<<<<<<< HEAD
    final worksiteName = _assignedLocations.isNotEmpty ? _assignedLocations.first['name'] : 'Assigned Worksite';
    final requestStatus = _activeRequest?['status'] as String?;
    final isPending = requestStatus == 'pending_approval';
    final isApproved = requestStatus == 'approved_waiting_qr' || requestStatus == 'qr_ready';
    final isCheckoutRequest = _activeRequest?['requestType'] == 'check_out';

=======
    final worksiteName =
        _assignedLocations.isNotEmpty
            ? _assignedLocations.first['name']
            : 'Assigned Worksite';
    final requestStatus = _activeRequest?['status'] as String?;
    final isPending = requestStatus == 'pending_approval';
    final isApproved =
        requestStatus == 'approved_waiting_qr' || requestStatus == 'qr_ready';
    final isCheckoutRequest = _activeRequest?['requestType'] == 'check_out';

    final primaryLocation =
        _assignedLocations.isNotEmpty ? _assignedLocations.first : null;
    final employeeRole = normalizeEmployeeRole(
      _employeeData?['role'] as String?,
    );
    final activeWindow = checkAttendanceWindow(
      attendanceWindows: primaryLocation?['attendanceWindows'],
      role: employeeRole,
      action: _isCheckedIn ? 'checkOut' : 'checkIn',
    );
    final activeWindowText =
        !activeWindow.allowed
            ? '${_isCheckedIn ? 'Check-out' : 'Check-in'} available ${formatHHMM12(activeWindow.from!)} – ${formatHHMM12(activeWindow.to!)}'
            : null;

>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
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
<<<<<<< HEAD
                  color: _isCheckedIn ? const Color(0xFFE8F5E9) : const Color(0xFFFFF2F2),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: _isCheckedIn ? const Color(0xFFC8E6C9) : const Color(0xFFFFD5D5)),
=======
                  color:
                      _isCheckedIn
                          ? const Color(0xFFE8F5E9)
                          : const Color(0xFFFFF2F2),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color:
                        _isCheckedIn
                            ? const Color(0xFFC8E6C9)
                            : const Color(0xFFFFD5D5),
                  ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                ),
                child: Row(
                  children: [
                    Icon(
<<<<<<< HEAD
                      _isCheckedIn ? Icons.check_circle_rounded : Icons.info_outline_rounded,
                      color: _isCheckedIn ? const Color(0xFF2E7D32) : AppColors.brandRed,
=======
                      _isCheckedIn
                          ? Icons.check_circle_rounded
                          : Icons.info_outline_rounded,
                      color:
                          _isCheckedIn
                              ? const Color(0xFF2E7D32)
                              : AppColors.brandRed,
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                      size: 24,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
<<<<<<< HEAD
                            _isCheckedIn ? 'Status: Checked in Offsite' : 'Status: Not Checked in',
                            style: TextStyle(
                              color: _isCheckedIn ? const Color(0xFF2E7D32) : AppColors.brandRed,
=======
                            _isCheckedIn
                                ? 'Status: Checked in Offsite'
                                : 'Status: Not Checked in',
                            style: TextStyle(
                              color:
                                  _isCheckedIn
                                      ? const Color(0xFF2E7D32)
                                      : AppColors.brandRed,
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _isCheckedIn
                                ? 'You are currently active on offsite duty at $worksiteName.'
                                : 'Submit a check-in request to your supervisor below.',
<<<<<<< HEAD
                            style: const TextStyle(color: AppColors.inkSoft, fontSize: 12),
=======
                            style: const TextStyle(
                              color: AppColors.inkSoft,
                              fontSize: 12,
                            ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
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
<<<<<<< HEAD
                      const Icon(Icons.qr_code_scanner_rounded, size: 48, color: AppColors.brandRed),
                      const SizedBox(height: 12),
                      Text(
                        isCheckoutRequest ? 'Checkout Request Approved!' : 'Check-in Request Approved!',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.ink),
=======
                      const Icon(
                        Icons.qr_code_scanner_rounded,
                        size: 48,
                        color: AppColors.brandRed,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        isCheckoutRequest
                            ? 'Checkout Request Approved!'
                            : 'Check-in Request Approved!',
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: AppColors.ink,
                        ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        'Scan your supervisor\'s generated QR code now to complete offsite attendance.',
                        textAlign: TextAlign.center,
<<<<<<< HEAD
                        style: TextStyle(color: AppColors.inkSoft, fontSize: 13),
=======
                        style: TextStyle(
                          color: AppColors.inkSoft,
                          fontSize: 13,
                        ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                      ),
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        height: 48,
                        child: ElevatedButton.icon(
                          onPressed: () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
<<<<<<< HEAD
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
=======
                                builder:
                                    (_) => OffsiteQrScannerScreen(
                                      requestId: _activeRequest!['id'],
                                    ),
                              ),
                            );
                          },
                          icon: const Icon(
                            Icons.camera_alt_rounded,
                            color: AppColors.white,
                          ),
                          label: const Text(
                            'Scan Supervisor QR Code',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 15,
                              color: AppColors.white,
                            ),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.brandRed,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
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
<<<<<<< HEAD
                      const Icon(Icons.hourglass_top_rounded, color: Color(0xFFF57F17), size: 24),
=======
                      const Icon(
                        Icons.hourglass_top_rounded,
                        color: Color(0xFFF57F17),
                        size: 24,
                      ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
<<<<<<< HEAD
                              isCheckoutRequest ? 'Checkout Request Pending' : 'Check-in Request Pending',
                              style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFF57F17), fontSize: 14),
=======
                              isCheckoutRequest
                                  ? 'Checkout Request Pending'
                                  : 'Check-in Request Pending',
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                color: Color(0xFFF57F17),
                                fontSize: 14,
                              ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                            ),
                            const SizedBox(height: 2),
                            const Text(
                              'Your supervisor is reviewing your request. You will receive a notification once approved.',
<<<<<<< HEAD
                              style: TextStyle(color: AppColors.inkSoft, fontSize: 12),
=======
                              style: TextStyle(
                                color: AppColors.inkSoft,
                                fontSize: 12,
                              ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
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
<<<<<<< HEAD
                            color: _isCheckedIn ? const Color(0xFFF0F0F0) : const Color(0xFFFFE5E5),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            _isCheckedIn ? Icons.logout_rounded : Icons.location_on_rounded,
                            color: _isCheckedIn ? AppColors.brandRed : AppColors.brandRed,
=======
                            color:
                                _isCheckedIn
                                    ? const Color(0xFFF0F0F0)
                                    : const Color(0xFFFFE5E5),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            _isCheckedIn
                                ? Icons.logout_rounded
                                : Icons.location_on_rounded,
                            color:
                                _isCheckedIn
                                    ? AppColors.brandRed
                                    : AppColors.brandRed,
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                            size: 22,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
<<<<<<< HEAD
                                _isCheckedIn ? 'Submit Offsite Check-out' : 'Submit Offsite Check-in',
=======
                                _isCheckedIn
                                    ? 'Submit Offsite Check-out'
                                    : 'Submit Offsite Check-in',
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                                style: const TextStyle(
                                  fontSize: 17,
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.ink,
                                ),
                              ),
                              Text(
                                'Worksite: $worksiteName',
<<<<<<< HEAD
                                style: const TextStyle(color: AppColors.inkSoft, fontSize: 12),
=======
                                style: const TextStyle(
                                  color: AppColors.inkSoft,
                                  fontSize: 12,
                                ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
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
<<<<<<< HEAD
                      style: const TextStyle(color: AppColors.inkSoft, fontSize: 13),
=======
                      style: const TextStyle(
                        color: AppColors.inkSoft,
                        fontSize: 13,
                      ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _reasonController,
                      maxLines: 3,
                      enabled: !_submitting && !isPending && !isApproved,
                      decoration: InputDecoration(
<<<<<<< HEAD
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
=======
                        hintText:
                            _isCheckedIn
                                ? 'e.g. Completed offsite work shift at client location'
                                : 'e.g. Client meeting at Dubai Marina office',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(
                            color: AppColors.brandRed,
                            width: 2,
                          ),
                        ),
                      ),
                    ),
                    if (activeWindowText != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        activeWindowText,
                        style: const TextStyle(
                          color: AppColors.inkSoft,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: ElevatedButton(
<<<<<<< HEAD
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
=======
                        onPressed:
                            (_submitting ||
                                    isPending ||
                                    isApproved ||
                                    !activeWindow.allowed)
                                ? null
                                : (_isCheckedIn
                                    ? _submitCheckout
                                    : _submitCheckin),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.brandRed,
                          disabledBackgroundColor: const Color(0xFFE0E0E0),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        child:
                            _submitting
                                ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    color: Colors.white,
                                    strokeWidth: 2,
                                  ),
                                )
                                : Text(
                                  _isCheckedIn
                                      ? 'Submit Check-out Request'
                                      : 'Submit Check-in Request',
                                  style: const TextStyle(
                                    color: AppColors.white,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 15,
                                  ),
                                ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
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
