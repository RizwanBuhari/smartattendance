// One-off generator: composites the wide Elsewedy Electric wordmark onto a
// padded, TRANSPARENT square canvas — specifically for the Android 12+
// splash screen API, which renders its image inside a compact, roughly
// square icon slot (same constraint as adaptive launcher icons). Feeding it
// the wide logo directly gets it squeezed non-uniformly to fit that slot,
// which is what caused the "stretched" look — squaring it up first means
// Android scales it uniformly instead. Pre-Android-12 splash (the plain
// `image` field) doesn't have this constraint and keeps using the wide logo.
// Run with: dart run tool/generate_splash_source.dart
import 'dart:io';

import 'package:image/image.dart' as img;

void main() {
  final logo = img.decodePng(
    File('assets/images/elsewedy-logo-transparent.png').readAsBytesSync(),
  )!;

  const canvasSize = 1024;
  // Sized to read clearly at splash size while staying inside Android 12's
  // circular safe zone within the icon slot — the logo's own aspect ratio
  // (~1.5:1) keeps its height well clear of the mask even at this width.
  final targetWidth = (canvasSize * 0.80).round();
  final targetHeight = (targetWidth * logo.height / logo.width).round();

  final resizedLogo = img.copyResize(
    logo,
    width: targetWidth,
    height: targetHeight,
    interpolation: img.Interpolation.average,
  );

  final canvas = img.Image(width: canvasSize, height: canvasSize, numChannels: 4);
  img.fill(canvas, color: img.ColorRgba8(255, 255, 255, 0));

  img.compositeImage(
    canvas,
    resizedLogo,
    dstX: (canvasSize - targetWidth) ~/ 2,
    dstY: (canvasSize - targetHeight) ~/ 2,
  );

  File('assets/images/splash-icon-source.png').writeAsBytesSync(img.encodePng(canvas));
  // ignore: avoid_print
  print('Wrote assets/images/splash-icon-source.png (${canvasSize}x$canvasSize, logo ${targetWidth}x$targetHeight)');
}
