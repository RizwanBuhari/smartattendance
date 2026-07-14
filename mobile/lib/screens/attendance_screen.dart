import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;

import '../core/constants/api_constants.dart';
import '../core/services/device_id.dart';
import '../core/theme/app_colors.dart';
import '../core/theme/app_theme.dart';
import '../core/widgets/brand_logo.dart';
import 'auth/auth_gate.dart';
import 'profile_screen.dart';

// Reject a check-in/out attempt if the device can't get a fix at least this
// good — a worse fix isn't trustworthy enough to compare against a geofence
// that's typically only 100-150m wide.
const _kMaxAcceptableAccuracyMeters = 50.0;

class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({super.key});

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  String _currentStatus = "Not checked in";
  String _timestampMessage = "No history recorded yet.";
  String _backendResponse = "";
  bool _isCheckedIn = false;
  bool _isBusy = false;

  List<Map<String, dynamic>> _history = [];
  bool _loadingHistory = true;
  String? _photoBase64;

  String? get _employeeId => FirebaseAuth.instance.currentUser?.uid;

  @override
  void initState() {
    super.initState();
    _loadHistory();
    _loadAvatar();
  }

  // Just the photo, for the AppBar avatar — the full profile lives in ProfileScreen.
  Future<void> _loadAvatar() async {
    final id = _employeeId;
    if (id == null) return;
    try {
      final snapshot = await FirebaseFirestore.instance
          .collection('employees')
          .where('authUid', isEqualTo: id)
          .limit(1)
          .get();
      if (snapshot.docs.isNotEmpty && mounted) {
        setState(() => _photoBase64 = snapshot.docs.first.data()['photoBase64'] as String?);
      }
    } catch (e) {
      // Non-fatal — the avatar just falls back to a generic icon. Still
      // logged since this is the same authUid query ProfileScreen uses, so
      // if that one's failing, this is a second data point on why.
      debugPrint('Avatar load failed: $e');
    }
  }

  void _showSnackBar(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  // Fetches this employee's own attendance records — used both to render the
  // history panel and to figure out the current status on screen load.
  Future<void> _loadHistory() async {
    final id = _employeeId;
    if (id == null) return;

    setState(() => _loadingHistory = true);
    try {
      final uri = Uri.parse('${ApiConstants.baseUrl}/attendance?employeeId=$id');
      final res = await http.get(uri);
      debugPrint('GET $uri -> ${res.statusCode}');
      final list = (jsonDecode(res.body) as List).cast<Map<String, dynamic>>();
      final open = list.where((r) => r['status'] == 'checked_in');

      setState(() {
        _history = list;
        _isCheckedIn = open.isNotEmpty;
        _currentStatus = _isCheckedIn ? 'Checked in' : (list.isEmpty ? 'Not checked in' : 'Checked out');
        // Records come back newest-first, so the first one reflects whatever
        // the last real action was — without this, reopening the app while
        // already checked in showed the placeholder message instead of
        // when that check-in actually happened.
        if (list.isNotEmpty) {
          final latest = list.first;
          final isOpen = latest['status'] == 'checked_in';
          final utc = (isOpen ? latest['checkInUtc'] : latest['checkOutUtc']) as String?;
          if (utc != null) {
            final local = DateTime.parse(utc).toLocal();
            _timestampMessage =
                'Last action: ${isOpen ? 'check-in' : 'check-out'} at ${_formattedTime(local)}';
          }
        }
      });
    } catch (_) {
      // Non-fatal — the history panel just stays empty/stale.
    } finally {
      if (mounted) setState(() => _loadingHistory = false);
    }
  }

  // Location Acquisition + Validation: gets a live GPS fix and rejects it up
  // front if permissions/services aren't available or the fix is too poor to
  // trust against a geofence. Returns null (having already shown the reason)
  // if the caller should not proceed.
  Future<Position?> _acquireLocation() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      _showSnackBar('Turn on location services to check in/out.');
      return null;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      _showSnackBar('Location permission is required to check in/out.');
      return null;
    }

    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    );

    if (position.accuracy > _kMaxAcceptableAccuracyMeters) {
      _showSnackBar(
        'GPS accuracy too low (±${position.accuracy.round()}m). Move to an open area and try again.',
      );
      return null;
    }

    return position;
  }

  String _formattedTime(DateTime time) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(time.hour)}:${two(time.minute)}:${two(time.second)}';
  }

  Future<void> _handleCheckIn() => _performAction('check-in');
  Future<void> _handleCheckOut() => _performAction('check-out');

  // Runs the full check-in/out sequence: acquire + validate location, send
  // to the backend, then only update the on-screen status if the backend
  // actually accepted it (the geofence constraint check is authoritative on
  // the server, so the UI must reflect its answer, not assume success).
  Future<void> _performAction(String action) async {
    if (_isBusy) return;

    setState(() {
      _isBusy = true;
      _backendResponse = 'Getting your location…';
    });

    try {
      final employeeId = _employeeId;
      if (employeeId == null) {
        _showSnackBar('Not signed in — please log in again.');
        return;
      }

      final position = await _acquireLocation();
      if (position == null) {
        setState(() => _backendResponse = '');
        return;
      }

      setState(() => _backendResponse = 'Sending to server…');
      final deviceId = await DeviceId.get();

      final uri = Uri.parse('${ApiConstants.baseUrl}/attendance/$action');
      final response = await http.post(
        uri,
        headers: {"Content-Type": "application/json"},
        body: jsonEncode({
          "employeeId": employeeId,
          "deviceId": deviceId,
          "latitude": position.latitude,
          "longitude": position.longitude,
          "gpsAccuracy": position.accuracy,
          "timestamp": DateTime.now().toUtc().toIso8601String(),
        }),
      );
      debugPrint('POST $uri -> ${response.statusCode}');

      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final accepted = body['accepted'] == true;
      final message = body['message'] as String? ?? (accepted ? 'Success.' : 'Rejected.');

      setState(() {
        _backendResponse = message;
        if (accepted) {
          _isCheckedIn = action == 'check-in';
          _currentStatus = _isCheckedIn ? 'Checked in' : 'Checked out';
          _timestampMessage = 'Last action: $action at ${_formattedTime(DateTime.now())}';
        }
      });

      if (accepted) {
        await _loadHistory();
      }
    } catch (e) {
      setState(() => _backendResponse = 'Connection failed. Is the server reachable?');
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  Future<void> _handleLogout() async {
    await FirebaseAuth.instance.signOut();
    // AttendanceScreen was reached via pushAndRemoveUntil, which clears the
    // navigator stack down to just this route — AuthGate's StreamBuilder
    // (which would otherwise react to the sign-out automatically) isn't
    // mounted anymore at that point, so nothing is listening to navigate
    // away on its own. Re-push AuthGate explicitly instead.
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const AuthGate()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    // Mirrors the dashboard's .badge-checked_in (ok) / .badge-checked_out
    // (neutral) colors exactly.
    final statusFg = _isCheckedIn ? AppColors.okText : AppColors.ink;

    return Scaffold(
      appBar: AppBar(
        leading: Padding(
          padding: const EdgeInsets.all(8),
          child: GestureDetector(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const ProfileScreen()),
            ),
            child: CircleAvatar(
              backgroundColor: AppColors.neutralBg,
              backgroundImage: _photoBase64 != null ? MemoryImage(base64Decode(_photoBase64!)) : null,
              child: _photoBase64 == null
                  ? const Icon(Icons.person, color: AppColors.muted)
                  : null,
            ),
          ),
        ),
        title: const BrandLogo(width: 48),
        actions: [
          IconButton(
            tooltip: 'Log out',
            icon: const Icon(Icons.logout),
            onPressed: _handleLogout,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => Future.wait([_loadHistory(), _loadAvatar()]),
        child: ListView(
          padding: const EdgeInsets.all(24.0),
          children: [
            Container(
              padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 20),
              decoration: panelDecoration(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text("Current status:", style: Theme.of(context).textTheme.bodyMedium),
                  const SizedBox(height: 4),
                  Text(
                    _currentStatus,
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: statusFg),
                  ),
                ],
              ),
            ),
            if (_timestampMessage != "No history recorded yet.") ...[
              const SizedBox(height: 8),
              Text(
                _timestampMessage,
                style: const TextStyle(fontSize: 13, color: AppColors.muted),
                textAlign: TextAlign.center,
              ),
            ],
            if (_backendResponse.isNotEmpty) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.neutralBg,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  _backendResponse,
                  style: const TextStyle(fontSize: 13, color: AppColors.inkSoft),
                  textAlign: TextAlign.center,
                ),
              ),
            ],
            const SizedBox(height: 24),

            ElevatedButton.icon(
              onPressed: _isBusy ? null : _handleCheckIn,
              icon: const Icon(Icons.login),
              label: const Text('Check in', style: TextStyle(fontSize: 18)),
            ),
            const SizedBox(height: 16),

            OutlinedButton.icon(
              onPressed: _isBusy ? null : _handleCheckOut,
              icon: const Icon(Icons.logout),
              label: const Text('Check out', style: TextStyle(fontSize: 18)),
            ),

            const SizedBox(height: 32),
            Text('Recent activity', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            _buildHistory(),
          ],
        ),
      ),
    );
  }

  Widget _buildHistory() {
    if (_loadingHistory) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    if (_history.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(20),
        decoration: panelDecoration(),
        child: const Text(
          'No attendance recorded yet.',
          style: TextStyle(color: AppColors.muted),
          textAlign: TextAlign.center,
        ),
      );
    }

    return Column(
      children: [
        for (final record in _history) ...[
          _HistoryRow(record: record),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}

// Individual flat white card per record, rather than one bordered list —
// matches the "Recent activity" mockup.
class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.record});

  final Map<String, dynamic> record;

  @override
  Widget build(BuildContext context) {
    final status = record['status'] as String? ?? 'unknown';
    final isCheckedIn = status == 'checked_in';
    final locationName = record['locationName'] as String? ?? '—';
    final checkInUtc = record['checkInUtc'] as String?;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: panelDecoration(radius: 12),
      child: Row(
        children: [
          Icon(
            isCheckedIn ? Icons.login : Icons.logout,
            size: 18,
            color: isCheckedIn ? AppColors.okText : AppColors.neutralText,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(locationName, style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.ink)),
                if (checkInUtc != null)
                  Text(
                    checkInUtc.replaceFirst('T', ' ').split('.').first,
                    style: const TextStyle(fontSize: 12, color: AppColors.muted),
                  ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: isCheckedIn ? AppColors.okBg : AppColors.neutralBg,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              isCheckedIn ? 'Checked in' : 'Checked out',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: isCheckedIn ? AppColors.okText : AppColors.neutralText,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
