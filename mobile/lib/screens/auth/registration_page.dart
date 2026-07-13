import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../attendance_screen.dart';

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

  // STEP 1: Verification Logic
  Future<void> _verifyCode() async {
    final code = _companyCodeController.text.trim();
    
    setState(() => _isLoading = true);
    
    // Simulate network delay
    await Future.delayed(const Duration(milliseconds: 800));

    // Dummy check for '123456' or check Firestore as implemented before
    // I will keep the Firestore check but allow '123456' for your testing
    bool isValid = (code == '123456');
    
    if (!isValid) {
      // Also check Firestore for dynamic codes
      isValid = await _isCompanyCodeValid(code);
    }

    setState(() {
      _isLoading = false;
      if (isValid) {
        _isCodeVerified = true;
      } else {
        _showSnackBar('Invalid Verification Code');
      }
    });
  }

  Future<bool> _isCompanyCodeValid(String companyCode) async {
    try {
      final normalizedCode = companyCode.trim().toUpperCase();
      final querySnapshot = await FirebaseFirestore.instance
          .collection('company_codes')
          .where('code', isEqualTo: normalizedCode)
          .where('active', isEqualTo: true)
          .get();
      return querySnapshot.docs.isNotEmpty;
    } catch (e) {
      return false;
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

    setState(() => _isLoading = true);

    try {
      final credential = await FirebaseAuth.instance.createUserWithEmailAndPassword(
        email: _emailController.text.trim(),
        password: password,
      );

      final user = credential.user;
      if (user == null) {
        _showSnackBar('Unable to create account.');
        return;
      }

      await FirebaseFirestore.instance.collection('employees').doc(user.uid).set({
        'uid': user.uid,
        'fullName': _fullNameController.text.trim(),
        'nationality': _nationalityController.text.trim(),
        'email': _emailController.text.trim(),
        'companyCode': _companyCodeController.text.trim().toUpperCase(),
        'createdAt': FieldValue.serverTimestamp(),
      });

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
      appBar: AppBar(title: const Text('Register')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: _isCodeVerified ? _buildDetailsForm() : _buildCodeEntryView(),
        ),
      ),
    );
  }

  // UI for Step 1
  Widget _buildCodeEntryView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 40),
        const Icon(Icons.verified_user, size: 80, color: Colors.blue),
        const SizedBox(height: 24),
        const Text(
          'Enter Verification Code',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        const Text(
          'Enter the code provided by your admin to continue.',
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.grey),
        ),
        const SizedBox(height: 32),
        TextField(
          controller: _companyCodeController,
          decoration: const InputDecoration(
            labelText: 'Verification Code',
            border: OutlineInputBorder(),
            prefixIcon: Icon(Icons.vpn_key),
          ),
        ),
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: _isLoading ? null : _verifyCode,
          style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
          child: _isLoading 
            ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
            : const Text('Verify Code'),
        ),
      ],
    );
  }

  // UI for Step 2
  Widget _buildDetailsForm() {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Complete Your Profile',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text('Code Verified: ${_companyCodeController.text.toUpperCase()}', 
            style: const TextStyle(color: Colors.green, fontWeight: FontWeight.w600)),
          const SizedBox(height: 24),
          _buildTextField(_fullNameController, 'Full Name', Icons.person),
          const SizedBox(height: 16),
          _buildTextField(_nationalityController, 'Nationality', Icons.flag),
          const SizedBox(height: 16),
          _buildTextField(_emailController, 'Email', Icons.email, keyboardType: TextInputType.emailAddress),
          const SizedBox(height: 16),
          _buildTextField(_passwordController, 'Password', Icons.lock, isPassword: true),
          const SizedBox(height: 16),
          _buildTextField(_confirmPasswordController, 'Confirm Password', Icons.lock_outline, isPassword: true),
          const SizedBox(height: 32),
          ElevatedButton(
            onPressed: _isLoading ? null : _handleRegistration,
            style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
            child: _isLoading
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Create Account'),
          ),
        ],
      ),
    );
  }

  Widget _buildTextField(TextEditingController controller, String label, IconData icon, {bool isPassword = false, TextInputType? keyboardType}) {
    return TextFormField(
      controller: controller,
      obscureText: isPassword,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
        prefixIcon: Icon(icon),
      ),
      validator: (value) {
        if (value == null || value.trim().isEmpty) return '$label is required';
        if (label == 'Email' && !value.contains('@')) return 'Enter a valid email';
        if (isPassword && value.length < 6) return 'Password too short';
        return null;
      },
    );
  }
}
