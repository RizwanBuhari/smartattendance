import 'package:flutter/material.dart';

import 'app.dart';
import 'core/services/location_tracker.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  LocationTracker.initialize();
  runApp(const SmartAttendanceUIApp());
}