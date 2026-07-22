import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/services/offsite_request_service.dart';
import '../../core/theme/app_colors.dart';
import 'checkin_completed_screen.dart';

/// Screen 10 — Supervisor shows this QR to the employee.
///
/// The QR payload comes from the `offsite_requests` document's
/// `qrPayload` field, written by the backend when the supervisor
/// taps Accept (or Regenerate).  A 60-second countdown ticks from
/// `expiresAt`.  When the countdown hits zero the screen shows two
/// options:
///   • Regenerate QR — calls the backend (which invalidates the old
///     token via OffsiteQrTokenService and stamps a new one).
///   • Reject Request — closes the request with a reason dialog.
///
/// While the QR is live, the screen also watches for the request
/// status to flip to `completed` (the employee scanned successfully),
/// at which point it navigates to [CheckinCompletedScreen].
class ShowQrCodeScreen extends StatefulWidget {
  final String requestId;
  const ShowQrCodeScreen({super.key, required this.requestId});

  @override
  State<ShowQrCodeScreen> createState() => _ShowQrCodeScreenState();
}

class _ShowQrCodeScreenState extends State<ShowQrCodeScreen> {
  bool _loading = true;
  bool _submitting = false;
  Map<String, dynamic>? _requestData;
  StreamSubscription<DocumentSnapshot>? _docSub;

  // Countdown state
  Timer? _countdownTimer;
  int _secondsRemaining = 60;
  bool _isExpired = false;

  // The QR data string to render
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

