import 'package:flutter/material.dart';

import 'app.dart';
import 'core/services/location_tracker.dart';
import 'core/services/notifications.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  LocationTracker.initialize();
  Notifications.initialize();
  runApp(const SmartAttendanceUIApp());
}
