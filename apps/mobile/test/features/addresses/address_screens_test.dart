import 'dart:convert';

import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/features/addresses/application/address_providers.dart';
import 'package:chicman/features/addresses/domain/address.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/auth/presentation/auth_gate.dart';
import 'package:chicman/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../auth/fakes.dart';
import 'fake_map.dart';

const _config = AppConfig(
  supabaseUrl: 'https://p.supabase.co',
  supabasePublishableKey: 'k',
  apiBaseUrl: 'http://api.test',
  siteUrl: 'https://chicman.test',
);

Map<String, Object?> _address(
  String id, {
  bool isDefault = false,
  String landmark = 'Portail bleu',
}) => {
  'id': id,
  'label': 'Maison $id',
  'city': 'Nouakchott',
  'district': 'Tevragh Zeina',
  'landmark': landmark,
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

/// API with an in-memory address list.
ApiClient _api(
  List<http.Request> requests,
  List<Map<String, Object?>> stored,
) => routedApi({
  'GET /auth/session': (_) => (
    200,
    {
      'userId': 'u1',
      'roles': ['CUSTOMER'],
    },
  ),
  'GET /customers/me': (_) => (
    200,
    {
      'userId': 'u1',
      'roles': ['CUSTOMER'],
      'profile': {
        'id': 'p1',
        'fullName': 'Aminetou',
        'preferredLocale': 'fr',
        'phone': '+22222123456',
      },
    },
  ),
  'GET /customers/me/addresses': (_) => (200, {'addresses': stored}),
  'POST /customers/me/addresses': (request) {
    final body = jsonDecode(request.body) as Map<String, Object?>;
    final created = {
      ..._address('n${stored.length}'),
      ...body,
      'isDefault': stored.isEmpty,
    };
    stored.add(created);
    return (201, created);
  },
  'POST /customers/me/addresses/a2/default': (_) {
    for (final a in stored) {
      a['isDefault'] = a['id'] == 'a2';
    }
    return (200, stored.firstWhere((a) => a['id'] == 'a2'));
  },
  'DELETE /customers/me/addresses/a2': (_) {
    stored.removeWhere((a) => a['id'] == 'a2');
    return (204, null);
  },
}, requests: requests);

Future<void> _open(
  WidgetTester tester,
  ApiClient api, {
  DeviceLocator? locator,
}) async {
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
        if (locator != null) deviceLocatorProvider.overrideWithValue(locator),
      ],
      child: const MyApp(home: AuthGate()),
    ),
  );
  await tester.pumpAndSettle();
}

Iterable<http.Request> _calls(
  List<http.Request> requests,
  String method,
  String path,
) => requests.where((r) => r.method == method && r.url.path == '/api/v1$path');

