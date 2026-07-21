import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';

class OffsiteSuccessScreen extends StatelessWidget {
  final Map<String, dynamic> attendanceRecord;
  const OffsiteSuccessScreen({super.key, required this.attendanceRecord});

  @override
  Widget build(BuildContext context) {
    final worksite = attendanceRecord['worksiteName'] ?? 'Assigned Worksite';
    final supervisor = attendanceRecord['approvedBy'] ?? 'Rahul Sharma';
    
    // Parse checkInUtc or fallback
    final checkInUtcStr = attendanceRecord['checkInUtc'] as String?;
    final timestamp = checkInUtcStr != null
        ? DateTime.parse(checkInUtcStr).toLocal().toString().substring(0, 16)
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
              const Text(
                'Checked In Successfully!',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'You have been checked in at the worksite.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.inkSoft, fontSize: 14),
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
                      'Checked In At',
                      timestamp,
                    ),
                    const Divider(color: AppColors.line, height: 24),
                    _buildDetailRow(
                      Icons.person_outline_rounded,
                      'Checked In By',
                      '$supervisor (Supervisor)',
                    ),
                    const Divider(color: AppColors.line, height: 24),
                    _buildDetailRow(
                      Icons.qr_code_2_rounded,
                      'Check-in Method',
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
