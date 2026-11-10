import 'dart:async';
import 'dart:convert';

import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/core/theme/app_theme.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/orders/domain/orders.dart';
import 'package:chicman/features/orders/presentation/order_messages.dart';
import 'package:chicman/features/orders/presentation/order_screens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../auth/fakes.dart';

const _orderId = '11111111-1111-4111-8111-111111111111';

Map<String, Object?> _shopOrder({
  String id = 'so1',
  String shop = 'Maison Lalla',
  String status = 'PENDING',
  String label = 'AWAITING_SHOP',
  bool canCancel = true,
  Map<String, Object?> decision = const {'cancelledBy': null, 'reason': null},
  String paymentStatus = 'PENDING',
  String? deliveryStatus,
  Map<String, Object?>? deliveryProgress,
}) => {
  'id': id,
  'status': status,
  'label': label,
  'deliveryStatus': deliveryStatus,
  'deliveryProgress': deliveryProgress,
  'respondBy': '2026-11-11T10:00:00.000Z',
  'closedAt': null,
  'decision': decision,
  'canCancel': canCancel,
  'shop': {
    'id': 'shop-$id',
    'name': shop,
    'contactPhone': '+22236000000',
    'whatsappPhone': '+22246000001',
  },
  'productsSubtotal': '1500.00',
  'deliveryFee': '100.00',
  'total': '1600.00',
  'delivery': {
    'recipientName': 'Moussa',
    'deliveryPhone': '+22233000000',
    'label': 'Maison',
    'city': 'Nouakchott',
    'district': 'Ksar',
    'landmark': 'Près du marché',
    'latitude': 18.08,
    'longitude': -15.97,
    'locationSource': 'MANUAL',
    'accuracyMeters': null,
  },
  'items': [
    {
      'id': 'oi-$id',
      'productId': 'p1',
      'productName': 'Melhfa',
      'size': 'M',
      'color': null,
      'imageUrl': null,
      'unitPrice': '1500.00',
      'quantity': 1,
      'lineTotal': '1500.00',
    },
  ],
  'payment': {
    'method': 'CASH_ON_DELIVERY',
    'amountDue': '1600.00',
    'status': paymentStatus,
  },
};

Map<String, Object?> _order(List<Map<String, Object?>> shopOrders) => {
  'id': _orderId,
  'reference': 'CM-7K3QX9D2RB',
  'createdAt': '2026-11-09T10:00:00.000Z',
  'productsSubtotal': '1500.00',
  'deliveryFeeTotal': '100.00',
  'total': '1600.00',
  'paymentMethod': 'CASH_ON_DELIVERY',
  'shopOrders': shopOrders,
};

Map<String, Object?> _listPage(int page, int total, List<String> ids) => {
  'orders': [
    for (final id in ids)
      {
        'id': id,
        'reference': 'CM-$id',
        'createdAt': '2026-11-09T10:00:00.000Z',
        'total': '1600.00',
        'itemsCount': 2,
        'shopOrders': [
          {
            'id': 'so-$id',
            'shopName': 'Maison Lalla',
            'status': 'PENDING',
            'label': 'AWAITING_SHOP',
          },
        ],
      },
  ],
  'page': page,
  'pageSize': 1,
  'total': total,
};

