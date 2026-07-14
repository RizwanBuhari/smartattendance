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
    // Clear space ~= the width of the "E" in the wordmark; approximated here
    // as a fraction of the logo's own width per the manual's proportional rule.
    final clearSpace = width * 0.12;
    return Padding(
      padding: EdgeInsets.all(clearSpace),
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
