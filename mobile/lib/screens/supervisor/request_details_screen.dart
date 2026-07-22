import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../core/services/offsite_request_service.dart';
import '../../core/theme/app_colors.dart';
import 'request_accepted_screen.dart';
import 'show_qr_code_screen.dart';

class RequestDetailsScreen extends StatefulWidget {
  final String requestId;
  const RequestDetailsScreen({super.key, required this.requestId});

  @override
  State<RequestDetailsScreen> createState() => _RequestDetailsScreenState();
}

class _RequestDetailsScreenState extends State<RequestDetailsScreen> {
  bool _loading = true;
  bool _submitting = false;
  Map<String, dynamic>? _requestData;
  StreamSubscription<DocumentSnapshot>? _docSub;

  @override
  void initState() {
    super.initState();
    _listenToRequest();
  }

  @override
  void dispose() {
    _docSub?.cancel();
    super.dispose();
  }

  void _listenToRequest() {
    _docSub = FirebaseFirestore.instance
        .collection('offsite_requests')
        .doc(widget.requestId)
        .snapshots()
        .listen((snap) {
      if (snap.exists && mounted) {
        setState(() {
          _requestData = snap.data();
          _loading = false;
        });
      } else if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    });
  }

  Future<void> _acceptRequest() async {
    setState(() {
      _submitting = true;
    });

    try {
      await OffsiteRequestService.acceptRequest(widget.requestId);
      if (mounted) {
        setState(() {
          _submitting = false;
        });
        // Route to the accepted confirmation screen, which hands off to the QR
        // display screen.
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => RequestAcceptedScreen(
              requestId: widget.requestId,
              requestData: _requestData!,
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _submitting = false;
        });
        _showSnackbar(e.toString());
      }
    }
  }

  void _showRejectDialog() {
    final reasonController = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reject Request'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Please provide a reason for rejecting this offsite request.',
              style: TextStyle(fontSize: 13, color: AppColors.inkSoft),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reasonController,
              decoration: InputDecoration(
                hintText: 'e.g. Invalid location or schedule mismatch',
                hintStyle: const TextStyle(color: AppColors.muted),
                filled: true,
                fillColor: AppColors.bg,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide.none,
                ),
              ),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel', style: TextStyle(color: AppColors.inkSoft)),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              _rejectRequest(reasonController.text.trim());
            },
            child: const Text('Reject', style: TextStyle(color: AppColors.brandRed, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Future<void> _rejectRequest(String reason) async {
    if (reason.isEmpty) {
      _showSnackbar('Please specify a rejection reason.');
      return;
    }

    setState(() {
      _submitting = true;
    });

    try {
      await OffsiteRequestService.rejectRequest(widget.requestId, reason);
      if (mounted) {
        setState(() {
          _submitting = false;
        });
        _showSnackbar('Request rejected.');
        Navigator.pop(context); // Go back to List
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _submitting = false;
        });
        _showSnackbar(e.toString());
      }
    }
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

    if (_requestData == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Request Details')),
        body: const Center(child: Text('Request not found or has been deleted.')),
      );
    }

    final empName = _requestData!['employeeName'] ?? 'Employee';
    final worksite = _requestData!['worksiteName'] ?? ' Dubai Worksite';
    final reason = _requestData!['reason'] ?? 'Offsite work';
    final status = _requestData!['status'] as String;
    final timeStr = _requestData!['requestedAt'] as String? ?? '';
    final displayTime = timeStr.isNotEmpty
        ? DateTime.parse(timeStr).toLocal().toString().substring(0, 16)
        : '';

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: const Text('Request Details'),
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
              // Details Card
              Container(
                decoration: BoxDecoration(
                  color: AppColors.panel,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.line),
                ),
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          backgroundColor: AppColors.brandRedSoft,
                          foregroundColor: AppColors.brandRed,
                          radius: 26,
                          child: Text(
                            empName.isNotEmpty ? empName[0].toUpperCase() : 'E',
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20),
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                empName,
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: AppColors.ink),
                              ),
                              const SizedBox(height: 2),
                              const Text(
                                'Offsite Check-in Request',
                                style: TextStyle(color: AppColors.inkSoft, fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const Divider(color: AppColors.line, height: 32),
                    _buildDetailField('Worksite', worksite),
                    const SizedBox(height: 16),
                    _buildDetailField('Requested On', displayTime),
                    const SizedBox(height: 16),
                    _buildDetailField('Reason / Note', reason),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Status', style: TextStyle(color: AppColors.inkSoft, fontSize: 13)),
                        _buildStatusBadge(status),
                      ],
                    ),
                    if (status == 'rejected' && _requestData!['rejectionReason'] != null) ...[
                      const Divider(color: AppColors.line, height: 32),
                      _buildDetailField('Rejection Reason', _requestData!['rejectionReason']),
                    ],
                  ],
                ),
              ),
              const Spacer(),
              
              // Dynamic Action buttons based on status
              if (status == 'pending_approval')
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.white,
                          foregroundColor: AppColors.alertText,
                          side: const BorderSide(color: AppColors.brandRed),
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        onPressed: _submitting ? null : _showRejectDialog,
                        child: const Text('Reject', style: TextStyle(fontWeight: FontWeight.bold)),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.brandRed,
                          foregroundColor: AppColors.white,
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        onPressed: _submitting ? null : _acceptRequest,
                        child: _submitting
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(color: AppColors.white, strokeWidth: 2),
                              )
                            : const Text('Accept', style: TextStyle(fontWeight: FontWeight.bold)),
                      ),
                    ),
                  ],
                )
              else if (status == 'approved_waiting_qr' || status == 'qr_ready' || status == 'qr_expired')
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.brandRed,
                    foregroundColor: AppColors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: () {
                    Navigator.of(context).pushReplacement(
                      MaterialPageRoute(
                        builder: (_) => ShowQrCodeScreen(requestId: widget.requestId),
                      ),
                    );
                  },
                  child: const Text('Show QR Code', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                )
              else
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.white,
                    foregroundColor: AppColors.inkSoft,
                    side: const BorderSide(color: AppColors.line),
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Close Details', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDetailField(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppColors.inkSoft, fontSize: 11)),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(color: AppColors.ink, fontSize: 14, fontWeight: FontWeight.w600),
        ),
      ],
    );
  }

  Widget _buildStatusBadge(String status) {
    Color bg;
    Color text;
    String label = status;

    switch (status) {
      case 'pending_approval':
        bg = AppColors.lateBg;
        text = AppColors.lateText;
        label = 'Pending';
        break;
      case 'approved_waiting_qr':
      case 'qr_ready':
        bg = AppColors.okBg;
        text = AppColors.okText;
        label = 'Approved';
        break;
      case 'qr_scanned':
        bg = AppColors.okBg;
        text = AppColors.okText;
        label = 'Verifying';
        break;
      case 'completed':
        bg = AppColors.okBg;
        text = AppColors.okText;
        label = 'Completed';
        break;
      case 'rejected':
        bg = AppColors.alertBg;
        text = AppColors.alertText;
        label = 'Rejected';
        break;
      case 'qr_expired':
        bg = AppColors.alertBg;
        text = AppColors.alertText;
        label = 'Expired';
        break;
      case 'cancelled':
        bg = AppColors.neutralBg;
        text = AppColors.neutralText;
        label = 'Cancelled';
        break;
      default:
        bg = AppColors.neutralBg;
        text = AppColors.neutralText;
    }

    return Container(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(12),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Text(
        label,
        style: TextStyle(color: text, fontSize: 11, fontWeight: FontWeight.bold),
      ),
    );
  }
}
