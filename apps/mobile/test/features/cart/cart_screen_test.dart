import 'dart:async';
import 'dart:convert';

import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/core/theme/app_theme.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/cart/application/cart_providers.dart';
import 'package:chicman/features/cart/presentation/cart_screen.dart';
import 'package:chicman/features/cart/presentation/cart_widgets.dart';
import 'package:chicman/features/catalog/presentation/product_detail_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../auth/fakes.dart';

Map<String, Object?> _line(
  String id, {
  String name = 'Melhfa',
  String? size,
  String? color,
  int quantity = 2,
  String unitPrice = '1500.00',
  String subtotal = '3000.00',
  bool purchasable = true,
  List<Map<String, Object?>> issues = const [],
}) => {
  'id': id,
  'productId': 'p-$id',
  'variantId': null,
  'name': name,
  'imageUrl': null,
  'size': size,
  'color': color,
  'quantity': quantity,
  'unitPrice': unitPrice,
  'subtotal': subtotal,
  'purchasable': purchasable,
  'issues': issues,
};

Map<String, Object?> _group(
  String id,
  String name,
  List<Map<String, Object?>> items, {
  String subtotal = '3000.00',
}) => {
  'shop': {'id': id, 'name': name},
  'items': items,
  'subtotal': subtotal,
};

Map<String, Object?> _cart(
  List<Map<String, Object?>> shops, {
  int itemCount = 2,
  String subtotal = '3000.00',
}) => {'shops': shops, 'itemCount': itemCount, 'subtotal': subtotal};

const _emptyCart = {'shops': <Object?>[], 'itemCount': 0, 'subtotal': '0.00'};

AuthRepository _signedIn() => FakeAuthRepository(
  restored: const AuthSession(userId: 'u1', email: 'a@b.c'),
);

