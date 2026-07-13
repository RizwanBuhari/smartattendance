import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('basic smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Center(child: Text('Smart Attendance')),
        ),
      ),
    );

    expect(find.text('Smart Attendance'), findsOneWidget);
  });
}
