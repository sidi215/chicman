import 'dart:convert';

import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/core/theme/theme_mode_controller.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../auth/fakes.dart';

const _config = AppConfig(
  supabaseUrl: 'https://p.supabase.co',
  supabasePublishableKey: 'k',
  apiBaseUrl: 'http://api.test',
  siteUrl: 'https://chicman.test',
);

const _restored = AuthSession(userId: 'u1', email: 'a@b.mr');

Map<String, Object?> _account({
  String? fullName = 'Aminetou',
  String locale = 'fr',
  String phone = '+22222123456',
}) => {
  'userId': 'u1',
  'roles': ['CUSTOMER'],
  'profile': {
    'id': 'p1',
    'fullName': fullName,
    'preferredLocale': locale,
    'phone': phone,
  },
};

/// API with a stored profile; `PATCH` applies the body, or answers [patch].
ApiClient _api(List<http.Request> requests, {(int, Object?)? patch}) {
  var stored = _account();
  return routedApi({
    'GET /auth/session': (_) => (
      200,
      {
        'userId': 'u1',
        'roles': ['CUSTOMER'],
      },
    ),
    'GET /customers/me': (_) => (200, stored),
    'PATCH /customers/me': (request) {
      if (patch != null) return patch;
      final body = jsonDecode(request.body) as Map<String, Object?>;
      final profile = {...stored['profile']! as Map<String, Object?>, ...body};
      stored = {...stored, 'profile': profile};
      return (200, stored);
    },
  }, requests: requests);
}

Future<FakeAuthRepository> _openSettings(
  WidgetTester tester,
  ApiClient api,
) async {
  await tester.binding.setSurfaceSize(const Size(500, 1400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final repository = FakeAuthRepository(restored: _restored);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(null),
        appConfigProvider.overrideWithValue(_config),
        authRepositoryProvider.overrideWithValue(repository),
        apiClientProvider.overrideWithValue(api),
        incomingLinksProvider.overrideWithValue(null),
      ],
      child: const MyApp(),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('account-profile-settings')));
  await tester.pumpAndSettle();
  return repository;
}

Iterable<http.Request> _patches(List<http.Request> requests) =>
    requests.where((r) => r.method == 'PATCH');

void main() {
  testWidgets('the account screen opens profile settings with stored values', (
    tester,
  ) async {
    final requests = <http.Request>[];
    await _openSettings(tester, _api(requests));
    expect(find.text('Paramètres du profil'), findsOneWidget);
    expect(find.text('Aminetou'), findsOneWidget);
    expect(find.text('+22222123456'), findsOneWidget);
    expect(find.text('Téléphone de contact (non vérifié)'), findsOneWidget);
    expect(find.byKey(const Key('profile-theme-selector')), findsOneWidget);
  });

  testWidgets('saving sends only the changed fields and shows the result', (
    tester,
  ) async {
    final requests = <http.Request>[];
    await _openSettings(tester, _api(requests));
    await tester.enterText(
      find.byKey(const Key('profile-full-name')),
      ' Aminetou Mint Ahmed ',
    );
    await tester.enterText(
      find.byKey(const Key('profile-phone')),
      '33 44 55 66',
    );
    await tester.tap(find.text('العربية'));
    await tester.tap(find.byKey(const Key('profile-save')));
    await tester.pumpAndSettle();

    final patch = _patches(requests).single;
    expect(jsonDecode(patch.body), {
      'fullName': 'Aminetou Mint Ahmed',
      'preferredLocale': 'ar',
      'phone': '+22233445566',
    });
    expect(patch.headers['authorization'], 'Bearer access-token');
    expect(find.text('Profil enregistré.'), findsOneWidget);
    expect(find.text('+22233445566'), findsOneWidget);
  });

  testWidgets('an untouched form sends nothing', (tester) async {
    final requests = <http.Request>[];
    await _openSettings(tester, _api(requests));
    await tester.tap(find.byKey(const Key('profile-save')));
    await tester.pumpAndSettle();
    expect(_patches(requests), isEmpty);
    expect(find.text('Aucune modification à enregistrer.'), findsOneWidget);
  });

  testWidgets('an invalid or empty phone is refused before any request', (
    tester,
  ) async {
    final requests = <http.Request>[];
    await _openSettings(tester, _api(requests));
    await tester.enterText(find.byKey(const Key('profile-phone')), '');
    await tester.tap(find.byKey(const Key('profile-save')));
    await tester.pumpAndSettle();
    expect(_patches(requests), isEmpty);
    expect(find.text('Numéro de téléphone invalide.'), findsOneWidget);
  });

  testWidgets('400 INVALID_PHONE from the API marks the phone field', (
    tester,
  ) async {
    final requests = <http.Request>[];
    await _openSettings(
      tester,
      _api(
        requests,
        patch: (
          400,
          {
            'error': {'code': 'INVALID_PHONE'},
          },
        ),
      ),
    );
    await tester.enterText(
      find.byKey(const Key('profile-phone')),
      '+99912345678',
    );
    await tester.tap(find.byKey(const Key('profile-save')));
    await tester.pumpAndSettle();
    expect(find.text('Numéro de téléphone invalide.'), findsOneWidget);
  });

  for (final (status, code, message) in [
    (429, 'RATE_LIMITED', 'Trop de modifications. Réessayez plus tard.'),
    (
      503,
      'SERVICE_UNAVAILABLE',
      "Le service est momentanément indisponible. Vos modifications n'ont pas été enregistrées ; réessayez dans un instant.",
    ),
  ]) {
    testWidgets('$status $code keeps the form and explains why', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await _openSettings(
        tester,
        _api(
          requests,
          patch: (
            status,
            {
              'error': {'code': code},
            },
          ),
        ),
      );
      await tester.enterText(
        find.byKey(const Key('profile-full-name')),
        'Fatimetou',
      );
      await tester.tap(find.byKey(const Key('profile-save')));
      await tester.pumpAndSettle();
      expect(find.text(message), findsOneWidget);
      expect(find.text('Fatimetou'), findsOneWidget);
    });
  }

  testWidgets('401 on save ends the session', (tester) async {
    final requests = <http.Request>[];
    final repository = await _openSettings(
      tester,
      _api(
        requests,
        patch: (
          401,
          {
            'error': {'code': 'UNAUTHORIZED'},
          },
        ),
      ),
    );
    await tester.enterText(
      find.byKey(const Key('profile-full-name')),
      'Fatimetou',
    );
    await tester.tap(find.byKey(const Key('profile-save')));
    await tester.pumpAndSettle();
    expect(repository.calls, contains('signOut'));
    expect(find.text('Connexion'), findsWidgets);
  });

  testWidgets('the theme selector is device-local and calls no API', (
    tester,
  ) async {
    final requests = <http.Request>[];
    await _openSettings(tester, _api(requests));
    final before = requests.length;
    await tester.tap(
      find.descendant(
        of: find.byKey(const Key('profile-theme-selector')),
        matching: find.text('Sombre'),
      ),
    );
    await tester.pumpAndSettle();
    final container = ProviderScope.containerOf(
      tester.element(find.byType(MaterialApp)),
    );
    expect(container.read(themeModeProvider), ThemeMode.dark);
    expect(requests.length, before);
  });
}
