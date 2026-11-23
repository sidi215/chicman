import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Opens the account drawer as a user does: the app bar's menu button.
Future<void> openAccountDrawer(WidgetTester tester) async {
  await tester.tap(find.byType(DrawerButton).first);
  await tester.pumpAndSettle();
}

/// Opens the drawer, then taps one of its entries.
Future<void> tapDrawerItem(WidgetTester tester, Key key) async {
  await openAccountDrawer(tester);
  await tester.tap(find.byKey(key));
  await tester.pumpAndSettle();
}
