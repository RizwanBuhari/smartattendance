import 'package:flutter/material.dart';

// Mirrors dashboard/src/index.css exactly, so the mobile app and the admin
// dashboard read as one system rather than two separate interpretations of
// the brand manual.
class AppColors {
  AppColors._();

  // Brand
  static const brandRed = Color(0xFFCE1B28);
  static const brandRedHover = Color(0xFFB0151F);
  static const brandRedSoft = Color(0xFFFDECEE);

  // Neutrals
  static const bg = Color(0xFFF4F5F6); // page/scaffold background
  static const panel = Color(0xFFFFFFFF); // card/panel surface
  static const ink = Color(0xFF212121); // primary text
  static const inkSoft = Color(0xFF333333); // secondary text
  static const muted = Color(0xFF6F7378); // hints/labels
  static const line = Color(0xFFEAEAEA); // borders/dividers

  // Functional status colors
  static const okBg = Color(0xFFE7F6E8);
  static const okText = Color(0xFF2F7A31);
  static const neutralBg = Color(0xFFF0F1F2);
  static const neutralText = Color(0xFF555B61);
  static const alertBg = Color(0xFFFDECEE);
  static const alertText = Color(0xFFA8121E);
  static const lateBg = Color(0xFFFFF3E0);
  static const lateText = Color(0xFF9A5B00);

  static const white = Color(0xFFFFFFFF);
}
