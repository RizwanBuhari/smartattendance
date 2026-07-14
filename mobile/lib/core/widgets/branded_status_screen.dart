import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import 'play_once_gif.dart';

// Full-screen loading state shown while Firebase/auth state resolves.
class BrandedLoadingScreen extends StatelessWidget {
  const BrandedLoadingScreen({super.key, this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const PlayOnceGif(assetPath: 'assets/images/logo_gif_uae.gif', width: 220),
            const SizedBox(height: 32),
            const CircularProgressIndicator(),
            if (message != null) ...[
              const SizedBox(height: 16),
              Text(message!, style: Theme.of(context).textTheme.bodyMedium),
            ],
          ],
        ),
      ),
    );
  }
}

// Full-screen error state (e.g. Firebase failed to initialize).
class BrandedErrorScreen extends StatelessWidget {
  const BrandedErrorScreen({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 48, color: AppColors.alertText),
              const SizedBox(height: 16),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.alertText),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
