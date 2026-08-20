import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/date_helpers.dart';

/// Screen 11 — Shown to the supervisor after the employee scans
/// the QR and the backend marks the request as `completed`.
///
/// Displays a confirmation with the employee name, worksite, and
/// check-in timestamp.
class CheckinCompletedScreen extends StatelessWidget {
  final Map<String, dynamic> requestData;
  const CheckinCompletedScreen({super.key, required this.requestData});

  @override
  Widget build(BuildContext context) {
    final empName = requestData['employeeName'] ?? 'Employee';
    final worksite = requestData['worksiteName'] ?? 'Worksite';
    final displayTime = DateHelpers.formatDisplay(
      requestData['completedAt'],
      fallback: DateTime.now().toLocal().toString().substring(0, 16),
    );

    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),

              // ── Success animation ──
              Center(
                child: TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0.0, end: 1.0),
                  duration: const Duration(milliseconds: 600),
                  curve: Curves.elasticOut,
<<<<<<< HEAD
                  builder: (_, value, child) => Transform.scale(
                    scale: value,
                    child: child,
                  ),
=======
                  builder:
                      (_, value, child) =>
                          Transform.scale(scale: value, child: child),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                  child: Container(
                    width: 100,
                    height: 100,
                    decoration: const BoxDecoration(
                      color: AppColors.okBg,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.check_rounded,
                      color: AppColors.okText,
                      size: 56,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Check-in Completed!',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                '$empName has been checked in successfully.',
                textAlign: TextAlign.center,
<<<<<<< HEAD
                style: const TextStyle(
                  color: AppColors.inkSoft,
                  fontSize: 14,
                ),
=======
                style: const TextStyle(color: AppColors.inkSoft, fontSize: 14),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
              ),
              const SizedBox(height: 32),

              // ── Details card ──
              Container(
                decoration: BoxDecoration(
                  color: AppColors.panel,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.line),
                ),
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    _row(Icons.person_outline_rounded, 'Employee', empName),
                    const Divider(color: AppColors.line, height: 24),
                    _row(Icons.location_on_outlined, 'Worksite', worksite),
                    const Divider(color: AppColors.line, height: 24),
<<<<<<< HEAD
                    _row(Icons.access_time_rounded, 'Checked In At', displayTime),
=======
                    _row(
                      Icons.access_time_rounded,
                      'Checked In At',
                      displayTime,
                    ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                    const Divider(color: AppColors.line, height: 24),
                    _row(Icons.qr_code_2_rounded, 'Method', 'Supervisor QR'),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // ── Attendance recorded badge ──
              Container(
                decoration: BoxDecoration(
                  color: AppColors.okBg,
                  borderRadius: BorderRadius.circular(12),
                ),
                padding: const EdgeInsets.all(12),
                child: const Row(
                  children: [
<<<<<<< HEAD
                    Icon(Icons.verified_rounded, color: AppColors.okText, size: 20),
=======
                    Icon(
                      Icons.verified_rounded,
                      color: AppColors.okText,
                      size: 20,
                    ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Attendance recorded and visible on the dashboard.',
                        style: TextStyle(
                          color: AppColors.okText,
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              const Spacer(),

              // ── Done button ──
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
                  Navigator.of(context).popUntil((route) => route.isFirst);
                },
                child: const Text(
                  'Done',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _row(IconData icon, String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: AppColors.inkSoft, size: 20),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(color: AppColors.inkSoft, fontSize: 11),
              ),
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
