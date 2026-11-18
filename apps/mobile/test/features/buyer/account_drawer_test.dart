import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/features/addresses/presentation/address_screens.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/buyer/domain/buyer_dashboard.dart';
import 'package:chicman/features/cart/presentation/cart_screen.dart';
import 'package:chicman/features/favorites/presentation/favorites_screen.dart';
import 'package:chicman/features/notifications/presentation/notifications_screen.dart';
import 'package:chicman/features/orders/presentation/order_screens.dart';
import 'package:chicman/features/profile/presentation/profile_settings_screen.dart';
import 'package:chicman/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../addresses/fake_map.dart';
import '../auth/fakes.dart';
import 'drawer_helpers.dart';

const _config = AppConfig(
  supabaseUrl: 'https://p.supabase.co',
  supabasePublishableKey: 'k',
  apiBaseUrl: 'http://api.test',
  siteUrl: 'https://chicman.test',
);

Map<String, Object?> _favorite(String id) => {
  'productId': id,
  'addedAt': '2026-11-10T10:00:00.000Z',
  'name': 'Robe $id',
  'imageUrl': 'http://media.test/$id.jpg',
  'state': 'AVAILABLE',
  'product': {
    'id': id,
    'name': 'Robe $id',
    'category': 'CLOTHING',
    'brand': null,
    'price': '1500.00',
    'available': true,
    'mainImageUrl': 'http://media.test/$id.jpg',
    'shop': {'id': 's1', 'name': 'Boutique Sahel'},
  },
};

ApiClient _api({
  String fullName = 'Aminetou Mint Ahmed',
  String locale = 'fr',
}) => routedApi({
  'GET /auth/session': (_) => (200, {'userId': 'u1', 'accountType': 'BUYER'}),
  'GET /accounts/me': (_) => (
    200,
    {
      'userId': 'u1',
      'accountType': 'BUYER',
      'profile': {
        'id': 'p1',
        'fullName': fullName,
        'preferredLocale': locale,
        'phone': '+22222123456',
      },
    },
  ),
  'GET /customers/me/addresses': (_) => (200, {'addresses': <Object?>[]}),
  'GET /customers/me/orders': (_) =>
      (200, {'orders': <Object?>[], 'page': 1, 'pageSize': 20, 'total': 0}),
  'GET /customers/me/favorites': (_) => (
    200,
    {
      'items': [_favorite('a'), _favorite('b')],
    },
  ),
  'GET /customers/me/notifications/unread-count': (_) => (200, {'unread': 4}),
  'GET /customers/me/notifications': (_) =>
      (200, {'items': <Object?>[], 'nextCursor': null}),
  'GET /customers/me/cart': (_) =>
      (200, {'shops': <Object?>[], 'itemCount': 3, 'subtotal': '0.00'}),
});

Future<FakeAuthRepository> _open(
  WidgetTester tester, {
  bool signedIn = true,
  Size size = const Size(400, 900),
  double textScale = 1,
  ApiClient? api,
}) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  tester.platformDispatcher.textScaleFactorTestValue = textScale;
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
  final repository = FakeAuthRepository(
    restored: signedIn
        ? const AuthSession(userId: 'u1', email: 'aminetou@example.mr')
        : null,
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(null),
        appConfigProvider.overrideWithValue(_config),
        authRepositoryProvider.overrideWithValue(repository),
        apiClientProvider.overrideWithValue(api ?? _api()),
        incomingLinksProvider.overrideWithValue(null),
        fakeMapOverride,
      ],
      child: const MyApp(),
    ),
  );
  await tester.pumpAndSettle();
  return repository;
}

Finder _inDrawer(Finder finder) => find.descendant(
  of: find.byKey(const Key('account-drawer')),
  matching: finder,
);