      // If employee scanned and backend marked it completed → success screen
      if (status == 'completed') {
        _countdownTimer?.cancel();
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => CheckinCompletedScreen(requestData: data),
          ),
        );
        return;
      }

      // Backend is mid-verification: stop the countdown so it can't flip to
      // expired while the scan is still being processed.
      if (status == 'qr_scanned') {
        _countdownTimer?.cancel();
      }

      setState(() {
        _requestData = data;
        _loading = false;
      });

      // Extract QR payload and expiry
      final payload = data['qrPayload'] as String?;
      final expiresAtStr = data['expiresAt'] as String?;

      if (payload != null && payload != _qrPayload) {
        // New QR payload arrived (first time or after regeneration)
        _qrPayload = payload;
        _startCountdown(expiresAtStr);
      }

      // If backend already marked it expired, reflect that
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
      // The Firestore listener will pick up the new qrPayload and restart
      // the countdown automatically.
      if (mounted) {
        setState(() {
          _submitting = false;
          _isExpired = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _submitting = false);
        _showSnackbar(e.toString());
      }
    }
  }

  void _showRejectDialog() {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Reject Request'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'This will close the request and notify the employee.',
              style: TextStyle(fontSize: 13, color: AppColors.inkSoft),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              decoration: InputDecoration(
                hintText: 'Reason for rejection',
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
              _rejectRequest(controller.text.trim());
            },
            child: const Text(
              'Reject',
              style: TextStyle(color: AppColors.brandRed, fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _rejectRequest(String reason) async {
    if (reason.isEmpty) {
      _showSnackbar('Please provide a rejection reason.');
      return;
    }
    setState(() => _submitting = true);
    try {
      await OffsiteRequestService.rejectRequest(widget.requestId, reason);
      if (mounted) {
        _showSnackbar('Request rejected.');
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _submitting = false);
        _showSnackbar(e.toString());
      }
    }
  }

  void _showSnackbar(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: AppColors.brandRed),
    );
  }

  // ─── Build ────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        backgroundColor: AppColors.bg,
        body: Center(
          child: CircularProgressIndicator(color: AppColors.brandRed),
        ),
      );
    }

    final empName = _requestData?['employeeName'] ?? 'Employee';

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: const Text('QR Code'),
        centerTitle: true,
        backgroundColor: AppColors.white,
        foregroundColor: AppColors.ink,
        elevation: 0.5,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 8),
              Text(
                'Show this QR to $empName',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'The employee must scan this code to complete check-in.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: AppColors.inkSoft),
              ),
              const SizedBox(height: 24),

              // ── QR Card ──
              Center(
                child: Container(
                  decoration: BoxDecoration(
                    color: AppColors.panel,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.line),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x0A000000),
                        blurRadius: 12,
                        offset: Offset(0, 4),
                      ),
                    ],
                  ),
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    children: [
                      if (_qrPayload != null && !_isExpired) ...[
                        QrImageView(
                          data: _qrPayload!,
                          version: QrVersions.auto,
                          size: 220,
                          eyeStyle: const QrEyeStyle(
                            eyeShape: QrEyeShape.square,
                            color: AppColors.ink,
                          ),
                          dataModuleStyle: const QrDataModuleStyle(
                            dataModuleShape: QrDataModuleShape.square,
                            color: AppColors.ink,
                          ),
                          gapless: true,
                        ),
                        const SizedBox(height: 16),
                      ] else if (_qrPayload == null) ...[
                        // OTP integration pending
                        Container(
                          width: 220,
                          height: 220,
                          decoration: BoxDecoration(
                            color: AppColors.bg,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppColors.line),
                          ),
                          child: const Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.qr_code_2_rounded, size: 56, color: AppColors.muted),
                                SizedBox(height: 12),
                                Text(
                                  'QR Integration Pending',
                                  style: TextStyle(
                                    color: AppColors.inkSoft,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                SizedBox(height: 4),
                                Padding(
                                  padding: EdgeInsets.symmetric(horizontal: 16),
                                  child: Text(
                                    'The secure OTP generator is not yet connected.',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(color: AppColors.muted, fontSize: 11),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                      ] else ...[
                        // Expired overlay on top of dimmed QR
                        Stack(
                          alignment: Alignment.center,
                          children: [
                            Opacity(
                              opacity: 0.15,
                              child: QrImageView(
                                data: _qrPayload!,
                                version: QrVersions.auto,
                                size: 220,
                              ),
                            ),
                            Container(
                              width: 220,
                              height: 220,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.85),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: const Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(Icons.timer_off_rounded, size: 40, color: AppColors.brandRed),
                                  SizedBox(height: 8),
                                  Text(
                                    'QR Expired',
                                    style: TextStyle(
                                      color: AppColors.brandRed,
                                      fontSize: 16,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                      ],

                      // ── Countdown timer ──
                      _buildCountdownWidget(),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 32),

              // ── Action buttons ──
              if (_isExpired) ...[
                // TWO BUTTONS: Regenerate QR  |  Reject Request
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.brandRed,
                    foregroundColor: AppColors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onPressed: _submitting ? null : _regenerateQr,
                  icon: _submitting
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            color: AppColors.white,
                            strokeWidth: 2,
                          ),
                        )
                      : const Icon(Icons.refresh_rounded),
                  label: Text(
                    _submitting ? 'Generating…' : 'Regenerate QR',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                  ),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.alertText,
                    side: const BorderSide(color: AppColors.brandRed),
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onPressed: _submitting ? null : _showRejectDialog,
                  icon: const Icon(Icons.close_rounded),
                  label: const Text(
                    'Reject Request',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                  ),
                ),
              ] else if (_requestData?['status'] == 'qr_scanned') ...[
                // Backend is mid-verification — nothing for the supervisor to do
                // but wait a moment for the completed screen to take over.
                const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.brandRed),
                    ),
                    SizedBox(width: 10),
                    Text(
                      'Verifying scan…',
                      style: TextStyle(color: AppColors.inkSoft, fontSize: 13, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ] else ...[
                // Info banner while QR is active (or integration is still pending)
                Container(
                  decoration: BoxDecoration(
                    color: _qrPayload == null ? AppColors.neutralBg : AppColors.okBg,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    children: [
                      Icon(
                        Icons.info_outline_rounded,
                        color: _qrPayload == null ? AppColors.neutralText : AppColors.okText,
                        size: 20,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          _qrPayload == null
                              ? 'You can reject this request while the QR integration is pending.'
                              : 'Keep this screen visible for the employee to scan.',
                          style: TextStyle(
                            color: _qrPayload == null ? AppColors.neutralText : AppColors.okText,
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                // Always reachable, even before expiry — a supervisor must never
                // be stuck on this screen with no way to close out the request
                // (e.g. the employee never shows up, or the QR is still pending
                // the external generator integration).
                TextButton.icon(
                  style: TextButton.styleFrom(foregroundColor: AppColors.alertText),
                  onPressed: _submitting ? null : _showRejectDialog,
                  icon: const Icon(Icons.close_rounded, size: 18),
                  label: const Text(
                    'Reject Request',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCountdownWidget() {
    final minutes = (_secondsRemaining ~/ 60).toString().padLeft(2, '0');
    final seconds = (_secondsRemaining % 60).toString().padLeft(2, '0');
    final fraction = _secondsRemaining / 60;

    final Color ringColor;
    final Color textColor;
    if (_isExpired) {
      ringColor = AppColors.brandRed;
      textColor = AppColors.brandRed;
    } else if (_secondsRemaining <= 15) {
      ringColor = AppColors.brandRed;
      textColor = AppColors.brandRed;
    } else if (_secondsRemaining <= 30) {
      ringColor = AppColors.lateText;
      textColor = AppColors.lateText;
    } else {
      ringColor = AppColors.okText;
      textColor = AppColors.okText;
    }

    return Column(
      children: [
        SizedBox(
          width: 64,
          height: 64,
          child: Stack(
            fit: StackFit.expand,
            children: [
              CircularProgressIndicator(
                value: _isExpired ? 0 : fraction,
                strokeWidth: 5,
                backgroundColor: AppColors.line,
                color: ringColor,
                strokeCap: StrokeCap.round,
              ),
              Center(
                child: Text(
                  _isExpired ? '00:00' : '$minutes:$seconds',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: textColor,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Text(
          _isExpired ? 'Code expired' : 'Time remaining',
          style: TextStyle(
            fontSize: 12,
            color: _isExpired ? AppColors.brandRed : AppColors.inkSoft,
            fontWeight: _isExpired ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ],
    );
  }
}
