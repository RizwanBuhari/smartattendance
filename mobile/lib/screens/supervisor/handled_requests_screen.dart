import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import 'request_details_screen.dart';

/// Read-only history of requests the supervisor has already acted on
/// (approved, rejected, expired, completed, or cancelled).
class HandledRequestsScreen extends StatelessWidget {
  final List<Map<String, dynamic>> requests;
  const HandledRequestsScreen({super.key, required this.requests});

  @override
  Widget build(BuildContext context) {
    if (requests.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.history_rounded, size: 48, color: AppColors.muted),
            SizedBox(height: 12),
            Text(
              'No request history.',
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
                        const SizedBox(height: 6),
                        _buildStatusBadge(req['status']),
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

  Widget _buildStatusBadge(String status) {
    Color bg;
    Color text;
    String label = status;

    switch (status) {
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
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      child: Text(
        label,
        style: TextStyle(color: text, fontSize: 10, fontWeight: FontWeight.bold),
      ),
    );
  }
}