void main() {
  test('initials and badge counts', () {
    expect(initialsOf('Aminetou Mint Ahmed'), 'AA');
    expect(initialsOf('aïcha'), 'A');
    expect(initialsOf('محمد ولد أحمد'), 'مأ');
    expect(initialsOf('  '), isNull);
    expect(initialsOf(null), isNull);
    expect(countBadge(7), '7');
    expect(countBadge(120), '99+');
  });

  testWidgets(
    'a signed-in buyer sees the header, the groups, and live counts',
    (tester) async {
      await _open(tester);
      await openAccountDrawer(tester);
      expect(find.byKey(const Key('account-drawer')), findsOneWidget);
      expect(_inDrawer(find.text('AA')), findsOneWidget);
      expect(_inDrawer(find.text('Aminetou Mint Ahmed')), findsOneWidget);
      expect(_inDrawer(find.text('aminetou@example.mr')), findsOneWidget);
      expect(_inDrawer(find.text('Mes achats')), findsOneWidget);
      expect(_inDrawer(find.text('Mon compte')), findsOneWidget);
      expect(_inDrawer(find.byType(Divider)), findsNWidgets(2));
      Finder badge(String key, String count) =>
          find.descendant(of: find.byKey(Key(key)), matching: find.text(count));
      expect(badge('drawer-cart', '3'), findsOneWidget);
      expect(badge('drawer-favorites', '2'), findsOneWidget);
      expect(badge('drawer-notifications', '4'), findsOneWidget);
    },
  );

  testWidgets('every entry opens the existing screen', (tester) async {
    await _open(tester);
    for (final (key, screen) in [
      ('drawer-orders', OrderListScreen),
      ('drawer-favorites', FavoritesScreen),
      ('drawer-cart', CartScreen),
      ('account-addresses', AddressListScreen),
      ('drawer-notifications', NotificationsScreen),
      ('account-profile-settings', ProfileSettingsScreen),
    ]) {
      await tapDrawerItem(tester, Key(key));
      expect(find.byType(screen), findsOneWidget, reason: key);
      // A screen opened from the drawer keeps its back button.
      expect(find.byType(BackButton), findsOneWidget, reason: key);
      tester.state<NavigatorState>(find.byType(Navigator).first).pop();
      await tester.pumpAndSettle();
    }
  });

  testWidgets('sign-out uses the existing sign-out and closes the drawer', (
    tester,
  ) async {
    final repository = await _open(tester);
    await tapDrawerItem(tester, const Key('drawer-logout'));
    expect(repository.calls, contains('signOut'));
    expect(find.byKey(const Key('account-drawer')), findsNothing);
  });

  testWidgets('the drawer is on every main tab, not on pushed screens', (
    tester,
  ) async {
    await _open(tester);
    for (final tab in ['dock-home', 'dock-favorites', 'dock-account']) {
      await tester.tap(find.byKey(Key(tab)));
      await tester.pumpAndSettle();
      expect(find.byType(DrawerButton), findsOneWidget, reason: tab);
    }
  });

  testWidgets('a guest is invited to sign in, on the account tab', (
    tester,
  ) async {
    await _open(tester, signedIn: false);
    await openAccountDrawer(tester);
    expect(find.text('Invité'), findsOneWidget);
    expect(find.byKey(const Key('drawer-orders')), findsNothing);
    await tester.tap(find.byKey(const Key('drawer-sign-in')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('login-email')), findsOneWidget);
  });

  testWidgets('slides in from the right in Arabic', (tester) async {
    tester.platformDispatcher.localesTestValue = const [Locale('ar')];
    addTearDown(tester.platformDispatcher.clearLocalesTestValue);
    await _open(tester, api: _api(locale: 'ar'));
    await openAccountDrawer(tester);
    expect(find.text('مشترياتي'), findsOneWidget);
    final drawer = tester.getRect(find.byKey(const Key('account-drawer')));
    expect(drawer.right, 400);
    expect(drawer.left, greaterThan(0));
  });

  for (final scale in [1.3, 2.0]) {
    testWidgets('fits a 320 px phone at ${scale}x text without overflow', (
      tester,
    ) async {
      await _open(
        tester,
        size: const Size(320, 640),
        textScale: scale,
        api: _api(fullName: 'Aminetou Mint Mohamed Lemine Ould Abdallahi'),
      );
      await openAccountDrawer(tester);
      expect(tester.takeException(), isNull);
      await tester.tap(
        find.byKey(const Key('dock-account')),
        warnIfMissed: false,
      );
      await tester.pumpAndSettle();
    });
  }
}
