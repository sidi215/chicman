import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_providers.dart';
import '../domain/catalog.dart';

/// One page of a listing (`GET /products`). Public: no session is involved.
final catalogPageProvider = FutureProvider.autoDispose
    .family<CatalogOutcome<CatalogPage>, CatalogFilters>((ref, filters) async {
      return interpretCatalogResult(
        await ref
            .watch(apiClientProvider)
            .getPublic(filters.apiPath, decode: CatalogPage.fromJson),
      );
    });

final catalogDetailProvider = FutureProvider.autoDispose
    .family<CatalogOutcome<PublicProductDetail>, String>((
      ref,
      productId,
    ) async {
      return interpretCatalogResult(
        await ref
            .watch(apiClientProvider)
            .getPublic(
              '/products/${Uri.encodeComponent(productId)}',
              decode: PublicProductDetail.fromJson,
            ),
      );
    });

/// Sizes and colors customers can filter by, per category.
final catalogFacetsProvider = FutureProvider.autoDispose
    .family<CatalogOutcome<CatalogFacets>, ProductCategory?>((
      ref,
      category,
    ) async {
      return interpretCatalogResult(
        await ref
            .watch(apiClientProvider)
            .getPublic(facetsApiPath(category), decode: CatalogFacets.fromJson),
      );
    });

class HomeSection {
  const HomeSection(this.category, this.page);

  /// Null for the newest products.
  final ProductCategory? category;
  final CatalogPage page;
}

const _newestCount = 8;
const _categoryCount = 4;

/// The home page's sections, loaded together so the page has one state: the
/// newest products, then each category.
final homeSectionsProvider =
    FutureProvider.autoDispose<CatalogOutcome<List<HomeSection>>>((ref) async {
      final api = ref.watch(apiClientProvider);
      final categories = <ProductCategory?>[null, ...ProductCategory.values];
      final outcomes = await Future.wait([
        for (final category in categories)
          api
              .getPublic(
                CatalogFilters(
                  category: category,
                  pageSize: category == null ? _newestCount : _categoryCount,
                ).apiPath,
                decode: CatalogPage.fromJson,
              )
              .then(interpretCatalogResult),
      ]);
      final sections = <HomeSection>[];
      for (final (index, outcome) in outcomes.indexed) {
        if (outcome.kind != CatalogOutcomeKind.ok) {
          return CatalogOutcome(outcome.kind);
        }
        sections.add(HomeSection(categories[index], outcome.data!));
      }
      return CatalogOutcome(CatalogOutcomeKind.ok, sections);
    });
