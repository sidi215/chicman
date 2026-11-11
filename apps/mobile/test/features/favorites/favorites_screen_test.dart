import 'package:chicman/app_shell.dart';
import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/format/money.dart';
import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/core/theme/app_theme.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/catalog/presentation/product_detail_screen.dart';
import 'package:chicman/features/favorites/presentation/favorites_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../auth/fakes.dart';

const _config = AppConfig(
  supabaseUrl: 'https://p.supabase.co',
  supabasePublishableKey: 'k',
  apiBaseUrl: 'http://api.test',
  siteUrl: 'https://shop.test',
);

Map<String, Object?> _summary(
  String id, {
  String name = 'Robe',
  String price = '1500.00',
  bool available = true,
}) => {
  'id': id,
  'name': name,
  'category': 'CLOTHING',
  'brand': null,
  'price': price,
  'available': available,
  'mainImageUrl': 'http://media.test/$id.jpg',
  'shop': {'id': 's1', 'name': 'Boutique Sahel'},
};

Map<String, Object?> _item(
  String id, {
  String name = 'Robe',
  String state = 'AVAILABLE',
  String price = '1500.00',
}) => {
  'productId': id,
  'addedAt': '2026-11-10T10:00:00.000Z',
  'name': name,
  'imageUrl': state == 'UNAVAILABLE' ? null : 'http://media.test/$id.jpg',
  'state': state,
  'product': state == 'UNAVAILABLE'
      ? null
      : _summary(id, name: name, price: price, available: state == 'AVAILABLE'),
};

Map<String, Object?> _list(List<Map<String, Object?>> items) => {
  'items': items,
};

Map<String, Object?> _detail() => {
  ..._summary('p1'),
  'description': 'Voile léger.',
  'images': [
    {'id': 'i1', 'url': 'http://media.test/1.jpg', 'width': 600, 'height': 800},
  ],
  'variants': <Object?>[],
  'shop': {
    'id': 's1',
    'name': 'Boutique Sahel',
    'description': 'Tissus.',
    'city': 'Nouakchott',
    'logoUrl': null,
  },
};

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
        appConfigProvider.overrideWithValue(_config),
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

/// Requests that would change the cart: favorites must never send one.
bool _touchesCart(http.Request request) =>
    request.url.path.contains('/cart') && request.method != 'GET';

