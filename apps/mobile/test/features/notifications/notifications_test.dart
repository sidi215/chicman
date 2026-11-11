import 'dart:async';
import 'dart:convert';

import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/core/theme/app_theme.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/notifications/application/notifications_providers.dart';
import 'package:chicman/features/notifications/domain/notifications.dart';
import 'package:chicman/features/notifications/presentation/notifications_messages.dart';
import 'package:chicman/features/notifications/presentation/notifications_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
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

Map<String, Object?> _item(
  String id, {
  String type = 'SHOP_ORDER_CONFIRMED',
  Map<String, Object?>? payload,
  String audience = 'CUSTOMER',
  bool read = false,
  String? orderId = 'o1',
}) => {
  'id': id,
  'type': type,
  'payload':
      payload ?? {'orderReference': 'CM-$id', 'shopName': 'Boutique Alpha'},
  'audience': audience,
  'resource': {'type': 'SHOP_ORDER', 'id': 'so-$id', 'orderId': orderId},
  'createdAt': '2026-11-10T10:00:00.000Z',
  'readAt': read ? '2026-11-10T11:00:00.000Z' : null,
};

/// A fake notifications API. Requests whose key is in [hold] wait for [release].
class _Server {
  _Server(this.items);

  /// Newest first.
  final List<Map<String, Object?>> items;
  final received = <String>[];
  final hold = <String>{};
  final _held = <String, Completer<http.Response>>{};
  int pageSize = 50;

  int get _unread => items.where((item) => item['readAt'] == null).length;

  late final client = MockClient((request) async {
    final path = request.url.path.replaceFirst('/api/v1', '');
    final key = '${request.method} $path';
    received.add('$key?${request.url.query}');
    final response = _answer(request, path);
    if (!hold.contains(key)) return response;
    final completer = Completer<http.Response>();
    _held[key] = completer;
    return completer.future;
  });

  http.Response _answer(http.Request request, String path) {
    if (path.endsWith('/unread-count')) {
      return http.Response(jsonEncode({'unread': _unread}), 200);
    }
    if (path.endsWith('/read-all')) {
      for (final item in items) {
        item['readAt'] ??= '2026-11-11T00:00:00.000Z';
      }
      return http.Response('', 204);
    }
    if (path.endsWith('/read')) {
      final id = request.url.pathSegments[request.url.pathSegments.length - 2];
      final item = items.where((item) => item['id'] == id).firstOrNull;
      if (item == null) {
        return http.Response(
          '{"error":{"code":"NOTIFICATION_NOT_FOUND"}}',
          404,
        );
      }
      item['readAt'] ??= '2026-11-11T00:00:00.000Z';
      return http.Response('', 204);
    }
    final cursor = request.url.queryParameters['cursor'];
    final start = cursor == null ? 0 : int.parse(cursor);
    final page = items.skip(start).take(pageSize).toList();
    final next = start + pageSize < items.length ? '${start + pageSize}' : null;
    return http.Response(jsonEncode({'items': page, 'nextCursor': next}), 200);
  }

  void release(String key) => _held.remove(key)!.complete(_answerHeld(key));

  http.Response _answerHeld(String key) =>
      http.Response(jsonEncode({'items': items, 'nextCursor': null}), 200);
}

List<Override> _overrides(_Server server, FakeAuthRepository repository) => [
  sharedPreferencesProvider.overrideWithValue(null),
  appConfigProvider.overrideWithValue(_config),
  authRepositoryProvider.overrideWithValue(repository),
  apiClientProvider.overrideWithValue(
    ApiClient(baseUrl: 'http://api.test', httpClient: server.client),
  ),
];

Future<ProviderContainer> _container(
  _Server server,
  FakeAuthRepository repository,
) async {
  final container = ProviderContainer(
    overrides: _overrides(server, repository),
  );
  addTearDown(container.dispose);
  container.listen(notificationsProvider, (_, _) {}, fireImmediately: true);
  await _flush();
  return container;
}

