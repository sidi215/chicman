import 'dart:convert';
import 'dart:typed_data';

import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/shop/application/shop_providers.dart';
import 'package:chicman/features/shop/presentation/shop_screen.dart';
import 'package:chicman/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../auth/fakes.dart';
import 'shop_domain_test.dart' show shopJson;

const _config = AppConfig(
  supabaseUrl: 'https://p.supabase.co',
  supabasePublishableKey: 'k',
  apiBaseUrl: 'http://api.test',
  siteUrl: 'https://chicman.test',
);

const _restored = AuthSession(userId: 'u1', email: 'a@b.mr');

final _png = Uint8List.fromList([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  1,
  2,
  3,
  4,
]);

/// The API with an optional stored shop; mutations update it.
///
/// [onGetShop] changes what a read returns (an administrator's decision).
ApiClient _api(
  List<http.Request> requests, {
  Map<String, Object?>? shop,
  Map<String, Object?> Function(Map<String, Object?> stored)? onGetShop,
}) {
  var stored = shop;
  Map<String, Object?> account() => {
    'userId': 'u1',
    'roles': ['CUSTOMER'],
    'profile': {
      'id': 'p1',
      'fullName': 'Aminetou',
      'preferredLocale': 'fr',
      'phone': '+22222123456',
    },
  };
  return routedApi({
    'GET /auth/session': (_) => (
      200,
      {
        'userId': 'u1',
        'roles': ['CUSTOMER'],
      },
    ),
    'GET /customers/me': (_) => (200, account()),
    'GET /sellers/me/shop': (_) => stored == null
        ? (
            404,
            {
              'error': {'code': 'SHOP_NOT_FOUND'},
            },
          )
        : (200, onGetShop?.call(stored!) ?? stored),
    'POST /sellers/me/shop': (request) {
      final body = jsonDecode(request.body) as Map<String, Object?>;
      stored = {
        ...shopJson(status: 'PENDING'),
        ...body,
        'latestDecision': null,
      };
      return (201, stored);
    },
    'PATCH /sellers/me/shop': (request) {
      final body = jsonDecode(request.body) as Map<String, Object?>;
      stored = {...stored!, ...body, 'updatedAt': '2026-11-07T12:00:00.000Z'};
      return (200, stored);
    },
    'POST /sellers/me/shop/resubmit': (_) {
      stored = {...stored!, 'status': 'PENDING', 'rejection': null};
      return (200, stored);
    },
    'POST /sellers/me/shop/change-requests': (request) {
      final body = jsonDecode(request.body) as Map<String, Object?>;
      stored = {
        ...stored!,
        'changeRequest': {
          'id': 'cr1',
          'proposedShopName': body['shopName'],
          'proposedCity': body['city'],
          'status': 'PENDING',
          'submittedAt': '2026-11-07T12:00:00.000Z',
          'decidedAt': null,
        },
      };
      return (201, stored);
    },
    'POST /sellers/me/shop/logo/uploads': (_) => (
      201,
      {
        'uploadId': 'u1',
        'uploadUrl': 'http://storage.test/up/k',
        'method': 'PUT',
        'headers': {},
        'expiresAt': '',
      },
    ),
    'PUT /up/k': (_) => (200, null),
    'POST /sellers/me/shop/logo/uploads/u1/complete': (_) {
      // As on the real API, the logo change bumps updatedAt.
      stored = {
        ...stored!,
        'logoUrl': 'http://media.test/logo.png',
        'updatedAt': '2026-11-07T13:00:00.000Z',
      };
      return (200, {'logoUrl': 'http://media.test/logo.png'});
    },
  }, requests: requests);
}

Future<void> _openShop(WidgetTester tester, ApiClient api) async {
  await tester.binding.setSurfaceSize(const Size(600, 3000));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(null),
        appConfigProvider.overrideWithValue(_config),
        authRepositoryProvider.overrideWithValue(
          FakeAuthRepository(restored: _restored),
        ),
        apiClientProvider.overrideWithValue(api),
        incomingLinksProvider.overrideWithValue(null),
        logoPickerProvider.overrideWithValue(() async => _png),
      ],
      child: const MyApp(),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('account-shop')));
  await tester.pumpAndSettle();
}

