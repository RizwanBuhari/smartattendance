// Site admin home.
//
// A site admin does NOT check in or out — they supervise. So this replaces the
// employee attendance screen entirely (see main_navigation_container.dart)
// rather than sitting alongside it.
//
// Everything shown comes from GET /otp/team, which derives the site(s) from the
// CALLER'S OWN assignedLocationIds. The app never asks for a location, so a site
// admin cannot see or approve staff at a site they are not assigned to.
import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../core/constants/api_constants.dart';
import '../core/services/api_client.dart';
import '../core/theme/app_colors.dart';

// Bumped whenever this screen changes, and shown in the UI. If the number on
// screen is not this one, the device is running a stale build — which is
// otherwise indistinguishable from a bug in the screen itself.
const String _buildMarker = 'site-admin v3';

class SiteAdminScreen extends StatefulWidget {
  const SiteAdminScreen({super.key});

  @override
  State<SiteAdminScreen> createState() => _SiteAdminScreenState();
}

class _SiteAdminScreenState extends State<SiteAdminScreen> {
  List<dynamic> _employees = [];
  List<dynamic> _sites = [];
  Map<String, dynamic> _stats = {};
  List<dynamic> _recent = [];
  bool _loading = true;
  String? _error;

  // Pushes an update the moment anyone at this site checks in or out, so the
  // admin sees "checked in" flip live instead of having to pull to refresh.
  StreamSubscription<QuerySnapshot>? _attendanceSubscription;
  // Employees waiting for a code right now.
  StreamSubscription<QuerySnapshot>? _requestSubscription;
  // Guards against a burst of Firestore events causing a burst of API calls.
  Timer? _refreshDebounce;

