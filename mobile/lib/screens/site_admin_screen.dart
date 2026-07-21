// Site admin tab.
//
// Shows the staff assigned to THIS site admin's location, whether each one is
// currently checked in, and lets the admin issue a 60-second QR code for anyone
// who is not. The employee scans that QR to approve their own check-in.
//
// The employee list comes from GET /otp/team, which derives it from the caller's
// own assignedLocationIds — the app never asks for a location, so a site admin
// cannot see or issue codes for staff at another site.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../core/services/api_client.dart';
import '../core/theme/app_colors.dart';

class SiteAdminScreen extends StatefulWidget {
  const SiteAdminScreen({super.key});

  @override
  State<SiteAdminScreen> createState() => _SiteAdminScreenState();
}

class _SiteAdminScreenState extends State<SiteAdminScreen> {
  List<dynamic> _employees = [];
  List<dynamic> _locationIds = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await ApiClient.get('/otp/team');
      if (!mounted) return;
      setState(() {
        _employees = data['employees'] as List<dynamic>? ?? [];
        _locationIds = data['locationIds'] as List<dynamic>? ?? [];
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _issueCode(Map<String, dynamic> employee) async {
    // A site admin normally covers one site; if several, ask which.
    String? locationId = _locationIds.isNotEmpty
        ? _locationIds.first.toString()
        : null;
    if (_locationIds.length > 1) {
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
              for (final id in _locationIds)
                ListTile(
                  title: Text(id.toString()),
                  onTap: () => Navigator.pop(ctx, id.toString()),
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
        barrierDismissible: true,
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
      // Someone may have checked in while the dialog was open.
      _load();
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
        title: const Text(
          'Site check-in',
          style: TextStyle(
            color: AppColors.ink,
            fontWeight: FontWeight.w700,
            fontSize: 18,
          ),
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
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return _Message(
        icon: Icons.error_outline,
        title: 'Could not load your team',
        detail: _error!,
        onRetry: _load,
      );
    }
    if (_employees.isEmpty) {
      return _Message(
        icon: Icons.groups_outlined,
        title: 'No employees at your site',
        detail:
            'Nobody is assigned to your location yet. A dashboard admin can '
            'assign staff to this site.',
        onRetry: _load,
      );
    }

    final pending = _employees.where((e) => e['isCheckedIn'] != true).length;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _employees.length + 1,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (context, index) {
          if (index == 0) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                '$pending of ${_employees.length} not yet checked in',
                style: const TextStyle(
                  color: AppColors.inkSoft,
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
            );
          }
          final employee = _employees[index - 1] as Map<String, dynamic>;
          return _EmployeeRow(
            employee: employee,
            onGenerate: () => _issueCode(employee),
          );
        },
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

    return Container(
      decoration: BoxDecoration(
        color: AppColors.panel,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line),
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
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: checkedIn
                        ? AppColors.okBg
                        : AppColors.neutralBg,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    checkedIn ? 'Checked in' : 'Not checked in',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: checkedIn
                          ? AppColors.okText
                          : AppColors.neutralText,
                    ),
                  ),
                ),
              ],
            ),
          ),
          // Someone already checked in does not need a code.
          if (!checkedIn)
            ElevatedButton.icon(
              onPressed: onGenerate,
              icon: const Icon(Icons.qr_code_2, size: 18),
              label: const Text('Code'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.brandRed,
                foregroundColor: AppColors.white,
                elevation: 0,
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

// The QR itself, with a live countdown. When it runs out the code is genuinely
// dead on the server too, so the dialog offers a fresh one rather than showing
// a stale square that would silently fail to scan.
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
              QrImageView(
                data: _code,
                version: QrVersions.auto,
                size: 220,
                backgroundColor: AppColors.white,
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