Future<void> _flush() async {
  for (var i = 0; i < 30; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

FakeAuthRepository _signedIn() => FakeAuthRepository(
  restored: const AuthSession(userId: 'u1', email: 'a@b.c'),
);

void main() {
  group('domain', () {
    test('every request is narrowed to customer order notifications', () {
      expect(notificationListPath(null), contains('audience=CUSTOMER'));
      expect(
        notificationListPath('a+b'),
        '/customers/me/notifications?audience=CUSTOMER&cursor=a%2Bb',
      );
      expect(unreadCountPath, endsWith('?audience=CUSTOMER'));
      expect(readAllPath, endsWith('?audience=CUSTOMER'));
      expect(markReadPath('n 1'), '/customers/me/notifications/n%201/read');
    });

    test('opens a shop order only for the customer', () {
      expect(NotificationItem.fromJson(_item('a')).orderId, 'o1');
      expect(
        NotificationItem.fromJson(_item('a', audience: 'SELLER')).orderId,
        isNull,
      );
      final noResource = {..._item('a'), 'resource': null};
      expect(NotificationItem.fromJson(noResource).orderId, isNull);
    });

    test('a 204 answer decodes as no content', () {
      final result = ApiClient.classify(http.Response('', 204), decodeNothing);
      expect(result, isA<ApiOk<void>>());
    });

    test('appends a page without repeating an item and caps the badge', () {
      final a = NotificationItem.fromJson(_item('a'));
      final b = NotificationItem.fromJson(_item('b'));
      expect(appendPage([a], [a, b]).map((item) => item.id), ['a', 'b']);
      expect(unreadBadge(5), '5');
      expect(unreadBadge(100), '99+');
    });
  });

  group('messages', () {
    test('both languages have the same keys', () {
      expect(
        NotificationMessages.ar.keys.toSet(),
        NotificationMessages.fr.keys.toSet(),
      );
    });

    test('renders every customer type with no placeholder or raw code', () {
      final samples = [
        _item('1'),
        _item('2', type: 'SHOP_ORDER_EXPIRED'),
        _item('3', type: 'DELIVERY_CLOSED_UNDELIVERABLE'),
        _item(
          '4',
          type: 'SHOP_ORDER_REJECTED',
          payload: {
            'orderReference': 'CM-4',
            'shopName': 'Boutique Alpha',
            'reasonCode': 'OUT_OF_STOCK',
          },
        ),
        _item(
          '5',
          type: 'SHOP_ORDER_CANCELLED',
          payload: {
            'orderReference': 'CM-5',
            'shopName': 'Boutique Alpha',
            'cancelledBy': 'CHICMAN',
            'reasonCode': null,
          },
        ),
        _item(
          '6',
          type: 'SHOP_ORDER_CANCELLED',
          payload: {
            'orderReference': 'CM-6',
            'shopName': 'Boutique Alpha',
            'cancelledBy': 'SELLER',
            'reasonCode': 'PRICE_ERROR',
          },
        ),
        _item(
          '7',
          type: 'DELIVERY_DISPATCHED',
          payload: {
            'orderReference': 'CM-7',
            'shopName': 'Boutique Alpha',
            'attemptNumber': 2,
          },
        ),
        _item(
          '8',
          type: 'DELIVERY_ATTEMPT_FAILED',
          payload: {
            'orderReference': 'CM-8',
            'shopName': 'Boutique Alpha',
            'reasonCode': 'CUSTOMER_ABSENT',
          },
        ),
        _item(
          '9',
          type: 'DELIVERY_COMPLETED',
          payload: {
            'orderReference': 'CM-9',
            'shopName': 'Boutique Alpha',
            'amountCollected': '3100.00',
          },
        ),
      ].map(NotificationItem.fromJson);
      for (final t in [NotificationMessages.fr, NotificationMessages.ar]) {
        for (final item in samples) {
          final text = t.describe(item);
          final all = '${text.title} ${text.body}';
          expect(
            text.title,
            isNot(t.describe(_unknown()).title),
            reason: item.type,
          );
          expect(
            all,
            isNot(matches(RegExp(r'\{\w+\}|null|_[A-Z]'))),
            reason: all,
          );
          expect(all, contains('Boutique Alpha'));
        }
      }
      final rejected = NotificationMessages.fr.describe(
        samples.firstWhere((item) => item.type == 'SHOP_ORDER_REJECTED'),
      );
      expect(rejected.body, contains('Article en rupture de stock'));
      final failed = NotificationMessages.fr.describe(
        samples.firstWhere((item) => item.type == 'DELIVERY_ATTEMPT_FAILED'),
      );
      expect(failed.body, contains('Client absent'));
    });

    test('a type from a newer API shows a generic title', () {
      expect(NotificationMessages.fr.describe(_unknown()), (
        title: 'Nouvelle notification',
        body: '',
      ));
    });
  });

  group('controller', () {
    test('reads the count on sign-in, then the list when asked', () async {
      final server = _Server([_item('a'), _item('b', read: true)]);
      final container = await _container(server, _signedIn());
      expect(container.read(notificationsProvider).unread, 1);
      expect(
        server.received.single,
        contains('unread-count?audience=CUSTOMER'),
      );

      await container.read(notificationsProvider.notifier).reload();
      final view = container.read(notificationsProvider);
      expect(view.kind, NotificationsViewKind.ready);
      expect(view.items.map((item) => item.id), ['a', 'b']);
    });

    test('marks one read, then all, keeping the count in step', () async {
      final server = _Server([_item('a'), _item('b'), _item('c')]);
      final container = await _container(server, _signedIn());
      final controller = container.read(notificationsProvider.notifier);
      await controller.reload();
      expect(container.read(notificationsProvider).unread, 3);

      await controller.markRead(container.read(notificationsProvider).items[0]);
      var view = container.read(notificationsProvider);
      expect(view.items[0].isUnread, isFalse);
      expect(view.unread, 2);
      expect(
        server.received,
        contains('POST /customers/me/notifications/a/read?'),
      );

      await controller.markAllRead();
      view = container.read(notificationsProvider);
      expect(view.items.every((item) => !item.isUnread), isTrue);
      expect(view.unread, 0);
      expect(
        server.received,
        contains('POST /customers/me/notifications/read-all?audience=CUSTOMER'),
      );
    });

    test('loads further pages', () async {
      final server = _Server([for (var i = 0; i < 5; i++) _item('n$i')])
        ..pageSize = 2;
      final container = await _container(server, _signedIn());
      final controller = container.read(notificationsProvider.notifier);
      await controller.reload();
      expect(container.read(notificationsProvider).hasMore, isTrue);
      await controller.loadMore();
      await controller.loadMore();
      final view = container.read(notificationsProvider);
      expect(view.items.map((item) => item.id), ['n0', 'n1', 'n2', 'n3', 'n4']);
      expect(view.hasMore, isFalse);
    });

    test('a guest makes no request', () async {
      final server = _Server([_item('a')]);
      final container = await _container(server, FakeAuthRepository());
      expect(
        container.read(notificationsProvider).kind,
        NotificationsViewKind.guest,
      );
      await container.read(notificationsProvider.notifier).reload();
      expect(server.received, isEmpty);
    });

    test('an answer for a previous account is dropped', () async {
      final server = _Server([_item('a')])
        ..hold.add('GET /customers/me/notifications');
      final repository = _signedIn();
      final container = await _container(server, repository);
      final pending = container.read(notificationsProvider.notifier).reload();
      await _flush();
      await repository.signOut();
      await _flush();
      server.release('GET /customers/me/notifications');
      await pending;
      final view = container.read(notificationsProvider);
      expect(view.kind, NotificationsViewKind.guest);
      expect(view.items, isEmpty);
      expect(view.unread, 0);
    });
  });

  group('screen', () {
    Future<void> pump(
      WidgetTester tester,
      _Server server,
      Locale locale,
    ) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: _overrides(server, _signedIn()),
          child: MaterialApp(
            theme: AppTheme.light,
            locale: locale,
            supportedLocales: const [Locale('fr'), Locale('ar')],
            localizationsDelegates: GlobalMaterialLocalizations.delegates,
            home: Scaffold(
              appBar: AppBar(actions: const [NotificationsAction()]),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('the bell shows the unread count and opens the center', (
      tester,
    ) async {
      final server = _Server([_item('a'), _item('b')]);
      await pump(tester, server, const Locale('fr'));
      expect(find.byKey(const Key('notifications-badge')), findsOneWidget);
      expect(find.text('2'), findsOneWidget);

      await tester.tap(find.byKey(const Key('notifications-action')));
      await tester.pumpAndSettle();
      expect(find.text('Commande confirmée'), findsNWidgets(2));
      expect(find.byKey(const Key('notification-unread-a')), findsOneWidget);

      await tester.tap(find.byKey(const Key('notification-read-a')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('notification-unread-a')), findsNothing);

      await tester.tap(find.byKey(const Key('notifications-read-all')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('notification-unread-b')), findsNothing);
      expect(find.byKey(const Key('notifications-read-all')), findsNothing);
    });

    testWidgets('renders right to left in Arabic', (tester) async {
      final server = _Server([_item('a')]);
      await pump(tester, server, const Locale('ar'));
      await tester.tap(find.byKey(const Key('notifications-action')));
      await tester.pumpAndSettle();
      expect(find.text('الإشعارات'), findsOneWidget);
      expect(find.text('تم تأكيد الطلب'), findsOneWidget);
      final direction = Directionality.of(
        tester.element(find.byKey(const Key('notifications-list'))),
      );
      expect(direction, TextDirection.rtl);
    });

    testWidgets('the bell is hidden for guests', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: _overrides(_Server([]), FakeAuthRepository()),
          child: MaterialApp(
            theme: AppTheme.light,
            home: Scaffold(
              appBar: AppBar(actions: const [NotificationsAction()]),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('notifications-action')), findsNothing);
    });
  });
}

NotificationItem _unknown() => NotificationItem.fromJson({
  ..._item('x'),
  'type': 'SOMETHING_NEW',
  'payload': <String, Object?>{},
});