  // Requests already announced, so re-attaching the listener does not re-alert
  // about people who have been waiting since before this screen opened.
  final Set<String> _seenRequests = {};
  // The first snapshot reports every existing document as "added"; only alert
  // for things that arrive after that.
  bool _primed = false;
  // Which sites the listeners are currently attached to, so they are not
  // rebuilt on every refresh (see _attachSiteListeners).
  String? _listeningToSites;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _attendanceSubscription?.cancel();
    _requestSubscription?.cancel();
    _refreshDebounce?.cancel();
    super.dispose();
  }

  Future<void> _load({bool showSpinner = true}) async {
    if (showSpinner) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final data = await ApiClient.get('/otp/team');
      if (!mounted) return;
      setState(() {
        _employees = data['employees'] as List<dynamic>? ?? [];
        _sites = data['sites'] as List<dynamic>? ?? [];
        _stats = (data['stats'] as Map?)?.cast<String, dynamic>() ?? {};
        _recent = data['recentActivity'] as List<dynamic>? ?? [];
        _loading = false;
        _error = null;
      });
      _attachSiteListeners();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  // Watches attendance for THIS admin's site(s) only. The stats and the team
  // list are still computed server-side (so scoping stays enforced there) —
  // Firestore is used purely as the trigger to re-fetch.
  // Attaches both Firestore listeners, ONCE per set of sites.
  //
  // The guard matters: each listener's handler calls _load(), and _load()
  // attaches listeners. Re-subscribing every time would immediately deliver a
  // fresh initial snapshot, which calls _load() again — an endless refresh loop
  // hammering the API. The site list almost never changes, so comparing it is
  // enough to break the cycle.
  void _attachSiteListeners() {
    final ids = _sites
        .map((s) => s['id']?.toString())
        .whereType<String>()
        .toList();
    if (ids.isEmpty) return;

    final key = ids.join(',');
    if (key == _listeningToSites) return;
    _listeningToSites = key;

    _listenForCodeRequests(ids);
    _listenForAttendanceChanges(ids);
  }

  // The reason this screen updates the moment someone taps check-in at a site
  // that needs approval. The attendance listener below cannot do it: a check-in
  // needing a code writes NO attendance record, so nothing there ever changes.
  void _listenForCodeRequests(List<String> ids) {
    _requestSubscription?.cancel();
    _requestSubscription = FirebaseFirestore.instance
        .collection('code_Requests')
        .where('locationId', whereIn: ids.take(30).toList())
        .snapshots()
        .listen((snap) {
          // Refresh so the row flips to "Waiting for code". The list itself is
          // still built server-side, so site scoping stays enforced there.
          if (mounted) _load(showSpinner: false);

          // A push already fired for this, but only reaches a phone that is not
          // showing the app. If the site admin IS looking at this screen, the
          // OS shows nothing — so surface it here instead.
          for (final change in snap.docChanges) {
            if (change.type != DocumentChangeType.added) continue;
            final data = change.doc.data();
            final name = data?['employeeName']?.toString();
            if (name == null || !mounted) continue;
            // Skip the initial load, which reports every existing doc as added.
            if (_seenRequests.contains(change.doc.id)) continue;
            _seenRequests.add(change.doc.id);
            if (_primed) _showRequestBanner(name);
          }
          _primed = true;
        }, onError: _onListenerError);
  }

  // Firestore listener failures are otherwise completely silent: the stream
  // just stops and the screen quietly goes stale. The common cause is a rules
  // change (permission-denied) for a token minted before the siteAdmin claim
  // existed — which is only fixable by signing out and in again, so it needs
  // to be visible rather than guessed at.
  void _onListenerError(Object error) {
    debugPrint('SiteAdmin: Firestore listener failed — $error');
    if (!mounted) return;
    _showError('Live updates unavailable: $error');
  }

  void _showRequestBanner(String name) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.qr_code_scanner, color: AppColors.white),
            const SizedBox(width: 12),
            Expanded(child: Text('$name is waiting for a check-in code.')),
          ],
        ),
        backgroundColor: AppColors.brandRed,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
        margin: const EdgeInsets.all(16),
        duration: const Duration(seconds: 6),
      ),
    );
  }

  void _listenForAttendanceChanges(List<String> ids) {
    _attendanceSubscription?.cancel();
    _attendanceSubscription = FirebaseFirestore.instance
        .collection('attendance_ids')
        // whereIn is capped at 30 values by Firestore.
        .where('locationId', whereIn: ids.take(30).toList())
        .snapshots()
        .listen((_) {
          // A single check-in writes more than once (record + review updates),
          // so collapse rapid events into one refresh.
          _refreshDebounce?.cancel();
          _refreshDebounce = Timer(const Duration(milliseconds: 600), () {
            if (mounted) _load(showSpinner: false);
          });
        }, onError: _onListenerError);
  }

  String get _siteName {
    if (_sites.isEmpty) return 'Your site';
    if (_sites.length == 1) return _sites.first['name']?.toString() ?? 'Site';
    return '${_sites.length} sites';
  }

  Future<void> _issueCode(Map<String, dynamic> employee) async {
    String? locationId = _sites.isNotEmpty
        ? _sites.first['id']?.toString()
        : null;

    // Only ask which site when the admin actually covers more than one.
    if (_sites.length > 1) {
      locationId = await showModalBottomSheet<String>(
        context: context,
        builder: (ctx) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('Which site?'),
              ),
              for (final s in _sites)
                ListTile(
                  title: Text(s['name']?.toString() ?? s['id'].toString()),
                  onTap: () => Navigator.pop(ctx, s['id'].toString()),
                ),
            ],
          ),
        ),
      );
      if (locationId == null) return;
    }

    if (locationId == null) {
      _showError('You are not assigned to a site yet.');
      return;
    }

    try {
      final res = await ApiClient.post('/otp/issue', {
        'targetEmployeeId': employee['id'],
        'locationId': locationId,
      });
      if (!mounted) return;
      await showDialog(
        context: context,
        builder: (_) => _QrDialog(
          employeeName: employee['name']?.toString() ?? 'Employee',
          code: res['code'].toString(),
          seconds: (res['expiresInSeconds'] as num?)?.toInt() ?? 60,
          onRegenerate: () async {
            final again = await ApiClient.post('/otp/issue', {
              'targetEmployeeId': employee['id'],
              'locationId': locationId,
            });
            return again['code'].toString();
          },
        ),
      );
      _load(); // they may have checked in while the dialog was open
    } catch (e) {
      _showError(e.toString());
    }
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: AppColors.alertText),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        backgroundColor: AppColors.panel,
        elevation: 0,
        titleSpacing: 20,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Site overview',
              style: TextStyle(
                color: AppColors.ink,
                fontWeight: FontWeight.w700,
                fontSize: 18,
              ),
            ),
            Text(
              // The build marker is deliberately visible: if it is missing or
              // shows an older version, the device is running a stale build.
              '$_siteName · $_buildMarker',
              style: const TextStyle(
                color: AppColors.inkSoft,
                fontWeight: FontWeight.w500,
                fontSize: 11,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: AppColors.inkSoft),
            onPressed: _loading ? null : _load,
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator());

    if (_error != null) {
      return _Message(
        icon: Icons.wifi_off_rounded,
        title: 'Could not load your site',
        // Showing the URL turns "it doesn't work" into something diagnosable:
        // wrong host, wrong port, or unreachable are all obvious from here.
        detail: 'Tried: ${ApiConstants.baseUrl}/otp/team\n\n${_error!}',
        onRetry: _load,
      );
    }

    if (_sites.isEmpty) {
      return _Message(
        icon: Icons.location_off_outlined,
        title: 'No site assigned',
        detail:
            'You are marked as a site admin but not assigned to any location. '
            'A dashboard admin needs to assign you one.',
        onRetry: _load,
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildStats(),
          const SizedBox(height: 24),
          _sectionTitle('Team', '${_employees.length}'),
          const SizedBox(height: 8),
          if (_employees.isEmpty)
            _emptyCard('No employees are assigned to your site yet.')
          else
            ..._employees.map(
              (e) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _EmployeeRow(
                  employee: e as Map<String, dynamic>,
                  onGenerate: () => _issueCode(e),
                ),
              ),
            ),
          const SizedBox(height: 24),
          _sectionTitle('Recent activity today', '${_recent.length}'),
          const SizedBox(height: 8),
          if (_recent.isEmpty)
            _emptyCard('Nothing has happened at your site today.')
          else
            ..._recent.map((r) => _ActivityRow(record: r as Map<String, dynamic>)),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _sectionTitle(String label, String count) {
    return Row(
      children: [
        Text(
          label,
          style: const TextStyle(
            color: AppColors.ink,
            fontWeight: FontWeight.w700,
            fontSize: 15,
          ),
        ),
        const SizedBox(width: 8),
        Text(
          count,
          style: const TextStyle(color: AppColors.muted, fontSize: 13),
        ),
      ],
    );
  }

  Widget _emptyCard(String text) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.panel,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line),
      ),
      child: Text(
        text,
        style: const TextStyle(color: AppColors.inkSoft, fontSize: 13),
      ),
    );
  }

  Widget _buildStats() {
    final total = _stats['totalEmployees'] ?? 0;
    final inNow = _stats['checkedIn'] ?? 0;
    final outNow = _stats['checkedOut'] ?? 0;
    final today = _stats['checkInsToday'] ?? 0;
    final rejected = _stats['rejectedToday'] ?? 0;

    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _StatCard(
                label: 'On site now',
                value: '$inNow',
                tone: _Tone.good,
                icon: Icons.login_rounded,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _StatCard(
                label: 'Not checked in',
                value: '$outNow',
                tone: _Tone.neutral,
                icon: Icons.logout_rounded,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: _StatCard(
                label: 'Assigned staff',
                value: '$total',
                tone: _Tone.neutral,
                icon: Icons.groups_rounded,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _StatCard(
                label: 'Check-ins today',
                value: '$today',
                tone: _Tone.neutral,
                icon: Icons.today_rounded,
              ),
            ),
          ],
        ),
        // Only surfaced when there is something to look at.
        if (rejected is int && rejected > 0) ...[
          const SizedBox(height: 8),
          _StatCard(
            label: 'Rejected attempts today',
            value: '$rejected',
            tone: _Tone.alert,
            icon: Icons.gpp_maybe_rounded,
            wide: true,
          ),
        ],
      ],
    );
  }
}