http.Response _json(int status, Object body) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Future<void> _pump(
  WidgetTester tester, {
  required http.Client client,
  required Widget home,
  AuthRepository? repository,
  Locale? locale,
}) async {
  await tester.binding.setSurfaceSize(const Size(500, 2200));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(null),
        authRepositoryProvider.overrideWithValue(
          repository ??
              FakeAuthRepository(
                restored: const AuthSession(userId: 'u1', email: 'a@b.c'),
              ),
        ),
        apiClientProvider.overrideWithValue(
          ApiClient(baseUrl: 'http://api.test', httpClient: client),
        ),
      ],
      child: MaterialApp(
        theme: AppTheme.light,
        locale: locale,
        supportedLocales: const [Locale('fr'), Locale('ar')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: home,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Finder _key(String key) => find.byKey(Key(key));

void main() {
  group('order rules (spec 11)', () {
    test('builds the paths and the cancellation body like the web', () {
      expect(
        customerCancelPath('o 1', 's/2'),
        '/customers/me/orders/o%201/shop-orders/s%2F2/cancel',
      );
      expect(cancellationBody(null, 'x'), isEmpty);
      expect(cancellationBody(CustomerCancellationReason.changedMind, 'x'), {
        'reason': 'CHANGED_MIND',
      });
      expect(
        cancellationBody(CustomerCancellationReason.other, '  Trop long '),
        {'reason': 'OTHER', 'reasonText': 'Trop long'},
      );
    });

    test('checks the OTHER text with the API rule', () {
      expect(cancellationTextError('   '), CancellationTextError.required);
      expect(cancellationTextError('ab'), CancellationTextError.tooShort);
      expect(cancellationTextError('x' * 201), CancellationTextError.tooLong);
      expect(cancellationTextError('abc\u0007'), CancellationTextError.invalid);
      expect(cancellationTextError('Trop long'), isNull);
    });

    test('maps every answer like the web', () {
      OrderFailure of(int status, String code) =>
          (interpretOrderResult<Object?>(ApiError(status, code)) as OrderFailed)
              .failure;
      expect(of(404, 'ORDER_NOT_FOUND'), OrderFailure.notFound);
      expect(of(404, 'SHOP_ORDER_NOT_FOUND'), OrderFailure.notFound);
      expect(of(409, 'SHOP_ORDER_STATUS_CONFLICT'), OrderFailure.conflict);
      expect(of(409, 'SHOP_ORDER_EXPIRED'), OrderFailure.expired);
      expect(of(400, 'BAD_REQUEST'), OrderFailure.invalid);
      expect(of(429, 'RATE_LIMITED'), OrderFailure.rateLimited);
      expect(of(500, 'INTERNAL_ERROR'), OrderFailure.error);
      expect(OrderFailure.conflict.needsReload, isTrue);
      expect(OrderFailure.expired.needsReload, isTrue);
      expect(OrderFailure.invalid.needsReload, isFalse);
      expect(
        interpretOrderResult<Object?>(const ApiUnauthorized()),
        isA<OrderSignedOut<Object?>>(),
      );
    });

    test(
      'reads the lifecycle fields, treating anything but true as not cancellable',
      () {
        final order = CustomerOrder.fromJson(
          _order([
            _shopOrder(
              status: 'DELIVERED',
              label: 'DELIVERED',
              canCancel: false,
            ),
          ]),
        );
        final shopOrder = order.shopOrders.single;
        expect(shopOrder.status, ShopOrderStatus.delivered);
        expect(shopOrder.showsReturnsNotice, isTrue);
        expect(shopOrder.showsDeadline, isFalse);
        final missing = Map<String, Object?>.of(_shopOrder())
          ..remove('canCancel');
        expect(ShopOrder.fromJson(missing).canCancel, isFalse);
      },
    );

    test('has the same keys in French and Arabic', () {
      expect(OrderMessages.ar.keys.toSet(), OrderMessages.fr.keys.toSet());
      for (final label in ShopOrderLabel.values) {
        expect(OrderMessages.fr.label(label), isNotEmpty);
        expect(OrderMessages.ar.label(label), isNotEmpty);
      }
      for (final code in shopOrderReasonCodes) {
        expect(OrderMessages.fr.reason(code), isNot(contains(code)));
        expect(OrderMessages.ar.reason(code), isNot(contains(code)));
      }
      expect(OrderMessages.fr.cancelledByChicman, 'Annulée par Chicman');
      expect(OrderMessages.ar.cancelledByChicman, 'ألغتها شيكمان');
    });
  });

  group('delivery progress (spec 12)', () {
    test(
      'reads the customer view of the delivery, or nothing before confirmation',
      () {
        final pending = ShopOrder.fromJson(_shopOrder());
        expect(pending.deliveryProgress, isNull);
        final failed = ShopOrder.fromJson(
          _shopOrder(
            status: 'CONFIRMED',
            label: 'DELIVERY_FAILED_RETRY',
            deliveryStatus: 'FAILED',
            deliveryProgress: {
              'attemptsCount': 2,
              'currentAttemptDispatchedAt': null,
              'failures': [
                {
                  'attemptNumber': 1,
                  'reason': 'CUSTOMER_ABSENT',
                  'failedAt': '2026-11-10T09:00:00.000Z',
                },
                {
                  'attemptNumber': 2,
                  'reason': 'CUSTOMER_COULD_NOT_PAY',
                  'failedAt': '2026-11-10T15:00:00.000Z',
                },
              ],
              'deliveredAt': null,
            },
          ),
        );
        final progress = failed.deliveryProgress!;
        expect(progress.attemptsCount, 2);
        expect(progress.isVisible, isTrue);
        expect(progress.failures.map((f) => f.reason), [
          'CUSTOMER_ABSENT',
          'CUSTOMER_COULD_NOT_PAY',
        ]);
        expect(failed.showsRetryByPhone, isTrue);
        const confirmed = DeliveryProgress(attemptsCount: 0);
        expect(confirmed.isVisible, isFalse);
      },
    );

    test('translates every failure reason in French and Arabic', () {
      for (final t in [OrderMessages.fr, OrderMessages.ar]) {
        for (final reason in deliveryFailureReasons) {
          expect(t.deliveryFailure(reason), isNot(reason));
        }
      }
      expect(
        OrderMessages.fr.deliveryFailure('CUSTOMER_COULD_NOT_PAY'),
        "Le client n'a pas pu payer",
      );
      expect(
        OrderMessages.ar.deliveryFailure('ADDRESS_NOT_FOUND'),
        'العنوان غير موجود',
      );
    });
  });

  group('order screens', () {
    testWidgets('lists orders newest first and loads more pages', (
      tester,
    ) async {
      final pages = <String>[];
      await _pump(
        tester,
        home: const OrderListScreen(),
        client: MockClient((request) async {
          pages.add(request.url.query);
          final page = request.url.queryParameters['page'];
          return _json(
            200,
            page == '1' ? _listPage(1, 2, ['a']) : _listPage(2, 2, ['b']),
          );
        }),
      );
      expect(_key('order-a'), findsOneWidget);
      expect(find.text('En attente de la boutique'), findsOneWidget);
      await tester.tap(_key('orders-load-more'));
      await tester.pumpAndSettle();
      expect(_key('order-b'), findsOneWidget);
      expect(_key('orders-load-more'), findsNothing);
      expect(pages, ['page=1', 'page=2']);
    });

    testWidgets(
      'shows each shop with its label, decision, and returns sentence',
      (tester) async {
        await _pump(
          tester,
          home: const OrderDetailScreen(orderId: _orderId),
          client: MockClient(
            (_) async => _json(
              200,
              _order([
                _shopOrder(
                  id: 'so1',
                  status: 'REJECTED',
                  label: 'REJECTED',
                  canCancel: false,
                  decision: {'cancelledBy': null, 'reason': 'OUT_OF_STOCK'},
                  paymentStatus: 'CANCELLED',
                ),
                _shopOrder(
                  id: 'so2',
                  shop: 'Boutique Beta',
                  status: 'CANCELLED',
                  label: 'CANCELLED',
                  canCancel: false,
                  decision: {'cancelledBy': 'CHICMAN', 'reason': null},
                ),
                _shopOrder(
                  id: 'so3',
                  shop: 'Boutique Gamma',
                  status: 'DELIVERED',
                  label: 'DELIVERED',
                  canCancel: false,
                  paymentStatus: 'COLLECTED',
                ),
              ]),
            ),
          ),
        );
        expect(
          find.text('Motif : Article en rupture de stock'),
          findsOneWidget,
        );
        expect(find.text('Annulée par Chicman'), findsOneWidget);
        expect(_key('returns-so3'), findsOneWidget);
        expect(_key('returns-so1'), findsNothing);
        expect(find.byKey(const Key('cancel-so1')), findsNothing);
      },
    );

    testWidgets(
      'shows the payment method, amount due, and each payment status (spec 13)',
      (tester) async {
        const statuses = {
          'PENDING': 'Paiement : À payer à la livraison',
          'COLLECTED': 'Paiement : Payée',
          'FAILED': 'Paiement : Non payée (livraison impossible)',
          'CANCELLED': 'Paiement : Annulée',
        };
        for (final MapEntry(key: status, value: text) in statuses.entries) {
          await _pump(
            tester,
            home: const OrderDetailScreen(orderId: _orderId),
            client: MockClient(
              (_) async => _json(
                200,
                _order([_shopOrder(canCancel: false, paymentStatus: status)]),
              ),
            ),
          );
          expect(
            find.text(text, skipOffstage: false),
            findsOneWidget,
            reason: status,
          );
          expect(
            find.text('À payer en espèces à la livraison', skipOffstage: false),
            findsOneWidget,
          );
          await tester.scrollUntilVisible(
            find.text('Paiement à la livraison'),
            200,
            scrollable: find.byType(Scrollable).first,
          );
          expect(find.text('Paiement à la livraison'), findsOneWidget);
        }
      },
    );

    testWidgets('cancels a pending shop order with OTHER and its text', (
      tester,
    ) async {
      final bodies = <Object?>[];
      var cancelled = false;
      await _pump(
        tester,
        home: const OrderDetailScreen(orderId: _orderId),
        client: MockClient((request) async {
          if (request.method == 'POST') {
            expect(
              request.url.path,
              '/api/v1/customers/me/orders/$_orderId/shop-orders/so1/cancel',
            );
            bodies.add(jsonDecode(request.body));
            cancelled = true;
          }
          return _json(
            200,
            _order([
              cancelled
                  ? _shopOrder(
                      status: 'CANCELLED',
                      label: 'CANCELLED',
                      canCancel: false,
                      decision: {'cancelledBy': 'CUSTOMER', 'reason': null},
                      paymentStatus: 'CANCELLED',
                    )
                  : _shopOrder(),
            ]),
          );
        }),
      );
      await tester.tap(_key('cancel-so1'));
      await tester.pumpAndSettle();
      await tester.tap(_key('reason-chip-OTHER'));
      await tester.pumpAndSettle();
      await tester.tap(_key('cancel-confirm'));
      await tester.pumpAndSettle();
      expect(find.text('Précisez la raison.'), findsOneWidget);
      expect(bodies, isEmpty);
      await tester.enterText(_key('cancel-text'), 'Délai trop long');
      await tester.tap(_key('cancel-confirm'));
      await tester.pumpAndSettle();
      expect(bodies, [
        {'reason': 'OTHER', 'reasonText': 'Délai trop long'},
      ]);
      expect(_key('cancel-sheet'), findsNothing);
      expect(_key('order-notice'), findsOneWidget);
      expect(_key('cancel-so1'), findsNothing);
    });

    testWidgets('a refused cancellation shows why and the current state', (
      tester,
    ) async {
      var reads = 0;
      await _pump(
        tester,
        home: const OrderDetailScreen(orderId: _orderId),
        client: MockClient((request) async {
          if (request.method == 'POST') {
            return _json(409, {
              'error': {'code': 'SHOP_ORDER_EXPIRED'},
            });
          }
          reads += 1;
          return _json(
            200,
            _order([
              reads == 1
                  ? _shopOrder()
                  : _shopOrder(
                      status: 'EXPIRED',
                      label: 'EXPIRED',
                      canCancel: false,
                    ),
            ]),
          );
        }),
      );
      await tester.tap(_key('cancel-so1'));
      await tester.pumpAndSettle();
      await tester.tap(_key('cancel-confirm'));
      await tester.pumpAndSettle();
      expect(
        find.text('Le délai de réponse est dépassé : la commande a expiré.'),
        findsOneWidget,
      );
      expect(reads, 2);
      expect(
        find.text('Expirée (sans réponse de la boutique)'),
        findsOneWidget,
      );
      expect(_key('cancel-so1'), findsNothing);
    });

    testWidgets("drops an answer that arrives after the account changed", (
      tester,
    ) async {
      final repository = FakeAuthRepository(
        restored: const AuthSession(userId: 'u1', email: 'a@b.c'),
      );
      final answer = Completer<http.Response>();
      await _pump(
        tester,
        repository: repository,
        home: const OrderDetailScreen(orderId: _orderId),
        client: MockClient((_) => answer.future),
      );
      await repository.signOut();
      await tester.pumpAndSettle();
      answer.complete(_json(200, _order([_shopOrder()])));
      await tester.pumpAndSettle();
      expect(_key('order-detail'), findsNothing);
      expect(
        find.text('Connectez-vous pour voir vos commandes.'),
        findsOneWidget,
      );
    });

    testWidgets('shows delivery progress: dispatch, failures, delivered', (
      tester,
    ) async {
      await _pump(
        tester,
        home: const OrderDetailScreen(orderId: _orderId),
        client: MockClient(
          (_) async => _json(
            200,
            _order([
              _shopOrder(
                id: 'so1',
                status: 'CONFIRMED',
                label: 'OUT_FOR_DELIVERY',
                canCancel: false,
                deliveryStatus: 'OUT_FOR_DELIVERY',
                deliveryProgress: {
                  'attemptsCount': 2,
                  'currentAttemptDispatchedAt': '2026-11-10T15:00:00.000Z',
                  'failures': [
                    {
                      'attemptNumber': 1,
                      'reason': 'CUSTOMER_UNREACHABLE',
                      'failedAt': '2026-11-10T09:00:00.000Z',
                    },
                  ],
                  'deliveredAt': null,
                },
              ),
              _shopOrder(
                id: 'so2',
                shop: 'Boutique Beta',
                status: 'CONFIRMED',
                label: 'PREPARING',
                canCancel: false,
                deliveryStatus: 'PENDING',
                deliveryProgress: {
                  'attemptsCount': 0,
                  'currentAttemptDispatchedAt': null,
                  'failures': <Object?>[],
                  'deliveredAt': null,
                },
              ),
            ]),
          ),
        ),
      );
      expect(_key('delivery-so1'), findsOneWidget);
      expect(find.text('2 tentative(s) de livraison'), findsOneWidget);
      expect(find.textContaining('Tentative 1 échouée le'), findsOneWidget);
      expect(find.textContaining('Client injoignable'), findsOneWidget);
      expect(find.textContaining('Partie en livraison le'), findsOneWidget);
      expect(_key('delivery-so2'), findsNothing, reason: 'not dispatched yet');
      expect(
        find.text(
          'Pour une nouvelle tentative, contactez la boutique par téléphone.',
        ),
        findsNothing,
      );
    });

    testWidgets('a failed attempt says to call the shop, in Arabic too', (
      tester,
    ) async {
      await _pump(
        tester,
        locale: const Locale('ar'),
        home: const OrderDetailScreen(orderId: _orderId),
        client: MockClient(
          (_) async => _json(
            200,
            _order([
              _shopOrder(
                status: 'CONFIRMED',
                label: 'DELIVERY_FAILED_RETRY',
                canCancel: false,
                deliveryStatus: 'FAILED',
                deliveryProgress: {
                  'attemptsCount': 1,
                  'currentAttemptDispatchedAt': null,
                  'failures': [
                    {
                      'attemptNumber': 1,
                      'reason': 'CUSTOMER_COULD_NOT_PAY',
                      'failedAt': '2026-11-10T09:00:00.000Z',
                    },
                  ],
                  'deliveredAt': null,
                },
              ),
            ]),
          ),
        ),
      );
      expect(find.textContaining('لم يتمكن الزبون من الدفع'), findsOneWidget);
      expect(
        find.text('لطلب محاولة جديدة، اتصل بالمتجر هاتفيًا.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('shows the Arabic layout right to left', (tester) async {
      await _pump(
        tester,
        locale: const Locale('ar'),
        home: const OrderDetailScreen(orderId: _orderId),
        client: MockClient((_) async => _json(200, _order([_shopOrder()]))),
      );
      expect(find.text('في انتظار المتجر'), findsOneWidget);
      expect(find.text('إلغاء هذا الطلب'), findsOneWidget);
      expect(
        Directionality.of(tester.element(_key('order-detail'))),
        TextDirection.rtl,
      );
      expect(tester.takeException(), isNull);
    });
  });
}
