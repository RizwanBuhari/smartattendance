import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/theme/app_colors.dart';
import '../core/widgets/brand_logo.dart';
import 'history/insights_tab.dart';
import 'history/map_tab.dart';
import 'history/records_tab.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  int _activeTabIndex = 0;

  DateTime _selectedDate = DateTime.now();
  List<Map<String, dynamic>> _locations = [];
  bool _loadingLocations = true;

  final String? _employeeId = FirebaseAuth.instance.currentUser?.uid;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _tabController.addListener(_handleTabChange);
    _loadSavedTab();
    _loadLocations();
  }

  @override
  void dispose() {
    _tabController.removeListener(_handleTabChange);
    _tabController.dispose();
    super.dispose();
  }

  void _handleTabChange() {
    if (_tabController.indexIsChanging) return;
    setState(() {
      _activeTabIndex = _tabController.index;
    });
    _saveTab(_tabController.index);
  }

  Future<void> _loadSavedTab() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedIndex = prefs.getInt('historyActiveTab') ?? 0;
      if (savedIndex >= 0 && savedIndex < 3 && mounted) {
        _tabController.index = savedIndex;
        setState(() {
          _activeTabIndex = savedIndex;
        });
      }
    } catch (_) {}
  }

  Future<void> _saveTab(int index) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt('historyActiveTab', index);
    } catch (_) {}
  }

  Future<void> _loadLocations() async {
    try {
      final snapshot =
          await FirebaseFirestore.instance.collection('locations').get();
      if (mounted) {
        setState(() {
          _locations =
              snapshot.docs.map((d) => {...d.data(), 'id': d.id}).toList();
          _loadingLocations = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _loadingLocations = false);
      }
    }
  }

  String _getAppBarTitle() {
    return switch (_activeTabIndex) {
      0 => 'Attendance History',
      1 => 'Attendance Insights',
      2 => 'Location Activity',
      _ => 'History',
    };
  }

  void _selectMonthYear() async {
    final now = DateTime.now();
    final firstDate = DateTime(now.year - 3, 1);
    final lastDate = DateTime(now.year + 1, 12);

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return Container(
          decoration: const BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Select Period',
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              SizedBox(
                height: 220,
                child: ListView.separated(
                  itemCount: 12,
                  separatorBuilder:
                      (_, __) =>
                          const Divider(height: 1, color: AppColors.line),
                  itemBuilder: (context, index) {
                    final date = DateTime(now.year, now.month - index);
                    if (date.isBefore(firstDate) || date.isAfter(lastDate))
                      return const SizedBox();

                    final isSelected =
                        date.year == _selectedDate.year &&
                        date.month == _selectedDate.month;
                    final monthStr = _getMonthName(date.month);

                    return ListTile(
                      onTap: () {
                        setState(() {
                          _selectedDate = date;
                        });
                        Navigator.pop(context);
                      },
                      title: Text(
                        '$monthStr ${date.year}',
                        style: TextStyle(
                          color:
                              isSelected ? AppColors.brandRed : AppColors.ink,
                          fontWeight:
                              isSelected ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                      trailing:
                          isSelected
                              ? const Icon(
                                Icons.check_circle_rounded,
                                color: AppColors.brandRed,
                              )
                              : null,
                    );
                  },
                ),
              ),
              const SizedBox(height: 16),
            ],
          ),
        );
      },
    );
  }

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

  @override
  Widget build(BuildContext context) {
    if (_employeeId == null) {
      return const Scaffold(body: Center(child: Text('Please log in.')));
    }

    final attendanceQuery =
        FirebaseFirestore.instance
            .collection('attendance')
            .where('employeeId', isEqualTo: _employeeId)
            .snapshots();

    final pingsQuery =
        FirebaseFirestore.instance
            .collection('locationPings')
            .where('employeeId', isEqualTo: _employeeId)
            .snapshots();

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: true,
        title: Column(
          children: [
            Text(
              _getAppBarTitle(),
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
            ),
            const SizedBox(height: 4),
            const BrandLogo(width: 80),
          ],
        ),
      ),
      body: Column(
        children: [
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
            decoration: const BoxDecoration(
              border: Border(
                bottom: BorderSide(color: AppColors.line, width: 1.2),
              ),
            ),
            child: TabBar(
              controller: _tabController,
              indicatorColor: AppColors.brandRed,
              indicatorSize: TabBarIndicatorSize.tab,
              indicatorWeight: 2.2,
              labelColor: AppColors.brandRed,
              labelStyle: const TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 14,
              ),
              unselectedLabelColor: AppColors.inkSoft,
              unselectedLabelStyle: const TextStyle(
                fontWeight: FontWeight.normal,
                fontSize: 14,
              ),
              dividerColor: Colors.transparent,
              tabs: const [
                Tab(text: 'Records'),
                Tab(text: 'Insights'),
                Tab(text: 'Map'),
              ],
            ),
          ),
          Expanded(
            child: StreamBuilder<QuerySnapshot>(
              stream: attendanceQuery,
              builder: (context, attSnapshot) {
                return StreamBuilder<QuerySnapshot>(
                  stream: pingsQuery,
                  builder: (context, pingsSnapshot) {
                    final attDocs =
                        attSnapshot.hasData
                            ? attSnapshot.data!.docs
                                .map(
                                  (d) => {
                                    ...d.data() as Map<String, dynamic>,
                                    'id': d.id,
                                  },
                                )
                                .toList()
                            : <Map<String, dynamic>>[];
                    final pingDocs =
                        pingsSnapshot.hasData
                            ? pingsSnapshot.data!.docs
                                .map(
                                  (d) => {
                                    ...d.data() as Map<String, dynamic>,
                                    'id': d.id,
                                  },
                                )
                                .toList()
                            : <Map<String, dynamic>>[];

                    attDocs.sort((a, b) {
                      final ta = a['checkInUtc'] as String? ?? '';
                      final tb = b['checkInUtc'] as String? ?? '';
                      return tb.compareTo(ta);
                    });

                    pingDocs.sort((a, b) {
                      final ta = a['timestamp'] as String? ?? '';
                      final tb = b['timestamp'] as String? ?? '';
                      return tb.compareTo(ta);
                    });

                    return TabBarView(
                      controller: _tabController,
                      physics: const NeverScrollableScrollPhysics(),
                      children: [
                        RecordsTab(
                          attendance: attDocs,
                          selectedDate: _selectedDate,
                          onSelectDate: _selectMonthYear,
                          loading:
                              attSnapshot.connectionState ==
                              ConnectionState.waiting,
                        ),
                        InsightsTab(
                          attendance: attDocs,
                          locations: _locations,
                          selectedDate: _selectedDate,
                          loading:
                              attSnapshot.connectionState ==
                                  ConnectionState.waiting ||
                              _loadingLocations,
                        ),
                        MapTab(
                          attendance: attDocs,
                          pings: pingDocs,
                          locations: _locations,
                          selectedDate: _selectedDate,
                          loading:
                              pingsSnapshot.connectionState ==
                                  ConnectionState.waiting ||
                              _loadingLocations,
                        ),
                      ],
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
