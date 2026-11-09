import 'dart:async';

import 'package:chicman/app_shell.dart';
import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/core/theme/app_theme.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/catalog/presentation/product_detail_screen.dart';
import 'package:chicman/features/catalog/presentation/product_list_screen.dart';
import 'package:chicman/features/catalog/domain/catalog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../auth/fakes.dart';

const _host = 'chicman.test';
const _config = AppConfig(
  supabaseUrl: 'https://p.supabase.co',
  supabasePublishableKey: 'k',
  apiBaseUrl: 'http://api.test',
  siteUrl: 'https://$_host',
);

Map<String, Object?> _card(
  String id, {
  String name = 'Robe',
  String category = 'CLOTHING',
  String price = '1500.50',
  bool available = true,
}) => {
  'id': id,
  'name': name,
  'category': category,
  'brand': null,
  'price': price,
  'available': available,
  'mainImageUrl': 'http://media.test/$id.jpg',
  'shop': {'id': 's1', 'name': 'Boutique Sahel'},
};

Map<String, Object?> _page(
  List<Map<String, Object?>> products, {
  int page = 1,
  int? total,
}) => {
  'products': products,
  'page': page,
  'pageSize': 20,
  'total': total ?? products.length,
};

Map<String, Object?> _detail({
  bool available = true,
  List<Map<String, Object?>> variants = const [],
}) => {
  ..._card('p1', available: available),
  'brand': 'Atelier',
  'description': 'Voile léger.',
  'images': [
    {'id': 'i1', 'url': 'http://media.test/1.jpg', 'width': 600, 'height': 800},
  ],
  'variants': variants,
  'shop': {
    'id': 's1',
    'name': 'Boutique Sahel',
    'description': 'Tissus de qualité.',
    'city': 'Nouakchott',
    'logoUrl': null,
  },
};

