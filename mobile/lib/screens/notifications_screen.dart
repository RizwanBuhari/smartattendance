import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/services/api_client.dart';
import '../core/services/notification_history.dart';
import '../core/theme/app_colors.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, this.onReadStatusChanged});

  final VoidCallback? onReadStatusChanged;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen>
    with WidgetsBindingObserver {
  List<NotificationEntry> _entries = [];
  Set<String> _readIds = {};
  Map<String, String> _submittedReasons = {};
  final Map<String, TextEditingController> _controllers = {};
  final Set<String> _submittingIds = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void didUpdateWidget(covariant NotificationsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load();
  }

  Future<void> _load() async {
    final entries = await NotificationHistory.getAll();
    final prefs = await SharedPreferences.getInstance();
    final readList = prefs.getStringList('readNotifications') ?? [];

    final Map<String, String> loadedReasons = {};
    for (final e in entries) {
      final id = e.time.millisecondsSinceEpoch.toString();
      final savedReason = prefs.getString('submitted_reason_$id');
      if (savedReason != null) {
        loadedReasons[id] = savedReason;
      }
      if (!_controllers.containsKey(id)) {
        _controllers[id] = TextEditingController();
      }
    }

    if (!mounted) return;
    setState(() {
      _entries = entries;
      _readIds = readList.toSet();
      _submittedReasons = loadedReasons;
      _loading = false;
    });
  }

  Future<void> _markAsRead(NotificationEntry entry) async {
    final id = entry.time.millisecondsSinceEpoch.toString();
    if (_readIds.contains(id)) return;

    final prefs = await SharedPreferences.getInstance();
    _readIds.add(id);
    await prefs.setStringList('readNotifications', _readIds.toList());

    setState(() {});
    widget.onReadStatusChanged?.call();
  }

  Future<void> _markAllAsRead() async {
    final prefs = await SharedPreferences.getInstance();
    final allIds =
        _entries.map((e) => e.time.millisecondsSinceEpoch.toString()).toList();
    await prefs.setStringList('readNotifications', allIds);

    setState(() {
      _readIds = allIds.toSet();
    });
    widget.onReadStatusChanged?.call();
  }

  Future<void> _submitReason(NotificationEntry entry) async {
    final id = entry.time.millisecondsSinceEpoch.toString();
    final controller = _controllers[id];
    final reasonText = controller?.text.trim() ?? '';

    if (reasonText.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter a reason before submitting.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }

    setState(() => _submittingIds.add(id));

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('submitted_reason_$id', reasonText);

      try {
        await ApiClient.post('/geofence-events/reason', {
          'reason': reasonText,
          'timestamp': entry.time.toIso8601String(),
        });
      } catch (_) {}

      if (mounted) {
        setState(() {
          _submittedReasons[id] = reasonText;
          _submittingIds.remove(id);
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Reason submitted to HR successfully!'),
            backgroundColor: AppColors.okText,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _submittingIds.remove(id));
    }
  }

  bool _isExitNotification(NotificationEntry entry) {
    final t = '${entry.title} ${entry.body}'.toLowerCase();
    return t.contains('outside') ||
        t.contains('left') ||
        t.contains('exit') ||
        t.contains('out of office');
  }

  String _formatTime(DateTime time) {
    final local = time.toLocal();
    final now = DateTime.now();
    final difference = now.difference(local);

    if (difference.inMinutes < 1) {
      return 'Just now';
    } else if (difference.inMinutes < 60) {
      return '${difference.inMinutes}m ago';
    } else if (difference.inHours < 24) {
      return '${difference.inHours}h ago';
    } else {
      String two(int n) => n.toString().padLeft(2, '0');
      return '${local.year}-${two(local.month)}-${two(local.day)} ${two(local.hour)}:${two(local.minute)}';
    }
  }

  IconData _getIconForNotification(String title) {
    final t = title.toLowerCase();
    if (t.contains('outside') || t.contains('left')) {
      return Icons.warning_amber_rounded;
    } else if (t.contains('returned') || t.contains('back')) {
      return Icons.location_on_outlined;
    } else if (t.contains('check-in') || t.contains('checked in')) {
      return Icons.check_circle_outline_rounded;
    } else if (t.contains('check-out') || t.contains('checked out')) {
      return Icons.logout_rounded;
    } else if (t.contains('permission') || t.contains('disabled')) {
      return Icons.location_off_outlined;
    } else if (t.contains('accuracy') || t.contains('gps')) {
      return Icons.gps_off_outlined;
    }
    return Icons.notifications_none_rounded;
  }

  Color _getIconColor(String title) {
    final t = title.toLowerCase();
    if (t.contains('outside') ||
        t.contains('left') ||
        t.contains('permission') ||
        t.contains('disabled') ||
        t.contains('accuracy') ||
        t.contains('gps')) {
      return AppColors.alertText;
    }
    return AppColors.okText;
  }

  Color _getIconBgColor(String title) {
    final t = title.toLowerCase();
    if (t.contains('outside') ||
        t.contains('left') ||
        t.contains('permission') ||
        t.contains('disabled') ||
        t.contains('accuracy') ||
        t.contains('gps')) {
      return AppColors.alertBg;
    }
    return AppColors.okBg;
  }

  @override
  Widget build(BuildContext context) {
    final hasUnread = _entries.any(
      (e) => !_readIds.contains(e.time.millisecondsSinceEpoch.toString()),
    );

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading:
            widget.onReadStatusChanged != null
                ? null
                : Padding(
                  padding: const EdgeInsets.only(left: 12.0),
                  child: Center(
                    child: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: AppColors.panel,
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.line),
                      ),
                      child: IconButton(
                        padding: EdgeInsets.zero,
                        icon: const Icon(Icons.arrow_back_rounded, size: 20),
                        onPressed: () => Navigator.of(context).pop(),
                      ),
                    ),
                  ),
                ),
        title: const Text(
          'Notifications',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
        actions: [
          if (_entries.isNotEmpty && hasUnread)
            TextButton(
              onPressed: _markAllAsRead,
              child: const Text('Mark all as read'),
            ),
          const SizedBox(width: 8),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child:
            _loading
                ? _buildSkeleton()
                : _entries.isEmpty
                ? _buildEmptyState()
                : _buildPopulatedState(),
      ),
    );
  }

  Widget _buildSkeleton() {
    return ListView.separated(
      padding: const EdgeInsets.all(24),
      itemCount: 3,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder:
          (_, __) => AnimatedContainer(
            duration: const Duration(seconds: 1),
            height: 90,
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.line.withValues(alpha: 0.5)),
            ),
          ),
    );
  }

  Widget _buildEmptyState() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        const SizedBox(height: 80),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 40),
            decoration: cardDecoration(radius: 24),
            child: Column(
              children: [
                Stack(
                  alignment: Alignment.center,
                  children: [
                    Container(
                      width: 90,
                      height: 90,
                      decoration: const BoxDecoration(
                        color: AppColors.brandRedSoft,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const Icon(
                      Icons.notifications_none_rounded,
                      color: AppColors.brandRed,
                      size: 40,
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                Text(
                  'No notifications yet',
                  style: Theme.of(
                    context,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  'Geofence alerts and attendance updates will appear here.',
                  style: Theme.of(context).textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                OutlinedButton.icon(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.grid_view_rounded, size: 18),
                  label: const Text('Go to dashboard'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.brandRed,
                    side: const BorderSide(
                      color: AppColors.brandRed,
                      width: 1.4,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildPopulatedState() {
    return ListView.separated(
      padding: const EdgeInsets.only(left: 24, right: 24, top: 24, bottom: 100),
      itemCount: _entries.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final entry = _entries[index];
        final id = entry.time.millisecondsSinceEpoch.toString();
        final isRead = _readIds.contains(id);
        final icon = _getIconForNotification(entry.title);
        final iconColor = _getIconColor(entry.title);
        final iconBgColor = _getIconBgColor(entry.title);
        final isExit = _isExitNotification(entry);
        final submittedReason = _submittedReasons[id];
        final isSubmitting = _submittingIds.contains(id);

        return GestureDetector(
          onTap: () => _markAsRead(entry),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color:
                  isRead
                      ? AppColors.white
                      : AppColors.brandRedSoft.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color:
                    isRead
                        ? AppColors.line
                        : AppColors.brandRed.withValues(alpha: 0.15),
                width: 1.2,
              ),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x06000000),
                  blurRadius: 16,
                  offset: Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: iconBgColor,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(icon, color: iconColor, size: 20),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(
                                  entry.title,
                                  style: TextStyle(
                                    fontWeight:
                                        isRead
                                            ? FontWeight.w600
                                            : FontWeight.w700,
                                    color: AppColors.ink,
                                    fontSize: 14,
                                  ),
                                ),
                              ),
                              if (!isRead)
                                Container(
                                  width: 8,
                                  height: 8,
                                  decoration: const BoxDecoration(
                                    color: AppColors.brandRed,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            entry.body,
                            style: const TextStyle(
                              fontSize: 13,
                              color: AppColors.inkSoft,
                              height: 1.4,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            _formatTime(entry.time),
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppColors.muted,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                if (isExit) ...[
                  const SizedBox(height: 12),
                  const Divider(color: AppColors.line, height: 1),
                  const SizedBox(height: 12),
                  if (submittedReason != null) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.okBg,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: AppColors.okText.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.check_circle_rounded,
                            color: AppColors.okText,
                            size: 18,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Submitted Reason to HR: "$submittedReason"',
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.okText,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ] else ...[
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Reason for leaving radius (optional):',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: AppColors.inkSoft,
                          ),
                        ),
                        const SizedBox(height: 6),
                        TextField(
                          controller: _controllers[id],
                          decoration: InputDecoration(
                            hintText:
                                'e.g., Client meeting, lunch break, sick leave…',
                            hintStyle: const TextStyle(
                              fontSize: 12,
                              color: AppColors.muted,
                            ),
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 10,
                            ),
                            isDense: true,
                            filled: true,
                            fillColor: AppColors.bg,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: const BorderSide(
                                color: AppColors.line,
                              ),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: const BorderSide(
                                color: AppColors.line,
                              ),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: const BorderSide(
                                color: AppColors.brandRed,
                                width: 1.5,
                              ),
                            ),
                          ),
                          style: const TextStyle(fontSize: 13),
                        ),
                        const SizedBox(height: 8),
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton.icon(
                            onPressed:
                                isSubmitting
                                    ? null
                                    : () => _submitReason(entry),
                            icon:
                                isSubmitting
                                    ? const SizedBox(
                                      width: 14,
                                      height: 14,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                    : const Icon(Icons.send_rounded, size: 14),
                            label: Text(
                              isSubmitting
                                  ? 'Submitting…'
                                  : 'Submit Reason to HR',
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.brandRed,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 10),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                              elevation: 0,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  BoxDecoration cardDecoration({double radius = 16}) {
    return BoxDecoration(
      color: AppColors.panel,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: AppColors.line.withValues(alpha: 0.5)),
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
