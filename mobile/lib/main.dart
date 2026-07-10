import 'package:flutter/material.dart';
import 'package:http/http.dart' as http; // Imports our new web requests tool

void main() {
  runApp(const SmartAttendanceUIApp());
}

class SmartAttendanceUIApp extends StatelessWidget {
  const SmartAttendanceUIApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'UI + Backend Connection Test',
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
  String _currentStatus = "Not Checked In";
  String _timestampMessage = "No history recorded yet.";

  // This variable will hold whatever message your NestJS server returns!
  String _backendResponse = "Backend Server Status: Disconnected";

  Color _statusColor = Colors.grey.shade200;
  Color _textColor = Colors.black87;

  // 🌐 FUNCTION TO CONNECT TO BACKEND API
  Future<void> _connectToBackend(String action) async {
    setState(() => _backendResponse = "Connecting to backend...");

    try {
      // 10.0.2.2 points directly to your computer's localhost from inside an emulator
      final url = Uri.parse('http://10.0.2.2:3000/');
      final response = await http.get(url);

      if (response.statusCode == 200) {
        setState(() {
          // response.body contains the "Hello World!" string from your NestJS backend
          _backendResponse = "Backend Reply: ${response.body}";
        });
      } else {
        setState(() => _backendResponse = "Server error: ${response.statusCode}");
      }
    } catch (e) {
      setState(() => _backendResponse = "Connection failed. Is NestJS server running?");
    }
  }

  String _getFormattedTime() {
    final DateTime now = DateTime.now();
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

    // Trigger the connection task
    _connectToBackend("check-in");
  }

  void _handleCheckOut() {
    final String currentTime = _getFormattedTime();
    setState(() {
      _currentStatus = "Checked Out";
      _timestampMessage = "Last action: Check-Out at $currentTime";
      _statusColor = Colors.red.shade100;
      _textColor = Colors.red.shade900;
    });

    // Trigger the connection task
    _connectToBackend("check-out");
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Attendance UI & Connection Test'),
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
              padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
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
                    style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold, color: _textColor),
                  ),
                  const SizedBox(height: 12),
                  Divider(color: Colors.black12),
                  const SizedBox(height: 8),
                  Text(
                    _timestampMessage,
                    style: const TextStyle(fontSize: 14, fontFamily: 'monospace', color: Colors.black87),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // 🌐 NEW BACKEND RESPONSE BOX
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.blue.shade50,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.blue.shade200),
              ),
              child: Text(
                _backendResponse,
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Colors.blue.shade900, fontFamily: 'monospace'),
                textAlign: TextAlign.center,
              ),
            ),
            const SizedBox(height: 40),

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