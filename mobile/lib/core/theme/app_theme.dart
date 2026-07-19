import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app_colors.dart';

// Design-spec typeface is Inter (PDF §3 Typography).
// Served via google_fonts — no bundled .ttf needed.
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
  textTheme: GoogleFonts.interTextTheme().copyWith(
    headlineLarge: GoogleFonts.inter(
      fontWeight: FontWeight.w700,
      fontSize: 30,
      color: AppColors.ink,
    ),
    headlineMedium: GoogleFonts.inter(
      fontWeight: FontWeight.w700,
      fontSize: 26,
      color: AppColors.ink,
    ),
    headlineSmall: GoogleFonts.inter(
      fontWeight: FontWeight.w700,
      fontSize: 22,
      color: AppColors.ink,
    ),
    titleLarge: GoogleFonts.inter(
      fontWeight: FontWeight.w600,
      fontSize: 20,
      color: AppColors.ink,
    ),
    titleMedium: GoogleFonts.inter(
      fontWeight: FontWeight.w600,
      fontSize: 17,
      color: AppColors.ink,
    ),
    bodyLarge: GoogleFonts.inter(
      fontWeight: FontWeight.w400,
      fontSize: 16,
      color: AppColors.ink,
    ),
    bodyMedium: GoogleFonts.inter(
      fontWeight: FontWeight.w400,
      fontSize: 15,
      color: AppColors.inkSoft,
    ),
    bodySmall: GoogleFonts.inter(
      fontWeight: FontWeight.w400,
      fontSize: 13,
      color: AppColors.inkSoft,
    ),
    labelLarge: GoogleFonts.inter(
      fontWeight: FontWeight.w600,
      fontSize: 17,
    ),
  ),
  appBarTheme: AppBarTheme(
    backgroundColor: AppColors.bg,
    foregroundColor: AppColors.ink,
    elevation: 0,
    scrolledUnderElevation: 0,
    centerTitle: true,
    titleTextStyle: GoogleFonts.inter(
      color: AppColors.ink,
      fontSize: 18,
      fontWeight: FontWeight.w600,
    ),
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: AppColors.white,
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: AppColors.line),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: AppColors.line),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: AppColors.brandRed, width: 1.6),
    ),
    errorBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: AppColors.alertText),
    ),
    focusedErrorBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: AppColors.alertText, width: 1.6),
    ),
    labelStyle: GoogleFonts.inter(color: AppColors.inkSoft, fontWeight: FontWeight.w500, fontSize: 15),
    hintStyle: GoogleFonts.inter(color: AppColors.muted, fontSize: 15),
    helperStyle: GoogleFonts.inter(color: AppColors.inkSoft, fontSize: 13),
    helperMaxLines: 2,
  ),
  elevatedButtonTheme: ElevatedButtonThemeData(
    style: ElevatedButton.styleFrom(
      backgroundColor: AppColors.brandRed,
      foregroundColor: AppColors.white,
      disabledBackgroundColor: AppColors.brandRed.withValues(alpha: 0.5),
      minimumSize: const Size.fromHeight(60),
      textStyle: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 17),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      elevation: 0,
    ),
  ),
  outlinedButtonTheme: OutlinedButtonThemeData(
    style: OutlinedButton.styleFrom(
      foregroundColor: AppColors.brandRed,
      side: const BorderSide(color: AppColors.brandRed, width: 1.4),
      minimumSize: const Size.fromHeight(60),
      textStyle: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 17),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      elevation: 0,
    ),
  ),
  textButtonTheme: TextButtonThemeData(
    style: TextButton.styleFrom(
      foregroundColor: AppColors.brandRed,
      textStyle: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 15),
    ),
  ),
);

// Design-spec card — white, 20–24 px radius, soft shadow per PDF §5.
BoxDecoration cardDecoration({double radius = 22}) {
  return BoxDecoration(
    color: AppColors.panel,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: AppColors.line.withValues(alpha: 0.5)),
    boxShadow: const [
      BoxShadow(color: Color(0x12000000), blurRadius: 24, offset: Offset(0, 6)),
    ],
  );
}

// Lighter panel shadow for content surfaces.
BoxDecoration panelDecoration({double radius = 20}) {
  return BoxDecoration(
    color: AppColors.panel,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: AppColors.line.withValues(alpha: 0.4)),
    boxShadow: const [
      BoxShadow(color: Color(0x08000000), blurRadius: 16, offset: Offset(0, 4)),
    ],
  );
}
