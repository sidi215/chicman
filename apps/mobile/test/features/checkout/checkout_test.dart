import 'dart:convert';
import 'dart:math';

import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/core/theme/app_theme.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/checkout/application/checkout_providers.dart';
import 'package:chicman/features/checkout/domain/checkout.dart';
import 'package:chicman/features/checkout/presentation/checkout_messages.dart';
import 'package:chicman/features/checkout/presentation/checkout_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../auth/fakes.dart';

const _shopA = '11111111-1111-4111-8111-111111111111';
const _shopB = '22222222-2222-4222-8222-222222222222';
const _addressId = '33333333-3333-4333-8333-333333333333';
const _otherAddressId = '44444444-4444-4444-8444-444444444444';

Map<String, Object?> _item(String id, String name, String price) => {
  'id': id,
  'productId': 'p-$id',
  'variantId': null,
  'name': name,
  'imageUrl': null,
  'size': id == 'i1' ? 'M' : null,
  'color': null,
  'quantity': 1,
  'unitPrice': price,
  'subtotal': price,
  'purchasable': true,
  'issues': <Object?>[],
};

Map<String, Object?> _address(String id, {String label = 'Maison'}) => {
  'addressId': id,
  'label': label,
  'city': 'Nouakchott',
  'district': 'Ksar',
  'landmark': 'Près du marché',
  'deliveryPhone': '+22233000000',
  'latitude': 18.08,
  'longitude': -15.97,
  'locationSource': 'MANUAL',
  'accuracyMeters': null,
};

Map<String, Object?> _summary({
  List<Map<String, Object?>> problems = const [],
  Map<String, Object?>? address = const {},
  String feeB = '0.00',
  String total = '1650.00',
}) => {
  'shops': [
    {
      'shop': {'id': _shopA, 'name': 'Maison Lalla'},
      'items': [_item('i1', 'Melhfa', '1500.00')],
      'productsSubtotal': '1500.00',
      'deliveryFee': '100.00',
      'total': '1600.00',
    },
    {
      'shop': {'id': _shopB, 'name': 'Atar Mode'},
      'items': [_item('i2', 'Sandales', '50.00')],
      'productsSubtotal': '50.00',
      'deliveryFee': feeB,
      'total': '50.00',
    },
  ],
  'itemCount': 2,
  'productsSubtotal': '1550.00',
  'deliveryFeeTotal': '100.00',
  'total': total,
  'address': address == null
      ? null
      : (address.isEmpty ? _address(_addressId) : address),
  'defaultRecipientName': 'Aïcha',
  'paymentMethod': 'CASH_ON_DELIVERY',
  'problems': problems,
};

Map<String, Object?> _order() => {
  'id': 'o1',
  'reference': 'CM-7K3QX9D2RB',
  'createdAt': '2026-11-09T10:00:00.000Z',
  'productsSubtotal': '1550.00',
  'deliveryFeeTotal': '100.00',
  'total': '1650.00',
  'paymentMethod': 'CASH_ON_DELIVERY',
  'shopOrders': [
    {
      'id': 'so1',
      'status': 'PENDING',
      'label': 'AWAITING_SHOP',
      'respondBy': '2026-11-11T10:00:00.000Z',
      'shop': {
        'id': _shopA,
        'name': 'Maison Lalla',
        'contactPhone': '+22236000000',
        'whatsappPhone': null,
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
          'id': 'oi1',
          'productId': 'p-i1',
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
        'status': 'PENDING',
      },
    },
  ],
};

const _emptyCart = {'shops': <Object?>[], 'itemCount': 0, 'subtotal': '0.00'};

AuthRepository _signedIn() => FakeAuthRepository(
  restored: const AuthSession(userId: 'u1', email: 'a@b.c'),
);

