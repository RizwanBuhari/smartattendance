import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../services/location_tracker.dart';
import '../services/notifications.dart';
import '../theme/app_colors.dart';
import 'brand_logo.dart';

// Wraps its child and blocks access until the OS grants "Always" location
// permission — required so background tracking (see LocationTracker) can
// run during work hours even while the app isn't open.
//
// Android/iOS only let an app show the system permission dialog a couple of
// times before refusing to show it again ("denied forever"), so this can't
// literally re-trigger the OS prompt forever. Instead, this screen itself
// reappears every time the app is opened or resumed (see
// didChangeAppLifecycleState) until permission is actually "always" — which
// is what makes it read as "asks again and again" from the user's side.
class LocationPermissionGate extends StatefulWidget {
  const LocationPermissionGate({super.key, required this.child});

  final Widget child;

  @override
  State<LocationPermissionGate> createState() => _LocationPermissionGateState();
}

class _LocationPermissionGateState extends State<LocationPermissionGate>
    with WidgetsBindingObserver {
  LocationPermission? _permission;
  bool _busy = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Re-check whenever the user comes back — covers both "granted it in
    // Settings" and "revoked it in Settings" while the app was backgrounded.
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final permission = await Geolocator.checkPermission();
    debugPrint('PermissionGate: checkPermission() -> $permission');
    if (permission == LocationPermission.always) {
      // Both idempotent — safe to call on every resume, not just the first grant.
      unawaited(LocationTracker.schedule());
      unawaited(Notifications.requestPermission());
    }
    if (!mounted) return;
    setState(() {
      _permission = permission;
      _busy = false;
    });
  }

  Future<void> _requestPermission() async {
    setState(() => _busy = true);
    // Android/iOS only let you request ONE tier per call: foreground first,
    // then a separate request for background ("Always"). Calling
    // requestPermission() again once foreground is already granted is what
    // triggers that second system prompt.
    final permission = await Geolocator.requestPermission();
    debugPrint('PermissionGate: requestPermission() -> $permission');
    if (permission == LocationPermission.always) {
      unawaited(LocationTracker.schedule());
      // Android 13+ needs a SEPARATE runtime grant for notifications —
      // request it here too, once location is sorted, so the employee
      // actually sees the "you're outside your area" alert this unlocks.
      unawaited(Notifications.requestPermission());
    }
    if (!mounted) return;
    setState(() {
      _permission = permission;
      _busy = false;
    });
  }

  Future<void> _openSettings() => Geolocator.openAppSettings();

  @override
  Widget build(BuildContext context) {
    if (_permission == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    if (_permission == LocationPermission.always) {
      return widget.child;
    }

    final deniedForever = _permission == LocationPermission.deniedForever;

    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            children: [
              const SizedBox(height: 32),
              // Logo at top
              const Center(child: BrandLogo(width: 160)),
              const SizedBox(height: 32),
              // Main card with illustration
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 40,
                ),
                decoration: cardDecoration(),
                child: Column(
                  children: [
                    // Location illustration — city silhouette + pin
                    SizedBox(
                      height: 160,
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          // City silhouette background
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              _buildingBlock(30, 70),
                              const SizedBox(width: 6),
                              _buildingBlock(20, 50),
                              const SizedBox(width: 6),
                              _buildingBlock(35, 90),
                              const SizedBox(width: 30), // gap for pin
                              _buildingBlock(35, 80),
                              const SizedBox(width: 6),
                              _buildingBlock(25, 55),
                              const SizedBox(width: 6),
                              _buildingBlock(20, 40),
                            ],
                          ),
                          // Geofence circles
                          Positioned(
                            bottom: 10,
                            child: Container(
                              width: 100,
                              height: 30,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(50),
                                color: AppColors.brandRedSoft.withValues(
                                  alpha: 0.5,
                                ),
                              ),
                            ),
                          ),
                          Positioned(
                            bottom: 15,
                            child: Container(
                              width: 70,
                              height: 20,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(50),
                                color: AppColors.brandRedSoft.withValues(
                                  alpha: 0.7,
                                ),
                              ),
                            ),
                          ),
                          // Location pin
                          Positioned(
                            bottom: 20,
                            child: Icon(
                              Icons.location_on,
                              size: 56,
                              color: AppColors.brandRed,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),
                    Text(
                      'Location access required',
                      style: Theme.of(context).textTheme.headlineSmall,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Check-N needs "Allow all the time" access to confirm '
                      "you're on-site even when the app is closed.",
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: AppColors.inkSoft,
                        fontSize: 15,
                        height: 1.5,
                      ),
                    ),
                    const SizedBox(height: 32),
                    if (_busy)
                      const SizedBox(
                        height: 60,
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else ...[
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed:
                              deniedForever
                                  ? _openSettings
                                  : _requestPermission,
                          icon: const Icon(
                            Icons.location_on_outlined,
                            size: 22,
                          ),
                          label: Text(
                            deniedForever
                                ? 'Open Settings'
                                : 'Grant Always Access',
                          ),
                        ),
                      ),
                      if (!deniedForever) ...[
                        const SizedBox(height: 16),
                        TextButton(
                          onPressed: _openSettings,
                          child: const Text('Open Settings manually'),
                        ),
                      ],
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 40),
            ],
          ),
        ),
      ),
    );
  }

  // Simple building-block silhouette for the city illustration
  Widget _buildingBlock(double width, double height) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: AppColors.line.withValues(alpha: 0.5),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
      ),
    );
  }

  BoxDecoration cardDecoration() {
    return BoxDecoration(
      color: AppColors.panel,
      borderRadius: BorderRadius.circular(22),
      border: Border.all(color: AppColors.line.withValues(alpha: 0.4)),
      boxShadow: const [
        BoxShadow(
          color: Color(0x12000000),
          blurRadius: 24,
          offset: Offset(0, 6),
        ),
      ],
    );
  }
}