String _fieldText(WidgetTester tester, String field) => tester
    .widget<TextField>(find.byKey(Key('shop-field-$field')))
    .controller!
    .text;

Iterable<http.Request> _calls(
  List<http.Request> requests,
  String method,
  String path,
) => requests.where((r) => r.method == method && r.url.path == '/api/v1$path');

void main() {
  testWidgets(
    'without a shop: the application form submits a normalized application',
    (tester) async {
      final requests = <http.Request>[];
      await _openShop(tester, _api(requests));
      expect(find.text('Devenir vendeur'), findsOneWidget);
      await tester.tap(find.byKey(const Key('shop-apply')));
      await tester.pumpAndSettle();
      expect(find.text('Ce champ est obligatoire.'), findsWidgets);
      expect(_calls(requests, 'POST', '/sellers/me/shop'), isEmpty);

      await tester.enterText(
        find.byKey(const Key('shop-field-shopName')),
        ' Maison ',
      );
      await tester.enterText(
        find.byKey(const Key('shop-field-description')),
        'Voiles',
      );
      await tester.enterText(
        find.byKey(const Key('shop-field-contactPhone')),
        '36 00 00 01',
      );
      await tester.enterText(find.byKey(const Key('shop-field-city')), 'Atar');
      await tester.enterText(
        find.byKey(const Key('shop-field-address')),
        'Centre',
      );
      await tester.tap(find.byKey(const Key('shop-apply')));
      await tester.pumpAndSettle();

      final post = _calls(requests, 'POST', '/sellers/me/shop').single;
      expect(jsonDecode(post.body), {
        'shopName': 'Maison',
        'description': 'Voiles',
        'contactPhone': '+22236000001',
        'city': 'Atar',
        'address': 'Centre',
      });
      expect(find.text("En attente d'examen"), findsOneWidget);
    },
  );

  testWidgets('a rejected owner sees the reason and can resubmit', (
    tester,
  ) async {
    final requests = <http.Request>[];
    await _openShop(
      tester,
      _api(
        requests,
        shop: shopJson(
          status: 'REJECTED',
          rejection: {
            'applicantReason': "Adresse incomplète, précisez l'îlot.",
            'rejectedAt': '2026-11-07T12:00:00.000Z',
          },
        ),
      ),
    );
    expect(find.text('Motif du refus'), findsOneWidget);
    expect(find.text("Adresse incomplète, précisez l'îlot."), findsOneWidget);
    await tester.tap(find.byKey(const Key('shop-resubmit')));
    await tester.pumpAndSettle();
    expect(_calls(requests, 'POST', '/sellers/me/shop/resubmit'), hasLength(1));
    expect(find.text("En attente d'examen"), findsOneWidget);
    expect(find.byKey(const Key('shop-rejection')), findsNothing);
  });

  testWidgets(
    'an approved shop edits immediate fields and requests a name/city change',
    (tester) async {
      final requests = <http.Request>[];
      await _openShop(tester, _api(requests, shop: shopJson()));
      // shopName/city appear only in the change-request card.
      expect(find.byKey(const Key('shop-field-shopName')), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('shop-field-address')),
        'Tevragh Zeina',
      );
      await tester.tap(find.byKey(const Key('shop-save')));
      await tester.pumpAndSettle();
      expect(
        jsonDecode(_calls(requests, 'PATCH', '/sellers/me/shop').single.body),
        {'address': 'Tevragh Zeina'},
      );

      await tester.enterText(find.byKey(const Key('shop-field-city')), 'Rosso');
      await tester.tap(find.byKey(const Key('shop-change-request-submit')));
      await tester.pumpAndSettle();
      expect(
        jsonDecode(
          _calls(
            requests,
            'POST',
            '/sellers/me/shop/change-requests',
          ).single.body,
        ),
        {'city': 'Rosso'},
      );
      expect(find.text("Modification en attente d'examen"), findsOneWidget);
      expect(find.byKey(const Key('shop-change-request-submit')), findsNothing);
    },
  );

  testWidgets('a suspended shop shows its status only', (tester) async {
    await _openShop(tester, _api([], shop: shopJson(status: 'SUSPENDED')));
    expect(find.text('Suspendue'), findsOneWidget);
    expect(find.byKey(const Key('shop-save')), findsNothing);
    expect(find.byKey(const Key('shop-logo-pick')), findsNothing);
    expect(find.byKey(const Key('shop-change-request-submit')), findsNothing);
  });

  testWidgets(
    'a change request keeps its sent message after the shop reloads',
    (tester) async {
      await _openShop(tester, _api([], shop: shopJson()));
      await tester.enterText(find.byKey(const Key('shop-field-city')), 'Rosso');
      await tester.tap(find.byKey(const Key('shop-change-request-submit')));
      await tester.pumpAndSettle();
      expect(find.text("Modification en attente d'examen"), findsOneWidget);
      expect(find.text('Demande de modification envoyée.'), findsOneWidget);
    },
  );

  testWidgets('a logo upload keeps an unsent change request edit', (
    tester,
  ) async {
    await _openShop(tester, _api([], shop: shopJson()));
    await tester.enterText(find.byKey(const Key('shop-field-city')), 'Rosso');
    await tester.tap(find.byKey(const Key('shop-logo-pick')));
    await tester.pumpAndSettle();
    expect(find.text('Logo enregistré.'), findsOneWidget);
    expect(_fieldText(tester, 'city'), 'Rosso');
  });

  testWidgets(
    'a decided change request restarts the form from current values',
    (tester) async {
      var decided = false;
      await _openShop(
        tester,
        _api(
          [],
          shop: shopJson(),
          onGetShop: (stored) => !decided
              ? stored
              : {
                  ...stored,
                  'changeRequest': {
                    ...stored['changeRequest']! as Map<String, Object?>,
                    'status': 'REJECTED',
                    'decidedAt': '2026-11-07T14:00:00.000Z',
                  },
                },
        ),
      );
      await tester.enterText(find.byKey(const Key('shop-field-city')), 'Rosso');
      await tester.tap(find.byKey(const Key('shop-change-request-submit')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('shop-change-request-submit')), findsNothing);

      decided = true;
      ProviderScope.containerOf(
        tester.element(find.byType(ShopScreen)),
      ).invalidate(ownerShopProvider);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('shop-change-request-submit')),
        findsOneWidget,
      );
      expect(_fieldText(tester, 'city'), 'Nouakchott');
      expect(find.text('Demande de modification envoyée.'), findsNothing);
    },
  );

  testWidgets('saving keeps the saved message after the shop reloads', (
    tester,
  ) async {
    await _openShop(tester, _api([], shop: shopJson()));
    await tester.enterText(
      find.byKey(const Key('shop-field-address')),
      'Tevragh Zeina',
    );
    await tester.tap(find.byKey(const Key('shop-save')));
    await tester.pumpAndSettle();
    expect(find.text('Modifications enregistrées.'), findsOneWidget);
    expect(_fieldText(tester, 'address'), 'Tevragh Zeina');
  });

  testWidgets('a logo upload keeps unsaved text edits', (tester) async {
    await _openShop(tester, _api([], shop: shopJson(status: 'PENDING')));
    await tester.enterText(
      find.byKey(const Key('shop-field-address')),
      'Non enregistrée',
    );
    await tester.tap(find.byKey(const Key('shop-logo-pick')));
    await tester.pumpAndSettle();
    expect(find.text('Logo enregistré.'), findsOneWidget);
    expect(_fieldText(tester, 'address'), 'Non enregistrée');
  });

  testWidgets('the logo is uploaded straight to storage and then completed', (
    tester,
  ) async {
    final requests = <http.Request>[];
    await _openShop(tester, _api(requests, shop: shopJson(status: 'PENDING')));
    await tester.tap(find.byKey(const Key('shop-logo-pick')));
    await tester.pumpAndSettle();
    final put = requests.singleWhere((r) => r.method == 'PUT');
    expect(put.url.host, 'storage.test');
    expect(put.headers['authorization'], isNull);
    expect(
      _calls(requests, 'POST', '/sellers/me/shop/logo/uploads/u1/complete'),
      hasLength(1),
    );
    expect(find.text('Logo enregistré.'), findsOneWidget);
    expect(find.byKey(const Key('shop-logo-remove')), findsOneWidget);
  });
}
