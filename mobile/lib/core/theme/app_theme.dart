import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app_colors.dart';

// Brand typeface is Montserrat only (Corporate Identity Manual, Typography
// section) — served via google_fonts since no local .ttf files are bundled.
// Every token below mirrors dashboard/src/index.css so the mobile app and
// the admin dashboard read as one system.
final ThemeData elsewedyTheme = ThemeData(
  useMaterial3: true,
  scaffoldBackgroundColor: AppColors.bg,
  colorScheme: ColorScheme.fromSeed(
    seedColor: AppColors.brandRed,
    primary: AppColors.brandRed,
    onPrimary: AppColors.white,
    secondary: AppColors.inkSoft,
    onSecondary: AppColors.white,
    error: AppColors.alertText,
    onError: AppColors.white,
    surface: AppColors.panel,
    onSurface: AppColors.ink,
  ),
  textTheme: GoogleFonts.montserratTextTheme().copyWith(
    headlineMedium: GoogleFonts.montserrat(
      fontWeight: FontWeight.w700,
      color: AppColors.ink,
    ),
    titleLarge: GoogleFonts.montserrat(
      fontWeight: FontWeight.w600,
      color: AppColors.ink,
    ),
    bodyMedium: GoogleFonts.montserrat(
      fontWeight: FontWeight.w400,
      color: AppColors.muted,
    ),
    labelLarge: GoogleFonts.montserrat(fontWeight: FontWeight.w600),
  ),
  appBarTheme: AppBarTheme(
    backgroundColor: AppColors.bg,
    foregroundColor: AppColors.ink,
    elevation: 0,
    centerTitle: true,
    titleTextStyle: GoogleFonts.montserrat(
      color: AppColors.ink,
      fontSize: 18,
      fontWeight: FontWeight.w600,
    ),
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: AppColors.white,
    contentPadding: const EdgeInsets.symmetric(horizontal: 13, vertical: 14),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(9),
      borderSide: const BorderSide(color: AppColors.line),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(9),
      borderSide: const BorderSide(color: AppColors.line),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(9),
      borderSide: const BorderSide(color: AppColors.brandRed, width: 1.6),
    ),
    errorBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(9),
      borderSide: const BorderSide(color: AppColors.alertText),
    ),
    focusedErrorBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(9),
      borderSide: const BorderSide(color: AppColors.alertText, width: 1.6),
    ),
    labelStyle: GoogleFonts.montserrat(color: AppColors.inkSoft, fontWeight: FontWeight.w600),
    helperStyle: GoogleFonts.montserrat(color: AppColors.muted, fontSize: 12),
  ),
  elevatedButtonTheme: ElevatedButtonThemeData(
    style: ElevatedButton.styleFrom(
      backgroundColor: AppColors.brandRed,
      foregroundColor: AppColors.white,
      disabledBackgroundColor: AppColors.brandRed.withValues(alpha: 0.5),
      minimumSize: const Size.fromHeight(52),
      textStyle: GoogleFonts.montserrat(fontWeight: FontWeight.w600, fontSize: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
    ),
  ),
  outlinedButtonTheme: OutlinedButtonThemeData(
    style: OutlinedButton.styleFrom(
      foregroundColor: AppColors.inkSoft,
      side: const BorderSide(color: AppColors.line, width: 1.4),
      minimumSize: const Size.fromHeight(52),
      textStyle: GoogleFonts.montserrat(fontWeight: FontWeight.w600, fontSize: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
    ),
  ),
  textButtonTheme: TextButtonThemeData(
    style: TextButton.styleFrom(
      foregroundColor: AppColors.brandRed,
      textStyle: GoogleFonts.montserrat(fontWeight: FontWeight.w600),
    ),
  ),
);

// Matches dashboard .card/.login-card — white surface, generous radius,
// soft elevated shadow. Used for the login/registration form containers.
BoxDecoration cardDecoration({double radius = 18}) {
  return BoxDecoration(
    color: AppColors.panel,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: AppColors.line),
    boxShadow: const [
      BoxShadow(color: Color(0x1A101828), blurRadius: 40, offset: Offset(0, 12)),
    ],
  );
}

// Matches dashboard .panel/.stat-tile/.table-wrap — the softer, everyday
// card shadow used for content surfaces rather than the login hero card.
BoxDecoration panelDecoration({double radius = 14}) {
  return BoxDecoration(
    color: AppColors.panel,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: AppColors.line),
    boxShadow: const [
      BoxShadow(color: Color(0x0A101828), blurRadius: 2, offset: Offset(0, 1)),
      BoxShadow(color: Color(0x0A101828), blurRadius: 24, offset: Offset(0, 8)),
    ],
  );
}
