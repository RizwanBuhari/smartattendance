import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';

import 'core/constants/app_strings.dart';
import 'screens/auth/auth_gate.dart';

class SmartAttendanceUIApp extends StatelessWidget {
  const SmartAttendanceUIApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: AppStrings.appTitle,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
        useMaterial3: true,
      ),
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
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        if (snapshot.hasError) {
          return Scaffold(
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  '${AppStrings.firebaseInitError}${snapshot.error}',
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          );
        }

        return const AuthGate();
      },
    );
  }
}