Future<void> _pump(
  WidgetTester tester,
  Widget home, {
  required ApiClient api,
  AuthRepository? repository,
  Locale? locale,
  Stream<Uri>? links,
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
        incomingLinksProvider.overrideWithValue(links),
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

ApiClient _homeApi({List<http.Request>? requests}) => routedApi({
  'GET /products': (request) {
    final category = request.url.queryParameters['category'];
    if (category == 'SHOES') {
      return (200, _page([_card('shoe', name: 'Sandale', category: 'SHOES')]));
    }
    if (category != null) return (200, _page(const []));
    return (
      200,
      _page([
        _card('robe', name: 'Robe'),
        _card('epuise', name: 'Épuisée', available: false),
      ]),
    );
  },
}, requests: requests);

void main() {
  group('public storefront', () {
    testWidgets('a guest lands on the storefront, with no token sent', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await _pump(
        tester,
        const AppShell(),
        api: _homeApi(requests: requests),
        repository: FakeAuthRepository(),
      );
      expect(find.text('Nouveautés'), findsOneWidget);
      expect(find.text('Robe'), findsOneWidget);
      expect(find.text('Sandale'), findsOneWidget);
      expect(find.text('Adresse e-mail'), findsNothing);
      expect(requests, isNotEmpty);
      for (final request in requests) {
        expect(request.headers.containsKey('authorization'), isFalse);
      }
      // No section for a category without products.
      expect(find.byKey(const Key('home-see-all-CLOTHING')), findsNothing);
    });

    testWidgets('the account tab opens login, only when asked', (tester) async {
      await _pump(
        tester,
        const AppShell(),
        api: _homeApi(),
        repository: FakeAuthRepository(),
      );
      await tester.tap(find.byKey(const Key('dock-account')));
      await tester.pumpAndSettle();
      expect(find.text('Adresse e-mail'), findsOneWidget);
      await tester.tap(find.byKey(const Key('dock-home')));
      await tester.pumpAndSettle();
      expect(find.text('Adresse e-mail'), findsNothing);
    });

    testWidgets('an email link opens the account tab and its callback', (
      tester,
    ) async {
      final links = StreamController<Uri>();
      addTearDown(links.close);
      await _pump(
        tester,
        const AppShell(),
        api: _homeApi(),
        repository: FakeAuthRepository(),
        links: links.stream,
      );
      expect(find.text('Nouveautés'), findsOneWidget);
      links.add(
        Uri.parse('https://$_host/auth/callback#token_hash=abc&type=signup'),
      );
      await tester.pumpAndSettle();
      expect(find.text('Nouveautés').hitTestable(), findsNothing);
      // The callback screen has handled the link instead of being lost.
      final bar = tester.widget<NavigationBar>(find.byType(NavigationBar));
      expect(bar.selectedIndex, 1);
    });

    testWidgets('an empty catalog is explained', (tester) async {
      await _pump(
        tester,
        const AppShell(),
        api: routedApi({'GET /products': (_) => (200, _page(const []))}),
      );
      expect(
        find.text("Aucun produit n'est disponible pour le moment."),
        findsOneWidget,
      );
    });

    testWidgets('a failure offers a retry that works', (tester) async {
      var fail = true;
      await _pump(
        tester,
        const AppShell(),
        api: routedApi({
          'GET /products': (_) =>
              fail ? (503, const {}) : (200, _page([_card('a')])),
        }),
      );
      expect(
        find.text(
          'Le service est momentanément indisponible. Réessayez dans un instant.',
        ),
        findsOneWidget,
      );
      fail = false;
      await tester.tap(find.text('Réessayer'));
      await tester.pumpAndSettle();
      expect(find.text('Robe'), findsWidgets);
    });

    testWidgets('a card shows name, price, shop, and unavailability', (
      tester,
    ) async {
      await _pump(tester, const AppShell(), api: _homeApi());
      expect(find.text('1\u00A0500,50\u00A0MRU'), findsWidgets);
      expect(find.text('Boutique Sahel'), findsWidgets);
      expect(find.text('Indisponible'), findsOneWidget);
    });

    testWidgets('Arabic renders right to left with localized labels', (
      tester,
    ) async {
      await _pump(
        tester,
        const AppShell(),
        api: _homeApi(),
        locale: const Locale('ar'),
      );
      expect(find.text('وصل حديثًا'), findsOneWidget);
      expect(find.text('أحذية'), findsWidgets);
      expect(find.text('1,500.50\u00A0أوقية'), findsWidgets);
      // Seller content is not translated.
      expect(find.text('Robe'), findsOneWidget);
      final context = tester.element(find.text('وصل حديثًا'));
      expect(Directionality.of(context), TextDirection.rtl);
      expect(tester.takeException(), isNull);
    });
  });

  group('listing', () {
    Map<String, String>? lastQuery;
    ApiClient listingApi({int total = 45}) => routedApi({
      'GET /products': (request) {
        lastQuery = request.url.queryParameters;
        final page = int.parse(request.url.queryParameters['page'] ?? '1');
        return (
          200,
          _page(
            [_card('p$page', name: 'Produit $page')],
            page: page,
            total: total,
          ),
        );
      },
      'GET /products/facets': (_) => (
        200,
        {
          'sizes': ['M', 'L'],
          'colors': ['Noir'],
        },
      ),
    });

    testWidgets('sort and pages keep filters, and a change returns to page 1', (
      tester,
    ) async {
      await _pump(
        tester,
        const ProductListScreen(
          initialFilters: CatalogFilters(category: ProductCategory.shoes),
        ),
        api: listingApi(),
      );
      expect(lastQuery, {'category': 'SHOES'});
      expect(find.text('Résultats : 45'), findsOneWidget);
      expect(find.text('Page 1 sur 3'), findsOneWidget);

      await tester.tap(find.byKey(const Key('page-next')));
      await tester.pumpAndSettle();
      expect(lastQuery, {'category': 'SHOES', 'page': '2'});
      expect(find.text('Produit 2'), findsOneWidget);

      await tester.tap(find.byKey(const Key('listing-sort')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('sort-price_asc')));
      await tester.pumpAndSettle();
      expect(lastQuery, {'category': 'SHOES', 'sort': 'price_asc'});

      await tester.tap(find.byKey(const Key('page-next')));
      await tester.pumpAndSettle();
      expect(lastQuery, {
        'category': 'SHOES',
        'sort': 'price_asc',
        'page': '2',
      });
    });

    testWidgets('filters apply together; an invalid range sends nothing', (
      tester,
    ) async {
      await _pump(
        tester,
        const ProductListScreen(initialFilters: CatalogFilters()),
        api: listingApi(),
      );
      await tester.tap(find.byKey(const Key('listing-filters')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('filter-min-price')), '100');
      await tester.enterText(find.byKey(const Key('filter-max-price')), '20');
      await tester.tap(find.byKey(const Key('filter-apply')));
      await tester.pumpAndSettle();
      expect(
        find.text('Le prix minimum dépasse le prix maximum.'),
        findsOneWidget,
      );
      expect(lastQuery, isEmpty);

      await tester.enterText(
        find.byKey(const Key('filter-max-price')),
        '1 500,5',
      );
      await tester.tap(find.byKey(const Key('filter-available')));
      await tester.tap(find.byKey(const Key('filter-size-M')));
      await tester.tap(find.byKey(const Key('filter-color-Noir')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('filter-apply')));
      await tester.pumpAndSettle();
      expect(lastQuery, {
        'minPrice': '100.00',
        'maxPrice': '1500.50',
        'availability': 'available',
        'size': 'M',
        'color': 'Noir',
      });
      expect(find.text('Filtres (4)'), findsNothing);
      expect(find.text('Filtres (5)'), findsOneWidget);

      await tester.tap(find.byKey(const Key('listing-filters')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('filter-clear')));
      await tester.pumpAndSettle();
      expect(lastQuery, isEmpty);
      expect(find.text('Filtres'), findsOneWidget);
    });

    testWidgets('no result is explained, and filters can be cleared', (
      tester,
    ) async {
      await _pump(
        tester,
        const ProductListScreen(initialFilters: CatalogFilters(size: 'XXL')),
        api: routedApi({
          'GET /products': (request) => (
            200,
            _page(
              request.url.queryParameters.containsKey('size')
                  ? const []
                  : [_card('a')],
            ),
          ),
        }),
      );
      expect(
        find.text('Aucun produit ne correspond à ces critères.'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('listing-clear')));
      await tester.pumpAndSettle();
      expect(find.text('Robe'), findsOneWidget);
    });
  });

  group('details', () {
    ApiClient detailApi(Map<String, Object?> body) =>
        routedApi({'GET /products/p1': (_) => (200, body)});

    testWidgets(
      'shows the product and its shop; a guest is invited to sign in',
      (tester) async {
        await _pump(
          tester,
          const ProductDetailScreen(productId: 'p1'),
          api: detailApi(_detail()),
        );
        expect(find.text('Robe'), findsOneWidget);
        expect(find.text('1\u00A0500,50\u00A0MRU'), findsOneWidget);
        expect(find.text('Voile léger.'), findsOneWidget);
        expect(find.text('Marque : Atelier'), findsOneWidget);
        expect(find.text('Boutique Sahel'), findsOneWidget);
        expect(find.text('Ville : Nouakchott'), findsOneWidget);
        expect(find.text('Tissus de qualité.'), findsOneWidget);
        expect(find.text('Disponible'), findsOneWidget);
        expect(find.byKey(const Key('add-to-cart-invitation')), findsOneWidget);
        expect(find.byKey(const Key('add-to-cart')), findsNothing);
      },
    );

    testWidgets('an unavailable product says so', (tester) async {
      await _pump(
        tester,
        const ProductDetailScreen(productId: 'p1'),
        api: detailApi(_detail(available: false)),
      );
      expect(
        find.text('Ce produit est indisponible pour le moment.'),
        findsOneWidget,
      );
    });

    testWidgets('the chosen size and color are identified, with availability', (
      tester,
    ) async {
      await _pump(
        tester,
        const ProductDetailScreen(productId: 'p1'),
        api: detailApi(
          _detail(
            variants: [
              {'id': 'v1', 'size': 'M', 'color': 'Noir', 'available': true},
              {'id': 'v2', 'size': 'M', 'color': 'Rouge', 'available': false},
              {'id': 'v3', 'size': 'L', 'color': 'Rouge', 'available': true},
            ],
          ),
        ),
      );
      String status() =>
          tester.widget<Text>(find.byKey(const Key('variant-status'))).data!;
      expect(status(), 'Sélectionnez les options souhaitées.');

      await tester.tap(find.byKey(const Key('variant-size-M')));
      await tester.pumpAndSettle();
      expect(find.text('Taille : M'), findsOneWidget);
      expect(status(), 'Sélectionnez les options souhaitées.');

      await tester.tap(find.byKey(const Key('variant-color-Rouge')));
      await tester.pumpAndSettle();
      expect(find.text('Couleur : Rouge'), findsOneWidget);
      expect(status(), 'Ce choix est indisponible pour le moment.');

      await tester.tap(find.byKey(const Key('variant-color-Noir')));
      await tester.pumpAndSettle();
      expect(status(), 'Disponible');

      await tester.tap(find.byKey(const Key('variant-size-L')));
      await tester.pumpAndSettle();
      expect(status(), "Cette combinaison n'est pas proposée.");
    });

    testWidgets('a hidden product reads as not found', (tester) async {
      await _pump(
        tester,
        const ProductDetailScreen(productId: 'gone'),
        api: routedApi(const {}),
      );
      expect(find.text('Produit introuvable'), findsOneWidget);
    });

    testWidgets('a card opens its details', (tester) async {
      await _pump(
        tester,
        const AppShell(),
        api: routedApi({
          'GET /products': (request) => (
            200,
            _page(
              request.url.queryParameters['category'] == null
                  ? [_card('p1', name: 'Melhfa')]
                  : const [],
            ),
          ),
          'GET /products/p1': (_) => (200, _detail()),
        }),
      );
      await tester.tap(find.byKey(const Key('product-card-p1')));
      await tester.pumpAndSettle();
      expect(find.text('Voile léger.'), findsOneWidget);
    });
  });
}
