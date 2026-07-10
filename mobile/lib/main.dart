import 'package:flutter/material.dart';

void main() {
  runApp(const SmartAttendanceUIApp());
}

class SmartAttendanceUIApp extends StatelessWidget {
  const SmartAttendanceUIApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'UI Test 1 + Timestamps',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
        useMaterial3: true,
      ),
      home: const AttendanceScreen(),
    );
  }
}

class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({super.key});

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  // Local state trackers
  String _currentStatus = "Not Checked In";
  String _timestampMessage = "No history recorded yet.";
  Color _statusColor = Colors.grey.shade200;
  Color _textColor = Colors.black87;

  // Helper function to format the time neatly (HH:MM:SS)
  String _getFormattedTime() {
    final DateTime now = DateTime.now();
    // Padding numbers to always display 2 digits (e.g., 09 instead of 9)
    final String hour = now.hour.toString().padLeft(2, '0');
    final String minute = now.minute.toString().padLeft(2, '0');
    final String second = now.second.toString().padLeft(2, '0');
    return "$hour:$minute:$second";
  }

  void _handleCheckIn() {
    final String currentTime = _getFormattedTime();
    setState(() {
      _currentStatus = "Checked In";
      _timestampMessage = "Last action: Check-In at $currentTime";
      _statusColor = Colors.green.shade100;
      _textColor = Colors.green.shade900;
    });
  }

  void _handleCheckOut() {
    final String currentTime = _getFormattedTime();
    setState(() {
      _currentStatus = "Checked Out";
      _timestampMessage = "Last action: Check-Out at $currentTime";
      _statusColor = Colors.red.shade100;
      _textColor = Colors.red.shade900;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Attendance UI & Time Test'),
        centerTitle: true,
        backgroundColor: Colors.blue.shade100,
      ),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Status & Timestamp Card Box
            Container(
              padding: const EdgeInsets.symmetric(vertical: 30, horizontal: 16),
              decoration: BoxDecoration(
                color: _statusColor,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.black12),
              ),
              child: Column(
                children: [
                  const Text(
                    "Current Status:",
                    style: TextStyle(fontSize: 14, color: Colors.black54),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _currentStatus,
                    style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.bold,
                      color: _textColor,
                    ),
                  ),
                  const SizedBox(height: 16),
                  // New Timestamp Visual Box
                  Divider(color: Colors.black12),
                  const SizedBox(height: 8),
                  Text(
                    _timestampMessage,
                    style: const TextStyle(
                        fontSize: 15,
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w500,
                        color: Colors.black87
                    ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 60),

            // CHECK IN BUTTON
            ElevatedButton.icon(
              onPressed: _handleCheckIn,
              icon: const Icon(Icons.login),
              label: const Text('Check In', style: TextStyle(fontSize: 18)),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.blue,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
            ),
            const SizedBox(height: 16),

            // CHECK OUT BUTTON
            ElevatedButton.icon(
              onPressed: _handleCheckOut,
              icon: const Icon(Icons.logout),
              label: const Text('Check Out', style: TextStyle(fontSize: 18)),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.black87,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}