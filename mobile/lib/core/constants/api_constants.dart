class ApiConstants {
  ApiConstants._();

  // The NestJS backend's address, reachable from the phone/emulator.
  //
  // - Android EMULATOR, backend running on this same machine:
  //     'http://10.0.2.2:3000'   (10.0.2.2 is the emulator's fixed alias for
  //     the host's localhost — this never works from a real phone)
  // - Real phone (or emulator), backend hosted on a laptop on the same Wi-Fi:
  //     'http://<that laptop's LAN IPv4>:3000'   e.g. 'http://192.168.0.173:3000'
  //     (find it with `ipconfig` on the hosting laptop)
  //
  // This is the ONE line to change when switching who's hosting. Requires a
  // full restart (not just hot reload) since it's a compile-time constant.
  static const String baseUrl = 'http://192.168.90.45:3000';
}
