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
import 'site_admin_screen.dart';
import '../core/services/push_service.dart';
import '../core/services/session_guard.dart';
import 'auth/auth_gate.dart';

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

  // Whether this user may issue check-in codes. Comes from the employee record
  // (role == 'siteAdmin'), which is already being watched below, so the tab
  // appears/disappears live if a dashboard admin changes the role.
  bool _isSiteAdmin = false;

  // Keyed lists of pages to maintain their state via IndexedStack
  late final List<Widget> _basePages;

  // A site admin supervises rather than attends, so they get a DIFFERENT shell:
  // the site overview replaces the check in / check out screen entirely, and
  // History (their own attendance) is dropped since they have none.
  //
  // Employees are unaffected and never see the site tab.
  List<Widget> get _pages => _isSiteAdmin
      ? [
          const SiteAdminScreen(),
          _basePages[2], // Notifications
          _basePages[3], // Profile
        ]
      : _basePages;

  // Nav labels/icons per role, kept beside _pages so the two can never drift
  // out of sync (a mismatch would send taps to the wrong screen).
  List<_NavSpec> get _navSpecs => _isSiteAdmin
      ? const [
          _NavSpec(Icons.dashboard_outlined, Icons.dashboard_rounded, 'Site'),
          _NavSpec(
            Icons.notifications_none_rounded,
            Icons.notifications_rounded,
            'Notifications',
          ),
          _NavSpec(
            Icons.person_outline_rounded,
            Icons.person_rounded,
            'Profile',
          ),
        ]
      : const [
          _NavSpec(Icons.home_outlined, Icons.home_rounded, 'Home'),
          _NavSpec(Icons.history_rounded, Icons.history_rounded, 'History'),
          _NavSpec(
            Icons.notifications_none_rounded,
            Icons.notifications_rounded,
            'Notifications',
          ),
          _NavSpec(
            Icons.person_outline_rounded,
            Icons.person_rounded,
            'Profile',
          ),
        ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    // Re-register for push on every launch, not only at sign-in — a user who
    // was already signed in never passes through the login screen, and a token
    // that rotated while the app was closed would otherwise never be sent.
    PushService.start();
    _basePages = [
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

          // One account, one device — for employees AND site admins. If someone
          // signs in elsewhere, this device signs itself out and returns to the
          // login screen.
          SessionGuard.watch(
            employeeDocId: empSnap.docs.first.id,
            onEvicted: () async {
              if (!mounted) return;
              final navigator = Navigator.of(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Signed out — your account was used on another device.'),
                ),
              );
              navigator.pushAndRemoveUntil(
                MaterialPageRoute(builder: (_) => const AuthGate()),
                (route) => false,
              );
            },
          );

          // Show/hide the site admin tab as the role changes.
          final isSiteAdmin = data['role'] == 'siteAdmin';
          if (isSiteAdmin != _isSiteAdmin && mounted) {
            setState(() {
              _isSiteAdmin = isSiteAdmin;
              // If the tab disappears while the user is standing on it, fall
              // back to Home rather than leaving IndexedStack out of range.
              // The two roles have different tab counts, so a stale index
              // could point past the end of the new list.
              _selectedIndex = 0;
            });
          }

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
            // Built from _navSpecs so the bar always matches _pages — the two
            // differ by role, and hardcoding either would send taps to the
            // wrong screen.
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                for (var i = 0; i < _navSpecs.length; i++)
                  _buildNavItem(
                    i,
                    _navSpecs[i].outlineIcon,
                    _navSpecs[i].filledIcon,
                    _navSpecs[i].label,
                    badgeCount: _navSpecs[i].label == 'Notifications'
                        ? _unreadCount
                        : 0,
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

// One bottom-nav entry. Declared so the tab list and the page list can be kept
// side by side and vary together by role.
class _NavSpec {
  final IconData outlineIcon;
  final IconData filledIcon;
  final String label;
  const _NavSpec(this.outlineIcon, this.filledIcon, this.label);
}
