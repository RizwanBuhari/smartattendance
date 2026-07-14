// Builds final black/white logo variants from the new high-res transparent
// source ("logo without background.png") using real alpha compositing —
// this source has genuine smooth per-pixel alpha (verified via
// inspect_logo.dart/inspect_logo2.dart), unlike the earlier JPEG source.
//
// Black variant (light backgrounds): flatten onto solid white.
// White variant (dark backgrounds): keep transparency, recolor black
// wordmark -> white and the gray "UAE" caption -> light gray, red smile
// stays red — same per-pixel alpha preserved for clean anti-aliased edges.
import 'dart:io';

import 'package:image/image.dart' as img;

void main() {
  final source = img.decodePng(
    File(r'C:\smartattendance\mobile\assets\images\logo without background.png').readAsBytesSync(),
  )!;

  // --- Black variant: flatten onto white ---
  final black = img.Image(width: source.width, height: source.height, numChannels: 3);
  img.fill(black, color: img.ColorRgb8(255, 255, 255));
  img.compositeImage(black, source);

  // --- White variant: recolor, keep alpha ---
  final white = img.Image(width: source.width, height: source.height, numChannels: 4);
  for (var y = 0; y < source.height; y++) {
    for (var x = 0; x < source.width; x++) {
      final p = source.getPixel(x, y);
      final a = p.a.toInt();
      if (a == 0) {
        white.setPixelRgba(x, y, 0, 0, 0, 0);
        continue;
      }
      final r = p.r.toInt(), g = p.g.toInt(), b = p.b.toInt();
      final luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      final isGrayscale = (r - g).abs() < 20 && (g - b).abs() < 20;
      final isRed = r > g + 30 && r > b + 30;

      if (isRed) {
        white.setPixelRgba(x, y, r, g, b, a);
      } else if (isGrayscale && luminance < 100) {
        white.setPixelRgba(x, y, 255, 255, 255, a);
      } else if (isGrayscale) {
        white.setPixelRgba(x, y, 235, 235, 235, a);
      } else {
        white.setPixelRgba(x, y, r, g, b, a);
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
  print('Wrote ${source.width}x${source.height} black+white logo variants.');
}
