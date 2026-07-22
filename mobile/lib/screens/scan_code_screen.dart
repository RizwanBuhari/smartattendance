// Scans the site admin's QR to approve a check-in.
//
// Pops with the 6-digit code as a String, or null if the user backs out.
// Also offers manual entry, because a camera that will not focus (dust, glare,
// a cracked screen on site) should not stop someone checking in.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../core/theme/app_colors.dart';

class ScanCodeScreen extends StatefulWidget {
  const ScanCodeScreen({super.key});

  @override
  State<ScanCodeScreen> createState() => _ScanCodeScreenState();
}

class _ScanCodeScreenState extends State<ScanCodeScreen> {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
  );
  // Stops a burst of detections popping the route several times.
  bool _handled = false;
  bool _manualEntry = false;
  final TextEditingController _manualController = TextEditingController();

  void _submit(String? raw) {
    if (_handled) return;
    final code = (raw ?? '').trim();
    // The QR encodes exactly the 6 digits the backend issued.
    if (!RegExp(r'^\d{6}$').hasMatch(code)) return;
    _handled = true;
    Navigator.of(context).pop(code);
  }

  @override
  void dispose() {
    _controller.dispose();
    _manualController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('Scan to check in'),
        actions: [
          IconButton(
            tooltip: _manualEntry ? 'Use camera' : 'Enter code manually',
            icon: Icon(_manualEntry ? Icons.qr_code_scanner : Icons.keyboard),
            onPressed: () => setState(() => _manualEntry = !_manualEntry),
          ),
        ],
      ),
      body: _manualEntry ? _buildManualEntry() : _buildScanner(),
    );
  }

  Widget _buildScanner() {
    return Stack(
      alignment: Alignment.center,
      children: [
        MobileScanner(
          controller: _controller,
          onDetect: (capture) {
            if (capture.barcodes.isEmpty) return;
            _submit(capture.barcodes.first.rawValue);
          },
          errorBuilder: (context, error) => Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.no_photography_outlined,
                    color: Colors.white70,
                    size: 48,
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Camera unavailable',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Allow camera access in Settings, or enter the 6-digit code manually.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                  const SizedBox(height: 16),
                  TextButton(
                    onPressed: () => setState(() => _manualEntry = true),
                    child: const Text('Enter code manually'),
                  ),
                ],
              ),
            ),
          ),
        ),

        // Viewfinder
        Container(
          width: 240,
          height: 240,
          decoration: BoxDecoration(
            border: Border.all(color: Colors.white70, width: 2),
            borderRadius: BorderRadius.circular(16),
          ),
        ),

        Positioned(
          bottom: 48,
          left: 24,
          right: 24,
          child: Text(
            'Point at the QR code on your site admin\'s phone',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white70, fontSize: 14),
          ),
        ),
      ],
    );
  }

  Widget _buildManualEntry() {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 24),
          const Text(
            'Enter the 6-digit code',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Shown under the QR code on your site admin\'s phone.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white70, fontSize: 13),
          ),
          const SizedBox(height: 24),
          TextField(
            controller: _manualController,
            autofocus: true,
            keyboardType: TextInputType.number,
            textAlign: TextAlign.center,
            maxLength: 6,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: const TextStyle(
              color: Colors.white,
              fontSize: 32,
              letterSpacing: 8,
              fontWeight: FontWeight.w700,
            ),
            decoration: const InputDecoration(
              counterText: '',
              hintText: '000000',
              hintStyle: TextStyle(color: Colors.white24, letterSpacing: 8),
              enabledBorder: UnderlineInputBorder(
                borderSide: BorderSide(color: Colors.white24),
              ),
              focusedBorder: UnderlineInputBorder(
                borderSide: BorderSide(color: Colors.white),
              ),
            ),
            onChanged: (v) {
              // Submit as soon as six digits are in — no extra tap needed.
              if (v.length == 6) _submit(v);
            },
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.brandRed,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            onPressed: () => _submit(_manualController.text),
            child: const Text('Approve check-in'),
          ),
        ],
      ),
    );
  }
}
