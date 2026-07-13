import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';

// A per-install identifier for the physical device, sent with every
// attendance event so a record can be traced back to a specific device.
class DeviceId {
  DeviceId._();

  static String? _cached;

  static Future<String> get() async {
    final cached = _cached;
    if (cached != null) return cached;

    final plugin = DeviceInfoPlugin();
    String id;
    try {
      if (Platform.isAndroid) {
        final info = await plugin.androidInfo;
        id = info.id;
      } else if (Platform.isIOS) {
        final info = await plugin.iosInfo;
        id = info.identifierForVendor ?? 'unknown-ios-device';
      } else {
        id = 'unsupported-platform-device';
      }
    } catch (_) {
      id = 'unknown-device';
    }

    _cached = id;
    return id;
  }
}
