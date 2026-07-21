import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
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
  List<Map<String, dynamic>> _pendingRequests = [];
  List<Map<String, dynamic>> _handledRequests = [];
  StreamSubscription<QuerySnapshot>? _requestsSub;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _listenToRequests();
  }

  @override
  void dispose() {
    _requestsSub?.cancel();
    _tabController.dispose();
    super.dispose();
  }

  void _listenToRequests() {
    _requestsSub = OffsiteRequestService.getSupervisorRequestsStream().listen((snap) async {
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

      // Sort by requestedAt descending
      pending.sort((a, b) => (b['requestedAt'] as String).compareTo(a['requestedAt'] as String));
      handled.sort((a, b) => (b['requestedAt'] as String).compareTo(a['requestedAt'] as String));

      if (mounted) {
        setState(() {
          _pendingRequests = pending;
          _handledRequests = handled;
          _loading = false;
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
          : TabBarView(
              controller: _tabController,
              children: [
                _buildPendingList(_pendingRequests),
                HandledRequestsScreen(requests: _handledRequests),
              ],
            ),
    );
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
        final timeStr = req['requestedAt'] as String? ?? '';
        final displayTime = timeStr.isNotEmpty
            ? DateTime.parse(timeStr).toLocal().toString().substring(11, 16)
            : '';

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
                  // Initial Avatar circular badge
                  CircleAvatar(
                    backgroundColor: AppColors.brandRedSoft,
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
                            Text(
                              empName,
                              style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.ink, fontSize: 15),
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
