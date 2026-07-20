import 'dart:developer' as developer;
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/widgets.dart';
import 'package:workmanager/workmanager.dart';

import 'native_geofence_service.dart';

const _syncTaskName = 'geofence-offline-sync';
const _testSyncTaskName = 'test-geofence-offline-sync';

// For fast testing, we can chain one-off tasks every 30 seconds
const bool useFastTestInterval = true;
const Duration testInterval = Duration(seconds: 30);

@pragma('vm:entry-point')
void locationTrackerCallbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    developer.log('LocationTracker (Sync): task fired at ${DateTime.now()}');
    try {
      WidgetsFlutterBinding.ensureInitialized();
      await Firebase.initializeApp();

      // Trigger the offline queue sync
      await NativeGeofenceService.syncOfflineQueue();

      return true;
    } catch (e) {
      developer.log('LocationTracker (Sync): failed — $e');
      return false;
    } finally {
      if (useFastTestInterval && task == _testSyncTaskName) {
        await Workmanager().registerOneOffTask(
          _testSyncTaskName,
          _testSyncTaskName,
          initialDelay: testInterval,
          constraints: Constraints(networkType: NetworkType.connected),
          existingWorkPolicy: ExistingWorkPolicy.replace,
        );
      }
    }
  });
}

class LocationTracker {
  LocationTracker._();

  static Future<void> initialize() async {
    await Workmanager().initialize(locationTrackerCallbackDispatcher);
  }

  static Future<void> schedule() async {
    if (useFastTestInterval) {
      await Workmanager().registerOneOffTask(
        _testSyncTaskName,
        _testSyncTaskName,
        initialDelay: testInterval,
        constraints: Constraints(networkType: NetworkType.connected),
        existingWorkPolicy: ExistingWorkPolicy.keep,
      );
      return;
    }

    await Workmanager().registerPeriodicTask(
      _syncTaskName,
      _syncTaskName,
      frequency: const Duration(minutes: 15),
      constraints: Constraints(networkType: NetworkType.connected),
      existingWorkPolicy: ExistingPeriodicWorkPolicy.update,
    );
  }
}
