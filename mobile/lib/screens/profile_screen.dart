import 'dart:convert';
import 'dart:io';

import 'package:country_picker/country_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';

import '../core/constants/api_constants.dart';
import '../core/theme/app_colors.dart';
import '../core/services/session_guard.dart';
import 'auth/auth_gate.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, this.hideBackButton = false});

  final bool hideBackButton;

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
  String? _photoBase64;
  String? _employeeDocId;
  File? _pickedImage;

  // Track initial values to activate/disable Save changes button
  String _initialName = '';
  String _initialNationality = '';
  bool _hasPhotoChanged = false;

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

  void _showSnackBar(String message, {bool isSuccess = false}) {
    if (!mounted) return;
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

  Future<void> _loadProfile() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) {
      setState(() => _isLoading = false);
      _showSnackBar('Not signed in.');
      return;
    }

    setState(() => _isLoading = true);
    try {
      final uri = Uri.parse(
        '${ApiConstants.baseUrl}/employees/me?authUid=$uid',
      );
      final res = await http.get(uri);

      if (res.statusCode != 200) {
        throw Exception('Server returned ${res.statusCode}');
      }

      final data = jsonDecode(res.body) as Map<String, dynamic>?;
      if (data == null) {
        _showSnackBar('Could not find your profile.');
        return;
      }

      setState(() {
        _employeeDocId = data['id'] as String?;
        _nameController.text = data['name'] as String? ?? '';
        _nationalityController.text = data['nationality'] as String? ?? '';
        _email = data['email'] as String?;
        _status = data['status'] as String?;
        _photoBase64 = data['photoBase64'] as String?;
        _initialName = _nameController.text;
        _initialNationality = _nationalityController.text;
        _hasPhotoChanged = false;
        _isLoading = false;
      });
    } catch (e) {
      debugPrint('Profile load failed: $e');
      _showSnackBar('Could not load your profile.');
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _pickImage() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 512,
      imageQuality: 70,
    );
    if (picked != null) {
      setState(() {
        _pickedImage = File(picked.path);
        _hasPhotoChanged = true;
      });
    }
  }

  Future<void> _handleSave() async {
    if (!_formKey.currentState!.validate()) return;

    final docId = _employeeDocId;
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (docId == null || uid == null) {
      _showSnackBar('Profile could not be loaded.');
      return;
    }

    setState(() => _isSaving = true);
    try {
      String? photoBase64 = _photoBase64;
      if (_pickedImage != null) {
        final bytes = await _pickedImage!.readAsBytes();
        photoBase64 = base64Encode(bytes);
      }

      final uri = Uri.parse(
        '${ApiConstants.baseUrl}/employees/me?authUid=$uid',
      );
      final res = await http.patch(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'name': _nameController.text.trim(),
          'nationality': _nationalityController.text.trim(),
          if (_hasPhotoChanged) 'photoBase64': photoBase64,
        }),
      );
      if (res.statusCode != 200) {
        throw Exception('Server returned ${res.statusCode}');
      }

      setState(() {
        _photoBase64 = photoBase64;
        _pickedImage = null;
        _isEditing = false;
        _initialName = _nameController.text;
        _initialNationality = _nationalityController.text;
        _hasPhotoChanged = false;
      });
      _showSnackBar('Profile updated successfully.', isSuccess: true);
    } catch (e) {
      debugPrint('Profile save failed: $e');
      _showSnackBar('Could not save your changes.');
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  void _confirmDiscard() {
    final hasChanges =
        _nameController.text != _initialName ||
        _nationalityController.text != _initialNationality ||
        _pickedImage != null;

    if (hasChanges) {
      showDialog(
        context: context,
        builder:
            (context) => AlertDialog(
              title: const Text('Discard unsaved changes?'),
              content: const Text('Your profile changes have not been saved.'),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Keep editing'),
                ),
                TextButton(
                  onPressed: () {
                    Navigator.pop(context);
                    setState(() {
                      _nameController.text = _initialName;
                      _nationalityController.text = _initialNationality;
                      _pickedImage = null;
                      _isEditing = false;
                    });
                  },
                  child: const Text('Discard'),
                ),
              ],
            ),
      );
    } else {
      setState(() => _isEditing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasChanges =
        _nameController.text != _initialName ||
        _nationalityController.text != _initialNationality ||
        _pickedImage != null;

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading:
            widget.hideBackButton
                ? null
                : Padding(
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
                          if (_isEditing) {
                            _confirmDiscard();
                          } else {
                            Navigator.of(context).pop();
                          }
                        },
                      ),
                    ),
                  ),
                ),
        title: Text(
          _isEditing ? 'Edit profile' : 'Profile',
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        actions: [
          if (!_isLoading) ...[
            if (_isEditing)
              IconButton(
                tooltip: 'Cancel',
                icon: const Icon(
                  Icons.close_rounded,
                  size: 24,
                  color: AppColors.ink,
                ),
                onPressed: _isSaving ? null : _confirmDiscard,
              )
            else
              IconButton(
                tooltip: 'Edit profile',
                icon: const Icon(
                  Icons.edit_outlined,
                  size: 22,
                  color: AppColors.ink,
                ),
                onPressed: () => setState(() => _isEditing = true),
              ),
          ],
          const SizedBox(width: 8),
        ],
      ),
      body:
          _isLoading
              ? _buildSkeleton()
              : SafeArea(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.only(
                    left: 24,
                    right: 24,
                    top: 8,
                    bottom: 100,
                  ),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const SizedBox(height: 16),
                        // Avatar Area
                        Center(
                          child: Stack(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(4),
                                decoration: const BoxDecoration(
                                  color: AppColors.white,
                                  shape: BoxShape.circle,
                                  boxShadow: [
                                    BoxShadow(
                                      color: Color(0x0F000000),
                                      blurRadius: 16,
                                      offset: Offset(0, 4),
                                    ),
                                  ],
                                ),
                                child: CircleAvatar(
                                  radius: 56,
                                  backgroundColor: AppColors.bg,
                                  backgroundImage:
                                      _pickedImage != null
                                          ? FileImage(_pickedImage!)
                                              as ImageProvider
                                          : (_photoBase64 != null
                                              ? MemoryImage(
                                                base64Decode(_photoBase64!),
                                              )
                                              : null),
                                  child:
                                      (_pickedImage == null &&
                                              _photoBase64 == null)
                                          ? const Icon(
                                            Icons.person_outline_rounded,
                                            size: 48,
                                            color: AppColors.inkSoft,
                                          )
                                          : null,
                                ),
                              ),
                              if (_isEditing)
                                Positioned(
                                  right: 0,
                                  bottom: 0,
                                  child: GestureDetector(
                                    onTap: _pickImage,
                                    child: Container(
                                      padding: const EdgeInsets.all(10),
                                      decoration: const BoxDecoration(
                                        color: AppColors.brandRed,
                                        shape: BoxShape.circle,
                                        boxShadow: [
                                          BoxShadow(
                                            color: Color(0x2A000000),
                                            blurRadius: 8,
                                            offset: Offset(0, 3),
                                          ),
                                        ],
                                      ),
                                      child: const Icon(
                                        Icons.camera_alt_outlined,
                                        size: 18,
                                        color: AppColors.white,
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 32),
                        // Main Information Card
                        Container(
                          padding: const EdgeInsets.all(20),
                          decoration: cardDecoration(radius: 24),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              // Full Name row
                              _isEditing
                                  ? _buildEditableField(
                                    controller: _nameController,
                                    label: 'Full name',
                                    icon: Icons.person_outline_rounded,
                                    validator:
                                        (v) =>
                                            (v == null || v.trim().isEmpty)
                                                ? 'Full name is required'
                                                : null,
                                  )
                                  : _buildViewField(
                                    label: 'Full name',
                                    value: _nameController.text,
                                    icon: Icons.person_outline_rounded,
                                  ),
                              const SizedBox(height: 16),
                              const Divider(color: AppColors.line),
                              const SizedBox(height: 16),
                              // Nationality row
                              _isEditing
                                  ? _buildNationalityDropdown()
                                  : _buildViewField(
                                    label: 'Nationality',
                                    value: _nationalityController.text,
                                    icon: Icons.flag_outlined,
                                  ),
                              const SizedBox(height: 16),
                              const Divider(color: AppColors.line),
                              const SizedBox(height: 16),
                              // Email row (always read-only)
                              _buildViewField(
                                label: 'Email',
                                value: _email ?? '—',
                                icon: Icons.mail_outline_rounded,
                                isLocked: _isEditing,
                              ),
                              const SizedBox(height: 16),
                              const Divider(color: AppColors.line),
                              const SizedBox(height: 16),
                              // Status row (always read-only)
                              _buildViewField(
                                label: 'Status',
                                value: _status ?? '—',
                                icon: Icons.verified_user_outlined,
                                isStatus: true,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 24),
                        // Account status active banner (View mode only)
                        if (!_isEditing)
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: cardDecoration(radius: 20),
                            child: Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(8),
                                  decoration: const BoxDecoration(
                                    color: AppColors.brandRedSoft,
                                    shape: BoxShape.circle,
                                  ),
                                  child: const Icon(
                                    Icons.shield_outlined,
                                    color: AppColors.brandRed,
                                    size: 20,
                                  ),
                                ),
                                const SizedBox(width: 14),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        _status?.toLowerCase() == 'active'
                                            ? 'Your account is active'
                                            : 'Account status description',
                                        style: const TextStyle(
                                          color: AppColors.ink,
                                          fontWeight: FontWeight.w700,
                                          fontSize: 14,
                                        ),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        _status?.toLowerCase() == 'active'
                                            ? 'You can check in and check out as usual.'
                                            : 'Please contact your administrator.',
                                        style: const TextStyle(
                                          color: AppColors.inkSoft,
                                          fontSize: 13,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        // Save button (Edit mode only)
                        if (_isEditing) ...[
                          const SizedBox(height: 8),
                          ElevatedButton(
                            onPressed:
                                (_isSaving || !hasChanges) ? null : _handleSave,
                            style: ElevatedButton.styleFrom(
                              backgroundColor:
                                  hasChanges
                                      ? AppColors.brandRed
                                      : AppColors.muted.withValues(alpha: 0.3),
                              foregroundColor:
                                  hasChanges
                                      ? AppColors.white
                                      : AppColors.inkSoft,
                            ),
                            child:
                                _isSaving
                                    ? const SizedBox(
                                      height: 20,
                                      width: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: AppColors.white,
                                      ),
                                    )
                                    : const Text('Save changes'),
                          ),
                        ],
                        // Sign out lives here so BOTH roles can reach it: the
                        // site admin shell has no attendance screen, which is
                        // where the app's only sign-out used to be.
                        if (!_isEditing) ...[
                          const SizedBox(height: 24),
                          OutlinedButton.icon(
                            onPressed: _confirmSignOut,
                            icon: const Icon(Icons.logout_rounded, size: 18),
                            label: const Text('Sign out'),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: AppColors.brandRed,
                              side: const BorderSide(color: AppColors.line),
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                          ),
                        ],
                        const SizedBox(height: 32),
                      ],
                    ),
                  ),
                ),
              ),
    );
  }

  // Uses SessionGuard.signOut() rather than calling FirebaseAuth directly, so
  // the session claim and the geofences are torn down too — the same cleanup
  // that runs when another device takes over the account.
  void _confirmSignOut() {
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text(
          'You will need to sign in again to access Check-N.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text(
              'Cancel',
              style: TextStyle(color: AppColors.inkSoft),
            ),
          ),
          TextButton(
            onPressed: () async {
              Navigator.pop(dialogContext);
              final navigator = Navigator.of(context);
              await SessionGuard.signOut();
              navigator.pushAndRemoveUntil(
                MaterialPageRoute(builder: (_) => const AuthGate()),
                (route) => false,
              );
            },
            child: const Text(
              'Sign out',
              style: TextStyle(
                color: AppColors.brandRed,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSkeleton() {
    return SingleChildScrollView(
      padding: const EdgeInsets.only(left: 24, right: 24, top: 24, bottom: 100),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 16),
          const Center(
            child: CircleAvatar(radius: 56, backgroundColor: AppColors.white),
          ),
          const SizedBox(height: 32),
          Container(height: 280, decoration: cardDecoration(radius: 24)),
          const SizedBox(height: 24),
          Container(height: 80, decoration: cardDecoration(radius: 20)),
        ],
      ),
    );
  }

  Widget _buildViewField({
    required String label,
    required String value,
    required IconData icon,
    bool isLocked = false,
    bool isStatus = false,
  }) {
    Widget valueWidget = Text(
      value.isEmpty ? '—' : value,
      style: const TextStyle(
        fontSize: 16,
        color: AppColors.ink,
        fontWeight: FontWeight.w700,
      ),
    );

    if (isStatus) {
      final isActive = value.toLowerCase() == 'active';
      valueWidget = Align(
        alignment: Alignment.centerLeft,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: isActive ? AppColors.okBg : AppColors.brandRedSoft,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            value,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: isActive ? AppColors.okText : AppColors.brandRed,
            ),
          ),
        ),
      );
    }

    return Row(
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: const BoxDecoration(
            color: AppColors.brandRedSoft,
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: AppColors.brandRed, size: 22),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.inkSoft,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 2),
              valueWidget,
            ],
          ),
        ),
        if (isLocked)
          const Icon(
            Icons.lock_outline_rounded,
            color: AppColors.muted,
            size: 18,
          ),
      ],
    );
  }

  Widget _buildEditableField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    String? Function(String?)? validator,
  }) {
    return Row(
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: const BoxDecoration(
            color: AppColors.brandRedSoft,
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: AppColors.brandRed, size: 22),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.inkSoft,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 2),
              TextFormField(
                controller: controller,
                autocorrect: false,
                style: const TextStyle(
                  fontSize: 16,
                  color: AppColors.ink,
                  fontWeight: FontWeight.w700,
                ),
                decoration: const InputDecoration(
                  isDense: true,
                  contentPadding: EdgeInsets.zero,
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
      ],
    );
  }

  Widget _buildNationalityDropdown() {
    return InkWell(
      onTap: () {
        showCountryPicker(
          context: context,
          showPhoneCode: false,
          countryListTheme: const CountryListThemeData(
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            inputDecoration: InputDecoration(
              hintText: 'Search nationality',
              prefixIcon: Icon(Icons.search_rounded),
            ),
          ),
          onSelect:
              (country) =>
                  setState(() => _nationalityController.text = country.name),
        );
      },
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: const BoxDecoration(
              color: AppColors.brandRedSoft,
              shape: BoxShape.circle,
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
                    fontSize: 12,
                    color: AppColors.inkSoft,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _nationalityController.text,
                  style: const TextStyle(
                    fontSize: 16,
                    color: AppColors.ink,
                    fontWeight: FontWeight.w700,
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
