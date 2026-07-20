import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/services/notifications.dart';
import '../core/services/notification_history.dart';
import '../core/services/native_geofence_service.dart';
import '../core/theme/app_colors.dart';
import 'attendance_screen.dart';
import 'history_screen.dart';
import 'notifications_screen.dart';
import 'profile_screen.dart';

class MainNavigationContainer extends StatefulWidget {
  const MainNavigationContainer({super.key});

  @override
  State<MainNavigationContainer> createState() =>
      _MainNavigationContainerState();
}

class _MainNavigationContainerState extends State<MainNavigationContainer>
    with WidgetsBindingObserver {
  int _selectedIndex = 0;
  int _unreadCount = 0;

  // Keyed lists of pages to maintain their state via IndexedStack
  late final List<Widget> _pages;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _pages = [
      AttendanceScreen(
        onNavigateToTab: (index) {
          setState(() => _selectedIndex = index);
          _updateUnreadCount();
        },
      ),
      const HistoryScreen(),
      NotificationsScreen(
        onReadStatusChanged: () {
          _updateUnreadCount();
        },
      ),
      const ProfileScreen(hideBackButton: true),
    ];
    _updateUnreadCount();
    _listenForReviewChanges();
    _setupGeofenceListener();
  }

  StreamSubscription<QuerySnapshot>? _reviewSubscription;
  StreamSubscription<QuerySnapshot>? _employeeSubscription;
  final List<StreamSubscription<DocumentSnapshot>> _locationSubscriptions = [];

  void _setupGeofenceListener() {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;

    _employeeSubscription?.cancel();
    _employeeSubscription = FirebaseFirestore.instance
        .collection('employees_ids')
        .where('authUid', isEqualTo: uid)
        .limit(1)
        .snapshots()
        .listen((empSnap) {
          if (empSnap.docs.isEmpty) return;
          final data = empSnap.docs.first.data();
          final assigned = data['assignedLocationIds'] as List<dynamic>? ?? [];
          _syncAssignedLocationsGeofences(
            assigned.map((e) => e.toString()).toList(),
          );
        });
  }

  Future<void> _syncAssignedLocationsGeofences(List<String> assignedIds) async {
    for (final sub in _locationSubscriptions) {
      sub.cancel();
    }
    _locationSubscriptions.clear();

    if (assignedIds.isEmpty) {
      await NativeGeofenceService.removeAllGeofences();
      return;
    }

    final List<Map<String, dynamic>> resolvedLocations = [];

    void checkAndSync() async {
      if (resolvedLocations.length == assignedIds.length) {
        await NativeGeofenceService.initialize();
        await NativeGeofenceService.syncGeofences(resolvedLocations);
      }
    }

    for (final locId in assignedIds) {
      final sub = FirebaseFirestore.instance
          .collection('locations_ids')
          .doc(locId)
          .snapshots()
          .listen((locSnap) {
            if (locSnap.exists) {
              final locData = locSnap.data()!;
              final newLoc = {
                'id': locSnap.id,
                'latitude': locData['latitude'],
                'longitude': locData['longitude'],
                'radiusMeters': locData['radiusMeters'] ?? 100.0,
              };

              final idx = resolvedLocations.indexWhere(
                (l) => l['id'] == locSnap.id,
              );
              if (idx != -1) {
                resolvedLocations[idx] = newLoc;
              } else {
                resolvedLocations.add(newLoc);
              }
              checkAndSync();
            }
          });
      _locationSubscriptions.add(sub);
    }
  }

  void _listenForReviewChanges() {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;

    _reviewSubscription?.cancel();
    _reviewSubscription = FirebaseFirestore.instance
        .collection('attendance_ids')
        .where('employeeId', isEqualTo: uid)
        .snapshots()
        .listen((snapshot) async {
          final prefs = await SharedPreferences.getInstance();
          final notifiedIds = prefs.getStringList('notifiedReviewIds') ?? [];
          final notifiedSet = notifiedIds.toSet();
          bool changed = false;

          for (final doc in snapshot.docs) {
            final data = doc.data();
            final id = doc.id;
            final review = data['checkoutReview'] as Map<String, dynamic>?;
            if (review != null) {
              final status = review['status'] as String?;
              final dateStr = data['checkInUtc'] as String?;
              final dateDisplay =
                  dateStr != null
                      ? DateTime.parse(
                        dateStr,
                      ).toLocal().toString().split(' ')[0]
                      : 'recent shift';

              if (status == 'accepted' &&
                  !notifiedSet.contains('${id}_accepted')) {
                await Notifications.showCheckoutReviewApproved(dateDisplay);
                notifiedSet.add('${id}_accepted');
                changed = true;
              } else if (status == 'rejected' &&
                  !notifiedSet.contains('${id}_rejected')) {
                final reason = review['rejectionReason'] as String?;
                await Notifications.showCheckoutReviewRejected(
                  dateDisplay,
                  reason,
                );
                notifiedSet.add('${id}_rejected');
                changed = true;
              }
            }
          }

          if (changed) {
            await prefs.setStringList(
              'notifiedReviewIds',
              notifiedSet.toList(),
            );
          }
        });
  }

  @override
  void dispose() {
    _reviewSubscription?.cancel();
    _employeeSubscription?.cancel();
    for (final sub in _locationSubscriptions) {
      sub.cancel();
    }
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _updateUnreadCount();
    }
  }

  Future<void> _updateUnreadCount() async {
    try {
      final entries = await NotificationHistory.getAll();
      final prefs = await SharedPreferences.getInstance();
      final readList = prefs.getStringList('readNotifications') ?? [];
      final readIds = readList.toSet();

      int unread = 0;
      for (final entry in entries) {
        final id = entry.time.millisecondsSinceEpoch.toString();
        if (!readIds.contains(id)) {
          unread++;
        }
      }

      if (mounted) {
        setState(() {
          _unreadCount = unread;
        });
      }
    } catch (_) {}
  }

  void _onItemTapped(int index) {
    setState(() {
      _selectedIndex = index;
    });
    _updateUnreadCount();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _selectedIndex, children: _pages),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          boxShadow: [
            BoxShadow(
              color: Color(0x0C000000),
              blurRadius: 16,
              offset: Offset(0, -4),
            ),
          ],
        ),
        child: SafeArea(
          child: SizedBox(
            height: 72,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildNavItem(
                  0,
                  Icons.home_outlined,
                  Icons.home_rounded,
                  'Home',
                ),
                _buildNavItem(
                  1,
                  Icons.history_rounded,
                  Icons.history_rounded,
                  'History',
                ),
                _buildNavItem(
                  2,
                  Icons.notifications_none_rounded,
                  Icons.notifications_rounded,
                  'Notifications',
                  badgeCount: _unreadCount,
                ),
                _buildNavItem(
                  3,
                  Icons.person_outline_rounded,
                  Icons.person_rounded,
                  'Profile',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildNavItem(
    int index,
    IconData outlineIcon,
    IconData filledIcon,
    String label, {
    int badgeCount = 0,
  }) {
    final isSelected = _selectedIndex == index;
    final color = isSelected ? AppColors.brandRed : AppColors.inkSoft;
    final icon = isSelected ? filledIcon : outlineIcon;

    return Expanded(
      child: InkWell(
        onTap: () => _onItemTapped(index),
        splashColor: Colors.transparent,
        highlightColor: Colors.transparent,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                // Soft background circle behind selected tab
                AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color:
                        isSelected
                            ? AppColors.brandRedSoft
                            : Colors.transparent,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(icon, color: color, size: 24),
                ),
                // Badge counter / dot
                if (badgeCount > 0)
                  Positioned(
                    right: -2,
                    top: -2,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: const BoxDecoration(
                        color: AppColors.brandRed,
                        shape: BoxShape.circle,
                      ),
                      constraints: const BoxConstraints(
                        minWidth: 16,
                        minHeight: 16,
                      ),
                      child: Center(
                        child: Text(
                          badgeCount > 99 ? '99+' : badgeCount.toString(),
                          style: const TextStyle(
                            color: AppColors.white,
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 11,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
