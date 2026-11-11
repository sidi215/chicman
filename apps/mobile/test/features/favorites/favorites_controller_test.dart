import 'dart:async';
import 'dart:convert';

import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/favorites/application/favorites_providers.dart';
import 'package:chicman/features/favorites/presentation/favorites_screen.dart';
import 'package:chicman/core/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../auth/fakes.dart';

const _config = AppConfig(
  supabaseUrl: 'https://p.supabase.co',
  supabasePublishableKey: 'k',
  apiBaseUrl: 'http://api.test',
  siteUrl: 'https://shop.test',
);

Map<String, Object?> _item(String id) => {
  'productId': id,
  'addedAt': '2026-11-10T10:00:00.000Z',
  'name': id,
  'imageUrl': null,
  'state': 'UNAVAILABLE',
  'product': null,
};

String _list(Iterable<String> ids) =>
    jsonEncode({'items': ids.map(_item).toList()});

/// A server whose answers the test releases by hand, in any order.
class _HeldServer {
  /// What the server holds, changed when a request is received.
  final saved = <String>{};
  final received = <String>[];
  final _held = <String, Completer<http.Response>>{};

  /// Requests (`'PUT p1'`) whose answer waits for [release].
  final hold = <String>{};

  late final client = MockClient((request) async {
    final id = request.url.pathSegments.last;
    final key = request.method == 'GET' ? 'GET' : '${request.method} $id';
    received.add(key);
    if (request.method == 'PUT') saved.add(id);
    if (request.method == 'DELETE') saved.remove(id);
    // The answer is the list as it was when this request was handled.
    final body = http.Response(_list([...saved]), 200);
    if (!hold.contains(key)) return body;
    final completer = Completer<http.Response>();
    _held[key] = completer;
    return completer.future.then((override) => override);
  });

  void release(String key, [http.Response? response]) {
    _held.remove(key)!.complete(response ?? http.Response(_list(saved), 200));
  }

  bool isHeld(String key) => _held.containsKey(key);
}

Future<ProviderContainer> _container(
  _HeldServer server,
  FakeAuthRepository repository,
) async {
  final container = ProviderContainer(
    overrides: [
      sharedPreferencesProvider.overrideWithValue(null),
      appConfigProvider.overrideWithValue(_config),
      authRepositoryProvider.overrideWithValue(repository),
      apiClientProvider.overrideWithValue(
        ApiClient(baseUrl: 'http://api.test', httpClient: server.client),
      ),
    ],
  );
  addTearDown(container.dispose);
  container.listen(favoritesProvider, (_, _) {}, fireImmediately: true);
  await _settle(container, FavoritesViewKind.ready);
  return container;
}

Future<void> _settle(
  ProviderContainer container,
  FavoritesViewKind kind,
) async {
  for (var i = 0; i < 100; i++) {
    if (container.read(favoritesProvider).kind == kind) return;
    await Future<void>.delayed(Duration.zero);
  }
  fail(
    'favorites never reached $kind: ${container.read(favoritesProvider).kind}',
  );
}

Future<void> _flush() async {
  for (var i = 0; i < 20; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  test('a slow earlier answer never replaces a newer list', () async {
    final server = _HeldServer()..hold.add('PUT p1');
    final container = await _container(
      server,
      FakeAuthRepository(
        restored: const AuthSession(userId: 'u1', email: 'a@b.c'),
      ),
    );
    final favorites = container.read(favoritesProvider.notifier);

    final first = favorites.add('p1');
    final second = favorites.add('p2');
    await _flush();
    // One at a time: the second add waits for the first answer.
    expect(server.received.where((r) => r.startsWith('PUT')), ['PUT p1']);

    server.release('PUT p1');
    expect(await first, isNull);
    expect(await second, isNull);
    expect(server.received.where((r) => r.startsWith('PUT')), [
      'PUT p1',
      'PUT p2',
    ]);
    // The last answer shown is the newest list, with both products.
    expect(container.read(favoritesProvider).productIds, {'p1', 'p2'});
  });

  test('a reload answered late does not hide a change made after it', () async {
    final server = _HeldServer();
    final container = await _container(
      server,
      FakeAuthRepository(
        restored: const AuthSession(userId: 'u1', email: 'a@b.c'),
      ),
    );
    final favorites = container.read(favoritesProvider.notifier);
    server.hold.add('GET');

    final reload = favorites.reload();
    final add = favorites.add('p1');
    await _flush();
    expect(server.received.last, 'GET', reason: 'the add waits for the reload');

    server.release('GET');
    await reload;
    expect(await add, isNull);
    expect(container.read(favoritesProvider).productIds, {'p1'});
  });

  test(
    'a late 401 for a previous account never signs out the next one',
    () async {
      final server = _HeldServer()..hold.add('PUT p1');
      final repository = FakeAuthRepository(
        restored: const AuthSession(userId: 'u1', email: 'a@b.c'),
      );
      final container = await _container(server, repository);

      final pending = container.read(favoritesProvider.notifier).add('p1');
      await _flush();
      // The account changes while the request is out.
      await repository.signOut();
      await _settle(container, FavoritesViewKind.guest);
      await repository.signIn('a@b.c', 'secret');
      await _settle(container, FavoritesViewKind.ready);
      final signOuts = repository.calls.where((c) => c == 'signOut').length;

      server.release(
        'PUT p1',
        http.Response('{"error":{"code":"UNAUTHORIZED"}}', 401),
      );
      expect(await pending, isNull, reason: 'a stale answer is dropped');
      await _flush();
      expect(repository.calls.where((c) => c == 'signOut').length, signOuts);
      expect(repository.currentSession, isNotNull);
    },
  );

  test('a request still queued at an account change is never sent', () async {
    final server = _HeldServer()..hold.add('PUT p1');
    final repository = FakeAuthRepository(
      restored: const AuthSession(userId: 'u1', email: 'a@b.c'),
    );
    final container = await _container(server, repository);
    final favorites = container.read(favoritesProvider.notifier);

    final first = favorites.add('p1');
    final queued = favorites.add('p2');
    await _flush();
    await repository.signOut();
    await _settle(container, FavoritesViewKind.guest);

    server.release('PUT p1');
    await first;
    await queued;
    await _flush();
    // `p2` was asked for by the previous account: it must not reach the server.
    expect(server.received.contains('PUT p2'), isFalse);
  });

  testWidgets(
    'the sign-in message scrolls with enlarged text on a short screen',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 260));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            sharedPreferencesProvider.overrideWithValue(null),
            appConfigProvider.overrideWithValue(_config),
            authRepositoryProvider.overrideWithValue(FakeAuthRepository()),
            apiClientProvider.overrideWithValue(
              ApiClient(
                baseUrl: 'http://api.test',
                httpClient: _HeldServer().client,
              ),
            ),
          ],
          child: MaterialApp(
            theme: AppTheme.light,
            supportedLocales: const [Locale('fr'), Locale('ar')],
            localizationsDelegates: GlobalMaterialLocalizations.delegates,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(2)),
              child: child!,
            ),
            home: const FavoritesScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'no overflow');
      final login = find.text('Se connecter');
      await tester.scrollUntilVisible(
        login,
        50,
        scrollable: find.byType(Scrollable).first,
      );
      expect(login.hitTestable(), findsOneWidget);
    },
  );
}
