import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/services/notifications.dart';
import '../core/services/notification_history.dart';
import '../core/services/native_geofence_service.dart';
import '../core/services/offsite_request_service.dart';
import '../core/theme/app_colors.dart';
import 'attendance_screen.dart';
import 'history_screen.dart';
import 'notifications_screen.dart';
import 'profile_screen.dart';
import 'site_admin_screen.dart';
import '../core/services/push_service.dart';
import '../core/services/session_guard.dart';
import 'auth/auth_gate.dart';
import 'offsite/offsite_home_screen.dart';
import 'supervisor/approvals_list_screen.dart';
import 'supervisor/supervisor_home_screen.dart';

class MainNavigationContainer extends StatefulWidget {
  const MainNavigationContainer({super.key});

  @override
  State<MainNavigationContainer> createState() =>
      _MainNavigationContainerState();
}

enum NavigationDestinationType {
  home,
  site,
  history,
  offsite,
  approvals,
  notifications,
  profile,
}

class EmployeePermissions {
  final bool canUseOnsiteAttendance;
  final bool canRequestOffsiteCheckIn;
  final bool canApproveOffsiteRequests;
  final bool canViewHistory;
  final bool canViewNotifications;
  final bool canManageProfile;
  final bool canManageSite;

  const EmployeePermissions({
    this.canUseOnsiteAttendance = false,
    this.canRequestOffsiteCheckIn = false,
    this.canApproveOffsiteRequests = false,
    this.canViewHistory = false,
    this.canViewNotifications = false,
    this.canManageProfile = false,
    this.canManageSite = false,
  });

  factory EmployeePermissions.fromRole(String role) {
    if (role == 'site_supervisor' || role == 'siteAdmin') {
      return const EmployeePermissions(
        canUseOnsiteAttendance: true,
        canApproveOffsiteRequests: true,
        canViewHistory: true,
        canViewNotifications: true,
        canManageProfile: true,
      );
    } else if (role == 'offsite_employee') {
      return const EmployeePermissions(
        canUseOnsiteAttendance: true,
        canRequestOffsiteCheckIn: true,
        canViewHistory: true,
        canViewNotifications: true,
        canManageProfile: true,
      );
    } else {
      // onsite_employee / employee / default
      return const EmployeePermissions(
        canUseOnsiteAttendance: true,
        canViewHistory: true,
        canViewNotifications: true,
        canManageProfile: true,
      );
    }
  }
}

