import 'dart:convert';

import 'package:animations/animations.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/brand_logo.dart';
import '../attendance_screen.dart';

// Backend base URL — 10.0.2.2 is how the Android emulator reaches the host
// machine's localhost. Swap this for a real host when testing on a device.
const _kBackendBaseUrl = 'http://10.0.2.2:3000';

class RegistrationPage extends StatefulWidget {
  const RegistrationPage({super.key});

  @override
  State<RegistrationPage> createState() => _RegistrationPageState();
}

class _RegistrationPageState extends State<RegistrationPage> {
  final _formKey = GlobalKey<FormState>();
  final _companyCodeController = TextEditingController();
  final _fullNameController = TextEditingController();
  final _nationalityController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  bool _isLoading = false;
  bool _isCodeVerified = false; // Toggle for the two-step process

  // Set once the code passes the (non-consuming) check in step 1, and used to
  // redeem it for real in step 2. employeeId is null for a standalone code
  // (brand-new user); if set, it points at an employee doc the admin already
  // created, which this registration links to via authUid. When set,
  // employeeEmail is the email the admin put on that employee record — the
  // person registering must use that same email, so the field gets
  // pre-filled and locked rather than left open to a mismatch.
  String? _verifiedCode;
  String? _verifiedEmployeeId;
  String? _verifiedEmployeeEmail;

