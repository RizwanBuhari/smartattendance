import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/services/notifications.dart';
import '../../core/services/offsite_request_service.dart';
import '../../core/theme/app_colors.dart';
import 'handled_requests_screen.dart';
import 'request_details_screen.dart';

class ApprovalsListScreen extends StatefulWidget {
  const ApprovalsListScreen({super.key});

  @override
  State<ApprovalsListScreen> createState() => _ApprovalsListScreenState();
}

class _ApprovalsListScreenState extends State<ApprovalsListScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _pendingRequests = [];
  List<Map<String, dynamic>> _handledRequests = [];
  StreamSubscription<QuerySnapshot>? _requestsSub;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _resolveSupervisorAndListen();
  }

  @override
  void dispose() {
    _requestsSub?.cancel();
    _tabController.dispose();
    super.dispose();
  }

  // The supervisor stream is keyed by the site admin's employees_ids doc id, not
  // their auth uid, so resolve that doc first, then subscribe.
  Future<void> _resolveSupervisorAndListen() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    try {
      final snap = await FirebaseFirestore.instance
          .collection('employees_ids')
          .where('authUid', isEqualTo: uid)
          .limit(1)
          .get();
      if (snap.docs.isEmpty) {
        if (mounted) setState(() => _loading = false);
        return;
      }
      _listenToRequests(snap.docs.first.id);
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Could not load approvals. Pull to retry.';
        });
      }
    }
  }

  void _listenToRequests(String supervisorId) {
    _requestsSub = OffsiteRequestService.getSupervisorRequestsStream(
      supervisorId,
    ).listen((snap) async {
      final List<Map<String, dynamic>> pending = [];
      final List<Map<String, dynamic>> handled = [];
      
      final prefs = await SharedPreferences.getInstance();
      final notifiedKeys = prefs.getStringList('notifiedSupervisorKeys') ?? [];
      final notifiedSet = notifiedKeys.toSet();
      bool changed = false;

      for (final doc in snap.docs) {
        final data = doc.data() as Map<String, dynamic>;
        final req = {'id': doc.id, ...data};
        final status = req['status'] as String;

        // Sort requests
        if (status == 'pending_approval') {
          pending.add(req);
          
          // Supervisor tray notifications on new request arrival
          if (!notifiedSet.contains(doc.id)) {
            final empName = req['employeeName'] ?? 'An employee';
            final worksite = req['worksiteName'] ?? 'Worksite';
            await Notifications.showNewOffsiteRequestReceived(empName, worksite);
            notifiedSet.add(doc.id);
            changed = true;
          }
        } else {
          handled.add(req);
        }
      }

      if (changed) {
        await prefs.setStringList('notifiedSupervisorKeys', notifiedSet.toList());
      }

      // Sort by requestedAt descending safely
      pending.sort(_compareRequestedAt);
      handled.sort(_compareRequestedAt);

      if (mounted) {
        setState(() {
          _pendingRequests = pending;
          _handledRequests = handled;
          _loading = false;
          _error = null;
        });
      }
    }, onError: (_) {
      // A failed read (e.g. denied by Firestore rules) must not leave the screen
      // spinning forever — surface it so the user knows to retry.
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Could not load approvals. Pull to retry.';
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: const Text('Offsite Approvals'),
        centerTitle: true,
        backgroundColor: AppColors.white,
        foregroundColor: AppColors.ink,
        elevation: 0.5,
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppColors.brandRed,
          labelColor: AppColors.brandRed,
          unselectedLabelColor: AppColors.inkSoft,
          tabs: [
            Tab(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('Pending'),
                  if (_pendingRequests.isNotEmpty) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: const BoxDecoration(
                        color: AppColors.brandRed,
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        _pendingRequests.length.toString(),
                        style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const Tab(text: 'Handled'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.brandRed))
          : _error != null
              ? _buildError(_error!)
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildPendingList(_pendingRequests),
                    HandledRequestsScreen(requests: _handledRequests),
                  ],
                ),
    );
  }

  Widget _buildError(String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline_rounded, size: 48, color: AppColors.muted),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.inkSoft, fontSize: 14),
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: () {
                _requestsSub?.cancel();
                setState(() {
                  _loading = true;
                  _error = null;
                });
                _resolveSupervisorAndListen();
              },
              child: const Text('Retry', style: TextStyle(color: AppColors.brandRed)),
            ),
          ],
        ),
      ),
    );
  }

  DateTime? _parseTimestamp(dynamic val) {
    if (val == null) return null;
    if (val is Timestamp) return val.toDate();
    if (val is String) return DateTime.tryParse(val);
    return null;
  }

  String _formatDisplayTime(dynamic val) {
    final dt = _parseTimestamp(val);
    if (dt == null) return '';
    final local = dt.toLocal();
    final h = local.hour.toString().padLeft(2, '0');
    final m = local.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  int _compareRequestedAt(Map<String, dynamic> a, Map<String, dynamic> b) {
    final dtA = _parseTimestamp(a['requestedAt']);
    final dtB = _parseTimestamp(b['requestedAt']);
    if (dtA == null && dtB == null) return 0;
    if (dtA == null) return 1;
    if (dtB == null) return -1;
    return dtB.compareTo(dtA);
  }

  Widget _buildPendingList(List<Map<String, dynamic>> requests) {
    if (requests.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.done_all_rounded, size: 48, color: AppColors.muted),
            SizedBox(height: 12),
            Text(
              'No pending requests!',
              style: TextStyle(color: AppColors.inkSoft, fontSize: 14),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: requests.length,
      itemBuilder: (context, idx) {
        final req = requests[idx];
        final empName = req['employeeName'] ?? 'Employee';
        final worksite = req['worksiteName'] ?? ' Dubai Worksite';
        final reason = req['reason'] ?? 'Offsite site visit';
        final displayTime = _formatDisplayTime(req['requestedAt']);

        final requestType = req['requestType'] as String? ?? 'check_in';
        final isCheckout = requestType == 'check_out';

        return Card(
          elevation: 0.5,
          margin: const EdgeInsets.only(bottom: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: AppColors.line),
          ),
          color: AppColors.panel,
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => RequestDetailsScreen(requestId: req['id']),
                ),
              );
            },
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  CircleAvatar(
                    backgroundColor: isCheckout ? const Color(0xFFFFF2F2) : AppColors.brandRedSoft,
                    foregroundColor: AppColors.brandRed,
                    radius: 24,
                    child: Text(
                      empName.isNotEmpty ? empName[0].toUpperCase() : 'E',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Row(
                              children: [
                                Text(
                                  empName,
                                  style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.ink, fontSize: 15),
                                ),
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: isCheckout ? const Color(0xFFFFF2F2) : const Color(0xFFE8F5E9),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(
                                    isCheckout ? 'Check-out' : 'Check-in',
                                    style: TextStyle(
                                      fontSize: 10,
                                      fontWeight: FontWeight.bold,
                                      color: isCheckout ? AppColors.brandRed : Colors.green[800],
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            Text(
                              displayTime,
                              style: const TextStyle(color: AppColors.inkSoft, fontSize: 11),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          worksite,
                          style: const TextStyle(color: AppColors.inkSoft, fontSize: 12, fontWeight: FontWeight.w500),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          reason,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: AppColors.inkSoft, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Icon(Icons.arrow_forward_ios_rounded, size: 16, color: AppColors.muted),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
