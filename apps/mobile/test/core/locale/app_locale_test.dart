import 'dart:async';

import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/locale/app_locale_controller.dart';
import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../features/auth/fakes.dart';

const _config = AppConfig(
  supabaseUrl: 'https://p.supabase.co',
  supabasePublishableKey: 'k',
  apiBaseUrl: 'http://api.test',
  siteUrl: 'https://chicman.test',
);

const _session = AuthSession(userId: 'u1', email: 'a@b.mr');

Map<String, Object?> _account(String locale) => {
  'userId': 'u1',
  'roles': ['CUSTOMER'],
  'profile': {
    'id': 'p1',
    'fullName': 'Aminetou',
    'preferredLocale': locale,
    'phone': '+22222123456',
  },
};

class _Language extends StatelessWidget {
  const _Language();

  @override
  Widget build(BuildContext context) => Text(
    '${Localizations.localeOf(context).languageCode} '
    '${Directionality.of(context).name}',
    key: const Key('language'),
  );
}

String _shown(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('language'))).data!;

Future<SharedPreferences> _prefs([Map<String, Object> values = const {}]) {
  SharedPreferences.setMockInitialValues(values);
  return SharedPreferences.getInstance();
}

Future<void> _pump(
  WidgetTester tester, {
  required ApiClient api,
  required FakeAuthRepository repository,
  SharedPreferences? prefs,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        appConfigProvider.overrideWithValue(_config),
        authRepositoryProvider.overrideWithValue(repository),
        apiClientProvider.overrideWithValue(api),
        incomingLinksProvider.overrideWithValue(null),
      ],
      child: const MyApp(home: _Language()),
    ),
  );
  await tester.pumpAndSettle();
}

ApiClient _apiWith(String locale, List<http.Request> requests) => routedApi({
  'GET /customers/me': (_) => (200, _account(locale)),
}, requests: requests);

void main() {
  testWidgets('a restored session follows the profile language, in RTL', (
    tester,
  ) async {
    final prefs = await _prefs();
    await _pump(
      tester,
      api: _apiWith('ar', []),
      repository: FakeAuthRepository(restored: _session),
      prefs: prefs,
    );
    expect(_shown(tester), 'ar rtl');
    expect(prefs.getString(AppLocaleController.storageKey), 'ar');
  });

  testWidgets('the profile replaces another language saved on the device', (
    tester,
  ) async {
    await _pump(
      tester,
      api: _apiWith('fr', []),
      repository: FakeAuthRepository(restored: _session),
      prefs: await _prefs({AppLocaleController.storageKey: 'ar'}),
    );
    expect(_shown(tester), 'fr ltr');
  });

  testWidgets('signing in applies the profile language', (tester) async {
    final repository = FakeAuthRepository();
    final requests = <http.Request>[];
    await _pump(
      tester,
      api: _apiWith('ar', requests),
      repository: repository,
      prefs: await _prefs(),
    );
    expect(_shown(tester), 'fr ltr');
    expect(requests, isEmpty);
    await repository.signIn('a@b.mr', 'password');
    await tester.pumpAndSettle();
    expect(_shown(tester), 'ar rtl');
  });

  testWidgets('a guest with an Arabic device gets Arabic', (tester) async {
    tester.platformDispatcher.localesTestValue = const [Locale('ar')];
    addTearDown(tester.platformDispatcher.clearLocalesTestValue);
    final requests = <http.Request>[];
    await _pump(
      tester,
      api: _apiWith('fr', requests),
      repository: FakeAuthRepository(),
      prefs: await _prefs(),
    );
    expect(_shown(tester), 'ar rtl');
    expect(requests, isEmpty);
  });

  testWidgets('the saved language applies from the first frame, offline too', (
    tester,
  ) async {
    final failing = ApiClient(
      baseUrl: 'http://api.test',
      httpClient: MockClient((_) async => throw http.ClientException('down')),
    );
    await _pump(
      tester,
      api: failing,
      repository: FakeAuthRepository(restored: _session),
      prefs: await _prefs({AppLocaleController.storageKey: 'ar'}),
    );
    expect(_shown(tester), 'ar rtl');
  });

  testWidgets('an account not set up yet keeps the current language', (
    tester,
  ) async {
    final api = routedApi({
      'GET /customers/me': (_) => (
        403,
        {
          'error': {'code': 'ACCOUNT_NOT_BOOTSTRAPPED'},
        },
      ),
    });
    await _pump(
      tester,
      api: api,
      repository: FakeAuthRepository(restored: _session),
      prefs: await _prefs({AppLocaleController.storageKey: 'ar'}),
    );
    expect(_shown(tester), 'ar rtl');
  });

  testWidgets('signing out keeps the language; another user gets theirs', (
    tester,
  ) async {
    final repository = FakeAuthRepository(restored: _session);
    final requests = <http.Request>[];
    await _pump(
      tester,
      api: _apiWith('ar', requests),
      repository: repository,
      prefs: await _prefs(),
    );
    await repository.signOut();
    await tester.pumpAndSettle();
    expect(_shown(tester), 'ar rtl');
    await repository.signIn('a@b.mr', 'password');
    await tester.pumpAndSettle();
    expect(requests.where((r) => r.method == 'GET'), hasLength(2));
  });

  testWidgets('a newer save wins over a profile read still in flight', (
    tester,
  ) async {
    final release = Completer<void>();
    final slow = ApiClient(
      baseUrl: 'http://api.test',
      httpClient: MockClient((_) async {
        await release.future;
        return http.Response(
          '{"userId":"u1","roles":[],"profile":{"id":"p","preferredLocale":"fr","phone":"+22222123456"}}',
          200,
        );
      }),
    );
    await _pump(
      tester,
      api: slow,
      repository: FakeAuthRepository(restored: _session),
      prefs: await _prefs(),
    );
    final container = ProviderScope.containerOf(
      tester.element(find.byKey(const Key('language'))),
    );
    await container.read(appLocaleProvider.notifier).setLanguage('ar');
    release.complete();
    await tester.pumpAndSettle();
    expect(_shown(tester), 'ar rtl');
  });

  testWidgets('storage that is unavailable does not stop the language', (
    tester,
  ) async {
    await _pump(
      tester,
      api: _apiWith('ar', []),
      repository: FakeAuthRepository(restored: _session),
    );
    expect(_shown(tester), 'ar rtl');
  });
}
