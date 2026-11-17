import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/features/addresses/domain/address.dart';
import 'package:chicman/features/addresses/presentation/address_screens.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/auth/presentation/auth_gate.dart';
import 'package:chicman/features/buyer/domain/buyer_dashboard.dart';
import 'package:chicman/features/orders/domain/orders.dart';
import 'package:chicman/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../addresses/fake_map.dart';
import '../auth/fakes.dart';

const _config = AppConfig(
  supabaseUrl: 'https://p.supabase.co',
  supabasePublishableKey: 'k',
  apiBaseUrl: 'http://api.test',
  siteUrl: 'https://chicman.test',
);

Map<String, Object?> _address({bool isDefault = true, String? label}) => {
  'id': 'a1',
  'label': label,
  'city': 'Nouakchott',
  'district': 'Tevragh Zeina',
  'landmark': 'Portail bleu',
  'deliveryPhone': null,
  'latitude': 18.1,
  'longitude': -15.99,
  'locationSource': 'MANUAL',
  'accuracyMeters': null,
  'locationConfirmedAt': '2026-11-08T10:00:00.000Z',
  'isDefault': isDefault,
  'createdAt': '',
  'updatedAt': '',
};

Map<String, Object?> _order(String id, List<String> labels) => {
  'id': id,
  'reference': 'CM-$id',
  'createdAt': '2026-11-09T10:00:00.000Z',
  'total': '1600.00',
  'itemsCount': 1,
  'shopOrders': [
    for (final (index, label) in labels.indexed)
      {
        'id': 'so-$id-$index',
        'shopName': 'Maison Lalla',
        'status': 'PENDING',
        'label': label,
      },
  ],
};

ApiClient _api({
  List<Map<String, Object?>> addresses = const [],
  List<Map<String, Object?>> orders = const [],
  int total = 0,
  bool ordersFail = false,
  String preferredLocale = 'fr',
  List<http.Request>? requests,
}) => routedApi({
  'GET /auth/session': (_) => (200, {'userId': 'u1', 'accountType': 'BUYER'}),
  'GET /accounts/me': (_) => (
    200,
    {
      'userId': 'u1',
      'accountType': 'BUYER',
      'profile': {
        'id': 'p1',
        'fullName': 'Aminetou Mint Ahmed',
        'preferredLocale': preferredLocale,
        'phone': '+22222123456',
      },
    },
  ),
  'GET /customers/me/addresses': (_) => (200, {'addresses': addresses}),
  'GET /customers/me/orders': (_) => ordersFail
      ? (
          503,
          {
            'error': {'code': 'SERVICE_UNAVAILABLE'},
          },
        )
      : (200, {'orders': orders, 'page': 1, 'pageSize': 3, 'total': total}),
  'GET /customers/me/favorites': (_) => (200, {'items': <Object?>[]}),
  'GET /customers/me/notifications/unread-count': (_) => (200, {'unread': 2}),
  'GET /customers/me/notifications': (_) =>
      (200, {'items': <Object?>[], 'nextCursor': null}),
  'GET /customers/me/cart': (_) => (200, {'shops': <Object?>[]}),
}, requests: requests);

Future<void> _open(WidgetTester tester, ApiClient api) async {
  await tester.binding.setSurfaceSize(const Size(600, 2600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(null),
        appConfigProvider.overrideWithValue(_config),
        authRepositoryProvider.overrideWithValue(
          FakeAuthRepository(
            restored: const AuthSession(userId: 'u1', email: 'a@b.mr'),
          ),
        ),
        apiClientProvider.overrideWithValue(api),
        incomingLinksProvider.overrideWithValue(null),
        fakeMapOverride,
      ],
      child: const MyApp(home: AuthGate()),
    ),
  );
  await tester.pumpAndSettle();
}

CustomerAddress _domainAddress({bool isDefault = false, String? label}) =>
    CustomerAddress.fromJson(_address(isDefault: isDefault, label: label));