void main() {
  group('favorites screen', () {
    testWidgets('a guest is invited to sign in, and nothing is requested', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await _pump(
        tester,
        const FavoritesScreen(),
        api: routedApi(const {}, requests: requests),
        repository: FakeAuthRepository(),
      );
      expect(_key('favorites-guest'), findsOneWidget);
      expect(find.text('Connectez-vous pour voir vos favoris'), findsOneWidget);
      expect(requests, isEmpty);
    });

    testWidgets('an account without setup is told to finish it', (
      tester,
    ) async {
      await _pump(
        tester,
        const FavoritesScreen(),
        api: routedApi({
          'GET /customers/me/favorites': (_) => (
            403,
            {
              'error': {'code': 'ACCOUNT_NOT_BOOTSTRAPPED'},
            },
          ),
        }),
        repository: _signedIn(),
      );
      expect(_key('favorites-setup'), findsOneWidget);
    });

    testWidgets('a failed read offers a retry', (tester) async {
      var fail = true;
      await _pump(
        tester,
        const FavoritesScreen(),
        api: routedApi({
          'GET /customers/me/favorites': (_) => fail
              ? (
                  503,
                  {
                    'error': {'code': 'SERVICE_UNAVAILABLE'},
                  },
                )
              : (200, _list(const [])),
        }),
        repository: _signedIn(),
      );
      expect(_key('favorites-failed'), findsOneWidget);
      expect(
        find.text(
          'Le service est momentanément indisponible. Réessayez dans un instant.',
        ),
        findsOneWidget,
      );
      fail = false;
      await tester.tap(find.text('Réessayer'));
      await tester.pumpAndSettle();
      expect(_key('favorites-empty'), findsOneWidget);
    });

    testWidgets('the empty state in French and in Arabic, right to left', (
      tester,
    ) async {
      final api = routedApi({
        'GET /customers/me/favorites': (_) => (200, _list(const [])),
      });
      await _pump(
        tester,
        const FavoritesScreen(),
        api: api,
        repository: _signedIn(),
      );
      expect(find.text("Vous n'avez encore aucun favori."), findsOneWidget);

      await _pump(
        tester,
        const FavoritesScreen(),
        api: api,
        repository: _signedIn(),
        locale: const Locale('ar'),
      );
      expect(find.text('مفضلتي'), findsOneWidget);
      expect(find.text('لا توجد منتجات في مفضلتك بعد.'), findsOneWidget);
      expect(
        Directionality.of(tester.element(_key('favorites-empty'))),
        TextDirection.rtl,
      );
    });

    testWidgets(
      'shows current price and availability, and nothing about a hidden product',
      (tester) async {
        await _pump(
          tester,
          const FavoritesScreen(),
          api: routedApi({
            'GET /customers/me/favorites': (_) => (
              200,
              _list([
                _item('p1', name: 'Robe', price: '1200.00'),
                _item('p2', name: 'Voile', state: 'SOLD_OUT'),
                _item('p3', name: 'Archivée', state: 'UNAVAILABLE'),
              ]),
            ),
          }),
          repository: _signedIn(),
        );
        expect(find.text('Disponible'), findsOneWidget);
        expect(find.text('Épuisé'), findsOneWidget);
        expect(find.text('Indisponible'), findsOneWidget);
        expect(
          find.text(formatMru('1200.00', languageCode: 'fr')),
          findsOneWidget,
        );
        expect(find.textContaining('Boutique Sahel'), findsNWidgets(2));
        final hidden = _key('favorite-row-p3');
        expect(
          find.descendant(of: hidden, matching: find.textContaining('MRU')),
          findsNothing,
        );
        expect(
          find.descendant(
            of: hidden,
            matching: find.text(
              "Ce produit n'est plus proposé pour le moment.",
            ),
          ),
          findsOneWidget,
        );
        // A hidden product has no page to open.
        await tester.tap(find.text('Archivée'));
        await tester.pumpAndSettle();
        expect(find.byType(ProductDetailScreen), findsNothing);
      },
    );

    testWidgets('removes a favorite, and never touches the cart', (
      tester,
    ) async {
      final requests = <http.Request>[];
      var items = [_item('p1', name: 'Robe'), _item('p2', name: 'Voile')];
      await _pump(
        tester,
        const FavoritesScreen(),
        api: routedApi({
          'GET /customers/me/favorites': (_) => (200, _list(items)),
          'DELETE /customers/me/favorites/p1': (_) {
            items = [_item('p2', name: 'Voile')];
            return (200, _list(items));
          },
        }, requests: requests),
        repository: _signedIn(),
      );
      expect(_key('favorite-row-p1'), findsOneWidget);
      await tester.tap(_key('favorite-remove-p1'));
      await tester.pumpAndSettle();
      expect(_key('favorite-row-p1'), findsNothing);
      expect(_key('favorite-row-p2'), findsOneWidget);
      expect(
        requests.where((request) => request.method == 'DELETE'),
        hasLength(1),
      );
      expect(requests.where(_touchesCart), isEmpty);
    });

    testWidgets('a refused removal keeps the list and says why', (
      tester,
    ) async {
      await _pump(
        tester,
        const FavoritesScreen(),
        api: routedApi({
          'GET /customers/me/favorites': (_) => (200, _list([_item('p1')])),
          'DELETE /customers/me/favorites/p1': (_) => (
            429,
            {
              'error': {'code': 'RATE_LIMITED'},
            },
          ),
        }),
        repository: _signedIn(),
      );
      await tester.tap(_key('favorite-remove-p1'));
      await tester.pumpAndSettle();
      expect(_key('favorite-row-p1'), findsOneWidget);
      expect(_key('favorites-error'), findsOneWidget);
    });
  });

  group('favorite heart', () {
    ApiClient detailApi(
      List<http.Request> requests, {
      (int, Object?) Function(http.Request)? put,
    }) {
      var favorite = false;
      return routedApi({
        'GET /products/p1': (_) => (200, _detail()),
        'GET /customers/me/cart': (_) =>
            (200, {'shops': <Object?>[], 'itemCount': 0, 'subtotal': '0.00'}),
        'GET /customers/me/favorites': (_) =>
            (200, _list(favorite ? [_item('p1')] : const [])),
        'PUT /customers/me/favorites/p1':
            put ??
            (_) {
              favorite = true;
              return (200, _list([_item('p1')]));
            },
        'DELETE /customers/me/favorites/p1': (_) {
          favorite = false;
          return (200, _list(const []));
        },
      }, requests: requests);
    }

    IconButton heart(WidgetTester tester) =>
        tester.widget<IconButton>(_key('favorite-p1'));

    testWidgets('adds and removes from the product page, without the cart', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await _pump(
        tester,
        const ProductDetailScreen(productId: 'p1'),
        api: detailApi(requests),
        repository: _signedIn(),
      );
      expect(heart(tester).isSelected, isFalse);
      expect(heart(tester).tooltip, 'Ajouter Robe aux favoris');

      await tester.tap(_key('favorite-p1'));
      await tester.pumpAndSettle();
      expect(heart(tester).isSelected, isTrue);
      expect(heart(tester).tooltip, 'Retirer Robe des favoris');

      await tester.tap(_key('favorite-p1'));
      await tester.pumpAndSettle();
      expect(heart(tester).isSelected, isFalse);

      expect(
        requests.map((request) => request.method),
        containsAll(['PUT', 'DELETE']),
      );
      expect(requests.where(_touchesCart), isEmpty);
    });

    testWidgets('a refused add says why and leaves the heart empty', (
      tester,
    ) async {
      await _pump(
        tester,
        const ProductDetailScreen(productId: 'p1'),
        api: detailApi(
          [],
          put: (_) => (
            409,
            {
              'error': {'code': 'FAVORITE_LIMIT_REACHED'},
            },
          ),
        ),
        repository: _signedIn(),
      );
      await tester.tap(_key('favorite-p1'));
      await tester.pumpAndSettle();
      expect(heart(tester).isSelected, isFalse);
      expect(find.textContaining('200 favoris'), findsOneWidget);
    });

    testWidgets('a guest is sent to sign in, and nothing is saved', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await _pump(
        tester,
        const ProductDetailScreen(productId: 'p1'),
        api: detailApi(requests),
        repository: FakeAuthRepository(),
      );
      expect(
        heart(tester).tooltip,
        'Connectez-vous pour ajouter Robe aux favoris',
      );
      await tester.tap(_key('favorite-p1'));
      await tester.pumpAndSettle();
      expect(
        requests.where((request) => request.url.path.contains('favorites')),
        isEmpty,
      );
    });
  });

  testWidgets('the dock opens favorites, which reads the account list', (
    tester,
  ) async {
    final requests = <http.Request>[];
    await _pump(
      tester,
      const AppShell(),
      api: routedApi({
        'GET /products': (_) => (
          200,
          {
            'products': [_summary('p1')],
            'page': 1,
            'pageSize': 20,
            'total': 1,
          },
        ),
        'GET /customers/me/cart': (_) =>
            (200, {'shops': <Object?>[], 'itemCount': 0, 'subtotal': '0.00'}),
        'GET /customers/me/favorites': (_) => (200, _list([_item('p1')])),
      }, requests: requests),
      repository: _signedIn(),
    );
    // The card's heart already shows the saved product.
    expect(
      tester.widget<IconButton>(_key('favorite-p1').first).isSelected,
      isTrue,
    );
    final before = requests
        .where((request) => request.url.path.endsWith('/favorites'))
        .length;
    await tester.tap(_key('dock-favorites'));
    await tester.pumpAndSettle();
    expect(find.text('Mes favoris'), findsOneWidget);
    expect(_key('favorite-row-p1'), findsOneWidget);
    // Opening the tab reads the list again, so it is current.
    expect(
      requests
          .where((request) => request.url.path.endsWith('/favorites'))
          .length,
      before + 1,
    );
  });
}
