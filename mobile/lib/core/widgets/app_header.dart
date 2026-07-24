import 'dart:convert';
import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import 'brand_logo.dart';

class AppHeader extends StatelessWidget {
  const AppHeader({
    super.key,
    this.photoBase64,
    this.unreadNotificationCount = 0,
    required this.onProfileTap,
    required this.onNotificationsTap,
    required this.onLogoutTap,
  });

  final String? photoBase64;
  final int unreadNotificationCount;
  final VoidCallback onProfileTap;
  final VoidCallback onNotificationsTap;
  final VoidCallback onLogoutTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Profile Avatar
          GestureDetector(
            onTap: onProfileTap,
            child: CircleAvatar(
              radius: 20,
              backgroundColor: const Color(0xFFEFEFEF),
              backgroundImage: (photoBase64 != null && photoBase64!.isNotEmpty)
                  ? MemoryImage(base64Decode(photoBase64!))
                  : null,
              child: (photoBase64 == null || photoBase64!.isEmpty)
                  ? const Icon(
                      Icons.person_rounded,
                      color: AppColors.ink,
                      size: 22,
                    )
                  : null,
            ),
          ),
          // Logo Center
          const BrandLogo(width: 130),
          // Right Icons: Bell with Badge + Logout
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              GestureDetector(
                onTap: onNotificationsTap,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: const BoxDecoration(
                        color: Colors.transparent,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.notifications_none_rounded,
                        color: AppColors.ink,
                        size: 26,
                      ),
                    ),
                    if (unreadNotificationCount > 0)
                      Positioned(
                        right: 2,
                        top: 2,
                        child: Container(
                          padding: const EdgeInsets.all(3),
                          decoration: const BoxDecoration(
                            color: AppColors.brandRed,
                            shape: BoxShape.circle,
                          ),
                          constraints: const BoxConstraints(
                            minWidth: 16,
                            minHeight: 16,
                          ),
                          child: Center(
                            child: Text(
                              unreadNotificationCount > 99
                                  ? '99+'
                                  : unreadNotificationCount.toString(),
                              style: const TextStyle(
                                color: AppColors.white,
                                fontSize: 9,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 4),
              IconButton(
                icon: const Icon(
                  Icons.exit_to_app_rounded,
                  color: AppColors.ink,
                  size: 24,
                ),
                onPressed: onLogoutTap,
                tooltip: 'Logout',
              ),
            ],
          ),
        ],
      ),
    );
  }
}