void main() {
  group('dashboard rules (same as the web)', () {
    test('default address by its flag, on one line', () {
      expect(defaultAddress([_domainAddress()]), isNull);
      expect(
        defaultAddress([
          _domainAddress(),
          _domainAddress(isDefault: true),
        ])?.isDefault,
        isTrue,
      );
      expect(addressLine(_domainAddress()), 'Tevragh Zeina, Nouakchott');
      expect(
        addressLine(_domainAddress(label: 'Maison')),
        'Maison · Tevragh Zeina, Nouakchott',
      );
    });

    test('counts shop orders still moving, and greets by first name', () {
      final page = OrderPage.fromJson({
        'orders': [
          _order('1', ['AWAITING_SHOP', 'DELIVERED']),
          _order('2', ['OUT_FOR_DELIVERY', 'CANCELLED', 'EXPIRED']),
        ],
        'page': 1,
        'pageSize': 3,
        'total': 2,
      });
      expect(openShopOrderCount(page.orders), 2);
      expect(greetingName('Aminetou Mint Ahmed'), 'Aminetou');
      expect(greetingName('  '), isNull);
      expect(greetingName(null), isNull);
    });
  });

  group('buyer dashboard', () {
    testWidgets('greets the buyer and shows the figures from existing APIs', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await _open(
        tester,
        _api(
          addresses: [_address(label: 'Maison')],
          orders: [
            _order('1', ['AWAITING_SHOP']),
            _order('2', ['DELIVERED']),
          ],
          total: 7,
          requests: requests,
        ),
      );
      expect(find.text('Bonjour Aminetou'), findsOneWidget);
      expect(find.text('Connecté en tant que a@b.mr'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const Key('buyer-tile-orders')),
          matching: find.text('7'),
        ),
        findsOneWidget,
      );
      expect(find.text('1 en cours parmi les plus récentes'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const Key('buyer-tile-notifications')),
          matching: find.text('2'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const Key('buyer-tile-favorites')),
          matching: find.text('0'),
        ),
        findsOneWidget,
      );
      expect(find.text('Maison · Tevragh Zeina, Nouakchott'), findsOneWidget);
      expect(find.byKey(const Key('buyer-recent-1')), findsOneWidget);
      expect(find.byKey(const Key('buyer-recent-2')), findsOneWidget);
      expect(
        find.text('Téléphone de contact (non vérifié) : +22222123456'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('account-address-prompt')), findsNothing);
      // Only the latest orders are read for the dashboard.
      expect(
        requests.any(
          (r) =>
              r.url.path == '/api/v1/customers/me/orders' &&
              r.url.queryParameters['pageSize'] == '3',
        ),
        isTrue,
      );
    });

    testWidgets('opens the existing screens from the tiles and sections', (
      tester,
    ) async {
      await _open(
        tester,
        _api(
          orders: [
            _order('1', ['AWAITING_SHOP']),
          ],
          total: 1,
        ),
      );
      await tester.tap(find.byKey(const Key('buyer-tile-orders')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('orders-list')), findsOneWidget);
      tester.state<NavigatorState>(find.byType(Navigator).first).pop();
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('account-addresses')));
      await tester.pumpAndSettle();
      expect(find.byType(AddressListScreen), findsOneWidget);
      tester.state<NavigatorState>(find.byType(Navigator).first).pop();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('buyer-dashboard')), findsOneWidget);
    });

    testWidgets('no order, no address, and a failed read are each explained', (
      tester,
    ) async {
      await _open(tester, _api());
      expect(find.byKey(const Key('buyer-recent-empty')), findsOneWidget);
      expect(find.text('Aucune adresse'), findsOneWidget);
      expect(find.byKey(const Key('account-address-prompt')), findsOneWidget);

      await _open(tester, _api(ordersFail: true));
      expect(find.byKey(const Key('buyer-recent-retry')), findsOneWidget);
      // The other tiles still show.
      expect(
        find.descendant(
          of: find.byKey(const Key('buyer-tile-notifications')),
          matching: find.text('2'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('reads right to left in Arabic', (tester) async {
      tester.platformDispatcher.localesTestValue = const [Locale('ar')];
      addTearDown(tester.platformDispatcher.clearLocalesTestValue);
      await _open(tester, _api(preferredLocale: 'ar'));
      expect(find.text('مرحبًا Aminetou'), findsOneWidget);
      expect(find.text('مساحتي'), findsOneWidget);
      expect(
        Directionality.of(
          tester.element(find.byKey(const Key('buyer-dashboard'))),
        ),
        TextDirection.rtl,
      );
    });
  });
}
