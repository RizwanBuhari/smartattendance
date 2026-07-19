import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';

class InsightsTab extends StatefulWidget {
  const InsightsTab({
    super.key,
    required this.attendance,
    required this.locations,
    required this.selectedDate,
    this.loading = false,
  });

  final List<Map<String, dynamic>> attendance;
  final List<Map<String, dynamic>> locations;
  final DateTime selectedDate;
  final bool loading;

  @override
  State<InsightsTab> createState() => _InsightsTabState();
}

class _InsightsTabState extends State<InsightsTab>
    with AutomaticKeepAliveClientMixin {
  String _selectedPeriod = 'This Month'; // 'This Month', 'This Week'
  String _selectedLocation = 'All Locations';
  String _selectedStatus = 'All Statuses';

  @override
  bool get wantKeepAlive => true; // Preserve active state on tab changes

  List<Map<String, dynamic>> _getFilteredAttendance() {
    final filteredByPeriod =
        widget.attendance.where((record) {
          final checkInStr = record['checkInUtc'] as String?;
          if (checkInStr == null) return false;
          final date = DateTime.parse(checkInStr).toLocal();

          if (_selectedPeriod == 'This Month') {
            return date.year == widget.selectedDate.year &&
                date.month == widget.selectedDate.month;
          } else if (_selectedPeriod == 'This Week') {
            final now = DateTime.now().toLocal();
            final startOfWeek = now.subtract(Duration(days: now.weekday - 1));
            final endOfWeek = startOfWeek.add(
              const Duration(days: 6, hours: 23, minutes: 59, seconds: 59),
            );
            return date.isAfter(startOfWeek) && date.isBefore(endOfWeek);
          }
          return true;
        }).toList();

    return filteredByPeriod.where((r) {
      // Filter by location
      if (_selectedLocation != 'All Locations') {
        final locName = r['locationName'] as String? ?? '';
        if (locName != _selectedLocation) return false;
      }

      // Filter by status
      if (_selectedStatus != 'All Statuses') {
        final status = r['status'] as String? ?? '';
        final flagged =
            r['flaggedOutside'] == true || r['checkoutFlagged'] == true;
        final checkOutStr = r['checkOutUtc'] as String?;

        if (_selectedStatus == 'Flagged' && !flagged) return false;
        if (_selectedStatus == 'Completed' &&
            (flagged || status != 'checked_out' || checkOutStr == null))
          return false;
        if (_selectedStatus == 'Late') {
          final inStr = r['checkInUtc'] as String?;
          if (inStr == null) return false;
          final inDate = DateTime.parse(inStr).toLocal();
          final isLate =
              inDate.hour > 9 || (inDate.hour == 9 && inDate.minute > 15);
          if (!isLate) return false;
        }
      }
      return true;
    }).toList();
  }

  // Computes punctuality and average check-in metrics
  Map<String, dynamic> _calculateMetrics(List<Map<String, dynamic>> records) {
    if (records.isEmpty) {
      return {
        'present': 0,
        'worked': '0h 00m',
        'avgCheckIn': '--:--',
        'punctuality': '0%',
        'donutSplit': {'completed': 0, 'late': 0, 'missing': 0, 'flagged': 0},
      };
    }

    final presentDays =
        records
            .map((r) {
              final str = r['checkInUtc'] as String?;
              if (str == null) return null;
              final d = DateTime.parse(str).toLocal();
              return DateTime(d.year, d.month, d.day);
            })
            .whereType<DateTime>()
            .toSet()
            .length;

    int totalMinutes = 0;
    int lateDays = 0;
    int flaggedDays = 0;
    int missingCheckouts = 0;
    int completedShifts = 0;
    int checkInMinutesSum = 0;
    int checkInCount = 0;

    for (final r in records) {
      final inStr = r['checkInUtc'] as String?;
      final outStr = r['checkOutUtc'] as String?;
      final flagged =
          r['flaggedOutside'] == true || r['checkoutFlagged'] == true;
      final status = r['status'] as String? ?? 'pending';

      if (inStr != null) {
        final inDate = DateTime.parse(inStr).toLocal();
        checkInMinutesSum += inDate.hour * 60 + inDate.minute;
        checkInCount++;

        // Shift starts 9:00 AM. 15 mins grace period
        if (inDate.hour > 9 || (inDate.hour == 9 && inDate.minute > 15)) {
          lateDays++;
        }
      }

      if (flagged) {
        flaggedDays++;
      } else if (status == 'checked_in') {
        // in progress
      } else if (status == 'checked_out') {
        if (outStr == null) {
          missingCheckouts++;
        } else {
          completedShifts++;
        }
      }

      if (inStr != null && outStr != null) {
        final inDate = DateTime.parse(inStr);
        final outDate = DateTime.parse(outStr);
        totalMinutes += outDate.difference(inDate).inMinutes;
      }
    }

    final hrs = totalMinutes ~/ 60;
    final mins = totalMinutes % 60;

    // Average check-in time calculation
    String avgCheckInStr = '--:--';
    if (checkInCount > 0) {
      final avgMinutes = checkInMinutesSum ~/ checkInCount;
      final avgHour = avgMinutes ~/ 60;
      final avgMins = avgMinutes % 60;
      final ampm = avgHour >= 12 ? 'PM' : 'AM';
      final formattedHour =
          avgHour > 12 ? avgHour - 12 : (avgHour == 0 ? 12 : avgHour);
      avgCheckInStr =
          '${formattedHour.toString().padLeft(2, '0')}:${avgMins.toString().padLeft(2, '0')} $ampm';
    }

    // Punctuality: (Present Days - Late Days) / Present Days
    final punctualityRate =
        presentDays > 0
            ? '${((presentDays - lateDays) / presentDays * 100).round()}%'
            : '0%';

    return {
      'present': presentDays,
      'worked': '${hrs}h ${mins}m',
      'avgCheckIn': avgCheckInStr,
      'punctuality': punctualityRate,
      'donutSplit': {
        'completed': completedShifts,
        'late': lateDays,
        'missing': missingCheckouts,
        'flagged': flaggedDays,
      },
    };
  }

  // Prepares the 7-day weekly worked hours dataset
  List<double> _getWeeklyWorkedHours(List<Map<String, dynamic>> records) {
    final now = DateTime.now().toLocal();
    final startOfWeek = now.subtract(Duration(days: now.weekday - 1));
    final dailyHours = List<double>.filled(7, 0.0);

    for (final r in records) {
      final inStr = r['checkInUtc'] as String?;
      final outStr = r['checkOutUtc'] as String?;
      if (inStr == null || outStr == null) continue;

      final inDate = DateTime.parse(inStr).toLocal();
      if (inDate.isAfter(startOfWeek)) {
        final dayIndex = inDate.weekday - 1; // 0 for Mon, 6 for Sun
        if (dayIndex >= 0 && dayIndex < 7) {
          final dur = DateTime.parse(outStr).difference(DateTime.parse(inStr));
          dailyHours[dayIndex] += dur.inMinutes / 60.0;
        }
      }
    }
    return dailyHours;
  }

  // Prepares check-in times trend points
  List<FlSpot> _getCheckInTrendSpots(List<Map<String, dynamic>> records) {
    // Collect last 5 completed check-ins sorted chronologically
    final spots = <FlSpot>[];
    final recent =
        records.where((r) => r['checkInUtc'] != null).take(5).toList();

    recent.sort((a, b) {
      final ta = a['checkInUtc'] as String;
      final tb = b['checkInUtc'] as String;
      return ta.compareTo(tb);
    });

    for (int i = 0; i < recent.length; i++) {
      final inDate =
          DateTime.parse(recent[i]['checkInUtc'] as String).toLocal();
      // Minutes from midnight
      final minutes = inDate.hour * 60 + inDate.minute;
      spots.add(FlSpot(i.toDouble(), minutes.toDouble()));
    }
    return spots;
  }

  @override
  Widget build(BuildContext context) {
    super.build(context); // keep alive

    if (widget.loading) {
      return const Center(child: CircularProgressIndicator());
    }

    final records = _getFilteredAttendance();
    final metrics = _calculateMetrics(records);
    final weeklyWorked = _getWeeklyWorkedHours(records);
    final trendSpots = _getCheckInTrendSpots(records);

    final donutSplit = metrics['donutSplit'] as Map<String, int>;
    final totalDonutItems = donutSplit.values.fold(0, (sum, val) => sum + val);

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      children: [
        // Dropdown Filter Row
        Row(
          children: [
            Expanded(
              child: _buildFilterDropdown(
                'Period',
                _selectedPeriod,
                ['This Month', 'This Week'],
                (val) {
                  if (val != null) setState(() => _selectedPeriod = val);
                },
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _buildFilterDropdown(
                'Location',
                _selectedLocation,
                [
                  'All Locations',
                  ...widget.locations.map((l) => l['name'] as String),
                ],
                (val) {
                  if (val != null) setState(() => _selectedLocation = val);
                },
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _buildFilterDropdown(
                'Status',
                _selectedStatus,
                ['All Statuses', 'Completed', 'Late', 'Flagged'],
                (val) {
                  if (val != null) setState(() => _selectedStatus = val);
                },
              ),
            ),
          ],
        ),
        const SizedBox(height: 24),

        // KPI Summary Cards
        Row(
          children: [
            _buildKpiCard(
              bgColor: AppColors.okBg,
              iconColor: AppColors.okText,
              icon: Icons.calendar_today_rounded,
              value: metrics['present'].toString(),
              label: 'Present Days',
            ),
            const SizedBox(width: 12),
            _buildKpiCard(
              bgColor: Colors.blue.withValues(alpha: 0.1),
              iconColor: Colors.blue,
              icon: Icons.access_time_rounded,
              value: metrics['worked'].toString(),
              label: 'Total Worked Hours',
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            _buildKpiCard(
              bgColor: AppColors.neutralBg,
              iconColor: AppColors.brandRed,
              icon: Icons.login_rounded,
              value: metrics['avgCheckIn'].toString(),
              label: 'Avg. Check-in Time',
            ),
            const SizedBox(width: 12),
            _buildKpiCard(
              bgColor: AppColors.lateBg,
              iconColor: AppColors.lateText,
              icon: Icons.verified_rounded,
              value: metrics['punctuality'].toString(),
              label: 'Punctuality Rate',
            ),
          ],
        ),
        const SizedBox(height: 24),

        // Weekly Worked Hours (Bar Chart)
        _buildSectionCard(
          title: 'Worked Hours (Weekly)',
          subtitle: 'Hours',
          height: 240,
          chart: BarChart(
            BarChartData(
              alignment: BarChartAlignment.spaceAround,
              maxY: 12,
              barTouchData: BarTouchData(
                touchTooltipData: BarTouchTooltipData(
                  getTooltipColor: (_) => AppColors.ink,
                  getTooltipItem: (group, groupIndex, rod, rodIndex) {
                    final days = [
                      'Mon',
                      'Tue',
                      'Wed',
                      'Thu',
                      'Fri',
                      'Sat',
                      'Sun',
                    ];
                    final hrs = rod.toY;
                    final h = hrs.toInt();
                    final m = ((hrs - h) * 60).round();
                    return BarTooltipItem(
                      '${days[group.x.toInt()]}\nWorked: ${h}h ${m}m',
                      const TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                      ),
                    );
                  },
                ),
              ),
              titlesData: FlTitlesData(
                show: true,
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    getTitlesWidget: (val, meta) {
                      final days = [
                        'Mon',
                        'Tue',
                        'Wed',
                        'Thu',
                        'Fri',
                        'Sat',
                        'Sun',
                      ];
                      return SideTitleWidget(
                        meta: meta,
                        child: Text(
                          days[val.toInt()],
                          style: const TextStyle(
                            fontSize: 10,
                            color: AppColors.inkSoft,
                          ),
                        ),
                      );
                    },
                  ),
                ),
                leftTitles: const AxisTitles(
                  sideTitles: SideTitles(showTitles: true, reservedSize: 28),
                ),
                topTitles: const AxisTitles(
                  sideTitles: SideTitles(showTitles: false),
                ),
                rightTitles: const AxisTitles(
                  sideTitles: SideTitles(showTitles: false),
                ),
              ),
              borderData: FlBorderData(show: false),
              gridData: const FlGridData(show: true, drawVerticalLine: false),
              barGroups: List.generate(
                7,
                (i) => BarChartGroupData(
                  x: i,
                  barRods: [
                    BarChartRodData(
                      toY: weeklyWorked[i],
                      color: AppColors.brandRed,
                      width: 14,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),

        // Check-in Time Trend (Line Chart)
        _buildSectionCard(
          title: 'Check-in Time Trend',
          subtitle: 'Check-in Minutes',
          height: 240,
          chart: LineChart(
            LineChartData(
              lineTouchData: LineTouchData(
                touchTooltipData: LineTouchTooltipData(
                  getTooltipColor: (_) => AppColors.ink,
                  getTooltipItems: (touchedSpots) {
                    return touchedSpots.map((spot) {
                      final minutes = spot.y.toInt();
                      final h = minutes ~/ 60;
                      final m = minutes % 60;
                      final ampm = h >= 12 ? 'PM' : 'AM';
                      final hour = h > 12 ? h - 12 : (h == 0 ? 12 : h);
                      return LineTooltipItem(
                        'Check-in\n${hour.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')} $ampm',
                        const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      );
                    }).toList();
                  },
                ),
              ),
              gridData: const FlGridData(show: true, drawVerticalLine: false),
              titlesData: FlTitlesData(
                show: true,
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 52,
                    getTitlesWidget: (val, meta) {
                      final min = val.toInt();
                      final h = min ~/ 60;
                      final m = min % 60;
                      final ampm = h >= 12 ? 'PM' : 'AM';
                      final hour = h > 12 ? h - 12 : (h == 0 ? 12 : h);
                      return SideTitleWidget(
                        meta: meta,
                        child: Text(
                          '${hour.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')} $ampm',
                          style: const TextStyle(
                            fontSize: 9,
                            color: AppColors.inkSoft,
                          ),
                        ),
                      );
                    },
                  ),
                ),
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    getTitlesWidget: (val, meta) {
                      return SideTitleWidget(
                        meta: meta,
                        child: Text(
                          'Day ${val.toInt() + 1}',
                          style: const TextStyle(
                            fontSize: 10,
                            color: AppColors.inkSoft,
                          ),
                        ),
                      );
                    },
                  ),
                ),
                rightTitles: const AxisTitles(
                  sideTitles: SideTitles(showTitles: false),
                ),
                topTitles: const AxisTitles(
                  sideTitles: SideTitles(showTitles: false),
                ),
              ),
              borderData: FlBorderData(show: false),
              lineBarsData: [
                LineChartBarData(
                  spots:
                      trendSpots.isEmpty ? const [FlSpot(0, 540)] : trendSpots,
                  isCurved: true,
                  color: AppColors.brandRed,
                  barWidth: 3,
                  dotData: const FlDotData(show: true),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),

        // Attendance Status Summary (Donut Chart)
        _buildSectionCard(
          title: 'Attendance Summary',
          subtitle: 'Status splits',
          height: 320,
          chart: Row(
            children: [
              Expanded(
                flex: 4,
                child: SizedBox(
                  height: 160,
                  child: PieChart(
                    PieChartData(
                      sectionsSpace: 4,
                      centerSpaceRadius: 44,
                      sections: [
                        PieChartSectionData(
                          color: AppColors.okText,
                          value: donutSplit['completed']!.toDouble(),
                          title: '',
                          radius: 18,
                        ),
                        PieChartSectionData(
                          color: AppColors.lateText,
                          value: donutSplit['late']!.toDouble(),
                          title: '',
                          radius: 18,
                        ),
                        PieChartSectionData(
                          color: AppColors.neutralText,
                          value: donutSplit['missing']!.toDouble(),
                          title: '',
                          radius: 18,
                        ),
                        PieChartSectionData(
                          color: AppColors.alertText,
                          value: donutSplit['flagged']!.toDouble(),
                          title: '',
                          radius: 18,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              Expanded(
                flex: 6,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _buildDonutLabel(
                      'Completed',
                      donutSplit['completed']!,
                      totalDonutItems,
                      AppColors.okText,
                    ),
                    const SizedBox(height: 6),
                    _buildDonutLabel(
                      'Late',
                      donutSplit['late']!,
                      totalDonutItems,
                      AppColors.lateText,
                    ),
                    const SizedBox(height: 6),
                    _buildDonutLabel(
                      'Missing checkout',
                      donutSplit['missing']!,
                      totalDonutItems,
                      AppColors.neutralText,
                    ),
                    const SizedBox(height: 6),
                    _buildDonutLabel(
                      'Flagged',
                      donutSplit['flagged']!,
                      totalDonutItems,
                      AppColors.alertText,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 100),
      ],
    );
  }

  Widget _buildFilterDropdown(
    String label,
    String value,
    List<String> items,
    ValueChanged<String?> onChanged,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.line),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          isExpanded: true,
          value: items.contains(value) ? value : items.first,
          onChanged: onChanged,
          icon: const Icon(
            Icons.keyboard_arrow_down_rounded,
            color: AppColors.inkSoft,
            size: 18,
          ),
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.bold,
            color: AppColors.ink,
          ),
          items:
              items.map((item) {
                return DropdownMenuItem<String>(
                  value: item,
                  child: Text(
                    item,
                    overflow: TextOverflow.ellipsis,
                    maxLines: 1,
                  ),
                );
              }).toList(),
        ),
      ),
    );
  }

  Widget _buildKpiCard({
    required Color bgColor,
    required Color iconColor,
    required IconData icon,
    required String value,
    required String label,
  }) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
        decoration: BoxDecoration(
          color: AppColors.panel,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.line.withValues(alpha: 0.5)),
          boxShadow: const [
            BoxShadow(
              color: Color(0x06000000),
              blurRadius: 12,
              offset: Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: bgColor, shape: BoxShape.circle),
              child: Icon(icon, color: iconColor, size: 18),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    value,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 10,
                      color: AppColors.inkSoft,
                      height: 1.2,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionCard({
    required String title,
    required String subtitle,
    required double height,
    required Widget chart,
  }) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.panel,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.line.withValues(alpha: 0.5)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A000000),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.ink,
                ),
              ),
              Text(
                subtitle,
                style: const TextStyle(fontSize: 11, color: AppColors.inkSoft),
              ),
            ],
          ),
          const SizedBox(height: 20),
          SizedBox(height: height - 60, child: chart),
        ],
      ),
    );
  }

  Widget _buildDonutLabel(String label, int value, int total, Color color) {
    final pct = total > 0 ? (value / total * 100).round() : 0;
    return Row(
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            label,
            style: const TextStyle(fontSize: 12, color: AppColors.inkSoft),
          ),
        ),
        Text(
          '$value ($pct%)',
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.bold,
            color: AppColors.ink,
          ),
        ),
      ],
    );
  }
}
