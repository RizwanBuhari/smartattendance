import 'dart:convert';

import 'package:animations/animations.dart';
import 'package:country_picker/country_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../../core/constants/api_constants.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/brand_logo.dart';
import 'auth_gate.dart';

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

  final _fullNameFocusNode = FocusNode();
  final _passwordFocusNode = FocusNode();
  final _confirmPasswordFocusNode = FocusNode();

  bool _isLoading = false;
  bool _isCodeVerified = false;
  bool _isVerifyButtonPressed = false;
  bool _isRegisterButtonPressed = false;

  String? _verifiedCode;
  String? _verifiedEmployeeId;
  String? _verifiedEmployeeEmail;

  // Real-time password requirement flags
  bool _hasMinLength = false;
  bool _hasUppercase = false;
  bool _hasLowercase = false;
  bool _hasSpecialChar = false;

  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;

  @override
  void initState() {
    super.initState();
    _passwordController.addListener(_onPasswordChanged);
  }

  @override
  void dispose() {
    _companyCodeController.dispose();
    _fullNameController.dispose();
    _nationalityController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _passwordController.removeListener(_onPasswordChanged);
    _fullNameFocusNode.dispose();
    _passwordFocusNode.dispose();
    _confirmPasswordFocusNode.dispose();
    super.dispose();
  }

  void _onPasswordChanged() {
    final value = _passwordController.text;
    setState(() {
      _hasMinLength = value.length >= 8;
      _hasUppercase = RegExp(r'[A-Z]').hasMatch(value);
      _hasLowercase = RegExp(r'[a-z]').hasMatch(value);
      _hasSpecialChar = RegExp(
        r'[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\/~`;]',
      ).hasMatch(value);
    });
  }

  void _showSnackBar(String message, {bool isSuccess = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(
              isSuccess
                  ? Icons.check_circle_outline_rounded
                  : Icons.error_outline_rounded,
              color: AppColors.white,
            ),
            const SizedBox(width: 12),
            Expanded(child: Text(message)),
          ],
        ),
        backgroundColor: isSuccess ? AppColors.okText : AppColors.alertText,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        margin: const EdgeInsets.all(16),
      ),
    );
  }

  Future<void> _verifyCode() async {
    final code = _companyCodeController.text.trim().toUpperCase();
    if (code.isEmpty) return;

    setState(() => _isLoading = true);
    try {
      final uri = Uri.parse(
        '${ApiConstants.baseUrl}/company-codes/check/$code',
      );
      final res = await http.get(uri);

      if (res.statusCode != 200) {
        _showSnackBar('Server error. Ask your admin to check the backend.');
        return;
      }

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
      if (_verifiedEmployeeEmail != null)
        _emailController.text = _verifiedEmployeeEmail!;

      setState(() => _isCodeVerified = true);
      _showSnackBar('Code verified successfully.', isSuccess: true);
    } catch (e) {
      _showSnackBar('Could not verify code. Check your connection.');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _handleRegistration() async {
    if (!_formKey.currentState!.validate()) return;

    final password = _passwordController.text.trim();
    final confirmPassword = _confirmPasswordController.text.trim();

    if (password != confirmPassword) {
      _showSnackBar('Passwords do not match');
      return;
    }

    if (!_hasMinLength ||
        !_hasUppercase ||
        !_hasLowercase ||
        !_hasSpecialChar) {
      _showSnackBar('Password requirements not met');
      return;
    }

    if (_verifiedCode == null) {
      _showSnackBar('Please verify your code again.');
      return;
    }

    if (_verifiedEmployeeEmail != null &&
        _emailController.text.trim().toLowerCase() !=
            _verifiedEmployeeEmail!.trim().toLowerCase()) {
      _showSnackBar('Email must match the one your admin registered for you.');
      return;
    }

    setState(() => _isLoading = true);

    try {
      final credential = await FirebaseAuth.instance
          .createUserWithEmailAndPassword(
            email: _emailController.text.trim(),
            password: password,
          );

      final user = credential.user;
      if (user == null) {
        _showSnackBar('Unable to create account.');
        return;
      }

      try {
        final registerUri = Uri.parse(
          '${ApiConstants.baseUrl}/employees/register',
        );
        final registerRes = await http.post(
          registerUri,
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'authUid': user.uid,
            'name': _fullNameController.text.trim(),
            'email': _emailController.text.trim(),
            'nationality': _nationalityController.text.trim(),
            if (_verifiedEmployeeId != null) 'employeeId': _verifiedEmployeeId,
          }),
        );
        if (registerRes.statusCode != 200 && registerRes.statusCode != 201) {
          throw Exception('Server returned ${registerRes.statusCode}');
        }
      } catch (error) {
        debugPrint('Saving profile failed: $error');
      }

      try {
        final redeemUri = Uri.parse(
          '${ApiConstants.baseUrl}/company-codes/redeem',
        );
        await http.post(
          redeemUri,
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'code': _verifiedCode}),
        );
      } catch (error) {
        debugPrint('Redeeming code failed: $error');
      }

      if (!mounted) return;

      // Show brief success visual before navigation
      _showSnackBar('Account created successfully!', isSuccess: true);
      await Future.delayed(const Duration(milliseconds: 500));

      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const AuthGate()),
        (route) => false,
      );
    } on FirebaseAuthException catch (error) {
      if (mounted) {
        final message = switch (error.code) {
          'email-already-in-use' =>
            'This email is already registered. Try logging in.',
          'weak-password' => 'Choose a stronger password.',
          'invalid-email' => 'Enter a valid email address.',
          _ => error.message ?? 'Registration failed',
        };
        _showSnackBar(message);
      }
    } catch (error) {
      if (mounted) {
        _showSnackBar('Something went wrong. Please try again.');
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _confirmCodeChange() {
    showDialog(
      context: context,
      builder:
          (context) => AlertDialog(
            title: const Text('Use a different code?'),
            content: const Text(
              'Your entered profile information will be cleared.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Keep current code'),
              ),
              TextButton(
                onPressed: () {
                  Navigator.pop(context);
                  setState(() {
                    _isCodeVerified = false;
                    _verifiedCode = null;
                    _verifiedEmployeeId = null;
                    _verifiedEmployeeEmail = null;
                    _fullNameController.clear();
                    _nationalityController.clear();
                    _emailController.clear();
                    _passwordController.clear();
                    _confirmPasswordController.clear();
                  });
                },
                child: const Text('Use another code'),
              ),
            ],
          ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: Padding(
          padding: const EdgeInsets.only(left: 12.0),
          child: Center(
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: AppColors.panel,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.line),
              ),
              child: IconButton(
                padding: EdgeInsets.zero,
                icon: const Icon(Icons.arrow_back_rounded, size: 20),
                onPressed: () {
                  if (_isCodeVerified) {
                    _confirmCodeChange();
                  } else {
                    Navigator.of(context).pop();
                  }
                },
              ),
            ),
          ),
        ),
        title: const BrandLogo(width: 100),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _StepIndicator(activeStep: _isCodeVerified ? 1 : 0),
              const SizedBox(height: 28),
              PageTransitionSwitcher(
                duration: const Duration(milliseconds: 250),
                transitionBuilder:
                    (child, primary, secondary) => SharedAxisTransition(
                      animation: primary,
                      secondaryAnimation: secondary,
                      transitionType: SharedAxisTransitionType.horizontal,
                      child: child,
                    ),
                child:
                    _isCodeVerified
                        ? _buildDetailsForm(key: const ValueKey('details'))
                        : _buildCodeEntryView(key: const ValueKey('code')),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCodeEntryView({Key? key}) {
    return Container(
      key: key,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
      decoration: cardDecoration(radius: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Shield Check Illustration
          Center(
            child: Stack(
              alignment: Alignment.center,
              children: [
                Container(
                  width: 90,
                  height: 90,
                  decoration: const BoxDecoration(
                    color: AppColors.brandRedSoft,
                    shape: BoxShape.circle,
                  ),
                ),
                Container(
                  width: 60,
                  height: 60,
                  decoration: const BoxDecoration(
                    color: AppColors.brandRed,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.shield_outlined,
                    color: AppColors.white,
                    size: 32,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          Text(
            'Enter verification code',
            textAlign: TextAlign.center,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Text(
            'Enter the code provided by your admin to continue.',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 32),
          _buildCustomInputField(
            controller: _companyCodeController,
            label: 'Verification Code',
            placeholder: 'Enter verification code',
            icon: Icons.vpn_key_outlined,
            enabled: !_isLoading,
            textCapitalization: TextCapitalization.characters,
          ),
          const SizedBox(height: 32),
          GestureDetector(
            onTapDown: (_) => setState(() => _isVerifyButtonPressed = true),
            onTapUp: (_) => setState(() => _isVerifyButtonPressed = false),
            onTapCancel: () => setState(() => _isVerifyButtonPressed = false),
            onTap: _isLoading ? null : _verifyCode,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 100),
              transform:
                  Matrix4.identity()..scaleByDouble(
                    _isVerifyButtonPressed ? 0.98 : 1.0,
                    _isVerifyButtonPressed ? 0.98 : 1.0,
                    1.0,
                    1.0,
                  ),
              height: 60,
              decoration: BoxDecoration(
                color:
                    _isVerifyButtonPressed
                        ? AppColors.brandRedHover
                        : AppColors.brandRed,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (_isLoading)
                    const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.white,
                      ),
                    )
                  else
                    const Text(
                      'Verify code',
                      style: TextStyle(
                        color: AppColors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  const SizedBox(width: 8),
                  if (!_isLoading)
                    const Icon(
                      Icons.arrow_forward_rounded,
                      color: AppColors.white,
                      size: 18,
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailsForm({Key? key}) {
    final emailLocked = _verifiedEmployeeEmail != null;

    return Container(
      key: key,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
      decoration: cardDecoration(radius: 24),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Complete your profile',
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            // Verified Badge Green Pill
            Align(
              alignment: Alignment.centerLeft,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: AppColors.okBg,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.check_circle_rounded,
                      color: AppColors.okText,
                      size: 16,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      'Code verified: ${_companyCodeController.text.toUpperCase()}',
                      style: const TextStyle(
                        color: AppColors.okText,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
            // Full Name
            _buildCustomInputField(
              controller: _fullNameController,
              focusNode: _fullNameFocusNode,
              label: 'Full Name',
              placeholder: 'Enter your full name',
              icon: Icons.person_outline_rounded,
              enabled: !_isLoading,
              textCapitalization: TextCapitalization.words,
              validator:
                  (v) =>
                      (v == null || v.trim().isEmpty)
                          ? 'Full name is required'
                          : null,
            ),
            const SizedBox(height: 16),
            // Nationality Dropdown
            _buildNationalityField(),
            const SizedBox(height: 16),
            // Email (Locked if supplied by backend)
            _buildCustomInputField(
              controller: _emailController,
              label: 'Email',
              placeholder: 'Enter your email',
              icon: Icons.mail_outline_rounded,
              keyboardType: TextInputType.emailAddress,
              enabled: !emailLocked && !_isLoading,
              suffixIcon:
                  emailLocked
                      ? const Icon(
                        Icons.lock_outline_rounded,
                        color: AppColors.muted,
                        size: 18,
                      )
                      : null,
              helperText:
                  emailLocked
                      ? 'Locked — must match the email your admin registered for you'
                      : null,
              validator: (v) {
                if (v == null || v.trim().isEmpty) return 'Email is required';
                if (!v.contains('@')) return 'Enter a valid email';
                return null;
              },
            ),
            const SizedBox(height: 16),
            // Password
            _buildCustomInputField(
              controller: _passwordController,
              focusNode: _passwordFocusNode,
              label: 'Password',
              placeholder: 'Enter password',
              icon: Icons.lock_outline_rounded,
              isPassword: true,
              obscureText: _obscurePassword,
              enabled: !_isLoading,
              suffixIcon: GestureDetector(
                onTap:
                    () => setState(() => _obscurePassword = !_obscurePassword),
                child: Icon(
                  _obscurePassword
                      ? Icons.visibility_off_outlined
                      : Icons.visibility_outlined,
                  color: AppColors.inkSoft,
                  size: 20,
                ),
              ),
              validator: (value) {
                if (value == null || value.isEmpty)
                  return 'Password is required';
                if (value.length < 8) return 'Use at least 8 characters';
                return null;
              },
            ),
            const SizedBox(height: 8),
            // Password checklist
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Password requirements:',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.inkSoft,
                    ),
                  ),
                  const SizedBox(height: 4),
                  _checklistRow('At least 8 characters', _hasMinLength),
                  _checklistRow('One uppercase letter', _hasUppercase),
                  _checklistRow('One lowercase letter', _hasLowercase),
                  _checklistRow('One special character', _hasSpecialChar),
                ],
              ),
            ),
            const SizedBox(height: 16),
            // Confirm Password
            _buildCustomInputField(
              controller: _confirmPasswordController,
              focusNode: _confirmPasswordFocusNode,
              label: 'Confirm Password',
              placeholder: 'Re-enter password',
              icon: Icons.lock_reset_rounded,
              isPassword: true,
              obscureText: _obscureConfirmPassword,
              enabled: !_isLoading,
              suffixIcon: GestureDetector(
                onTap:
                    () => setState(
                      () => _obscureConfirmPassword = !_obscureConfirmPassword,
                    ),
                child: Icon(
                  _obscureConfirmPassword
                      ? Icons.visibility_off_outlined
                      : Icons.visibility_outlined,
                  color: AppColors.inkSoft,
                  size: 20,
                ),
              ),
              validator: (value) {
                if (value == null || value.isEmpty)
                  return 'Confirm password is required';
                if (value != _passwordController.text)
                  return 'Passwords do not match';
                return null;
              },
            ),
            const SizedBox(height: 32),
            // Create Account Button
            GestureDetector(
              onTapDown: (_) => setState(() => _isRegisterButtonPressed = true),
              onTapUp: (_) => setState(() => _isRegisterButtonPressed = false),
              onTapCancel:
                  () => setState(() => _isRegisterButtonPressed = false),
              onTap: _isLoading ? null : _handleRegistration,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 100),
                transform:
                    Matrix4.identity()..scaleByDouble(
                      _isRegisterButtonPressed ? 0.98 : 1.0,
                      _isRegisterButtonPressed ? 0.98 : 1.0,
                      1.0,
                      1.0,
                    ),
                height: 60,
                decoration: BoxDecoration(
                  color:
                      _isRegisterButtonPressed
                          ? AppColors.brandRedHover
                          : AppColors.brandRed,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (_isLoading)
                      const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppColors.white,
                        ),
                      )
                    else
                      const Text(
                        'Create account',
                        style: TextStyle(
                          color: AppColors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    const SizedBox(width: 8),
                    if (!_isLoading)
                      const Icon(
                        Icons.arrow_forward_rounded,
                        color: AppColors.white,
                        size: 18,
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: _isLoading ? null : _confirmCodeChange,
              child: const Text('Use a different code'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _checklistRow(String label, bool isSatisfied) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Icon(
            isSatisfied
                ? Icons.check_circle_rounded
                : Icons.radio_button_unchecked_rounded,
            color: isSatisfied ? AppColors.okText : AppColors.muted,
            size: 14,
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: isSatisfied ? AppColors.okText : AppColors.inkSoft,
              fontWeight: isSatisfied ? FontWeight.w500 : FontWeight.normal,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNationalityField() {
    return Container(
      decoration: cardDecoration(radius: 16),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: InkWell(
        onTap:
            _isLoading
                ? null
                : () {
                  showCountryPicker(
                    context: context,
                    showPhoneCode: false,
                    countryListTheme: const CountryListThemeData(
                      borderRadius: BorderRadius.vertical(
                        top: Radius.circular(24),
                      ),
                      inputDecoration: InputDecoration(
                        hintText: 'Search nationality',
                        prefixIcon: Icon(Icons.search_rounded),
                      ),
                    ),
                    onSelect: (Country country) {
                      setState(
                        () => _nationalityController.text = country.name,
                      );
                    },
                  );
                },
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: AppColors.brandRedSoft,
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(
                Icons.flag_outlined,
                color: AppColors.brandRed,
                size: 22,
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Nationality',
                    style: TextStyle(
                      color: AppColors.inkSoft,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _nationalityController.text.isEmpty
                        ? 'Select nationality'
                        : _nationalityController.text,
                    style: TextStyle(
                      color:
                          _nationalityController.text.isEmpty
                              ? AppColors.muted
                              : AppColors.ink,
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.keyboard_arrow_down_rounded,
              color: AppColors.inkSoft,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCustomInputField({
    required TextEditingController controller,
    required String label,
    required String placeholder,
    required IconData icon,
    FocusNode? focusNode,
    bool isPassword = false,
    bool obscureText = false,
    bool enabled = true,
    Widget? suffixIcon,
    String? helperText,
    TextCapitalization textCapitalization = TextCapitalization.none,
    TextInputType? keyboardType,
    String? Function(String?)? validator,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          decoration: cardDecoration(radius: 16),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.brandRedSoft,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: AppColors.brandRed, size: 22),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      label,
                      style: const TextStyle(
                        color: AppColors.inkSoft,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    TextFormField(
                      controller: controller,
                      focusNode: focusNode,
                      obscureText: obscureText,
                      enabled: enabled,
                      keyboardType: keyboardType,
                      textCapitalization: textCapitalization,
                      autocorrect: false,
                      style: const TextStyle(
                        color: AppColors.ink,
                        fontSize: 16,
                        fontWeight: FontWeight.w500,
                      ),
                      decoration: InputDecoration(
                        isDense: true,
                        contentPadding: EdgeInsets.zero,
                        hintText: placeholder,
                        hintStyle: const TextStyle(
                          color: AppColors.muted,
                          fontSize: 15,
                        ),
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        errorBorder: InputBorder.none,
                        focusedErrorBorder: InputBorder.none,
                        fillColor: Colors.transparent,
                        filled: false,
                      ),
                      validator: validator,
                    ),
                  ],
                ),
              ),
              if (suffixIcon != null) suffixIcon,
            ],
          ),
        ),
        if (helperText != null) ...[
          const SizedBox(height: 6),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text(
              helperText,
              style: const TextStyle(
                color: AppColors.inkSoft,
                fontSize: 12,
                height: 1.4,
              ),
            ),
          ),
        ],
      ],
    );
  }

  BoxDecoration cardDecoration({double radius = 16}) {
    return BoxDecoration(
      color: AppColors.panel,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: AppColors.line.withValues(alpha: 0.5)),
      boxShadow: const [
        BoxShadow(
          color: Color(0x12000000),
          blurRadius: 24,
          offset: Offset(0, 6),
        ),
      ],
    );
  }
}

// 3-step indicator matching screen_04 and screen_05
class _StepIndicator extends StatelessWidget {
  const _StepIndicator({required this.activeStep});

  final int activeStep; // 0 = verify code, 1 = complete profile

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
      child: Column(
        children: [
          Row(
            children: [
              _buildStepCircle(0, '1', activeStep > 0),
              _buildStepLine(activeStep >= 1),
              _buildStepCircle(1, '2', activeStep > 1),
              _buildStepLine(activeStep >= 2),
              _buildStepCircle(2, '3', activeStep > 2),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildStepLabel('Verify code', activeStep >= 0),
              _buildStepLabel('Complete profile', activeStep >= 1),
              _buildStepLabel('All set', activeStep >= 2),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStepCircle(int stepIndex, String number, bool isCompleted) {
    final isActive = activeStep == stepIndex;
    return Container(
      width: 32,
      height: 32,
      decoration: BoxDecoration(
        color:
            isCompleted
                ? AppColors.brandRed
                : (isActive ? AppColors.brandRed : AppColors.line),
        shape: BoxShape.circle,
      ),
      child: Center(
        child:
            isCompleted
                ? const Icon(Icons.check, color: AppColors.white, size: 16)
                : Text(
                  number,
                  style: TextStyle(
                    color:
                        (isActive || isCompleted)
                            ? AppColors.white
                            : AppColors.muted,
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  ),
                ),
      ),
    );
  }

  Widget _buildStepLine(bool isActive) {
    return Expanded(
      child: Container(
        height: 3,
        color: isActive ? AppColors.brandRed : AppColors.line,
      ),
    );
  }

  Widget _buildStepLabel(String label, bool isActive) {
    return SizedBox(
      width: 80,
      child: Text(
        label,
        textAlign: TextAlign.center,
        style: TextStyle(
          fontSize: 11,
          fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
          color: isActive ? AppColors.ink : AppColors.inkSoft,
        ),
      ),
    );
  }
}
