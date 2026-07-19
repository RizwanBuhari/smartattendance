import 'package:flutter/material.dart';

// Renders the Elsewedy Electric lockup per the Corporate Identity Manual:
// black version on light backgrounds, white version on dark backgrounds.
// Never stretched (BoxFit.contain) and never recolored/cropped.
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.dark = false, this.width = 180});

  final bool dark; // true = on a dark background, so use the white lockup
  final double width;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(4),
      child: Image.asset(
        dark
            ? 'assets/images/elsewedy-logo-white.png'
            : 'assets/images/elsewedy-logo-transparent.png',
        width: width,
        fit: BoxFit.contain,
      ),
    );
  }
}