void main() {
  testWidgets(
    'no address: the account shows the prompt; "Plus tard" hides it',
    (tester) async {
      await _open(tester, _api([], []));
      expect(find.byKey(const Key('account-address-prompt')), findsOneWidget);
      await tester.tap(find.byKey(const Key('account-address-prompt-later')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('account-address-prompt')), findsNothing);
      expect(find.byKey(const Key('account-addresses')), findsOneWidget);
    },
  );

  testWidgets(
    'GPS address: locate, adjust, confirm, save (allowlisted confirmed body)',
    (tester) async {
      final requests = <http.Request>[];
      final stored = <Map<String, Object?>>[];
      await _open(
        tester,
        _api(requests, stored),
        locator: () async => const DeviceLocationResult.found(
          PinLocation(
            latitude: 18.0866,
            longitude: -15.9757,
            source: LocationSource.gps,
            accuracyMeters: 18,
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('account-address-prompt-add')));
      await tester.pumpAndSettle();

      // Review without a pin → location error, nothing sent.
      await tester.tap(find.byKey(const Key('address-review')));
      await tester.pumpAndSettle();
      expect(find.text('Placez le repère sur la carte.'), findsOneWidget);

      await tester.tap(find.byKey(const Key('address-locate')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Précision : environ 18 m'), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('address-field-city')),
        'Nouakchott',
      );
      await tester.enterText(
        find.byKey(const Key('address-field-district')),
        'Tevragh Zeina',
      );
      await tester.enterText(
        find.byKey(const Key('address-field-landmark')),
        'Près de la mosquée',
      );
      await tester.tap(find.byKey(const Key('address-review')));
      await tester.pumpAndSettle();
      expect(find.text('Confirmez votre adresse'), findsWidgets);
      expect(find.text('map locked'), findsOneWidget);
      expect(_calls(requests, 'POST', '/customers/me/addresses'), isEmpty);

      await tester.tap(find.byKey(const Key('address-confirm-save')));
      await tester.pumpAndSettle();
      final post = _calls(requests, 'POST', '/customers/me/addresses').single;
      expect(jsonDecode(post.body), {
        'city': 'Nouakchott',
        'district': 'Tevragh Zeina',
        'landmark': 'Près de la mosquée',
        'latitude': 18.0866,
        'longitude': -15.9757,
        'locationSource': 'GPS',
        'accuracyMeters': 18,
        'locationConfirmed': true,
      });
      // Back on the account: the prompt is gone now that an address exists.
      expect(find.byKey(const Key('account-address-prompt')), findsNothing);
    },
  );

  testWidgets('GPS denied: manual pin by moving the map', (tester) async {
    final requests = <http.Request>[];
    await _open(
      tester,
      _api(requests, []),
      locator: () async =>
          const DeviceLocationResult.failed(DeviceLocationFailure.denied),
    );
    await tester.tap(find.byKey(const Key('account-address-prompt-add')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('address-locate')));
    await tester.pumpAndSettle();
    expect(
      find.text('Accès à la position refusé. Placez le repère sur la carte.'),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const Key('fake-map-move')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Repère placé à la main.'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('address-field-city')),
      'Nouakchott',
    );
    await tester.enterText(
      find.byKey(const Key('address-field-district')),
      'Ksar',
    );
    await tester.enterText(
      find.byKey(const Key('address-field-landmark')),
      'Face au marché',
    );
    await tester.tap(find.byKey(const Key('address-review')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('address-confirm-save')));
    await tester.pumpAndSettle();
    final body =
        jsonDecode(
              _calls(requests, 'POST', '/customers/me/addresses').single.body,
            )
            as Map;
    expect(body['locationSource'], 'MANUAL');
    expect(body.containsKey('accuracyMeters'), isFalse);
    expect(body['latitude'], 18.0901);
  });

  testWidgets(
    'list: default badge, make another default, delete with confirmation',
    (tester) async {
      final requests = <http.Request>[];
      final stored = [
        _address('a1', isDefault: true),
        _address('a2', landmark: 'Second'),
      ];
      await _open(tester, _api(requests, stored));
      await tester.tap(find.byKey(const Key('account-addresses')));
      await tester.pumpAndSettle();
      expect(find.text('Par défaut'), findsOneWidget);
      expect(find.byKey(const Key('address-default-a1')), findsNothing);

      await tester.tap(find.byKey(const Key('address-default-a2')));
      await tester.pumpAndSettle();
      expect(
        _calls(requests, 'POST', '/customers/me/addresses/a2/default'),
        hasLength(1),
      );
      expect(find.text('Adresse par défaut mise à jour.'), findsOneWidget);

      await tester.tap(find.byKey(const Key('address-delete-a2')));
      await tester.pumpAndSettle();
      expect(_calls(requests, 'DELETE', '/customers/me/addresses/a2'), isEmpty);
      await tester.tap(find.byKey(const Key('address-delete-confirm-a2')));
      await tester.pumpAndSettle();
      expect(
        _calls(requests, 'DELETE', '/customers/me/addresses/a2'),
        hasLength(1),
      );
      expect(find.text('Second'), findsNothing);
    },
  );
}