  @override
  void dispose() {
    _companyCodeController.dispose();
    _fullNameController.dispose();
    _nationalityController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  void _showSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  // STEP 1: Verification Logic — a read-only check against the backend.
  // Doesn't consume the code; that only happens at final submit (_handleRegistration).
  Future<void> _verifyCode() async {
    final code = _companyCodeController.text.trim().toUpperCase();
    if (code.isEmpty) return;

    setState(() => _isLoading = true);
    try {
      final res = await http.get(
        Uri.parse('$_kBackendBaseUrl/company-codes/check/$code'),
      );
      final body = jsonDecode(res.body) as Map<String, dynamic>;

      if (body['ok'] != true) {
        _showSnackBar('Invalid or already-used code.');
        return;
      }

      _verifiedCode = code;
      _verifiedEmployeeId = body['employeeId'] as String?;
      _verifiedEmployeeEmail = body['employeeEmail'] as String?;
      final employeeName = body['employeeName'] as String?;
      if (employeeName != null) _fullNameController.text = employeeName;
      if (_verifiedEmployeeEmail != null) _emailController.text = _verifiedEmployeeEmail!;
      setState(() => _isCodeVerified = true);
    } catch (e) {
      _showSnackBar('Could not verify code. Check your connection.');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  // STEP 2: Final Registration
  Future<void> _handleRegistration() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    final password = _passwordController.text.trim();
    final confirmPassword = _confirmPasswordController.text.trim();

    if (password != confirmPassword) {
      _showSnackBar('Passwords do not match');
      return;
    }

    if (_verifiedCode == null) {
      _showSnackBar('Please verify your code again.');
      return;
    }

    // Defense in depth: the email field is locked to this value when set (see
    // _buildDetailsForm), but guard against it anyway before touching auth/Firestore.
    if (_verifiedEmployeeEmail != null &&
        _emailController.text.trim().toLowerCase() != _verifiedEmployeeEmail!.trim().toLowerCase()) {
      _showSnackBar('Email must match the one your admin registered for you.');
      return;
    }

    setState(() => _isLoading = true);

    try {
      // Claim the code for real now — this is the single-use consumption.
      final redeemRes = await http.post(
        Uri.parse('$_kBackendBaseUrl/company-codes/redeem'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'code': _verifiedCode}),
      );
      final redeemBody = jsonDecode(redeemRes.body) as Map<String, dynamic>;
      if (redeemBody['ok'] != true) {
        _showSnackBar('This code was just used elsewhere. Request a new one.');
        setState(() => _isCodeVerified = false);
        return;
      }

      final credential = await FirebaseAuth.instance.createUserWithEmailAndPassword(
        email: _emailController.text.trim(),
        password: password,
      );

      final user = credential.user;
      if (user == null) {
        _showSnackBar('Unable to create account.');
        return;
      }

      if (_verifiedEmployeeId != null) {
        // Code was issued for a specific employee the admin already created —
        // link this login to that existing employee record.
        await FirebaseFirestore.instance
            .collection('employees')
            .doc(_verifiedEmployeeId)
            .update({'authUid': user.uid});
      } else {
        // Standalone code: no employee record yet — create one, keyed by the
        // auth UID (and with an explicit authUid field, so the backend can
        // look employees up by that field uniformly regardless of which
        // registration path created them).
        await FirebaseFirestore.instance.collection('employees').doc(user.uid).set({
          'name': _fullNameController.text.trim(),
          'email': _emailController.text.trim(),
          'status': 'active',
          'assignedLocationIds': <String>[],
          'nationality': _nationalityController.text.trim(),
          'authUid': user.uid,
        });
      }

      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const AttendanceScreen()),
        (route) => false,
      );
    } on FirebaseAuthException catch (error) {
      if (mounted) _showSnackBar(error.message ?? 'Registration failed');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const BrandLogo(width: 36)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _StepIndicator(activeStep: _isCodeVerified ? 1 : 0),
              const SizedBox(height: 28),
              PageTransitionSwitcher(
                duration: const Duration(milliseconds: 320),
                transitionBuilder: (child, primary, secondary) => SharedAxisTransition(
                  animation: primary,
                  secondaryAnimation: secondary,
                  transitionType: SharedAxisTransitionType.horizontal,
                  child: child,
                ),
                child: _isCodeVerified
                    ? _buildDetailsForm(key: const ValueKey('details'))
                    : _buildCodeEntryView(key: const ValueKey('code')),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // UI for Step 1
  Widget _buildCodeEntryView({Key? key}) {
    return _StepCard(
      key: key,
      children: [
        const Icon(Icons.verified_user, size: 64, color: AppColors.brandRed),
        const SizedBox(height: 20),
        Text(
          'Enter verification code',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 8),
        Text(
          'Enter the code provided by your admin to continue.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 28),
        TextField(
          controller: _companyCodeController,
          textCapitalization: TextCapitalization.characters,
          decoration: const InputDecoration(
            labelText: 'Verification code',
            prefixIcon: Icon(Icons.vpn_key),
          ),
        ),
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: _isLoading ? null : _verifyCode,
          child: _LoadingLabel(isLoading: _isLoading, label: 'Verify code'),
        ),
      ],
    );
  }

  // UI for Step 2
  Widget _buildDetailsForm({Key? key}) {
    return _StepCard(
      key: key,
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Complete your profile', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.check_circle, size: 18, color: AppColors.okText),
                const SizedBox(width: 6),
                Text(
                  'Code verified: ${_companyCodeController.text.toUpperCase()}',
                  style: const TextStyle(color: AppColors.okText, fontWeight: FontWeight.w600),
                ),
              ],
            ),
            const SizedBox(height: 24),
            _buildTextField(_fullNameController, 'Full name', Icons.person),
            const SizedBox(height: 16),
            _buildTextField(_nationalityController, 'Nationality', Icons.flag),
            const SizedBox(height: 16),
            _buildTextField(
              _emailController,
              'Email',
              Icons.email,
              keyboardType: TextInputType.emailAddress,
              enabled: _verifiedEmployeeEmail == null,
              helperText: _verifiedEmployeeEmail != null
                  ? 'Locked — must match the email your admin registered for you'
                  : null,
            ),
            const SizedBox(height: 16),
            _buildTextField(
              _passwordController,
              'Password',
              Icons.lock,
              isPassword: true,
              helperText: 'At least 8 characters, with upper, lower & a special character',
              validator: _validatePassword,
            ),
            const SizedBox(height: 16),
            _buildTextField(_confirmPasswordController, 'Confirm password', Icons.lock_outline, isPassword: true),
            const SizedBox(height: 28),
            ElevatedButton(
              onPressed: _isLoading ? null : _handleRegistration,
              child: _LoadingLabel(isLoading: _isLoading, label: 'Create account'),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _isLoading
                  ? null
                  : () => setState(() {
                        _isCodeVerified = false;
                        _verifiedCode = null;
                        _verifiedEmployeeId = null;
                        _verifiedEmployeeEmail = null;
                      }),
              child: const Text('Use a different code'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTextField(
    TextEditingController controller,
    String label,
    IconData icon, {
    bool isPassword = false,
    bool enabled = true,
    TextInputType? keyboardType,
    String? helperText,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: controller,
      obscureText: isPassword,
      enabled: enabled,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        labelText: label,
        helperText: helperText,
        helperMaxLines: 2,
        prefixIcon: Icon(icon, color: enabled ? null : AppColors.muted),
        suffixIcon: enabled ? null : const Icon(Icons.lock_outline, size: 18, color: AppColors.muted),
      ),
      validator: validator ??
          (value) {
            if (value == null || value.trim().isEmpty) return '$label is required';
            if (label == 'Email' && !value.contains('@')) return 'Enter a valid email';
            return null;
          },
    );
  }

  // Minimum 8 characters, at least one uppercase, one lowercase, and one
  // special (non-alphanumeric) character.
  String? _validatePassword(String? value) {
    if (value == null || value.isEmpty) return 'Password is required';
    if (value.length < 8) return 'Use at least 8 characters';
    if (!RegExp(r'[A-Z]').hasMatch(value)) return 'Add at least one uppercase letter';
    if (!RegExp(r'[a-z]').hasMatch(value)) return 'Add at least one lowercase letter';
    if (!RegExp(r'[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\/~`;]').hasMatch(value)) {
      return 'Add at least one special character';
    }
    return null;
  }
}

// Two-segment progress indicator: red = active/complete, light gray = upcoming.
class _StepIndicator extends StatelessWidget {
  const _StepIndicator({required this.activeStep});

  final int activeStep; // 0 = code entry, 1 = details

  @override
  Widget build(BuildContext context) {
    Widget segment(bool active) => Expanded(
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 250),
            height: 4,
            decoration: BoxDecoration(
              color: active ? AppColors.brandRed : AppColors.line,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        );

    return Row(
      children: [
        segment(activeStep >= 0),
        const SizedBox(width: 6),
        segment(activeStep >= 1),
      ],
    );
  }
}

// Shared white, rounded, bordered surface both registration steps render in.
class _StepCard extends StatelessWidget {
  const _StepCard({super.key, this.children, this.child})
      : assert(children != null || child != null);

  final List<Widget>? children;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      decoration: cardDecoration(),
      child: child ??
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: children!,
          ),
    );
  }
}

// Cross-fades a button's label with a spinner instead of an abrupt rebuild.
class _LoadingLabel extends StatelessWidget {
  const _LoadingLabel({required this.isLoading, required this.label});

  final bool isLoading;
  final String label;

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 200),
      child: isLoading
          ? const SizedBox(
              key: ValueKey('spinner'),
              height: 20,
              width: 20,
              child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.white),
            )
          : Text(label, key: const ValueKey('label')),
    );
  }
}
