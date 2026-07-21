import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/services/notifications.dart';
import '../../core/services/offsite_request_service.dart';
import '../../core/theme/app_colors.dart';
import 'offsite_qr_scanner_screen.dart';

class OffsiteHomeScreen extends StatefulWidget {
  const OffsiteHomeScreen({super.key});

  @override
  State<OffsiteHomeScreen> createState() => _OffsiteHomeScreenState();
}

class _OffsiteHomeScreenState extends State<OffsiteHomeScreen> {
  bool _loading = true;
  bool _submitting = false;
  Map<String, dynamic>? _employeeData;
  Map<String, dynamic>? _activeRequest;
  bool _isCheckedIn = false;
  
  StreamSubscription<QuerySnapshot>? _requestSub;
  StreamSubscription<QuerySnapshot>? _attendanceSub;
  StreamSubscription<DocumentSnapshot>? _employeeSub;

  // Track if we just submitted the request in this session to show Screen 2 vs Screen 3
  bool _justSubmitted = false;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _requestSub?.cancel();
    _attendanceSub?.cancel();
    _employeeSub?.cancel();
    super.dispose();
  }

  Future<void> _loadData() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;

    // 1. Listen to employee profile details
    _employeeSub = FirebaseFirestore.instance
        .collection('employees_ids')
        .doc(uid)
        .snapshots()
        .listen((snap) {
      if (snap.exists && mounted) {
        setState(() {
          _employeeData = snap.data();
        });
      }
    });

    // 2. Check and listen if employee is already checked in today
    _attendanceSub = FirebaseFirestore.instance
        .collection('attendance_ids')
        .where('employeeId', isEqualTo: uid)
        .where('status', isEqualTo: 'checked_in')
        .snapshots()
        .listen((snap) {
      if (mounted) {
        setState(() {
          _isCheckedIn = snap.docs.isNotEmpty;
        });
      }
    });

    // 3. Listen to requests for status tracking & push notifications
    _requestSub = OffsiteRequestService.getEmployeeRequestsStream().listen((snap) async {
      if (snap.docs.isEmpty) {
        if (mounted) {
          setState(() {
            _activeRequest = null;
            _loading = false;
          });
        }
        return;
      }

      // Sort by requestedAt descending
      final docs = snap.docs.map((d) => {'id': d.id, ...d.data() as Map<String, dynamic>}).toList();
      docs.sort((a, b) => (b['requestedAt'] as String).compareTo(a['requestedAt'] as String));
      
      final mostRecent = docs.first;
      final status = mostRecent['status'] as String;

      // Handle local tray notifications for state changes using SharedPreferences to prevent duplicates
      if (mounted) {
        final previousRequest = _activeRequest;
        setState(() {
          _activeRequest = mostRecent;
          _loading = false;
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
              } else if (status == 'qr_expired') {
                await Notifications.showQrExpired();
              } else if (status == 'completed') {
                await Notifications.showOffsiteCheckinSuccess(worksiteName);
              }
            }
          }
        }
      }
    });
  }

  Future<void> _submitRequest(String reason) async {
    final worksiteId = (_employeeData?['assignedLocationIds'] as List<dynamic>?)?.first?.toString();
    if (worksiteId == null) {
      _showSnackbar('No approved worksite assigned to your profile.');
      return;
    }

    setState(() {
      _submitting = true;
    });

    try {
      await OffsiteRequestService.createRequest(worksiteId, reason);
      final worksiteName = _employeeData?['assignedLocationIds'] != null ? 'Assigned Worksite' : 'Worksite';
      await Notifications.showOffsiteRequestSubmitted(worksiteName);
      
      if (mounted) {
        setState(() {
          _justSubmitted = true;
          _submitting = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _submitting = false;
        });
      }
      _showSnackbar(e.toString());
    }
  }

  Future<void> _cancelRequest() async {
    final requestId = _activeRequest?['id'];
    if (requestId == null) return;

    setState(() {
      _submitting = true;
    });

    try {
      await OffsiteRequestService.cancelRequest(requestId);
      if (mounted) {
        setState(() {
          _activeRequest = null;
          _submitting = false;
          _justSubmitted = false;
        });
      }
      _showSnackbar('Request cancelled successfully.');
    } catch (e) {
      if (mounted) {
        setState(() {
          _submitting = false;
        });
      }
      _showSnackbar(e.toString());
    }
  }

  void _showReasonSheet() {
    final reasonController = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(ctx).viewInsets.bottom,
        ),
        child: Container(
          decoration: const BoxDecoration(
            color: AppColors.panel,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Check-in Details',
                style: Theme.of(ctx).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Please specify the reason or note for checking in offsite today.',
                style: TextStyle(color: AppColors.inkSoft, fontSize: 13),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: reasonController,
                decoration: InputDecoration(
                  hintText: 'e.g. Client visit and site inspection',
                  hintStyle: const TextStyle(color: AppColors.muted),
                  filled: true,
                  fillColor: AppColors.bg,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide.none,
                  ),
                ),
                maxLines: 3,
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.brandRed,
                  foregroundColor: AppColors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                onPressed: () {
                  Navigator.pop(ctx);
                  _submitRequest(reasonController.text.trim());
                },
                child: const Text('Submit Request', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showSnackbar(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: AppColors.brandRed),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator(color: AppColors.brandRed)),
      );
    }

    final hasActiveWorksite = (_employeeData?['assignedLocationIds'] as List<dynamic>?)?.isNotEmpty ?? false;
    final supervisorName = _employeeData?['supervisorName'] as String?;
    final worksiteName = hasActiveWorksite ? 'Dubai Site Office' : null; // Dynamic placeholder

    // Decide which view/screen to display
    if (_isCheckedIn) {
      return _buildCheckedInView();
    }

    if (_activeRequest == null || _activeRequest!['status'] == 'completed' || _activeRequest!['status'] == 'cancelled') {
      return _buildHomeView(supervisorName, worksiteName, hasActiveWorksite);
    }

    final status = _activeRequest!['status'] as String;

    if (status == 'pending_approval') {
      if (_justSubmitted) {
        return _buildRequestSentView();
      } else {
        return _buildWaitingView();
      }
    }

    if (status == 'approved_waiting_qr' || status == 'qr_ready') {
      return _buildReadyToScanView();
    }

    if (status == 'qr_expired') {
      return _buildQrExpiredView();
    }

    if (status == 'rejected') {
      return _buildRejectedView();
    }

    return _buildHomeView(supervisorName, worksiteName, hasActiveWorksite);
  }

  Widget _buildHomeView(String? supervisorName, String? worksiteName, bool hasActiveWorksite) {
    final bool canRequest = hasActiveWorksite && supervisorName != null && !_submitting;

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: const Text('Offsite Check-in'),
        centerTitle: true,
        backgroundColor: AppColors.white,
        foregroundColor: AppColors.ink,
        elevation: 0.5,
        actions: [
          IconButton(
            icon: const Icon(Icons.info_outline_rounded),
            onPressed: () => _showSnackbar('Offsite check-in requires supervisor approval.'),
          )
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 24),
              // Building icon circular frame
              Center(
                child: Container(
                  width: 100,
                  height: 100,
                  decoration: const BoxDecoration(
                    color: AppColors.brandRedSoft,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.business_rounded,
                    color: AppColors.brandRed,
                    size: 48,
                  ),
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Offsite Check-in',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Request approval from your worksite admin to check in at an offsite location.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.inkSoft, fontSize: 14),
              ),
              const SizedBox(height: 32),
              // Rounded card details
              Container(
                decoration: BoxDecoration(
                  color: AppColors.panel,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.line),
                ),
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    _buildDetailRow(
                      Icons.location_on_outlined,
                      'Worksite',
                      worksiteName ?? 'No offsite assignment',
                    ),
                    const Divider(color: AppColors.line, height: 24),
                    _buildDetailRow(
                      Icons.person_outline_rounded,
                      'Supervisor',
                      supervisorName ?? 'No supervisor assigned',
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 48),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.brandRed,
                  disabledBackgroundColor: AppColors.muted,
                  foregroundColor: AppColors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  elevation: 2,
                ),
                onPressed: canRequest ? _showReasonSheet : null,
                child: _submitting
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(color: AppColors.white, strokeWidth: 2),
                      )
                    : const Text(
                        'Request Check-in',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
              ),
              if (!hasActiveWorksite)
                const Padding(
                  padding: EdgeInsets.only(top: 12),
                  child: Text('No worksite assignment', textAlign: TextAlign.center, style: TextStyle(color: AppColors.alertText, fontSize: 12)),
                )
              else if (supervisorName == null)
                const Padding(
                  padding: EdgeInsets.only(top: 12),
                  child: Text('No supervisor assigned', textAlign: TextAlign.center, style: TextStyle(color: AppColors.alertText, fontSize: 12)),
                )
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRequestSentView() {
    final worksite = _activeRequest?['worksiteName'] ?? 'Assigned Worksite';
    final timestamp = _activeRequest?['requestedAt'] != null
        ? DateTime.parse(_activeRequest!['requestedAt'])
            .toLocal()
            .toString()
            .substring(0, 16)
        : '';

    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              Center(
                child: Container(
                  width: 90,
                  height: 90,
                  decoration: const BoxDecoration(
                    color: AppColors.brandRedSoft,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.send_rounded, color: AppColors.brandRed, size: 40),
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Request Sent!',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.ink),
              ),
              const SizedBox(height: 8),
              const Text(
                'Your check-in request has been sent to your worksite admin.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.inkSoft, fontSize: 14),
              ),
              const SizedBox(height: 32),
              Container(
                decoration: BoxDecoration(
                  color: AppColors.panel,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.line),
                ),
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    _buildDetailRow(Icons.location_on_outlined, 'Worksite', worksite),
                    const Divider(color: AppColors.line, height: 24),
                    _buildDetailRow(Icons.access_time_rounded, 'Requested On', timestamp),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              Container(
                decoration: BoxDecoration(
                  color: AppColors.okBg,
                  borderRadius: BorderRadius.circular(12),
                ),
                padding: const EdgeInsets.all(12),
                child: const Row(
                  children: [
                    Icon(Icons.check_circle, color: AppColors.okText, size: 20),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'You will be notified once your request is approved.',
                        style: TextStyle(color: AppColors.okText, fontSize: 13, fontWeight: FontWeight.w500),
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.white,
                  foregroundColor: AppColors.ink,
                  side: const BorderSide(color: AppColors.line),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: () {
                  setState(() {
                    _justSubmitted = false;
                  });
                },
                child: const Text('View Status', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildWaitingView() {
    final worksite = _activeRequest?['worksiteName'] ?? 'Assigned Worksite';
    final timestamp = _activeRequest?['requestedAt'] != null
        ? DateTime.parse(_activeRequest!['requestedAt'])
            .toLocal()
            .toString()
            .substring(0, 16)
        : '';

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: const Text('Offsite Check-in'),
        centerTitle: true,
        backgroundColor: AppColors.white,
        foregroundColor: AppColors.ink,
        elevation: 0.5,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 24),
              Center(
                child: Container(
                  width: 90,
                  height: 90,
                  decoration: const BoxDecoration(
                    color: AppColors.lateBg,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.access_time_filled_rounded, color: AppColors.lateText, size: 40),
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Waiting for Approval',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.ink),
              ),
              const SizedBox(height: 8),
              const Text(
                'Your request is pending approval from the worksite admin.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.inkSoft, fontSize: 14),
              ),
              const SizedBox(height: 32),
              Container(
                decoration: BoxDecoration(
                  color: AppColors.panel,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.line),
                ),
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    _buildDetailRow(Icons.location_on_outlined, 'Worksite', worksite),
                    const Divider(color: AppColors.line, height: 24),
                    _buildDetailRow(Icons.access_time_rounded, 'Requested On', timestamp),
                    const Divider(color: AppColors.line, height: 24),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Status', style: TextStyle(color: AppColors.inkSoft, fontSize: 13)),
                        Container(
                          decoration: BoxDecoration(
                            color: AppColors.lateBg,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                          child: const Text(
                            'Pending',
                            style: TextStyle(color: AppColors.lateText, fontSize: 12, fontWeight: FontWeight.bold),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const Spacer(),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.white,
                  foregroundColor: AppColors.alertText,
                  side: const BorderSide(color: AppColors.brandRed),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: _submitting ? null : _cancelRequest,
                child: const Text('Cancel Request', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildReadyToScanView() {
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: const Text('Offsite Check-in'),
        centerTitle: true,
        backgroundColor: AppColors.white,
        foregroundColor: AppColors.ink,
        elevation: 0.5,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 24),
              Center(
                child: Container(
                  width: 90,
                  height: 90,
                  decoration: const BoxDecoration(
                    color: AppColors.brandRedSoft,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.qr_code_scanner_rounded, color: AppColors.brandRed, size: 40),
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Ready to Scan',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.ink),
              ),
              const SizedBox(height: 8),
              const Text(
                'Your request has been approved. Scan the supervisor QR code to complete check-in.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.inkSoft, fontSize: 14),
              ),
              const SizedBox(height: 32),
              Container(
                decoration: BoxDecoration(
                  color: AppColors.alertBg,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.brandRedSoft),
                ),
                padding: const EdgeInsets.all(12),
                child: const Row(
                  children: [
                    Icon(Icons.info_rounded, color: AppColors.brandRed, size: 20),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'QR code is valid for 1 minute only.',
                        style: TextStyle(color: AppColors.brandRed, fontSize: 13, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.brandRed,
                  foregroundColor: AppColors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: () {
                  final reqId = _activeRequest?['id'];
                  if (reqId == null) return;
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => OffsiteQrScannerScreen(requestId: reqId),
                    ),
                  );
                },
                child: const Text('Open Scanner', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildQrExpiredView() {
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: const Text('Offsite Check-in'),
        centerTitle: true,
        backgroundColor: AppColors.white,
        foregroundColor: AppColors.ink,
        elevation: 0.5,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 24),
              Center(
                child: Container(
                  width: 90,
                  height: 90,
                  decoration: const BoxDecoration(
                    color: AppColors.alertBg,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.error_outline_rounded, color: AppColors.brandRed, size: 40),
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'QR Code Expired',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.ink),
              ),
              const SizedBox(height: 8),
              const Text(
                'The supervisor QR code has expired. Please ask them to regenerate a new QR code.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.inkSoft, fontSize: 14),
              ),
              const Spacer(),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.white,
                  foregroundColor: AppColors.ink,
                  side: const BorderSide(color: AppColors.line),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: () {
                  setState(() {
                    _activeRequest = null;
                  });
                },
                child: const Text('Return to Home', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRejectedView() {
    final reason = _activeRequest?['rejectionReason'] as String? ?? 'Rejected by supervisor';
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: const Text('Request Rejected'),
        centerTitle: true,
        backgroundColor: AppColors.white,
        foregroundColor: AppColors.ink,
        elevation: 0.5,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 24),
              Center(
                child: Container(
                  width: 90,
                  height: 90,
                  decoration: const BoxDecoration(
                    color: AppColors.alertBg,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.close_rounded, color: AppColors.brandRed, size: 40),
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Request Rejected',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.ink),
              ),
              const SizedBox(height: 8),
              Text(
                'Your offsite check-in request was rejected.\nReason: $reason',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.inkSoft, fontSize: 14),
              ),
              const Spacer(),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.white,
                  foregroundColor: AppColors.ink,
                  side: const BorderSide(color: AppColors.line),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: () {
                  setState(() {
                    _activeRequest = null;
                    _justSubmitted = false;
                  });
                },
                child: const Text('Return to Home', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCheckedInView() {
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: const Text('Checked In'),
        centerTitle: true,
        backgroundColor: AppColors.white,
        foregroundColor: AppColors.ink,
        elevation: 0.5,
      ),
      body: const SafeArea(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(Icons.check_circle_rounded, color: AppColors.okText, size: 64),
              SizedBox(height: 16),
              Text(
                'Already Checked In',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: AppColors.ink),
              ),
              SizedBox(height: 8),
              Text(
                'You are currently checked in. To check out, please use the Home geofence page.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.inkSoft, fontSize: 14),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDetailRow(IconData icon, String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: AppColors.inkSoft, size: 20),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(color: AppColors.inkSoft, fontSize: 11)),
              const SizedBox(height: 2),
              Text(
                value,
                style: const TextStyle(
                  color: AppColors.ink,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
