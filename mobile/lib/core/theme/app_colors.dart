import 'package:flutter/material.dart';

// Colour tokens from the Elsewedy Electric UAE design specification (PDF).
// Mobile-only — the dashboard/frontend CSS is untouched.
class AppColors {
  AppColors._();

  // Brand reds
  static const brandRed = Color(0xFFD71920);
  static const brandRedHover = Color(0xFFB9131A); // pressed state
  static const brandRedSoft = Color(0xFFFDECEE); // icon containers, pill backgrounds

  // Neutrals
  static const bg = Color(0xFFF7F8FA); // scaffold background
  static const panel = Color(0xFFFFFFFF); // cards & form surfaces
  static const ink = Color(0xFF17181B); // primary text / headings
  static const inkSoft = Color(0xFF6F747C); // descriptions / labels
  static const muted = Color(0xFFA8ADB4); // disabled text / placeholders
  static const line = Color(0xFFE5E7EB); // borders / dividers

  // Functional status colors
  static const okBg = Color(0xFFEAF7EC);
  static const okText = Color(0xFF2E8B3C);
  static const neutralBg = Color(0xFFF0F1F2);
  static const neutralText = Color(0xFF555B61);
  static const alertBg = Color(0xFFFFF0ED);
  static const alertText = Color(0xFFC83A2D);
  static const lateBg = Color(0xFFFFF3E0);
  static const lateText = Color(0xFF9A5B00);

  static const white = Color(0xFFFFFFFF);
}
