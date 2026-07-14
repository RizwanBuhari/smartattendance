import 'dart:convert';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:country_picker/country_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../core/theme/app_colors.dart';
import '../core/theme/app_theme.dart';

// Shows (and, in edit mode, updates) the signed-in employee's own profile —
// full name, nationality, and photo. Email/status stay read-only here: email
// is tied to the Firebase Auth identity, and status is admin-controlled from
// the dashboard.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _nationalityController = TextEditingController();

  bool _isLoading = true;
  bool _isSaving = false;
  bool _isEditing = false;

  String? _email;
  String? _status;
  String? _photoBase64; // the photo itself, stored inline on the Firestore doc — see _handleSave
  String? _employeeDocId; // found via an authUid query — see attendance.service.ts's getEmployee for why
  File? _pickedImage;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _nationalityController.dispose();
    super.dispose();
  }

  void _showSnackBar(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _loadProfile() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) {
      // Defensive — shouldn't happen since this screen is only reachable
      // while signed in, but without this the spinner would otherwise spin
      // forever instead of showing anything.
      setState(() => _isLoading = false);
      _showSnackBar('Not signed in.');
      return;
    }

    setState(() => _isLoading = true);
    try {
      final snapshot = await FirebaseFirestore.instance
          .collection('employees')
          .where('authUid', isEqualTo: uid)
          .limit(1)
          .get();

      if (snapshot.docs.isEmpty) {
        _showSnackBar('Could not find your profile.');
        return;
      }

      final doc = snapshot.docs.first;
      final data = doc.data();
      setState(() {
        _employeeDocId = doc.id;
        _nameController.text = data['name'] as String? ?? '';
        _nationalityController.text = data['nationality'] as String? ?? '';
        _email = data['email'] as String?;
        _status = data['status'] as String?;
        _photoBase64 = data['photoBase64'] as String?;
      });
    } catch (e) {
      // Show the real error, not just a generic message — this is very
      // likely a Firestore security rules issue on the query (a common
      // gotcha: rules that allow reading your own doc by ID don't
      // necessarily allow a `where` query the same way), and there's no way
      // to see or fix your Firestore rules from here — so surfacing the
      // actual exception is the fastest way to find out what's wrong.
      debugPrint('Profile load failed: $e');
      _showSnackBar('Could not load your profile: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _pickImage() async {
    // Kept small — this gets base64-encoded straight into the Firestore
    // document (no Firebase Storage, which needs the paid Blaze plan), and
    // Firestore caps a document at 1MB, so the photo needs to stay compact.
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 512,
      imageQuality: 70,
    );
    if (picked != null) {
      setState(() => _pickedImage = File(picked.path));
    }
  }

  Future<void> _handleSave() async {
    if (!_formKey.currentState!.validate()) return;

    final docId = _employeeDocId;
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (docId == null || uid == null) {
      // Your profile never actually loaded (see the error when this screen
      // opened), so there's nothing to save against — surface that instead
      // of silently doing nothing.
      _showSnackBar('Your profile could not be loaded, so there is nothing to save yet.');
      return;
    }

    setState(() => _isSaving = true);
    try {
      String? photoBase64 = _photoBase64;
      if (_pickedImage != null) {
        final bytes = await _pickedImage!.readAsBytes();
        photoBase64 = base64Encode(bytes);
      }

      await FirebaseFirestore.instance.collection('employees').doc(docId).update({
        'name': _nameController.text.trim(),
        'nationality': _nationalityController.text.trim(),
        if (photoBase64 != null) 'photoBase64': photoBase64,
      });

      setState(() {
        _photoBase64 = photoBase64;
        _pickedImage = null;
        _isEditing = false;
      });
      _showSnackBar('Profile updated.');
    } catch (e) {
      debugPrint('Profile save failed: $e');
      _showSnackBar('Could not save your changes: $e');
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        actions: [
          if (!_isLoading)
            IconButton(
              tooltip: _isEditing ? 'Cancel' : 'Edit',
              icon: Icon(_isEditing ? Icons.close : Icons.edit),
              onPressed: _isSaving
                  ? null
                  : () => setState(() {
                        if (_isEditing) _pickedImage = null; // discard unsaved pick on cancel
                        _isEditing = !_isEditing;
                      }),
            ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SafeArea(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(
                        child: Stack(
                          children: [
                            CircleAvatar(
                              radius: 52,
                              backgroundColor: AppColors.neutralBg,
                              backgroundImage: _pickedImage != null
                                  ? FileImage(_pickedImage!) as ImageProvider
                                  : (_photoBase64 != null ? MemoryImage(base64Decode(_photoBase64!)) : null),
                              child: (_pickedImage == null && _photoBase64 == null)
                                  ? const Icon(Icons.person, size: 52, color: AppColors.muted)
                                  : null,
                            ),
                            if (_isEditing)
                              Positioned(
                                right: 0,
                                bottom: 0,
                                child: GestureDetector(
                                  onTap: _pickImage,
                                  child: Container(
                                    padding: const EdgeInsets.all(6),
                                    decoration: const BoxDecoration(
                                      color: AppColors.brandRed,
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(Icons.camera_alt, size: 18, color: AppColors.white),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 28),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
                        decoration: cardDecoration(radius: 16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _isEditing
                                ? TextFormField(
                                    controller: _nameController,
                                    decoration: const InputDecoration(
                                      labelText: 'Full name',
                                      prefixIcon: Icon(Icons.person),
                                    ),
                                    validator: (v) =>
                                        (v == null || v.trim().isEmpty) ? 'Full name is required' : null,
                                  )
                                : _ProfileField(label: 'Full name', value: _nameController.text),
                            const SizedBox(height: 16),
                            _isEditing
                                ? TextFormField(
                                    controller: _nationalityController,
                                    readOnly: true,
                                    decoration: const InputDecoration(
                                      labelText: 'Nationality',
                                      prefixIcon: Icon(Icons.flag),
                                      suffixIcon: Icon(Icons.arrow_drop_down),
                                    ),
                                    onTap: () {
                                      showCountryPicker(
                                        context: context,
                                        showPhoneCode: false,
                                        onSelect: (country) =>
                                            setState(() => _nationalityController.text = country.name),
                                      );
                                    },
                                    validator: (v) =>
                                        (v == null || v.trim().isEmpty) ? 'Nationality is required' : null,
                                  )
                                : _ProfileField(label: 'Nationality', value: _nationalityController.text),
                            const SizedBox(height: 16),
                            _ProfileField(label: 'Email', value: _email ?? '—'),
                            const SizedBox(height: 16),
                            _ProfileField(label: 'Status', value: _status ?? '—'),
                          ],
                        ),
                      ),
                      if (_isEditing) ...[
                        const SizedBox(height: 24),
                        ElevatedButton(
                          onPressed: _isSaving ? null : _handleSave,
                          child: _isSaving
                              ? const SizedBox(
                                  height: 20,
                                  width: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.white),
                                )
                              : const Text('Save changes'),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
    );
  }
}

class _ProfileField extends StatelessWidget {
  const _ProfileField({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 12, color: AppColors.muted, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 4),
        Text(
          value.isEmpty ? '—' : value,
          style: const TextStyle(fontSize: 16, color: AppColors.ink),
        ),
      ],
    );
  }
}
