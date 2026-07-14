import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;

// Plays an animated GIF asset through once, then freezes on its last frame.
//
// Flutter's Image widget has no "play once" option, and a GIF's own loop-
// count metadata is interpreted inconsistently across decoders (0 means
// different things to different tools) — so instead of fighting that, this
// decodes the GIF with dart:ui directly and steps through exactly
// codec.frameCount frames, then simply stops requesting new ones. Whatever
// frame was last drawn just stays on screen.
class PlayOnceGif extends StatefulWidget {
  const PlayOnceGif({super.key, required this.assetPath, this.width, this.height});

  final String assetPath;
  final double? width;
  final double? height;

  @override
  State<PlayOnceGif> createState() => _PlayOnceGifState();
}

class _PlayOnceGifState extends State<PlayOnceGif> {
  ui.Image? _frame;
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    _play();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  Future<void> _play() async {
    final data = await rootBundle.load(widget.assetPath);
    final codec = await ui.instantiateImageCodec(data.buffer.asUint8List());
    for (var i = 0; i < codec.frameCount; i++) {
      final frameInfo = await codec.getNextFrame();
      if (_disposed) return;
      setState(() => _frame = frameInfo.image);
      final isLastFrame = i == codec.frameCount - 1;
      if (!isLastFrame) {
        await Future.delayed(frameInfo.duration);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final frame = _frame;
    if (frame == null) {
      return SizedBox(width: widget.width, height: widget.height);
    }
    return RawImage(
      image: frame,
      width: widget.width,
      height: widget.height,
      fit: BoxFit.contain,
    );
  }
}