Future<void> _pump(
  WidgetTester tester, {
  required ApiClient api,
  AuthRepository? repository,
  Locale? locale,
}) async {
  await tester.binding.setSurfaceSize(const Size(500, 2600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(null),
        authRepositoryProvider.overrideWithValue(repository),
        apiClientProvider.overrideWithValue(api),
      ],
      child: MaterialApp(
        theme: AppTheme.light,
        locale: locale,
        supportedLocales: const [Locale('fr'), Locale('ar')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: const CheckoutScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Finder _key(String key) => find.byKey(Key(key));

final _uuid = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
);

void main() {
  group('checkout rules (spec 10)', () {
    test('builds the placement body from the shown figures', () {
      final summary = CheckoutSummary.fromJson(_summary());
      expect(summary.canPlace, isTrue);
      expect(summary.placementBody('Moussa'), {
        'addressId': _addressId,
        'recipientName': 'Moussa',
        'expected': {
          'total': '1650.00',
          'shops': [
            {
              'shopId': _shopA,
              'productsSubtotal': '1500.00',
              'deliveryFee': '100.00',
            },
            {
              'shopId': _shopB,
              'productsSubtotal': '50.00',
              'deliveryFee': '0.00',
            },
          ],
        },
      });
    });

    test('offers placement only without problems and with an address', () {
      expect(
        CheckoutSummary.fromJson(
          _summary(
            problems: [
              {'code': 'CART_EMPTY'},
            ],
          ),
        ).canPlace,
        isFalse,
      );
      final noAddress = CheckoutSummary.fromJson(_summary(address: null));
      expect(noAddress.canPlace, isFalse);
      expect(noAddress.placementBody('Moussa'), isNull);
    });

    test('maps every answer like the web', () {
      CheckoutOutcome<Object?> of(int status, String code) =>
          interpretCheckoutResult<Object?>(ApiError(status, code));
      expect(
        (of(409, 'CHECKOUT_BLOCKED') as CheckoutFailed).failure,
        CheckoutFailure.blocked,
      );
      expect(
        (of(409, 'CHECKOUT_TOTALS_CHANGED') as CheckoutFailed).failure,
        CheckoutFailure.totalsChanged,
      );
      expect(
        (of(409, 'CHECKOUT_CART_EMPTY') as CheckoutFailed).failure,
        CheckoutFailure.cartEmpty,
      );
      expect(
        (of(404, 'ADDRESS_NOT_FOUND') as CheckoutFailed).failure,
        CheckoutFailure.addressNotFound,
      );
      expect(
        (of(400, 'CHECKOUT_IDEMPOTENCY_KEY_INVALID') as CheckoutFailed).failure,
        CheckoutFailure.invalid,
      );
      expect(
        (of(429, 'RATE_LIMITED') as CheckoutFailed).failure,
        CheckoutFailure.rateLimited,
      );
      expect(
        (interpretCheckoutResult<Object?>(const ApiNetworkError())
                as CheckoutFailed)
            .failure,
        CheckoutFailure.unavailable,
      );
      expect(
        interpretCheckoutResult<Object?>(const ApiOk('x', statusCode: 200)),
        isA<CheckoutOk<Object?>>(),
      );
    });

    test('keeps the attempt key only while the outcome is unknown', () {
      for (final failure in CheckoutFailure.values) {
        expect(
          failure.keepsAttemptKey,
          failure == CheckoutFailure.unavailable,
          reason: failure.name,
        );
      }
      expect(CheckoutFailure.totalsChanged.needsFreshSummary, isTrue);
      expect(CheckoutFailure.rateLimited.needsFreshSummary, isFalse);
    });

    test('checks the recipient with the API rule', () {
      expect(recipientError('Aïcha'), isNull);
      expect(recipientError('   '), RecipientError.required);
      expect(recipientError('x' * 101), RecipientError.tooLong);
      expect(recipientError('Ali\u0007'), RecipientError.invalid);
    });

    test('generates version 4 UUIDs', () {
      final keys = {for (var i = 0; i < 50; i++) newIdempotencyKey()};
      expect(keys, hasLength(50));
      for (final key in keys) {
        expect(_uuid.hasMatch(key), isTrue, reason: key);
      }
      expect(_uuid.hasMatch(newIdempotencyKey(Random(1))), isTrue);
    });

    test('has the same texts in French and Arabic, and every label', () {
      expect(
        CheckoutMessages.ar.keys.toSet(),
        CheckoutMessages.fr.keys.toSet(),
      );
      for (final label in ShopOrderLabel.values) {
        expect(CheckoutMessages.fr.label(label), isNotEmpty);
        expect(CheckoutMessages.ar.label(label), isNotEmpty);
      }
      expect(
        CheckoutMessages.fr.label(ShopOrderLabel.awaitingShop),
        'En attente de la boutique',
      );
    });
  });

  group('checkout screen', () {
    tearDown(() => CheckoutController.keyFactory = newIdempotencyKey);

    testWidgets('a guest is invited to sign in, and nothing is requested', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await _pump(
        tester,
        api: routedApi(const {}, requests: requests),
        repository: FakeAuthRepository(),
      );
      expect(_key('checkout-guest'), findsOneWidget);
      expect(requests, isEmpty);
    });

    testWidgets(
      'shows fees per shop, the total, COD, and the address; places with the shown figures and a key',
      (tester) async {
        final requests = <http.Request>[];
        CheckoutController.keyFactory = () =>
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        await _pump(
          tester,
          repository: _signedIn(),
          api: routedApi({
            'GET /customers/me/checkout': (_) => (200, _summary()),
            'POST /customers/me/checkout': (_) => (201, _order()),
            'GET /customers/me/cart': (_) => (200, _emptyCart),
          }, requests: requests),
        );

        expect(find.text('Maison Lalla'), findsOneWidget);
        expect(
          tester.widget<Text>(_key('checkout-fee-$_shopA')).data,
          '100,00 MRU',
        );
        expect(
          tester.widget<Text>(_key('checkout-fee-$_shopB')).data,
          'Gratuite',
        );
        expect(
          tester.widget<Text>(_key('checkout-total')).data,
          '1 650,00 MRU',
        );
        expect(find.text('Paiement à la livraison'), findsOneWidget);
        expect(find.textContaining('+22233000000'), findsOneWidget);
        expect(find.textContaining('vérifié'), findsNothing);
        final field = tester.widget<TextField>(_key('checkout-recipient'));
        expect(field.controller!.text, 'Aïcha');

        await tester.enterText(_key('checkout-recipient'), 'Moussa');
        await tester.tap(_key('checkout-place'));
        await tester.pumpAndSettle();

        final post = requests.singleWhere((r) => r.method == 'POST');
        expect(
          post.headers['Idempotency-Key'],
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        );
        expect(jsonDecode(post.body), {
          'addressId': _addressId,
          'recipientName': 'Moussa',
          'expected': {
            'total': '1650.00',
            'shops': [
              {
                'shopId': _shopA,
                'productsSubtotal': '1500.00',
                'deliveryFee': '100.00',
              },
              {
                'shopId': _shopB,
                'productsSubtotal': '50.00',
                'deliveryFee': '0.00',
              },
            ],
          },
        });
        expect(_key('checkout-confirmation'), findsOneWidget);
        expect(find.textContaining('CM-7K3QX9D2RB'), findsOneWidget);
        expect(
          find.textContaining('En attente de la boutique'),
          findsOneWidget,
        );
        expect(
          find.textContaining('Réponse de la boutique attendue'),
          findsOneWidget,
        );
        // The cart is read again after the order, so the app bar count follows.
        expect(
          requests.where(
            (r) => r.method == 'GET' && r.url.path.endsWith('/cart'),
          ),
          isNotEmpty,
        );
      },
    );

    testWidgets('lists blocking problems and disables placement', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await _pump(
        tester,
        repository: _signedIn(),
        api: routedApi({
          'GET /customers/me/checkout': (_) => (
            200,
            _summary(
              problems: [
                {'code': 'DELIVERY_FEE_NOT_SET', 'shopId': _shopB},
                {'code': 'PRICE_CHANGED', 'shopId': _shopA, 'itemId': 'i1'},
              ],
            ),
          ),
        }, requests: requests),
      );
      expect(_key('checkout-problems'), findsOneWidget);
      expect(find.textContaining("Atar Mode n'a pas encore"), findsOneWidget);
      expect(find.textContaining('« Melhfa »'), findsOneWidget);
      expect(
        tester.widget<FilledButton>(_key('checkout-place')).onPressed,
        isNull,
      );
      expect(requests.where((r) => r.method == 'POST'), isEmpty);
    });

    testWidgets('asks for an address when there is none', (tester) async {
      await _pump(
        tester,
        repository: _signedIn(),
        api: routedApi({
          'GET /customers/me/checkout': (_) => (200, _summary(address: null)),
        }),
      );
      expect(_key('checkout-add-address'), findsOneWidget);
      expect(
        tester.widget<FilledButton>(_key('checkout-place')).onPressed,
        isNull,
      );
    });

    testWidgets('refuses an empty recipient without sending anything', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await _pump(
        tester,
        repository: _signedIn(),
        api: routedApi({
          'GET /customers/me/checkout': (_) => (200, _summary()),
        }, requests: requests),
      );
      await tester.enterText(_key('checkout-recipient'), '   ');
      await tester.tap(_key('checkout-place'));
      await tester.pumpAndSettle();
      expect(find.text('Saisissez le nom du destinataire.'), findsOneWidget);
      expect(requests.where((r) => r.method == 'POST'), isEmpty);
    });

    testWidgets(
      'a changed total reads the summary again and starts a new attempt; an unknown outcome keeps the key',
      (tester) async {
        final requests = <http.Request>[];
        var keys = 0;
        CheckoutController.keyFactory = () => 'key-${++keys}';
        final answers = <(int, Object?)>[
          (0, null), // network failure
          (
            409,
            {
              'error': {'code': 'CHECKOUT_TOTALS_CHANGED'},
            },
          ),
          (201, _order()),
        ];
        var summaries = 0;
        await _pump(
          tester,
          repository: _signedIn(),
          api: ApiClient(
            baseUrl: 'http://api.test',
            httpClient: _Client((request) {
              requests.add(request);
              final path = request.url.path;
              if (request.method == 'GET' && path.endsWith('/checkout')) {
                summaries += 1;
                return (
                  200,
                  _summary(total: summaries > 1 ? '1700.00' : '1650.00'),
                );
              }
              if (request.method == 'POST') return answers.removeAt(0);
              return (200, _emptyCart);
            }),
          ),
        );

        await tester.tap(_key('checkout-place'));
        await tester.pumpAndSettle();
        expect(
          find.textContaining('votre commande ne sera pas passée deux fois'),
          findsOneWidget,
        );

        await tester.tap(_key('checkout-place'));
        await tester.pumpAndSettle();
        expect(find.textContaining('Les montants ont changé'), findsOneWidget);
        expect(
          tester.widget<Text>(_key('checkout-total')).data,
          '1 700,00 MRU',
        );

        await tester.tap(_key('checkout-place'));
        await tester.pumpAndSettle();
        expect(_key('checkout-confirmation'), findsOneWidget);

        final posts = requests.where((r) => r.method == 'POST').toList();
        expect(posts.map((r) => r.headers['Idempotency-Key']), [
          'key-1',
          'key-1',
          'key-2',
        ]);
        expect(
          (jsonDecode(posts.last.body) as Map)['expected']['total'],
          '1700.00',
        );
      },
    );

    testWidgets('the address list returns the chosen address to checkout', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await _pump(
        tester,
        repository: _signedIn(),
        api: routedApi({
          'GET /customers/me/checkout': (request) {
            final chosen = request.url.queryParameters['addressId'];
            return (
              200,
              _summary(
                address: chosen == _otherAddressId
                    ? _address(_otherAddressId, label: 'Bureau')
                    : const {},
              ),
            );
          },
          'GET /customers/me/addresses': (_) => (
            200,
            {
              'addresses': [
                {
                  'id': _addressId,
                  'label': 'Maison',
                  'city': 'Nouakchott',
                  'district': 'Ksar',
                  'landmark': 'Près du marché',
                  'deliveryPhone': null,
                  'latitude': 18.08,
                  'longitude': -15.97,
                  'locationSource': 'MANUAL',
                  'accuracyMeters': null,
                  'isDefault': true,
                },
                {
                  'id': _otherAddressId,
                  'label': 'Bureau',
                  'city': 'Nouakchott',
                  'district': 'Tevragh Zeina',
                  'landmark': 'Rond-point',
                  'deliveryPhone': null,
                  'latitude': 18.1,
                  'longitude': -15.98,
                  'locationSource': 'MANUAL',
                  'accuracyMeters': null,
                  'isDefault': false,
                },
              ],
            },
          ),
        }, requests: requests),
      );
      await tester.tap(_key('checkout-change-address'));
      await tester.pumpAndSettle();
      expect(find.text('Adresse de livraison de la commande'), findsOneWidget);
      await tester.tap(_key('address-select-$_otherAddressId'));
      await tester.pumpAndSettle();

      expect(find.text('Bureau'), findsOneWidget);
      expect(requests.last.url.queryParameters['addressId'], _otherAddressId);
    });

    testWidgets('renders in Arabic, right to left', (tester) async {
      await _pump(
        tester,
        locale: const Locale('ar'),
        repository: _signedIn(),
        api: routedApi({
          'GET /customers/me/checkout': (_) => (200, _summary()),
        }),
      );
      expect(find.text('الدفع عند الاستلام'), findsOneWidget);
      expect(find.text('تأكيد الطلب'), findsOneWidget);
      expect(
        Directionality.of(tester.element(_key('checkout-place'))),
        TextDirection.rtl,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('fits a 320 px phone without overflow', (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 2600));
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            sharedPreferencesProvider.overrideWithValue(null),
            authRepositoryProvider.overrideWithValue(_signedIn()),
            apiClientProvider.overrideWithValue(
              routedApi({
                'GET /customers/me/checkout': (_) => (200, _summary()),
              }),
            ),
          ],
          child: MaterialApp(
            theme: AppTheme.light,
            supportedLocales: const [Locale('fr'), Locale('ar')],
            localizationsDelegates: GlobalMaterialLocalizations.delegates,
            home: const CheckoutScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      addTearDown(() => tester.binding.setSurfaceSize(null));
      expect(tester.takeException(), isNull);
    });
  });
}

/// A client whose handler may answer `0` to simulate a network failure.
class _Client extends http.BaseClient {
  _Client(this.handler);

  final (int, Object?) Function(http.Request request) handler;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final (status, body) = handler(request as http.Request);
    if (status == 0) throw http.ClientException('offline');
    return http.StreamedResponse(
      Stream.value(utf8.encode(jsonEncode(body ?? {}))),
      status,
    );
  }
}
