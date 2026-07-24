import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

class RecentActivitySection extends StatelessWidget {
  const RecentActivitySection({
    super.key,
    required this.history,
    required this.isLoading,
    required this.onViewAllTap,
    this.emptySubtitle = 'Your check-in and check-out history will appear here.',
  });

  final List<Map<String, dynamic>> history;
  final bool isLoading;
  final VoidCallback onViewAllTap;
  final String emptySubtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'Recent activity',
              style: TextStyle(
                color: AppColors.ink,
                fontSize: 17,
                fontWeight: FontWeight.bold,
              ),
            ),
            GestureDetector(
              onTap: onViewAllTap,
              child: const Text(
                'View all',
                style: TextStyle(
                  color: AppColors.brandRed,
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (isLoading)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(32),
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(20),
            ),
            child: const Center(
              child: CircularProgressIndicator(
                color: AppColors.brandRed,
                strokeWidth: 2,
              ),
            ),
          )
        else if (history.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 20),
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(20),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x0A000000),
                  blurRadius: 16,
                  offset: Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              children: [
                Container(
                  width: 56,
                  height: 56,
                  decoration: const BoxDecoration(
                    color: Color(0xFFFFF2F2),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.calendar_today_rounded,
                    color: AppColors.ink,
                    size: 26,
                  ),
                ),
                const SizedBox(height: 14),
                const Text(
                  'No activity yet',
                  style: TextStyle(
                    color: AppColors.ink,
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  emptySubtitle,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: AppColors.inkSoft,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          )
        else
          Container(
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(20),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x0A000000),
                  blurRadius: 16,
                  offset: Offset(0, 4),
                ),
              ],
            ),
            child: ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: history.length > 3 ? 3 : history.length,
              separatorBuilder: (_, __) => const Divider(height: 1, color: Color(0xFFEEEEEE)),
              itemBuilder: (context, index) {
                final item = history[index];
                final status = item['status'] as String? ?? '';
                final isCheckedIn = status == 'checked_in';
                final rawUtc = isCheckedIn ? item['checkInUtc'] : item['checkOutUtc'];
                String displayTime = 'Recent';
                if (rawUtc is String && rawUtc.isNotEmpty) {
                  final dt = DateTime.tryParse(rawUtc)?.toLocal();
                  if (dt != null) {
                    displayTime =
                        '${dt.hour > 12 ? dt.hour - 12 : (dt.hour == 0 ? 12 : dt.hour)}:${dt.minute.toString().padLeft(2, '0')} ${dt.hour >= 12 ? 'PM' : 'AM'}';
                  }
                } else if (rawUtc != null) {
                  try {
                    final dt = (rawUtc as dynamic).toDate().toLocal() as DateTime;
                    displayTime =
                        '${dt.hour > 12 ? dt.hour - 12 : (dt.hour == 0 ? 12 : dt.hour)}:${dt.minute.toString().padLeft(2, '0')} ${dt.hour >= 12 ? 'PM' : 'AM'}';
                  } catch (_) {}
                }

                return ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  leading: CircleAvatar(
                    backgroundColor: isCheckedIn ? const Color(0xFFE8F5E9) : const Color(0xFFFFF2F2),
                    child: Icon(
                      isCheckedIn ? Icons.login_rounded : Icons.logout_rounded,
                      color: isCheckedIn ? const Color(0xFF2E7D32) : AppColors.brandRed,
                      size: 20,
                    ),
                  ),
                  title: Text(
                    isCheckedIn ? 'Checked In' : 'Checked Out',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                  subtitle: Text(
                    item['worksiteName'] as String? ?? 'Assigned Location',
                    style: const TextStyle(fontSize: 12, color: AppColors.inkSoft),
                  ),
                  trailing: Text(
                    displayTime,
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.ink),
                  ),
                );
              },
            ),
          ),
      ],
    );
  }
}
