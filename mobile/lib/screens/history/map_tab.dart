import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../core/theme/app_colors.dart';

class MapTab extends StatefulWidget {
  const MapTab({
    super.key,
    required this.attendance,
    required this.pings,
    required this.locations,
    required this.selectedDate,
    this.loading = false,
  });

  final List<Map<String, dynamic>> attendance;
  final List<Map<String, dynamic>> pings;
  final List<Map<String, dynamic>> locations;
  final DateTime selectedDate;
  final bool loading;

  @override
  State<MapTab> createState() => _MapTabState();
}

class _MapTabState extends State<MapTab> with AutomaticKeepAliveClientMixin {
  late final MapController _mapController;

  String _selectedPeriod = 'This Month'; // 'This Month', 'This Week'
  String _selectedLocation = 'All Locations';
  String _selectedEventType =
      'All Events'; // 'All Events', 'Check-in', 'Checkout', 'Geofence Exit', 'Geofence Return'

  String _selectedLayer = 'Events'; // 'Events', 'Heatmap'
  bool _showGeofenceLayer = true;

  Map<String, dynamic>? _selectedMarkerEvent;
  bool _isSheetExpanded = false;

  @override
  bool get wantKeepAlive => true; // Preserve active state/map state on tab changes

  @override
  void initState() {
    super.initState();
    _mapController = MapController();
  }

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  // Filter attendance and location pings based on filters
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
            final todayStart = DateTime(now.year, now.month, now.day);
            final startOfWeek = todayStart.subtract(
              Duration(days: todayStart.weekday - 1),
            );
            final endOfWeek = startOfWeek.add(const Duration(days: 7));
            return !date.isBefore(startOfWeek) && date.isBefore(endOfWeek);
          }
          return true;
        }).toList();

    return filteredByPeriod.where((r) {
      if (_selectedLocation != 'All Locations') {
        final locName = r['locationName'] as String? ?? '';
        if (locName != _selectedLocation) return false;
      }
      return true;
    }).toList();
  }

  List<Map<String, dynamic>> _getFilteredPings() {
    final filteredByPeriod =
        widget.pings.where((ping) {
          final ts = ping['timestamp'] as String?;
          if (ts == null) return false;
          final date = DateTime.parse(ts).toLocal();

          if (_selectedPeriod == 'This Month') {
            return date.year == widget.selectedDate.year &&
                date.month == widget.selectedDate.month;
          } else if (_selectedPeriod == 'This Week') {
            final now = DateTime.now().toLocal();
            final todayStart = DateTime(now.year, now.month, now.day);
            final startOfWeek = todayStart.subtract(
              Duration(days: todayStart.weekday - 1),
            );
            final endOfWeek = startOfWeek.add(const Duration(days: 7));
            return !date.isBefore(startOfWeek) && date.isBefore(endOfWeek);
          }
          return true;
        }).toList();

    return filteredByPeriod.where((p) {
      if (_selectedLocation != 'All Locations') {
        final locName = p['locationName'] as String? ?? '';
        if (locName != _selectedLocation) return false;
      }
      return true;
    }).toList();
  }

  // Get active office location coordinate to center map
  LatLng _getMapCenterCoordinate() {
    if (_selectedLocation != 'All Locations' && widget.locations.isNotEmpty) {
      final loc = widget.locations.firstWhere(
        (l) => l['name'] == _selectedLocation,
        orElse: () => widget.locations.first,
      );
      return LatLng(loc['latitude'] as double, loc['longitude'] as double);
    }
    if (widget.locations.isNotEmpty) {
      return LatLng(
        widget.locations.first['latitude'] as double,
        widget.locations.first['longitude'] as double,
      );
    }
    return const LatLng(25.2048, 55.2708); // Dubai default
  }

  void _recenterMap() {
    final center = _getMapCenterCoordinate();
    _mapController.move(center, 14.5);
  }

  String _formatTime(String? utcIso) {
    if (utcIso == null) return '--:--';
    final local = DateTime.parse(utcIso).toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    final hour =
        local.hour > 12 ? local.hour - 12 : (local.hour == 0 ? 12 : local.hour);
    final ampm = local.hour >= 12 ? 'PM' : 'AM';
    return '${two(hour)}:${two(local.minute)} $ampm';
  }

  String _formatDate(String? utcIso) {
    if (utcIso == null) return '--:--';
    final local = DateTime.parse(utcIso).toLocal();
    final months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${local.day} ${months[local.month - 1]} ${local.year}';
  }

  @override
  Widget build(BuildContext context) {
    super.build(context); // keep alive

    if (widget.loading) {
      return const Center(child: CircularProgressIndicator());
    }

    final attRecords = _getFilteredAttendance();
    final pings = _getFilteredPings();

    final center = _getMapCenterCoordinate();

    // Map Layers markers
    final markers = <Marker>[];
    final circles = <CircleMarker>[];

    // 1. Office workplace geofence overlay circles
    if (_showGeofenceLayer) {
      for (final loc in widget.locations) {
        if (_selectedLocation == 'All Locations' ||
            loc['name'] == _selectedLocation) {
          final lat = loc['latitude'] as double;
          final lng = loc['longitude'] as double;
          final radius = (loc['radiusMeters'] as num?)?.toDouble() ?? 100.0;

          circles.add(
            CircleMarker(
              point: LatLng(lat, lng),
              radius: radius,
              useRadiusInMeter: true,
              color: AppColors.brandRedSoft.withValues(alpha: 0.25),
              borderColor: AppColors.brandRed,
              borderStrokeWidth: 1.5,
            ),
          );

          // Office label overlay as a marker
          markers.add(
            Marker(
              point: LatLng(lat, lng),
              width: 140,
              height: 50,
              child: Column(
                children: [
                  const Icon(
                    Icons.business,
                    color: AppColors.brandRed,
                    size: 24,
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.ink,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      loc['name'] as String? ?? 'Office',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 9,
                        fontWeight: FontWeight.bold,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
          );
        }
      }
    }

    // 2. Events marker computation
    int checkInCount = 0;
    int checkOutCount = 0;
    int geofenceExits = 0;
    int geofenceReturns = 0;

    if (_selectedLayer == 'Events') {
      // Check-ins & Check-outs from Attendance records
      for (final att in attRecords) {
        final checkIn = att['checkInCoords'] as Map<String, dynamic>?;
        final checkOut = att['checkOutCoords'] as Map<String, dynamic>?;

        if (checkIn != null &&
            (_selectedEventType == 'All Events' ||
                _selectedEventType == 'Check-in')) {
          checkInCount++;
          final lat = checkIn['lat'] as double;
          final lng = checkIn['lng'] as double;
          final eventData = {
            'type': 'Check-in',
            'time': att['checkInUtc'] as String?,
            'location': att['locationName'] as String? ?? 'Approved Workplace',
            'accuracy': att['gpsAccuracy'] as num?,
            'lat': lat,
            'lng': lng,
          };

          markers.add(
            Marker(
              point: LatLng(lat, lng),
              width: 36,
              height: 36,
              child: GestureDetector(
                onTap: () => setState(() => _selectedMarkerEvent = eventData),
                child: const CircleAvatar(
                  backgroundColor: AppColors.okBg,
                  child: Icon(
                    Icons.login_rounded,
                    color: AppColors.okText,
                    size: 18,
                  ),
                ),
              ),
            ),
          );
        }

        if (checkOut != null &&
            (_selectedEventType == 'All Events' ||
                _selectedEventType == 'Checkout')) {
          checkOutCount++;
          final lat = checkOut['lat'] as double;
          final lng = checkOut['lng'] as double;
          final eventData = {
            'type': 'Check-out',
            'time': att['checkOutUtc'] as String?,
            'location': att['locationName'] as String? ?? 'Approved Workplace',
            'accuracy': att['gpsAccuracy'] as num?,
            'lat': lat,
            'lng': lng,
          };

          markers.add(
            Marker(
              point: LatLng(lat, lng),
              width: 36,
              height: 36,
              child: GestureDetector(
                onTap: () => setState(() => _selectedMarkerEvent = eventData),
                child: const CircleAvatar(
                  backgroundColor: AppColors.alertBg,
                  child: Icon(
                    Icons.logout_rounded,
                    color: AppColors.alertText,
                    size: 18,
                  ),
                ),
              ),
            ),
          );
        }
      }

      // Geofence Exits & Returns from background Pings
      for (final ping in pings) {
        final eventType = ping['eventType'] as String?;
        final isInside =
            eventType == 'ENTER' ||
            eventType == 'DWELL' ||
            eventType == 'RETURN';
        final lat = ping['latitude'] as double? ?? ping['lat'] as double?;
        final lng = ping['longitude'] as double? ?? ping['lng'] as double?;
        if (lat == null || lng == null) continue;

        if (isInside) {
          geofenceReturns++;
        } else {
          geofenceExits++;
        }

        final isExitFilter = _selectedEventType == 'Geofence Exit' && !isInside;
        final isReturnFilter =
            _selectedEventType == 'Geofence Return' && isInside;
        final isAllFilter = _selectedEventType == 'All Events';

        if (isAllFilter || isExitFilter || isReturnFilter) {
          final eventData = {
            'type':
                eventType ?? (isInside ? 'Geofence Return' : 'Geofence Exit'),
            'time': ping['timestamp'] as String?,
            'location':
                ping['locationName'] as String? ??
                (isInside ? 'Inside Workplace' : 'Outside Workplace'),
            'accuracy': ping['gpsAccuracy'] as num?,
            'lat': lat,
            'lng': lng,
          };

          markers.add(
            Marker(
              point: LatLng(lat, lng),
              width: 32,
              height: 32,
              child: GestureDetector(
                onTap: () => setState(() => _selectedMarkerEvent = eventData),
                child: CircleAvatar(
                  backgroundColor:
                      isInside
                          ? Colors.blue.withValues(alpha: 0.1)
                          : AppColors.brandRedSoft,
                  child: Icon(
                    isInside
                        ? Icons.location_on_outlined
                        : Icons.warning_amber_rounded,
                    color: isInside ? Colors.blue : AppColors.brandRed,
                    size: 16,
                  ),
                ),
              ),
            ),
          );
        }
      }
    } else if (_selectedLayer == 'Heatmap') {
      // Renders the dense points as translucent circles to simulate density mapping
      for (final ping in pings) {
        final lat = ping['lat'] as double?;
        final lng = ping['lng'] as double?;
        if (lat == null || lng == null) continue;

        circles.add(
          CircleMarker(
            point: LatLng(lat, lng),
            radius: 20,
            useRadiusInMeter: true,
            color: AppColors.brandRed.withValues(alpha: 0.15),
            borderColor: Colors.transparent,
          ),
        );
      }
    }

    final totalEvents =
        checkInCount + checkOutCount + geofenceExits + geofenceReturns;

    return Stack(
      children: [
        // Map viewport
        FlutterMap(
          mapController: _mapController,
          options: MapOptions(initialCenter: center, initialZoom: 14.5),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.elsewedy.checkn',
            ),
            CircleLayer(circles: circles),
            MarkerLayer(markers: markers),
          ],
        ),

        // Top Filter Row overlays
        Positioned(
          left: 20,
          right: 20,
          top: 16,
          child: Row(
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
              const SizedBox(width: 6),
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
              const SizedBox(width: 6),
              Expanded(
                child: _buildFilterDropdown(
                  'Events',
                  _selectedEventType,
                  [
                    'All Events',
                    'Check-in',
                    'Checkout',
                    'Geofence Exit',
                    'Geofence Return',
                  ],
                  (val) {
                    if (val != null) setState(() => _selectedEventType = val);
                  },
                ),
              ),
            ],
          ),
        ),

        // Floating Action Buttons overlays
        Positioned(
          right: 16,
          top: 80,
          child: Column(
            children: [
              _buildFloatingControl(
                Icons.my_location_rounded,
                _recenterMap,
                'Recenter',
              ),
              const SizedBox(height: 8),
              _buildFloatingControl(
                _showGeofenceLayer
                    ? Icons.layers_rounded
                    : Icons.layers_outlined,
                () => setState(() => _showGeofenceLayer = !_showGeofenceLayer),
                'Toggle Geofence',
              ),
              const SizedBox(height: 8),
              _buildFloatingControl(
                _selectedLayer == 'Events'
                    ? Icons.map_rounded
                    : Icons.bubble_chart_rounded,
                () {
                  setState(() {
                    _selectedLayer =
                        _selectedLayer == 'Events' ? 'Heatmap' : 'Events';
                  });
                },
                'Toggle Heatmap',
              ),
            ],
          ),
        ),

        // Selected Marker Detail Overlay popup card
        if (_selectedMarkerEvent != null)
          Positioned(
            left: 20,
            right: 20,
            bottom: _isSheetExpanded ? 240 : 130,
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.ink,
                borderRadius: BorderRadius.circular(16),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x33000000),
                    blurRadius: 16,
                    offset: Offset(0, 4),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _selectedMarkerEvent!['type'] as String,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 14,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${_formatDate(_selectedMarkerEvent!['time'] as String?)} at ${_formatTime(_selectedMarkerEvent!['time'] as String?)}',
                          style: const TextStyle(
                            color: Colors.white70,
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _selectedMarkerEvent!['location'] as String,
                          style: const TextStyle(
                            color: Colors.white70,
                            fontSize: 12,
                          ),
                        ),
                        if (_selectedMarkerEvent!['accuracy'] != null) ...[
                          const SizedBox(height: 2),
                          Text(
                            'Accuracy: ±${(_selectedMarkerEvent!['accuracy'] as num).round()} m',
                            style: const TextStyle(
                              color: Colors.white60,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(
                      Icons.close,
                      color: Colors.white70,
                      size: 20,
                    ),
                    onPressed:
                        () => setState(() => _selectedMarkerEvent = null),
                  ),
                ],
              ),
            ),
          ),

        // Bottom sliding summary sheet
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: GestureDetector(
            onVerticalDragUpdate: (details) {
              if (details.primaryDelta! < -4) {
                setState(() => _isSheetExpanded = true);
              } else if (details.primaryDelta! > 4) {
                setState(() => _isSheetExpanded = false);
              }
            },
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 240),
              height: _isSheetExpanded ? 240 : 100,
              decoration: const BoxDecoration(
                color: AppColors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                boxShadow: [
                  BoxShadow(
                    color: Color(0x14000000),
                    blurRadius: 16,
                    offset: Offset(0, -4),
                  ),
                ],
              ),
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              child: SingleChildScrollView(
                physics: const NeverScrollableScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Handlebar
                    Center(
                      child: Container(
                        width: 40,
                        height: 4,
                        decoration: BoxDecoration(
                          color: AppColors.line,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),

                    // Collapsed Row Summary
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _selectedPeriod == 'This Month'
                                  ? 'This Month Summary'
                                  : 'This Week Summary',
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 15,
                                color: AppColors.ink,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '$totalEvents location events logged',
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.inkSoft,
                              ),
                            ),
                          ],
                        ),
                        // Mini toggler arrow
                        IconButton(
                          padding: EdgeInsets.zero,
                          icon: Icon(
                            _isSheetExpanded
                                ? Icons.keyboard_arrow_down_rounded
                                : Icons.keyboard_arrow_up_rounded,
                            color: AppColors.inkSoft,
                          ),
                          onPressed:
                              () => setState(
                                () => _isSheetExpanded = !_isSheetExpanded,
                              ),
                        ),
                      ],
                    ),

                    if (_isSheetExpanded) ...[
                      const SizedBox(height: 16),
                      const Divider(height: 1, color: AppColors.line),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          _buildSheetCol(
                            'Check-ins',
                            checkInCount.toString(),
                            Colors.green,
                          ),
                          _buildSheetCol(
                            'Checkouts',
                            checkOutCount.toString(),
                            Colors.red,
                          ),
                          _buildSheetCol(
                            'Geofence Exits',
                            geofenceExits.toString(),
                            AppColors.brandRed,
                          ),
                          _buildSheetCol(
                            'Geofence Returns',
                            geofenceReturns.toString(),
                            Colors.blue,
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          const Icon(
                            Icons.business_rounded,
                            color: AppColors.inkSoft,
                            size: 16,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            _selectedLocation == 'All Locations'
                                ? 'Office sites tracked'
                                : 'Location: $_selectedLocation',
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppColors.inkSoft,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
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
      padding: const EdgeInsets.symmetric(horizontal: 8),
      height: 36,
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(12),
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
            size: 16,
          ),
          style: const TextStyle(
            fontSize: 11,
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

  Widget _buildFloatingControl(
    IconData icon,
    VoidCallback onTap,
    String tooltip,
  ) {
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: AppColors.white,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.line),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14000000),
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: IconButton(
        padding: EdgeInsets.zero,
        icon: Icon(icon, color: AppColors.brandRed, size: 20),
        onPressed: onTap,
        tooltip: tooltip,
      ),
    );
  }

  Widget _buildSheetCol(String label, String value, Color color) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: color,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(fontSize: 10, color: AppColors.inkSoft),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
