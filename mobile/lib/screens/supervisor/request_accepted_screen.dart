import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import 'show_qr_code_screen.dart';

/// Shown right after a supervisor taps Accept on a request — a brief
/// confirmation before moving on to displaying the QR code.
class RequestAcceptedScreen extends StatelessWidget {
  final String requestId;
  final Map<String, dynamic> requestData;
  const RequestAcceptedScreen({
    super.key,
    required this.requestId,
    required this.requestData,
  });

  @override
  Widget build(BuildContext context) {
    final empName = requestData['employeeName'] ?? 'Employee';
    final worksite = requestData['worksiteName'] ?? 'Worksite';

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
                child: TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0.0, end: 1.0),
                  duration: const Duration(milliseconds: 500),
                  curve: Curves.elasticOut,
<<<<<<< HEAD
                  builder: (_, value, child) => Transform.scale(scale: value, child: child),
=======
                  builder:
                      (_, value, child) =>
                          Transform.scale(scale: value, child: child),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                  child: Container(
                    width: 96,
                    height: 96,
                    decoration: const BoxDecoration(
                      color: AppColors.okBg,
                      shape: BoxShape.circle,
                    ),
<<<<<<< HEAD
                    child: const Icon(Icons.check_rounded, color: AppColors.okText, size: 52),
=======
                    child: const Icon(
                      Icons.check_rounded,
                      color: AppColors.okText,
                      size: 52,
                    ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                  ),
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Request Accepted',
                textAlign: TextAlign.center,
<<<<<<< HEAD
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.ink),
=======
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  color: AppColors.ink,
                ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
              ),
              const SizedBox(height: 8),
              Text(
                '$empName has been notified. Show them the QR code to complete check-in at $worksite.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.inkSoft, fontSize: 14),
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
                    _row(Icons.person_outline_rounded, 'Employee', empName),
                    const Divider(color: AppColors.line, height: 24),
                    _row(Icons.location_on_outlined, 'Worksite', worksite),
                  ],
                ),
              ),
              const Spacer(),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.brandRed,
                  foregroundColor: AppColors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
<<<<<<< HEAD
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
=======
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
                ),
                onPressed: () {
                  Navigator.of(context).pushReplacement(
                    MaterialPageRoute(
                      builder: (_) => ShowQrCodeScreen(requestId: requestId),
                    ),
                  );
                },
                icon: const Icon(Icons.qr_code_2_rounded),
<<<<<<< HEAD
                label: const Text('Show QR Code', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
=======
                label: const Text(
                  'Show QR Code',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
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
<<<<<<< HEAD
              Text(label, style: const TextStyle(color: AppColors.inkSoft, fontSize: 11)),
              const SizedBox(height: 2),
              Text(
                value,
                style: const TextStyle(color: AppColors.ink, fontSize: 14, fontWeight: FontWeight.w600),
=======
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
>>>>>>> 6868a23656d20f8bc936e09d10905fed1d14bc0c
              ),
            ],
          ),
        ),
      ],
    );
  }
}