enum _Tone { good, neutral, alert }

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final _Tone tone;
  final IconData icon;
  final bool wide;

  const _StatCard({
    required this.label,
    required this.value,
    required this.tone,
    required this.icon,
    this.wide = false,
  });

  @override
  Widget build(BuildContext context) {
    final Color bg = switch (tone) {
      _Tone.good => AppColors.okBg,
      _Tone.alert => AppColors.alertBg,
      _Tone.neutral => AppColors.panel,
    };
    final Color fg = switch (tone) {
      _Tone.good => AppColors.okText,
      _Tone.alert => AppColors.alertText,
      _Tone.neutral => AppColors.ink,
    };

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        children: [
          Icon(icon, color: fg, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  style: TextStyle(
                    color: fg,
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    height: 1.1,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.inkSoft,
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ActivityRow extends StatelessWidget {
  final Map<String, dynamic> record;
  const _ActivityRow({required this.record});

  String _time(String iso) {
    final parsed = DateTime.tryParse(iso);
    if (parsed == null) return '';
    final local = parsed.toLocal();
    final h = local.hour.toString().padLeft(2, '0');
    final m = local.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  @override
  Widget build(BuildContext context) {
    final rejected = record['status'] == 'rejected';
    final action = record['action']?.toString() ?? '';

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(
            rejected
                ? Icons.block_rounded
                : (action == 'checked out'
                      ? Icons.logout_rounded
                      : Icons.login_rounded),
            size: 16,
            color: rejected ? AppColors.alertText : AppColors.inkSoft,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '${record['employeeName']} ${rejected ? 'was rejected' : action}',
              style: const TextStyle(color: AppColors.ink, fontSize: 13),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Text(
            _time(record['at']?.toString() ?? ''),
            style: const TextStyle(color: AppColors.muted, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class _EmployeeRow extends StatelessWidget {
  final Map<String, dynamic> employee;
  final VoidCallback onGenerate;

  const _EmployeeRow({required this.employee, required this.onGenerate});

  @override
  Widget build(BuildContext context) {
    final checkedIn = employee['isCheckedIn'] == true;
    final name = employee['name']?.toString() ?? 'Unknown';
    // Someone standing at the gate right now, waiting to be let in. The whole
    // reason a site admin opens this screen, so the row shouts about it.
    final requesting = employee['isRequesting'] == true;
    final codeSent = employee['codeIssuedAt'] != null;
    final waitedFor = _waitedFor(employee['requestedAt']?.toString());

    return Container(
      decoration: BoxDecoration(
        color: requesting ? AppColors.brandRedSoft : AppColors.panel,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: requesting ? AppColors.brandRed : AppColors.line,
          width: requesting ? 1.5 : 1,
        ),
      ),
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w600,
                    fontSize: 15,
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: requesting
                            ? AppColors.brandRed
                            : (checkedIn
                                  ? AppColors.okBg
                                  : AppColors.neutralBg),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        requesting
                            ? (codeSent ? 'Code sent' : 'Waiting for code')
                            : (checkedIn ? 'Checked in' : 'Not checked in'),
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: requesting
                              ? AppColors.white
                              : (checkedIn
                                    ? AppColors.okText
                                    : AppColors.neutralText),
                        ),
                      ),
                    ),
                    // How long they have been standing there — the difference
                    // between "just tapped" and "waiting five minutes".
                    if (requesting && waitedFor != null) ...[
                      const SizedBox(width: 8),
                      Text(
                        waitedFor,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: AppColors.brandRed,
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          // Someone already on site does not need approving again.
          if (!checkedIn)
            ElevatedButton.icon(
              onPressed: onGenerate,
              icon: Icon(requesting ? Icons.qr_code_scanner : Icons.qr_code_2,
                  size: 18),
              // Spelled out for the person who is actually waiting, so the
              // action to take is unmistakable.
              label: Text(requesting ? 'Generate code' : 'QR'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.brandRed,
                foregroundColor: AppColors.white,
                elevation: requesting ? 2 : 0,
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 10,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// "3m" / "45s" since the employee tapped check-in. Returns null for anything
// unparseable rather than showing a nonsense duration.
String? _waitedFor(String? iso) {
  if (iso == null) return null;
  final at = DateTime.tryParse(iso);
  if (at == null) return null;
  final seconds = DateTime.now().difference(at.toLocal()).inSeconds;
  if (seconds < 0) return null;
  if (seconds < 60) return '${seconds}s';
  return '${seconds ~/ 60}m';
}

// The QR itself, with a live countdown. When it runs out the code is genuinely
// dead on the server too, so this offers a fresh one rather than showing a
// stale square that would silently fail to scan.
class _QrDialog extends StatefulWidget {
  final String employeeName;
  final String code;
  final int seconds;
  final Future<String> Function() onRegenerate;

  const _QrDialog({
    required this.employeeName,
    required this.code,
    required this.seconds,
    required this.onRegenerate,
  });

  @override
  State<_QrDialog> createState() => _QrDialogState();
}

class _QrDialogState extends State<_QrDialog> {
  late String _code;
  late int _remaining;
  Timer? _timer;
  bool _regenerating = false;

  @override
  void initState() {
    super.initState();
    _code = widget.code;
    _remaining = widget.seconds;
    _startTimer();
  }

  void _startTimer() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return;
      setState(() {
        _remaining--;
        if (_remaining <= 0) t.cancel();
      });
    });
  }

  Future<void> _regenerate() async {
    setState(() => _regenerating = true);
    try {
      final fresh = await widget.onRegenerate();
      if (!mounted) return;
      setState(() {
        _code = fresh;
        _remaining = widget.seconds;
        _regenerating = false;
      });
      _startTimer();
    } catch (_) {
      if (!mounted) return;
      setState(() => _regenerating = false);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final expired = _remaining <= 0;

    return Dialog(
      backgroundColor: AppColors.panel,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                widget.employeeName,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AppColors.ink,
                  fontWeight: FontWeight.w700,
                  fontSize: 17,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'Ask them to scan this to check in',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.inkSoft, fontSize: 13),
              ),
              const SizedBox(height: 20),

              if (expired)
                Container(
                  width: 220,
                  height: 220,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.neutralBg,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: _regenerating
                      ? const CircularProgressIndicator()
                      : const Text(
                          'Code expired',
                          style: TextStyle(
                            color: AppColors.neutralText,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                )
              else
                // White background is required: a dark QR on a dark surface
                // will not scan.
                Container(
                  padding: const EdgeInsets.all(8),
                  color: AppColors.white,
                  child: QrImageView(
                    data: _code,
                    version: QrVersions.auto,
                    size: 220,
                    backgroundColor: AppColors.white,
                  ),
                ),

              const SizedBox(height: 16),

              // Manual fallback for when a camera will not focus.
              Text(
                _code.split('').join(' '),
                style: const TextStyle(
                  color: AppColors.ink,
                  fontSize: 26,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 2,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                expired ? 'Expired' : 'Expires in $_remaining s',
                style: TextStyle(
                  color: expired ? AppColors.alertText : AppColors.inkSoft,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text(
                        'Close',
                        style: TextStyle(color: AppColors.inkSoft),
                      ),
                    ),
                  ),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: _regenerating ? null : _regenerate,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.brandRed,
                        foregroundColor: AppColors.white,
                        elevation: 0,
                      ),
                      child: const Text('New code'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  final IconData icon;
  final String title;
  final String detail;
  final VoidCallback onRetry;

  const _Message({
    required this.icon,
    required this.title,
    required this.detail,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: AppColors.muted),
            const SizedBox(height: 16),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.ink,
                fontWeight: FontWeight.w700,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              detail,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.inkSoft, fontSize: 13),
            ),
            const SizedBox(height: 20),
            TextButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}
