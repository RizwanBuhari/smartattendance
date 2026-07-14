// One-off generator: composites the wide Elsewedy Electric wordmark onto a
// padded white square so it survives Android's adaptive-icon circle/squircle
// crop instead of touching the edges. Run with: dart run tool/generate_icon_source.dart
import 'dart:io';

import 'package:image/image.dart' as img;

void main() {
  final logo = img.decodePng(
    File('assets/images/elsewedy-logo-black.png').readAsBytesSync(),
  )!;

  const canvasSize = 1024;
  // Logo occupies ~55% of the canvas width — larger than the original 40%,
  // while still staying under the ~66% safe zone adaptive launchers
  // guarantee stays visible after the circle/squircle mask crop.
  final targetWidth = (canvasSize * 1.25).round();
  final targetHeight = (targetWidth * logo.height / logo.width).round();

  final resizedLogo = img.copyResize(
    logo,
    width: targetWidth,
    height: targetHeight,
    interpolation: img.Interpolation.average,
  );

  final canvas = img.Image(width: canvasSize, height: canvasSize, numChannels: 4);
  img.fill(canvas, color: img.ColorRgb8(255, 255, 255));

  img.compositeImage(
    canvas,
    resizedLogo,
    dstX: (canvasSize - targetWidth) ~/ 2,
    dstY: (canvasSize - targetHeight) ~/ 2,
  );

  File('assets/images/app-icon-source.png').writeAsBytesSync(img.encodePng(canvas));
  // ignore: avoid_print
  print('Wrote assets/images/app-icon-source.png (${canvasSize}x$canvasSize, logo ${targetWidth}x$targetHeight)');
}