class _MainNavigationContainerState extends State<MainNavigationContainer>
    with WidgetsBindingObserver {
  int _selectedIndex = 0;
  int _unreadCount = 0;
  int _pendingApprovalsCount = 0;
  String _currentRole = 'onsite_employee';
  
  List<NavigationDestinationType> _activeDestinations = [
    NavigationDestinationType.home,
    NavigationDestinationType.history,
    NavigationDestinationType.notifications,
    NavigationDestinationType.profile,
  ];

  List<NavigationDestinationType> _getDestinations(String role) {
    final permissions = EmployeePermissions.fromRole(role);
    final list = <NavigationDestinationType>[];
    if (permissions.canUseOnsiteAttendance) {
      list.add(NavigationDestinationType.home);
    }
    if (permissions.canManageSite) {
      list.add(NavigationDestinationType.site);
    }
    if (permissions.canViewHistory) {
      list.add(NavigationDestinationType.history);
    }
    if (permissions.canRequestOffsiteCheckIn) {
      list.add(NavigationDestinationType.offsite);
    }
    if (permissions.canApproveOffsiteRequests) {
      list.add(NavigationDestinationType.approvals);
    }
    if (permissions.canViewNotifications) {
      list.add(NavigationDestinationType.notifications);
    }
    if (permissions.canManageProfile) {
      list.add(NavigationDestinationType.profile);
    }
    return list;
  }

  void _handleTabNavigation(int index) {
    if (index == 1) {
      _navigateToType(NavigationDestinationType.history);
    } else if (index == 2) {
      if (_currentRole == 'site_supervisor' || _currentRole == 'siteAdmin') {
        _navigateToType(NavigationDestinationType.approvals);
      } else if (_currentRole == 'offsite_employee') {
        _navigateToType(NavigationDestinationType.offsite);
      }
    } else if (index == 3) {
      _navigateToType(NavigationDestinationType.notifications);
    } else if (index == 4) {
      _navigateToType(NavigationDestinationType.profile);
    }
  }

  List<Widget> get _pages {
    return _activeDestinations.map((type) {
      switch (type) {
        case NavigationDestinationType.home:
          if (_currentRole == 'site_supervisor' || _currentRole == 'siteAdmin') {
            return SupervisorHomeScreen(
              onNavigateToTab: _handleTabNavigation,
            );
          } else if (_currentRole == 'offsite_employee') {
            return OffsiteHomeScreen(
              onNavigateToTab: _handleTabNavigation,
            );
          } else {
            return AttendanceScreen(
              onNavigateToTab: (index) {
                if (index == 1) {
                  _navigateToType(NavigationDestinationType.history);
                } else if (index == 3) {
                  _navigateToType(NavigationDestinationType.profile);
                }
              },
            );
          }
        case NavigationDestinationType.site:
          return const SiteAdminScreen();
        case NavigationDestinationType.history:
          return const HistoryScreen();
        case NavigationDestinationType.offsite:
          return OffsiteHomeScreen(
            onNavigateToTab: _handleTabNavigation,
          );
        case NavigationDestinationType.approvals:
          return const ApprovalsListScreen();
        case NavigationDestinationType.notifications:
          return NotificationsScreen(
            onReadStatusChanged: () {
              _updateUnreadCount();
            },
          );
        case NavigationDestinationType.profile:
          return const ProfileScreen(hideBackButton: true);
      }
    }).toList();
  }

  void _navigateToType(NavigationDestinationType type) {
    final permissions = EmployeePermissions.fromRole(_currentRole);
    bool allowed = false;
    switch (type) {
      case NavigationDestinationType.home:
        allowed = permissions.canUseOnsiteAttendance;
        break;
      case NavigationDestinationType.site:
        allowed = permissions.canManageSite;
        break;
      case NavigationDestinationType.history:
        allowed = permissions.canViewHistory;
        break;
      case NavigationDestinationType.offsite:
        allowed = permissions.canRequestOffsiteCheckIn;
        break;
      case NavigationDestinationType.approvals:
        allowed = permissions.canApproveOffsiteRequests;
        break;
      case NavigationDestinationType.notifications:
        allowed = permissions.canViewNotifications;
        break;
      case NavigationDestinationType.profile:
        allowed = permissions.canManageProfile;
        break;
    }
    if (!allowed) return;

    final idx = _activeDestinations.indexOf(type);
    if (idx != -1 && mounted) {
      setState(() {
        _selectedIndex = idx;
      });
      _updateUnreadCount();
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    PushService.start();

    _updateUnreadCount();
    _listenForReviewChanges();
    _setupGeofenceListener();
  }

  StreamSubscription<QuerySnapshot>? _reviewSubscription;
  StreamSubscription<QuerySnapshot>? _employeeSubscription;
  StreamSubscription<QuerySnapshot>? _approvalsBadgeSubscription;
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
          final doc = empSnap.docs.first;
          final data = doc.data();

          SessionGuard.watch(
            employeeDocId: doc.id,
            onEvicted: () async {
              if (!mounted) return;
              final navigator = Navigator.of(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text(
                    'Signed out — your account was used on another device.',
                  ),
                ),
              );
              navigator.pushAndRemoveUntil(
                MaterialPageRoute(builder: (_) => const AuthGate()),
                (route) => false,
              );
            },
          );

          final role = data['role'] ?? 'onsite_employee';
          if (role != _currentRole && mounted) {
            setState(() {
              _currentRole = role;
              _activeDestinations = _getDestinations(role);
              if (_selectedIndex >= _activeDestinations.length) {
                _selectedIndex = 0;
              }
            });
          }

          if (role == 'site_supervisor' || role == 'siteAdmin') {
            _listenToApprovalsBadge(doc.id);
          }

          final assigned = data['assignedLocationIds'] as List<dynamic>? ?? [];
          _syncAssignedLocationsGeofences(
            assigned.map((e) => e.toString()).toList(),
          );
        });
  }

  void _listenToApprovalsBadge(String supervisorId) {
    _approvalsBadgeSubscription?.cancel();
    _approvalsBadgeSubscription = OffsiteRequestService.getSupervisorRequestsStream(supervisorId).listen((snap) {
      int pending = 0;
      for (final doc in snap.docs) {
        final data = doc.data() as Map<String, dynamic>;
        if (data['status'] == 'pending_approval') {
          pending++;
        }
      }
      if (mounted) {
        setState(() {
          _pendingApprovalsCount = pending;
        });
      }
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
    _approvalsBadgeSubscription?.cancel();
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

  Widget _buildNavItemForType(int index, NavigationDestinationType type) {
    switch (type) {
      case NavigationDestinationType.home:
        return _buildNavItem(
          index,
          Icons.home_outlined,
          Icons.home_rounded,
          'Home',
        );
      case NavigationDestinationType.site:
        return _buildNavItem(
          index,
          Icons.dashboard_outlined,
          Icons.dashboard_rounded,
          'Site',
        );
      case NavigationDestinationType.history:
        return _buildNavItem(
          index,
          Icons.history_rounded,
          Icons.history_rounded,
          'History',
        );
      case NavigationDestinationType.offsite:
        return _buildNavItem(
          index,
          Icons.business_center_outlined,
          Icons.business_center_rounded,
          'Offsite',
        );
      case NavigationDestinationType.approvals:
        return _buildNavItem(
          index,
          Icons.assignment_turned_in_outlined,
          Icons.assignment_turned_in_rounded,
          'Approvals',
          badgeCount: _pendingApprovalsCount,
        );
      case NavigationDestinationType.notifications:
        return _buildNavItem(
          index,
          Icons.notifications_none_rounded,
          Icons.notifications_rounded,
          'Notifications',
          badgeCount: _unreadCount,
        );
      case NavigationDestinationType.profile:
        return _buildNavItem(
          index,
          Icons.person_outline_rounded,
          Icons.person_rounded,
          'Profile',
        );
    }
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
              children: _activeDestinations.asMap().entries.map((entry) {
                final idx = entry.key;
                final type = entry.value;
                return _buildNavItemForType(idx, type);
              }).toList(),
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
                AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: isSelected ? AppColors.brandRedSoft : Colors.transparent,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(icon, color: color, size: 24),
                ),
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
