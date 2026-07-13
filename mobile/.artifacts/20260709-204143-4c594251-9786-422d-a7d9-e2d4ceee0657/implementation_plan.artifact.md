# Implementation Plan - Auth Flow & String Extraction

Implement a complete Onboarding, Registration, and Login flow using Firebase Auth and Firestore, and extract hardcoded strings from `app.dart` into a `strings.xml` format.

## User Review Required

- **String Extraction Method**: Flutter does not natively use `strings.xml` (Android format). I will create the `strings.xml` file in the Android resource directory as requested, but I will also create a Dart `AppStrings` class to allow the Flutter code to access these values safely.
- **AttendanceScreen Integration**: The user requested not to rewrite `AttendanceScreen`. I have confirmed it exists and is correctly targeted by the new Auth flow.

## Proposed Changes

### Core Constants
Create a central location for application strings to replace hardcoded values.

#### [NEW] [app_strings.dart](file:///C:/smartattendance/mobile/lib/core/constants/app_strings.dart)
- Define constants for all hardcoded strings found in `app.dart`.

#### [NEW] [strings.xml](file:///C:/smartattendance/mobile/android/app/src/main/res/values/strings.xml)
- Replicate the hardcoded strings in Android XML format as requested.

---

### App Bootstrapping
Refactor `app.dart` to use the new string constants.

#### [app.dart](file:///C:/smartattendance/mobile/lib/app.dart)
- Replace hardcoded strings in `SmartAttendanceUIApp` and `FirebaseBootstrapper` with `AppStrings`.

---

### Authentication Screens (Verification & Refinement)
The existing screens (`OnboardingScreen`, `LoginPage`, `RegistrationPage`) already implement the requested business logic. I will perform a final refinement to ensure they are 100% compliant and robust.

#### [registration_page.dart](file:///C:/smartattendance/mobile/lib/screens/auth/registration_page.dart)
- Verify Firestore collection name is `employees`.
- Ensure all 6 fields (Company Code, Full Name, Nationality, Email, Password, Confirm Password) are correctly handled.
- Confirm the `_isCompanyCodeValid` placeholder is present.

#### [login_page.dart](file:///C:/smartattendance/mobile/lib/screens/auth/login_page.dart)
- Ensure robust Firebase Auth error handling with descriptive SnackBars.

#### [auth_gate.dart](file:///C:/smartattendance/mobile/lib/screens/auth/auth_gate.dart)
- Confirm it correctly mediates between `AttendanceScreen` and `OnboardingScreen` based on Auth state.

## Verification Plan

### Automated Verification
- Run `flutter analyze` to ensure no syntax errors or missing imports.
- Use `analyze_file` on each modified file.

### Manual Verification
- Verify the content of the new `strings.xml` matches the original hardcoded strings.
- Confirm that `app.dart` compiles and runs correctly with the new `AppStrings` constants.
- Review the logic in `RegistrationPage` and `LoginPage` against the 5 business requirements provided.