Future<void> _pump(
  WidgetTester tester,
  Widget home, {
  required ApiClient api,
  AuthRepository? repository,
  Locale? locale,
}) async {
  await tester.binding.setSurfaceSize(const Size(500, 1600));
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
        home: home,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Finder _key(String key) => find.byKey(Key(key));

Map<String, Object?> _detail({
  bool available = true,
  List<Map<String, Object?>> variants = const [],
}) => {
  'id': 'p1',
  'name': 'Robe',
  'category': 'CLOTHING',
  'brand': null,
  'price': '1500.00',
  'available': available,
  'mainImageUrl': 'http://media.test/p1.jpg',
  'description': 'Voile léger.',
  'images': [
    {'id': 'i1', 'url': 'http://media.test/1.jpg', 'width': 600, 'height': 800},
  ],
  'variants': variants,
  'shop': {
    'id': 's1',
    'name': 'Boutique Sahel',
    'description': 'Tissus.',
    'city': 'Nouakchott',
    'logoUrl': null,
  },
};

void main() {
  group('cart screen', () {
    testWidgets('a guest is invited to sign in, and nothing is requested', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await _pump(
        tester,
        const CartScreen(),
        api: routedApi(const {}, requests: requests),
        repository: FakeAuthRepository(),
      );
      expect(_key('cart-guest'), findsOneWidget);
      expect(
        find.text('Connectez-vous pour voir votre panier'),
        findsOneWidget,
      );
      expect(requests, isEmpty);
    });

    testWidgets('an account without setup is told to finish it', (
      tester,
    ) async {
      await _pump(
        tester,
        const CartScreen(),
        api: routedApi({
          'GET /customers/me/cart': (_) => (
            403,
            {
              'error': {'code': 'ACCOUNT_NOT_BOOTSTRAPPED'},
            },
          ),
        }),
        repository: _signedIn(),
      );
      expect(_key('cart-setup'), findsOneWidget);
    });

    testWidgets('a failed read offers a retry', (tester) async {
      var fail = true;
      await _pump(
        tester,
        const CartScreen(),
        api: routedApi({
          'GET /customers/me/cart': (_) => fail
              ? (
                  503,
                  {
                    'error': {'code': 'SERVICE_UNAVAILABLE'},
                  },
                )
              : (200, _emptyCart),
        }),
        repository: _signedIn(),
      );
      expect(_key('cart-failed'), findsOneWidget);
      fail = false;
      await tester.tap(find.text('Réessayer'));
      await tester.pumpAndSettle();
      expect(_key('cart-empty'), findsOneWidget);
    });

    testWidgets('groups lines by shop and shows what the API calculated', (
      tester,
    ) async {
      await _pump(
        tester,
        const CartScreen(),
        api: routedApi({
          'GET /customers/me/cart': (_) => (
            200,
            _cart(
              [
                _group('s1', 'Boutique Sahel', [
                  _line(
                    'a',
                    size: 'M',
                    color: 'Noir',
                    unitPrice: '1500.50',
                    subtotal: '3001.00',
                  ),
                ], subtotal: '3001.00'),
                _group('s2', 'Autre Boutique', [
                  _line(
                    'b',
                    name: 'Sandale',
                    quantity: 1,
                    unitPrice: '200.00',
                    subtotal: '200.00',
                  ),
                ], subtotal: '200.00'),
              ],
              itemCount: 3,
              subtotal: '3201.00',
            ),
          ),
        }),
        repository: _signedIn(),
      );
      expect(_key('cart-shop-s1'), findsOneWidget);
      expect(_key('cart-shop-s2'), findsOneWidget);
      expect(find.text('Boutique Sahel'), findsOneWidget);
      expect(find.text('Taille : M'), findsOneWidget);
      expect(find.text('Couleur : Noir'), findsOneWidget);
      expect(
        find.text('Prix unitaire : 1\u00A0500,50\u00A0MRU'),
        findsOneWidget,
      );
      expect(
        tester.widget<Text>(_key('cart-item-subtotal-a')).data,
        '3\u00A0001,00\u00A0MRU',
      );
      expect(
        tester.widget<Text>(_key('cart-subtotal')).data,
        '3\u00A0201,00\u00A0MRU',
      );
      expect(_key('cart-excluded-note'), findsNothing);
    });

    testWidgets('quantity controls send the new quantity and show the answer', (
      tester,
    ) async {
      final requests = <http.Request>[];
      var quantity = 2;
      Map<String, Object?> current() => _cart([
        _group('s1', 'Boutique', [_line('a', quantity: quantity)]),
      ], itemCount: quantity);
      await _pump(
        tester,
        const CartScreen(),
        api: routedApi({
          'GET /customers/me/cart': (_) => (200, current()),
          'PATCH /customers/me/cart/items/a': (request) {
            quantity = (jsonDecode(request.body) as Map)['quantity'] as int;
            return (200, current());
          },
        }, requests: requests),
        repository: _signedIn(),
      );
      await tester.tap(_key('cart-increase-a'));
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(_key('cart-quantity-a')).data, '3');
      await tester.tap(_key('cart-decrease-a'));
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(_key('cart-quantity-a')).data, '2');
      final patches = requests.where((request) => request.method == 'PATCH');
      expect(patches.map((request) => jsonDecode(request.body)), [
        {'quantity': 3},
        {'quantity': 2},
      ]);
    });

    testWidgets('a refused quantity shows why and keeps the server quantity', (
      tester,
    ) async {
      await _pump(
        tester,
        const CartScreen(),
        api: routedApi({
          'GET /customers/me/cart': (_) => (
            200,
            _cart([
              _group('s1', 'Boutique', [_line('a')]),
            ]),
          ),
          'PATCH /customers/me/cart/items/a': (_) => (
            409,
            {
              'error': {'code': 'CART_INSUFFICIENT_STOCK'},
            },
          ),
        }),
        repository: _signedIn(),
      );
      await tester.tap(_key('cart-increase-a'));
      await tester.pumpAndSettle();
      expect(find.text("Cette quantité n'est pas disponible."), findsOneWidget);
      expect(tester.widget<Text>(_key('cart-quantity-a')).data, '2');
    });

    testWidgets('removes a line', (tester) async {
      var removed = false;
      await _pump(
        tester,
        const CartScreen(),
        api: routedApi({
          'GET /customers/me/cart': (_) => (
            200,
            removed
                ? _emptyCart
                : _cart([
                    _group('s1', 'Boutique', [_line('a')]),
                  ]),
          ),
          'DELETE /customers/me/cart/items/a': (_) {
            removed = true;
            return (200, _emptyCart);
          },
        }),
        repository: _signedIn(),
      );
      await tester.tap(_key('cart-remove-a'));
      await tester.pumpAndSettle();
      expect(removed, isTrue);
      expect(_key('cart-empty'), findsOneWidget);
    });

    group('items that changed', () {
      Future<void> pumpIssue(
        WidgetTester tester,
        Map<String, Object?> issue, {
        bool purchasable = false,
      }) => _pump(
        tester,
        const CartScreen(),
        api: routedApi({
          'GET /customers/me/cart': (_) => (
            200,
            _cart([
              _group('s1', 'Boutique', [
                _line(
                  'a',
                  quantity: 5,
                  purchasable: purchasable,
                  issues: [issue],
                ),
              ]),
            ]),
          ),
        }),
        repository: _signedIn(),
      );

      for (final (code, message) in const [
        ('SHOP_UNAVAILABLE', "Cette boutique n'est pas disponible"),
        ('PRODUCT_ARCHIVED', "Ce produit n'est plus proposé."),
        ('PRODUCT_UNPUBLISHED', "Ce produit n'est plus en vente"),
        ('VARIANT_UNAVAILABLE', "L'option choisie n'est plus proposée."),
      ]) {
        testWidgets('$code: explains it, allows only removal', (tester) async {
          await pumpIssue(tester, {'code': code});
          expect(find.textContaining(message), findsOneWidget);
          expect(_key('cart-excluded-note'), findsOneWidget);
          IconButton button(String key) => tester.widget<IconButton>(_key(key));
          expect(button('cart-decrease-a').onPressed, isNull);
          expect(button('cart-increase-a').onPressed, isNull);
          expect(
            tester.widget<TextButton>(_key('cart-remove-a')).onPressed,
            isNotNull,
          );
        });
      }

      testWidgets(
        'a hidden product does not open a page that no longer exists',
        (tester) async {
          await pumpIssue(tester, {'code': 'PRODUCT_ARCHIVED'});
          expect(tester.widget<InkWell>(_key('cart-open-a')).onTap, isNull);
        },
      );

      testWidgets('insufficient stock leaves the quantity until corrected', (
        tester,
      ) async {
        final bodies = <Object?>[];
        await _pump(
          tester,
          const CartScreen(),
          api: routedApi({
            'GET /customers/me/cart': (_) => (
              200,
              _cart([
                _group('s1', 'Boutique', [
                  _line(
                    'a',
                    quantity: 5,
                    purchasable: false,
                    issues: const [
                      {'code': 'INSUFFICIENT_STOCK', 'availableQuantity': 2},
                    ],
                  ),
                ]),
              ]),
            ),
            'PATCH /customers/me/cart/items/a': (request) {
              bodies.add(jsonDecode(request.body));
              return (
                200,
                _cart([
                  _group('s1', 'Boutique', [_line('a', quantity: 2)]),
                ]),
              );
            },
          }),
          repository: _signedIn(),
        );
        expect(tester.widget<Text>(_key('cart-quantity-a')).data, '5');
        expect(
          find.text(
            'Quantité disponible : 2. Réduisez la quantité pour continuer.',
          ),
          findsOneWidget,
        );
        expect(bodies, isEmpty, reason: 'nothing changes on its own');
        await tester.tap(_key('cart-correct-a'));
        await tester.pumpAndSettle();
        expect(bodies, [
          {'quantity': 2},
        ]);
        expect(tester.widget<Text>(_key('cart-quantity-a')).data, '2');
        expect(_key('cart-issue-a-INSUFFICIENT_STOCK'), findsNothing);
      });

      testWidgets('a sold-out line says so and has no correction', (
        tester,
      ) async {
        await pumpIssue(tester, {
          'code': 'INSUFFICIENT_STOCK',
          'availableQuantity': 0,
        });
        expect(
          find.text('Cet article est épuisé pour le moment.'),
          findsOneWidget,
        );
        expect(_key('cart-correct-a'), findsNothing);
      });

      testWidgets('a price change shows both prices until acknowledged', (
        tester,
      ) async {
        final bodies = <Object?>[];
        await _pump(
          tester,
          const CartScreen(),
          api: routedApi({
            'GET /customers/me/cart': (_) => (
              200,
              _cart([
                _group('s1', 'Boutique', [
                  _line(
                    'a',
                    unitPrice: '1500.00',
                    issues: const [
                      {'code': 'PRICE_CHANGED', 'previousPrice': '1000.00'},
                    ],
                  ),
                ]),
              ]),
            ),
            'POST /customers/me/cart/items/a/accept-price': (request) {
              bodies.add(jsonDecode(request.body));
              return (
                200,
                _cart([
                  _group('s1', 'Boutique', [_line('a')]),
                ]),
              );
            },
          }),
          repository: _signedIn(),
        );
        expect(
          find.text(
            'Le prix a changé : 1\u00A0000,00\u00A0MRU auparavant, 1\u00A0500,00\u00A0MRU maintenant.',
          ),
          findsOneWidget,
        );
        // Informative: the line stays counted.
        expect(_key('cart-excluded-note'), findsNothing);
        await tester.tap(_key('cart-accept-a'));
        await tester.pumpAndSettle();
        expect(bodies, [
          {'price': '1500.00'},
        ]);
        expect(_key('cart-issue-a-PRICE_CHANGED'), findsNothing);
      });
    });

    testWidgets('only the line above the stock shows a quantity', (
      tester,
    ) async {
      await _pump(
        tester,
        const CartScreen(),
        api: routedApi({
          'GET /customers/me/cart': (_) => (
            200,
            _cart([
              _group('s1', 'Boutique', [
                _line(
                  'short',
                  quantity: 5,
                  purchasable: false,
                  issues: const [
                    {'code': 'INSUFFICIENT_STOCK', 'availableQuantity': 2},
                  ],
                ),
                _line('fine', name: 'Sandale', quantity: 5),
              ]),
            ]),
          ),
        }),
        repository: _signedIn(),
      );
      expect(find.textContaining('Quantité disponible'), findsOneWidget);
      expect(_key('cart-correct-short'), findsOneWidget);
      expect(_key('cart-correct-fine'), findsNothing);
      expect(_key('cart-issue-fine-INSUFFICIENT_STOCK'), findsNothing);
    });

    testWidgets('a stale acceptance is refused, then the new price is shown', (
      tester,
    ) async {
      final bodies = <Object?>[];
      var price = '150.00';
      Map<String, Object?> current() => _cart([
        _group('s1', 'Boutique', [
          _line(
            'a',
            unitPrice: price,
            issues: const [
              {'code': 'PRICE_CHANGED', 'previousPrice': '100.00'},
            ],
          ),
        ]),
      ]);
      await _pump(
        tester,
        const CartScreen(),
        api: routedApi({
          'GET /customers/me/cart': (_) => (200, current()),
          'POST /customers/me/cart/items/a/accept-price': (request) {
            bodies.add(jsonDecode(request.body));
            return (
              409,
              {
                'error': {'code': 'CART_PRICE_CHANGED'},
              },
            );
          },
        }),
        repository: _signedIn(),
      );
      price = '200.00'; // Changes after the customer read the cart.
      await tester.tap(_key('cart-accept-a'));
      await tester.pumpAndSettle();
      expect(bodies, [
        {'price': '150.00'},
      ]);
      expect(
        find.text(
          'Le prix vient de changer à nouveau. Vérifiez le nouveau prix.',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('200,00'), findsWidgets);
      expect(_key('cart-accept-a'), findsOneWidget);
    });

    group('a change still on its way when the account changes', () {
      /// Signs in, starts a change whose answer is held, then signs out and in
      /// again, so the next account's cart is on screen when that answer arrives.
      Future<void> switchAccountDuringChange(
        WidgetTester tester,
        http.Response Function() heldAnswer,
      ) async {
        final repository = FakeAuthRepository(
          restored: const AuthSession(userId: 'u1', email: 'a@b.c'),
        );
        final answer = Completer<http.Response>();
        addTearDown(() {
          if (!answer.isCompleted) answer.complete(http.Response('{}', 404));
        });
        var firstAccount = true;
        final api = ApiClient(
          baseUrl: 'http://api.test',
          httpClient: MockClient((request) async {
            if (request.method == 'PATCH') return answer.future;
            return http.Response(
              jsonEncode(
                firstAccount
                    ? _cart([
                        _group('s1', 'Boutique', [_line('a', quantity: 3)]),
                      ], itemCount: 3)
                    : _emptyCart,
              ),
              200,
            );
          }),
        );
        await _pump(
          tester,
          Scaffold(appBar: AppBar(actions: const [CartAction()])),
          api: api,
          repository: repository,
        );
        expect(tester.widget<Text>(_key('cart-badge')).data, '3');

        final container = ProviderScope.containerOf(
          tester.element(find.byType(CartAction)),
        );
        final change = container
            .read(cartProvider.notifier)
            .setQuantity('a', 5);
        await tester.pump();

        firstAccount = false;
        await repository.signOut();
        await tester.pumpAndSettle();
        await repository.signIn('next@b.c', 'password');
        await tester.pumpAndSettle();
        expect(container.read(cartProvider).itemCount, 0);

        answer.complete(heldAnswer());
        await change;
        await tester.pumpAndSettle();
        expect(container.read(cartProvider).kind, CartViewKind.ready);
        expect(container.read(cartProvider).itemCount, 0);
      }

      testWidgets('a successful answer is not shown to the next account', (
        tester,
      ) async {
        await switchAccountDuringChange(
          tester,
          () => http.Response(
            jsonEncode(
              _cart([
                _group('s1', 'Boutique', [_line('a', quantity: 5)]),
              ], itemCount: 5),
            ),
            200,
          ),
        );
      });

      testWidgets('a session answer does not change the next account\'s view', (
        tester,
      ) async {
        await switchAccountDuringChange(
          tester,
          () => http.Response(
            jsonEncode({
              'error': {'code': 'CUSTOMER_NOT_FOUND'},
            }),
            403,
          ),
        );
      });
    });

    testWidgets('shows progress while loading', (tester) async {
      final answer = Completer<http.Response>();
      addTearDown(() {
        if (!answer.isCompleted) answer.complete(http.Response('{}', 404));
      });
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            sharedPreferencesProvider.overrideWithValue(null),
            authRepositoryProvider.overrideWithValue(_signedIn()),
            apiClientProvider.overrideWithValue(
              ApiClient(
                baseUrl: 'http://api.test',
                httpClient: MockClient((_) => answer.future),
              ),
            ),
          ],
          child: MaterialApp(
            theme: AppTheme.light,
            supportedLocales: const [Locale('fr'), Locale('ar')],
            localizationsDelegates: GlobalMaterialLocalizations.delegates,
            home: const CartScreen(),
          ),
        ),
      );
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      answer.complete(http.Response(jsonEncode(_emptyCart), 200));
      await tester.pumpAndSettle();
      expect(_key('cart-empty'), findsOneWidget);
    });

    testWidgets(
      'French left to right, Arabic right to left, with MRU formats',
      (tester) async {
        await _pump(
          tester,
          const CartScreen(),
          api: routedApi({
            'GET /customers/me/cart': (_) => (
              200,
              _cart([
                _group('s1', 'Boutique', [
                  _line(
                    'a',
                    issues: const [
                      {'code': 'PRICE_CHANGED', 'previousPrice': '1000.00'},
                    ],
                  ),
                ]),
              ]),
            ),
          }),
          repository: _signedIn(),
          locale: const Locale('ar'),
        );
        expect(find.text('سلتي'), findsOneWidget);
        expect(
          Directionality.of(tester.element(_key('cart-subtotal'))),
          TextDirection.rtl,
        );
        expect(
          tester.widget<Text>(_key('cart-subtotal')).data,
          '3,000.00\u00A0أوقية',
        );
        expect(
          find.text(
            'تغيّر السعر: كان 1,000.00\u00A0أوقية وأصبح 1,500.00\u00A0أوقية.',
          ),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('fits a narrow phone in Arabic without overflow', (
      tester,
    ) async {
      await tester.binding.setSurfaceSize(const Size(320, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            sharedPreferencesProvider.overrideWithValue(null),
            authRepositoryProvider.overrideWithValue(_signedIn()),
            apiClientProvider.overrideWithValue(
              routedApi({
                'GET /customers/me/cart': (_) => (
                  200,
                  _cart([
                    _group(
                      's1',
                      'Boutique au nom vraiment très long pour tester',
                      [
                        _line(
                          'a',
                          name:
                              'Un produit au nom très long pour tester le retour à la ligne',
                          quantity: 1000,
                          unitPrice: '9999999999.99',
                          subtotal: '9999999999.99',
                        ),
                      ],
                      subtotal: '9999999999.99',
                    ),
                  ], subtotal: '9999999999.99'),
                ),
              }),
            ),
          ],
          child: MaterialApp(
            theme: AppTheme.light,
            locale: const Locale('ar'),
            supportedLocales: const [Locale('fr'), Locale('ar')],
            localizationsDelegates: GlobalMaterialLocalizations.delegates,
            home: const CartScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('cart icon', () {
    testWidgets(
      'shows the count for a signed-in customer, and opens the cart',
      (tester) async {
        await _pump(
          tester,
          Scaffold(appBar: AppBar(actions: const [CartAction()])),
          api: routedApi({
            'GET /customers/me/cart': (_) => (
              200,
              _cart([
                _group('s1', 'Boutique', [_line('a', quantity: 3)]),
              ], itemCount: 3),
            ),
          }),
          repository: _signedIn(),
        );
        expect(tester.widget<Text>(_key('cart-badge')).data, '3');
        await tester.tap(_key('cart-action'));
        await tester.pumpAndSettle();
        expect(find.byType(CartScreen), findsOneWidget);
      },
    );

    testWidgets('a guest sees no count, and a sign-out clears it', (
      tester,
    ) async {
      final repository = FakeAuthRepository(
        restored: const AuthSession(userId: 'u1', email: 'a@b.c'),
      );
      await _pump(
        tester,
        Scaffold(appBar: AppBar(actions: const [CartAction()])),
        api: routedApi({
          'GET /customers/me/cart': (_) => (
            200,
            _cart([
              _group('s1', 'Boutique', [_line('a', quantity: 3)]),
            ], itemCount: 3),
          ),
        }),
        repository: repository,
      );
      Badge badge() => tester.widget<Badge>(find.byType(Badge));
      expect(badge().isLabelVisible, isTrue);
      await repository.signOut();
      await tester.pumpAndSettle();
      expect(badge().isLabelVisible, isFalse);
    });
  });

  group('add to cart', () {
    final variants = [
      {'id': 'v1', 'size': 'M', 'color': 'Noir', 'available': true},
      {'id': 'v2', 'size': 'L', 'color': 'Noir', 'available': false},
    ];

    ApiClient api(
      Map<String, Object?> detail, {
      List<http.Request>? requests,
      (int, Object?) Function(http.Request)? onAdd,
    }) => routedApi({
      'GET /products/p1': (_) => (200, detail),
      'GET /customers/me/cart': (_) => (200, _emptyCart),
      'POST /customers/me/cart/items':
          onAdd ??
          (_) => (
            200,
            _cart([
              _group('s1', 'Boutique', [_line('a', quantity: 1)]),
            ], itemCount: 1),
          ),
    }, requests: requests);

    testWidgets('adds a product with its ID only, then updates the count', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await _pump(
        tester,
        const ProductDetailScreen(productId: 'p1'),
        api: api(_detail(), requests: requests),
        repository: _signedIn(),
      );
      await tester.tap(_key('add-to-cart'));
      await tester.pumpAndSettle();
      final add = requests.singleWhere((request) => request.method == 'POST');
      expect(add.headers['authorization'], 'Bearer access-token');
      expect(jsonDecode(add.body), {'productId': 'p1', 'quantity': 1});
      expect(_key('add-to-cart-added'), findsOneWidget);
      expect(tester.widget<Text>(_key('cart-badge')).data, '1');
    });

    testWidgets('the product page never shows a stock quantity', (
      tester,
    ) async {
      await _pump(
        tester,
        const ProductDetailScreen(productId: 'p1'),
        api: api(_detail(variants: variants)),
        repository: _signedIn(),
      );
      expect(find.textContaining('Quantité disponible'), findsNothing);
      expect(find.textContaining('stock'), findsNothing);
    });

    testWidgets('cannot add an unavailable product', (tester) async {
      await _pump(
        tester,
        const ProductDetailScreen(productId: 'p1'),
        api: api(_detail(available: false)),
        repository: _signedIn(),
      );
      expect(
        tester.widget<FilledButton>(_key('add-to-cart')).onPressed,
        isNull,
      );
    });

    testWidgets('needs an available variant, and sends the one chosen', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await _pump(
        tester,
        const ProductDetailScreen(productId: 'p1'),
        api: api(_detail(variants: variants), requests: requests),
        repository: _signedIn(),
      );
      FilledButton button() => tester.widget<FilledButton>(_key('add-to-cart'));
      expect(button().onPressed, isNull);
      await tester.tap(_key('variant-color-Noir'));
      await tester.tap(_key('variant-size-L'));
      await tester.pumpAndSettle();
      expect(button().onPressed, isNull, reason: 'unavailable variant');
      await tester.tap(_key('variant-size-M'));
      await tester.pumpAndSettle();
      await tester.tap(_key('add-to-cart'));
      await tester.pumpAndSettle();
      final add = requests.singleWhere((request) => request.method == 'POST');
      expect(jsonDecode(add.body), {
        'productId': 'p1',
        'variantId': 'v1',
        'quantity': 1,
      });
    });

    testWidgets('shows a refusal from the API', (tester) async {
      await _pump(
        tester,
        const ProductDetailScreen(productId: 'p1'),
        api: api(
          _detail(),
          onAdd: (_) => (
            409,
            {
              'error': {'code': 'CART_INSUFFICIENT_STOCK'},
            },
          ),
        ),
        repository: _signedIn(),
      );
      await tester.tap(_key('add-to-cart'));
      await tester.pumpAndSettle();
      expect(find.text("Cette quantité n'est pas disponible."), findsOneWidget);
      expect(_key('add-to-cart-added'), findsNothing);
    });

    testWidgets('a guest is invited to sign in, and nothing is sent', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await _pump(
        tester,
        const ProductDetailScreen(productId: 'p1'),
        api: api(_detail(), requests: requests),
        repository: FakeAuthRepository(),
      );
      expect(_key('add-to-cart'), findsNothing);
      expect(
        find.text('Connectez-vous pour ajouter ce produit au panier.'),
        findsOneWidget,
      );
      expect(
        requests.where((request) => request.url.path.contains('cart')),
        isEmpty,
      );
    });
  });
}
