import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';

class RecordsTab extends StatefulWidget {
  const RecordsTab({
    super.key,
    required this.attendance,
    required this.selectedDate,
    required this.onSelectDate,
    this.loading = false,
  });

  final List<Map<String, dynamic>> attendance;
  final DateTime selectedDate;
  final VoidCallback onSelectDate;
  final bool loading;

  @override
  State<RecordsTab> createState() => _RecordsTabState();
}

class _RecordsTabState extends State<RecordsTab>
    with AutomaticKeepAliveClientMixin {
  String _activeFilter = 'All'; // 'All', 'This Week', 'This Month', 'Flagged'

  @override
  bool get wantKeepAlive => true; // Preserve scroll/state on tab changes

  String _getMonthName(int month) {
    return switch (month) {
      1 => 'January',
      2 => 'February',
      3 => 'March',
      4 => 'April',
      5 => 'May',
      6 => 'June',
      7 => 'July',
      8 => 'August',
      9 => 'September',
      10 => 'October',
      11 => 'November',
      12 => 'December',
      _ => '',
    };
  }

  String _getDayName(int weekday) {
    return switch (weekday) {
      1 => 'Monday',
      2 => 'Tuesday',
      3 => 'Wednesday',
      4 => 'Thursday',
      5 => 'Friday',
      6 => 'Saturday',
      7 => 'Sunday',
      _ => '',
    };
  }

  // Filters the global attendance list by the selected month/year and the active filter chip
  List<Map<String, dynamic>> _getFilteredRecords() {
    final monthly =
        widget.attendance.where((record) {
          final checkInStr = record['checkInUtc'] as String?;
          if (checkInStr == null) return false;
          final date = DateTime.parse(checkInStr).toLocal();
          return date.year == widget.selectedDate.year &&
              date.month == widget.selectedDate.month;
        }).toList();

    if (_activeFilter == 'All') {
      return monthly;
    } else if (_activeFilter == 'This Month') {
      return monthly;
    } else if (_activeFilter == 'This Week') {
      final now = DateTime.now().toLocal();
      final startOfWeek = now.subtract(Duration(days: now.weekday - 1));
      final endOfWeek = startOfWeek.add(
        const Duration(days: 6, hours: 23, minutes: 59, seconds: 59),
      );

      return monthly.where((record) {
        final checkInStr = record['checkInUtc'] as String?;
        if (checkInStr == null) return false;
        final date = DateTime.parse(checkInStr).toLocal();
        return date.isAfter(startOfWeek) && date.isBefore(endOfWeek);
      }).toList();
    } else if (_activeFilter == 'Flagged') {
      return monthly.where((record) {
        final flagged =
            record['flaggedOutside'] == true ||
            record['checkoutFlagged'] == true;
        return flagged;
      }).toList();
    }
    return monthly;
  }

  // Calculate monthly stats from all records matching the selected month/year
  Map<String, dynamic> _calculateStats() {
    final monthly =
        widget.attendance.where((record) {
          final checkInStr = record['checkInUtc'] as String?;
          if (checkInStr == null) return false;
          final date = DateTime.parse(checkInStr).toLocal();
          return date.year == widget.selectedDate.year &&
              date.month == widget.selectedDate.month;
        }).toList();

    // Unique days where attendance exists
    final presentDays =
        monthly
            .map((r) {
              final str = r['checkInUtc'] as String?;
              if (str == null) return null;
              final d = DateTime.parse(str).toLocal();
              return DateTime(d.year, d.month, d.day);
            })
            .whereType<DateTime>()
            .toSet()
            .length;

    // Total worked duration
    int totalMinutes = 0;
    int lateDays = 0;
    int flaggedDays = 0;

    for (final r in monthly) {
      final inStr = r['checkInUtc'] as String?;
      final outStr = r['checkOutUtc'] as String?;

      if (inStr != null) {
        final inDate = DateTime.parse(inStr).toLocal();
        // Shift starts at 9:00 AM. 15 mins grace period -> late if after 9:15 AM
        if (inDate.hour > 9 || (inDate.hour == 9 && inDate.minute > 15)) {
          lateDays++;
        }
      }

      if (r['flaggedOutside'] == true || r['checkoutFlagged'] == true) {
        flaggedDays++;
      }

      if (inStr != null && outStr != null) {
        final inDate = DateTime.parse(inStr);
        final outDate = DateTime.parse(outStr);
        totalMinutes += outDate.difference(inDate).inMinutes;
      }
    }

    final hrs = totalMinutes ~/ 60;
    final mins = totalMinutes % 60;

    return {
      'present': presentDays,
      'worked': '${hrs}h ${mins}m',
      'late': lateDays,
      'flagged': flaggedDays,
    };
  }

  String _formatTime(String? utcIso) {
    if (utcIso == null) return '--:--';
    final local = DateTime.parse(utcIso).toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    final hour =
        local.hour > 12 ? local.hour - 12 : (local.hour == 0 ? 12 : local.hour);
    final ampm = local.hour >= 12 ? 'PM' : 'AM';
    return '${two(hour)}:${two(local.minute)} $ampm';
  }

  String _formatWorked(String? inStr, String? outStr) {
    if (inStr == null || outStr == null) return '--:--';
    final duration = DateTime.parse(outStr).difference(DateTime.parse(inStr));
    final hrs = duration.inMinutes ~/ 60;
    final mins = duration.inMinutes % 60;
    return '${hrs}h ${mins}m';
  }

  @override
  Widget build(BuildContext context) {
    super.build(context); // keep alive

    final stats = _calculateStats();
    final records = _getFilteredRecords();

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
            children: [
              // Month Selector Trigger
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  GestureDetector(
                    onTap: widget.onSelectDate,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 10,
                      ),
                      decoration: cardDecoration(radius: 12),
                      child: Row(
                        children: [
                          Text(
                            '${_getMonthName(widget.selectedDate.month)} ${widget.selectedDate.year}',
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              color: AppColors.ink,
                              fontSize: 15,
                            ),
                          ),
                          const SizedBox(width: 8),
                          const Icon(
                            Icons.keyboard_arrow_down_rounded,
                            color: AppColors.inkSoft,
                            size: 20,
                          ),
                        ],
                      ),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: cardDecoration(radius: 12),
                    child: const Icon(
                      Icons.calendar_month_outlined,
                      color: AppColors.brandRed,
                      size: 20,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // Monthly Summary Card
              Container(
                padding: const EdgeInsets.all(20),
                decoration: cardDecoration(radius: 22),
                child: Row(
                  children: [
                    _buildSummaryItem(
                      icon: Icons.calendar_today_rounded,
                      color: AppColors.okText,
                      bgColor: AppColors.okBg,
                      value: stats['present'].toString(),
                      label: 'Present Days',
                    ),
                    _buildSummaryItem(
                      icon: Icons.access_time_rounded,
                      color: Colors.blue,
                      bgColor: Colors.blue.withValues(alpha: 0.1),
                      value: stats['worked'].toString(),
                      label: 'Worked Hours',
                    ),
                    _buildSummaryItem(
                      icon: Icons.alarm_rounded,
                      color: AppColors.lateText,
                      bgColor: AppColors.lateBg,
                      value: stats['late'].toString(),
                      label: 'Late Days',
                    ),
                    _buildSummaryItem(
                      icon: Icons.flag_rounded,
                      color: AppColors.alertText,
                      bgColor: AppColors.alertBg,
                      value: stats['flagged'].toString(),
                      label: 'Flagged Days',
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // Filter Chips
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    _filterChip('All'),
                    const SizedBox(width: 8),
                    _filterChip('This Week'),
                    const SizedBox(width: 8),
                    _filterChip('This Month'),
                    const SizedBox(width: 8),
                    _filterChip('Flagged'),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // Records list
              if (widget.loading)
                _buildSkeleton()
              else if (records.isEmpty)
                _buildEmptyState()
              else
                ...records.map((record) => _buildRecordCard(record)),

              // Local Time Warning Indicator
              const SizedBox(height: 24),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.panel,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: AppColors.line.withValues(alpha: 0.5),
                  ),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.info_outline_rounded,
                      color: AppColors.inkSoft,
                      size: 20,
                    ),
                    const SizedBox(width: 12),
                    const Expanded(
                      child: Text(
                        'Displayed in your local time (GMT +04:00)\nAll attendance records are synced in UTC',
                        style: TextStyle(
                          color: AppColors.inkSoft,
                          fontSize: 12,
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 100),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSkeleton() {
    return Column(
      children: List.generate(
        3,
        (index) => Container(
          margin: const EdgeInsets.only(bottom: 12),
          height: 120,
          decoration: cardDecoration(radius: 20),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 48),
      decoration: cardDecoration(radius: 24),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              color: AppColors.brandRedSoft,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.calendar_month_outlined,
              color: AppColors.brandRed,
              size: 36,
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'No attendance records',
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
              fontSize: 16,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 6),
          const Text(
            'Attendance records for the selected period will appear here.',
            style: TextStyle(color: AppColors.inkSoft, fontSize: 14),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildSummaryItem({
    required IconData icon,
    required Color color,
    required Color bgColor,
    required String value,
    required String label,
  }) {
    return Expanded(
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: bgColor, shape: BoxShape.circle),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: color,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: const TextStyle(fontSize: 11, color: AppColors.inkSoft),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _filterChip(String filterName) {
    final isActive = _activeFilter == filterName;
    return GestureDetector(
      onTap: () => setState(() => _activeFilter = filterName),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: isActive ? AppColors.brandRed : AppColors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isActive ? AppColors.brandRed : AppColors.line,
          ),
        ),
        child: Text(
          filterName,
          style: TextStyle(
            color: isActive ? AppColors.white : AppColors.inkSoft,
            fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
            fontSize: 13,
          ),
        ),
      ),
    );
  }

  Widget _buildRecordCard(Map<String, dynamic> record) {
    final checkInStr = record['checkInUtc'] as String?;
    final checkOutStr = record['checkOutUtc'] as String?;

    final localDate =
        checkInStr != null
            ? DateTime.parse(checkInStr).toLocal()
            : DateTime.now();
    final dayStr = _getDayName(localDate.weekday);
    final dateStr = '${localDate.day} ${_getMonthName(localDate.month)}';

    final status = record['status'] as String? ?? 'pending';
    final flagged =
        record['flaggedOutside'] == true || record['checkoutFlagged'] == true;

    // Determine visual status label and color
    String statusLabel = 'Pending sync';
    Color statusColor = AppColors.inkSoft;
    Color statusBg = AppColors.neutralBg;

    if (flagged) {
      statusLabel = 'Flagged';
      statusColor = AppColors.alertText;
      statusBg = AppColors.alertBg;
    } else if (status == 'checked_in') {
      statusLabel = 'In progress';
      statusColor = Colors.blue;
      statusBg = Colors.blue.withValues(alpha: 0.1);
    } else if (status == 'checked_out') {
      if (checkOutStr == null) {
        statusLabel = 'Missing checkout';
        statusColor = AppColors.lateText;
        statusBg = AppColors.lateBg;
      } else {
        statusLabel = 'Completed';
        statusColor = AppColors.okText;
        statusBg = AppColors.okBg;
      }
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: cardDecoration(radius: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '$dayStr, $dateStr',
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  color: AppColors.ink,
                  fontSize: 15,
                ),
              ),
              // Status Pill
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: statusBg,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  statusLabel,
                  style: TextStyle(
                    color: statusColor,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Divider(height: 1, color: AppColors.line),
          const SizedBox(height: 12),
          Row(
            children: [
              _buildCardItem('Check in', _formatTime(checkInStr), Colors.green),
              _buildCardItem('Check out', _formatTime(checkOutStr), Colors.red),
              _buildCardItem(
                'Worked',
                _formatWorked(checkInStr, checkOutStr),
                AppColors.ink,
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              const Icon(
                Icons.location_on_outlined,
                color: AppColors.brandRed,
                size: 16,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  record['locationName'] as String? ?? 'Approved Location',
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.inkSoft,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildCardItem(String label, String value, Color color) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(fontSize: 11, color: AppColors.inkSoft),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  BoxDecoration cardDecoration({double radius = 16}) {
    return BoxDecoration(
      color: AppColors.panel,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: AppColors.line.withValues(alpha: 0.5)),
      boxShadow: const [
        BoxShadow(
          color: Color(0x0A000000),
          blurRadius: 16,
          offset: Offset(0, 4),
        ),
      ],
    );
  }
}
