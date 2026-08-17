import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/date_helpers.dart';

class OffsiteSuccessScreen extends StatelessWidget {
  final Map<String, dynamic> attendanceRecord;
  const OffsiteSuccessScreen({super.key, required this.attendanceRecord});

  @override
  Widget build(BuildContext context) {
    final worksite = attendanceRecord['worksiteName'] ?? 'Assigned Worksite';
    final rawSupervisor =
        attendanceRecord['approvedBy'] ??
        attendanceRecord['supervisorName'] ??
        'Supervisor';
    final supervisor =
        rawSupervisor.toString().replaceAll(RegExp(r'\s*\([^)]*\)'), '').trim();

    final requestType = attendanceRecord['requestType'] ?? 'check_in';
    final isCheckout = requestType == 'check_out';

    final timeValue =
        isCheckout
            ? (attendanceRecord['checkOutUtc'] ??
                attendanceRecord['checkInUtc'])
            : attendanceRecord['checkInUtc'];

    final timestamp = DateHelpers.formatDisplay(
      timeValue,
      fallback: DateTime.now().toLocal().toString().substring(0, 16),
    );

    final titleText =
        isCheckout ? 'Checked Out Successfully!' : 'Checked In Successfully!';
    final subtitleText =
        isCheckout
            ? 'You have completed your offsite duty at the worksite.'
            : 'You have been checked in at the worksite.';
    final timeLabel = isCheckout ? 'Checked Out At' : 'Checked In At';
    final approvedLabel = isCheckout ? 'Checked Out By' : 'Checked In By';

    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              // Success checkmark icon in red/white circular frame
              Center(
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
              const SizedBox(height: 24),
              Text(
                titleText,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                subtitleText,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.inkSoft, fontSize: 14),
              ),
              const SizedBox(height: 32),
              // Audit details box
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
                      worksite,
                    ),
                    const Divider(color: AppColors.line, height: 24),
                    _buildDetailRow(
                      Icons.access_time_rounded,
                      timeLabel,
                      timestamp,
                    ),
                    const Divider(color: AppColors.line, height: 24),
                    _buildDetailRow(
                      Icons.person_outline_rounded,
                      approvedLabel,
                      supervisor,
                    ),
                    const Divider(color: AppColors.line, height: 24),
                    _buildDetailRow(
                      Icons.qr_code_2_rounded,
                      isCheckout ? 'Check-out Method' : 'Check-in Method',
                      'Supervisor QR',
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
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                onPressed: () {
                  // Navigate back to the home page container
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
