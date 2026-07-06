import 'package:flutter_test/flutter_test.dart';

import 'package:frontend/app.dart';

void main() {
  testWidgets('App loads login screen', (WidgetTester tester) async {
    await tester.pumpWidget(const AmrDashboardApp());
    expect(find.text('Sign in'), findsOneWidget);
  });
}
