class ApiConstants {
  ApiConstants._();

  // The NestJS backend's address, as reachable FROM THE DEVICE.
  //
  // The default suits the Android emulator: 10.0.2.2 is the emulator's fixed
  // alias for the host machine's localhost. It works regardless of Wi-Fi and is
  // never blocked by the host firewall, which makes it the reliable choice for
  // Android Studio.
  //
  // A REAL PHONE cannot use 10.0.2.2 — it must reach the host over the network.
  // Rather than editing this file every time you swap devices, override it at
  // launch:
  //
  //   flutter run --dart-define=API_BASE_URL=http://192.168.90.141:30300
  //
  // (Find the host IP with `ipconfig`. The phone must be on the same Wi-Fi, the
  // host firewall must allow port 30300, and the network must not use client
  // isolation — corporate Wi-Fi often does.)
  //
  // Either way this is fixed at COMPILE time, so changing it needs a full
  // restart — a hot reload will keep using the old value.
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',defaultValue: 'http://192.168.90.50:30300',
  );
}
