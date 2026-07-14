import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../core/widgets/branded_status_screen.dart';
import '../../core/widgets/location_permission_gate.dart';
import '../attendance_screen.dart';
import 'onboarding_screen.dart';

class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const BrandedLoadingScreen();
        }

        if (snapshot.hasData) {
          return const LocationPermissionGate(child: AttendanceScreen());
        }

        return const OnboardingScreen();
      },
    );
  }
}