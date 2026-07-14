import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';

import 'core/constants/app_strings.dart';
import 'core/theme/app_theme.dart';
import 'core/widgets/branded_status_screen.dart';
import 'screens/auth/auth_gate.dart';

class SmartAttendanceUIApp extends StatelessWidget {
  const SmartAttendanceUIApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: AppStrings.appTitle,
      theme: elsewedyTheme,
      home: const FirebaseBootstrapper(),
    );
  }
}

class FirebaseBootstrapper extends StatelessWidget {
  const FirebaseBootstrapper({super.key});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<FirebaseApp>(
      future: Firebase.initializeApp(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const BrandedLoadingScreen(message: AppStrings.firebaseInitWaiting);
        }

        if (snapshot.hasError) {
          return BrandedErrorScreen(
            message: '${AppStrings.firebaseInitError}${snapshot.error}',
          );
        }

        return const AuthGate();
      },
    );
  }
}
