// One-off: takes the new "ELSEWEDY ELECTRIC UAE" logo (JPEG, black text on
// white) and:
//   1. Converts it to a transparent PNG (black-on-white use).
//   2. Derives a white-on-transparent version for dark backgrounds by
//      recoloring: white bg -> transparent, black wordmark -> white,
//      the red smile curve -> kept red, the gray "UAE" caption -> light gray
//      (so it stays legible on a dark/red background instead of vanishing).
// Run with: dart run tool/process_new_logo.dart
import 'dart:io';

import 'package:image/image.dart' as img;

void main() {
  final source = img.decodeJpg(
    File(r'C:\smartattendance\dashboard\public\newlogo.jpg').readAsBytesSync(),
  )!;

  final black = img.Image(width: source.width, height: source.height, numChannels: 4);
  final white = img.Image(width: source.width, height: source.height, numChannels: 4);

  for (var y = 0; y < source.height; y++) {
    for (var x = 0; x < source.width; x++) {
      final p = source.getPixel(x, y);
      final r = p.r.toInt(), g = p.g.toInt(), b = p.b.toInt();
      final luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      final isGrayscale = (r - g).abs() < 20 && (g - b).abs() < 20;
      final isRed = r > g + 30 && r > b + 30;

      if (luminance > 235 && isGrayscale) {
        // Background -> transparent on both; stays white-opaque on the
        // black variant so it still works over arbitrary light backgrounds.
        black.setPixelRgba(x, y, 255, 255, 255, 255);
        white.setPixelRgba(x, y, 0, 0, 0, 0);
      } else if (isRed) {
        // Smile curve -> keep brand red on both.
        black.setPixelRgba(x, y, r, g, b, 255);
        white.setPixelRgba(x, y, r, g, b, 255);
      } else if (isGrayscale && luminance < 90) {
        // Black wordmark -> stays black on the black variant, flips to
        // white on the dark-background variant.
        black.setPixelRgba(x, y, r, g, b, 255);
        white.setPixelRgba(x, y, 255, 255, 255, 255);
      } else if (isGrayscale) {
        // Mid-gray "UAE" caption -> stays gray on the black variant, becomes
        // light gray (not pure white) on the dark variant so it still reads
        // as secondary text, matching dashboard's rgba(255,255,255,0.72).
        black.setPixelRgba(x, y, r, g, b, 255);
        white.setPixelRgba(x, y, 235, 235, 235, 235);
      } else {
        // Anti-aliasing edge pixels: keep as-is on black, approximate on white.
        black.setPixelRgba(x, y, r, g, b, 255);
        final inv = 255 - luminance.round();
        white.setPixelRgba(x, y, inv, inv, inv, 200);
      }
    }
  }

  const blackTargets = [
    r'C:\smartattendance\dashboard\public\elsewedy-logo-black.png',
    r'C:\smartattendance\mobile\assets\images\elsewedy-logo-black.png',
  ];
  const whiteTargets = [
    r'C:\smartattendance\dashboard\public\elsewedy-logo-white.png',
    r'C:\smartattendance\mobile\assets\images\elsewedy-logo-white.png',
  ];

  final blackPng = img.encodePng(black);
  final whitePng = img.encodePng(white);
  for (final path in blackTargets) {
    File(path).writeAsBytesSync(blackPng);
  }
  for (final path in whiteTargets) {
    File(path).writeAsBytesSync(whitePng);
  }

  // ignore: avoid_print
  print('Wrote ${source.width}x${source.height} black+white logo variants to dashboard/public and mobile/assets/images.');
}
