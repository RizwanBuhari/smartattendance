import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/services/offsite_request_service.dart';
import '../../core/theme/app_colors.dart';
import 'checkin_completed_screen.dart';

/// Screen 10 — Supervisor shows this QR to the employee.
class ShowQrCodeScreen extends StatefulWidget {
  final String requestId;
  const ShowQrCodeScreen({super.key, required this.requestId});

  @override
  State<ShowQrCodeScreen> createState() => _ShowQrCodeScreenState();
}

class _ShowQrCodeScreenState extends State<ShowQrCodeScreen> {
  bool _loading = true;
  bool _submitting = false;
  bool _generatingQr = false;
  Map<String, dynamic>? _requestData;
  StreamSubscription<DocumentSnapshot>? _docSub;

  Timer? _countdownTimer;
  int _secondsRemaining = 60;
  bool _isExpired = false;

  String? _qrPayload;

  @override
  void initState() {
    super.initState();
    _listenToRequest();
  }

  @override
  void dispose() {
    _docSub?.cancel();
    _countdownTimer?.cancel();
    super.dispose();
  }

  void _listenToRequest() {
    _docSub = FirebaseFirestore.instance
        .collection('offsite_requests')
        .doc(widget.requestId)
        .snapshots()
        .listen((snap) {
      if (!snap.exists || !mounted) return;
      final data = snap.data()!;
      final status = data['status'] as String? ?? '';

      if (status == 'completed') {
        _countdownTimer?.cancel();
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => CheckinCompletedScreen(requestData: data),
          ),
        );
        return;
      }

      if (status == 'qr_scanned') {
        _countdownTimer?.cancel();
      }

      setState(() {
        _requestData = data;
        _loading = false;
      });

      final payload = data['qrPayload'] as String? ?? data['tokenHash'] as String?;
      final rawExpires = data['qrExpiresAt'] ?? data['expiresAt'];
      String? expiresAtStr;
      if (rawExpires is String) {
        expiresAtStr = rawExpires;
      } else if (rawExpires is Timestamp) {
        expiresAtStr = rawExpires.toDate().toIso8601String();
      }

      if (status == 'approved_waiting_qr' && payload == null && !_generatingQr) {
        _generatingQr = true;
        OffsiteRequestService.generateQr(widget.requestId).catchError((_) {});
      }

      if (payload != null && payload != _qrPayload) {
        _qrPayload = payload;
        _startCountdown(expiresAtStr);
      }

      if (status == 'qr_expired' && !_isExpired) {
        _countdownTimer?.cancel();
        setState(() {
          _isExpired = true;
          _secondsRemaining = 0;
        });
      }
    });
  }

  void _startCountdown(String? expiresAtStr) {
    _countdownTimer?.cancel();

    if (expiresAtStr != null) {
      final expiresAt = DateTime.parse(expiresAtStr).toUtc();
      final now = DateTime.now().toUtc();
      final diff = expiresAt.difference(now).inSeconds;
      _secondsRemaining = diff > 0 ? diff : 0;
    } else {
      _secondsRemaining = 60;
    }

    setState(() {
      _isExpired = _secondsRemaining <= 0;
    });

    if (_isExpired) return;

    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() {
        _secondsRemaining--;
        if (_secondsRemaining <= 0) {
          _secondsRemaining = 0;
          _isExpired = true;
          timer.cancel();
        }
      });
    });
  }

  Future<void> _regenerateQr() async {
    setState(() => _submitting = true);
    try {
      await OffsiteRequestService.regenerateQr(widget.requestId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('New QR code generated successfully.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to regenerate: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _rejectRequest() async {
    final reasonController = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reject Request'),
        content: TextField(
          controller: reasonController,
          decoration: const InputDecoration(
            hintText: 'Enter reason for rejection...',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.brandRed),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Reject'),
          ),
        ],
      ),
    );

    if (ok == true && mounted) {
      setState(() => _submitting = true);
      try {
        await OffsiteRequestService.rejectRequest(
          widget.requestId,
          reasonController.text.trim(),
        );
        if (mounted) Navigator.of(context).pop();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed to reject: $e')),
          );
        }
      } finally {
        if (mounted) setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    final empName = _requestData?['employeeName'] ?? 'Employee';
    final worksite = _requestData?['worksiteName'] ?? 'Offsite Worksite';
    final requestType = _requestData?['requestType'] as String? ?? 'check_in';
    final isCheckout = requestType == 'check_out';

    return Scaffold(
      backgroundColor: AppColors.white,
      appBar: AppBar(
        title: Text(isCheckout ? 'Checkout QR Code' : 'Check-in QR Code'),
        backgroundColor: AppColors.white,
        elevation: 0,
        iconTheme: const IconThemeData(color: AppColors.ink),
        titleTextStyle: const TextStyle(
          color: AppColors.ink,
          fontSize: 18,
          fontWeight: FontWeight.bold,
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                decoration: BoxDecoration(
                  color: isCheckout ? const Color(0xFFFFF2F2) : const Color(0xFFE8F5E9),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  isCheckout ? 'CHECK-OUT REQUEST QR' : 'CHECK-IN REQUEST QR',
                  style: TextStyle(
                    color: isCheckout ? AppColors.brandRed : Colors.green[800],
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'Show this QR code to $empName',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Worksite: $worksite',
                style: const TextStyle(fontSize: 14, color: AppColors.inkSoft),
              ),
              const SizedBox(height: 24),
              Center(
                child: Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: AppColors.white,
                    borderRadius: BorderRadius.circular(20),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.08),
                        blurRadius: 16,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: Column(
                    children: [
                      if (_qrPayload != null && !_isExpired)
                        QrImageView(
                          data: _qrPayload!,
                          version: QrVersions.auto,
                          size: 220.0,
                        )
                      else if (_isExpired)
                        Container(
                          width: 220,
                          height: 220,
                          color: Colors.grey[200],
                          child: const Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.timer_off_rounded, size: 48, color: Colors.grey),
                                SizedBox(height: 8),
                                Text(
                                  'QR Expired',
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    color: Colors.grey,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        )
                      else
                        const SizedBox(
                          width: 220,
                          height: 220,
                          child: Center(child: CircularProgressIndicator()),
                        ),
                      const SizedBox(height: 16),
                      Text(
                        _isExpired
                            ? 'This QR code has expired.'
                            : 'Expires in: ${_secondsRemaining}s',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: _isExpired ? AppColors.brandRed : AppColors.ink,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 32),
              if (_submitting)
                const CircularProgressIndicator()
              else Column(
                children: [
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _regenerateQr,
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('Regenerate QR Code'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.brandRed,
                        foregroundColor: AppColors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: _rejectRequest,
                      icon: const Icon(Icons.close_rounded, color: AppColors.brandRed),
                      label: const Text('Reject Request', style: TextStyle(color: AppColors.brandRed)),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: AppColors.brandRed),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
