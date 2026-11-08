import 'package:chicman/core/format/money.dart';
import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/features/catalog/domain/catalog.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

PublicVariant _variant(String? size, String? color, bool available) =>
    PublicVariant(
      id: '$size-$color',
      size: size,
      color: color,
      available: available,
    );

void main() {
  group('price format', () {
    test('matches the web, without floating point', () {
      expect(
        formatMru('1500.50', languageCode: 'fr'),
        '1\u00A0500,50\u00A0MRU',
      );
      expect(formatMru('1500.5', languageCode: 'ar'), '1,500.50\u00A0أوقية');
      expect(
        formatMru('9999999999.99', languageCode: 'fr'),
        '9\u00A0999\u00A0999\u00A0999,99\u00A0MRU',
      );
      expect(formatMru('20.00', languageCode: 'fr'), '20,00\u00A0MRU');
    });
  });

  group('listing query', () {
    test('uses the API parameter names and omits defaults', () {
      expect(const CatalogFilters().apiPath, '/products');
      final filters = const CatalogFilters(
        category: ProductCategory.shoes,
        minPrice: '10.00',
        maxPrice: '20.50',
        availableOnly: true,
        size: 'M',
        color: 'Bleu & vert',
        sort: CatalogSort.priceDesc,
        page: 3,
      );
      final uri = Uri.parse(filters.apiPath);
      expect(uri.queryParameters, {
        'category': 'SHOES',
        'minPrice': '10.00',
        'maxPrice': '20.50',
        'availability': 'available',
        'size': 'M',
        'color': 'Bleu & vert',
        'sort': 'price_desc',
        'page': '3',
      });
    });

    test('a change returns to page 1; a page move keeps everything', () {
      const filters = CatalogFilters(
        category: ProductCategory.shoes,
        size: 'M',
        sort: CatalogSort.priceAsc,
        page: 4,
      );
      expect(filters.changed(size: 'L').page, 1);
      expect(filters.changed(sort: CatalogSort.newest).page, 1);
      final next = filters.atPage(5);
      expect(next.page, 5);
      expect(next.size, 'M');
      expect(next.sort, CatalogSort.priceAsc);
      expect(next.category, ProductCategory.shoes);
    });

    test('null clears a filter, and leaving it out keeps it', () {
      const filters = CatalogFilters(size: 'M', minPrice: '5.00');
      expect(filters.changed(size: null).size, isNull);
      expect(filters.changed(size: null).minPrice, '5.00');
    });

    test('a new category clears size and color', () {
      const filters = CatalogFilters(
        category: ProductCategory.shoes,
        size: '40',
        color: 'Noir',
        minPrice: '5.00',
        page: 2,
      );
      final next = filters.withCategory(ProductCategory.clothing);
      expect(next.size, isNull);
      expect(next.color, isNull);
      expect(next.minPrice, '5.00');
      expect(next.page, 1);
      expect(
        identical(filters.withCategory(ProductCategory.shoes), filters),
        isTrue,
      );
    });

    test('clearing keeps the category and sort; equal filters are equal', () {
      const filters = CatalogFilters(
        category: ProductCategory.shoes,
        sort: CatalogSort.priceDesc,
        size: '40',
        availableOnly: true,
      );
      expect(filters.activeCount, 2);
      expect(
        filters.cleared(),
        const CatalogFilters(
          category: ProductCategory.shoes,
          sort: CatalogSort.priceDesc,
        ),
      );
      expect(filters.cleared().activeCount, 0);
    });
  });

  group('price inputs', () {
    test('accepts empty bounds, spaces, and a decimal comma', () {
      final range = parsePriceRange('1 500,5', '');
      expect((range.min, range.max, range.error), ('1500.50', null, null));
      final same = parsePriceRange('5', '5');
      expect((same.min, same.max, same.error), ('5.00', '5.00', null));
      expect(parsePriceRange('0', '').min, '0.00');
    });

    test('refuses invalid values and an inverted range', () {
      expect(parsePriceRange('abc', '').error, PriceRangeError.invalidMin);
      expect(parsePriceRange('', '-1').error, PriceRangeError.invalidMax);
      expect(parsePriceRange('1.234', '').error, PriceRangeError.invalidMin);
      expect(parsePriceRange('100', '20').error, PriceRangeError.range);
    });
  });

  group('API results', () {
    test('classifies each outcome', () {
      CatalogOutcomeKind kind(ApiResult<int> result) =>
          interpretCatalogResult(result).kind;
      expect(kind(const ApiOk(1)), CatalogOutcomeKind.ok);
      expect(kind(const ApiError(404, null)), CatalogOutcomeKind.notFound);
      expect(kind(const ApiError(429, null)), CatalogOutcomeKind.rateLimited);
      expect(kind(const ApiError(503, null)), CatalogOutcomeKind.unavailable);
      expect(kind(const ApiNetworkError()), CatalogOutcomeKind.unavailable);
      expect(kind(const ApiError(500, null)), CatalogOutcomeKind.error);
      expect(kind(const ApiUnauthorized()), CatalogOutcomeKind.error);
    });

    test('an unknown category is refused at the boundary', () {
      expect(
        () => ProductCategory.fromApi('BAGS'),
        throwsA(isA<FormatException>()),
      );
    });

    test('pages', () {
      CatalogPage page(int total) =>
          CatalogPage(products: const [], page: 1, pageSize: 20, total: total);
      expect(
        [page(0).pageCount, page(20).pageCount, page(21).pageCount],
        [1, 1, 2],
      );
    });
  });

  group('variant selection', () {
    final variants = [
      _variant('M', 'Noir', true),
      _variant('M', 'Rouge', false),
      _variant('L', 'Rouge', true),
      _variant('XL', 'Noir', false),
    ];

    test('needs a complete choice before it names a variant', () {
      expect(
        selectVariant(variants, const VariantChoice()),
        isA<SelectionIncomplete>(),
      );
      expect(
        selectVariant(variants, const VariantChoice(size: 'M')),
        isA<SelectionIncomplete>(),
      );
    });

    test('identifies the chosen variant and its availability', () {
      final selected = selectVariant(
        variants,
        const VariantChoice(size: 'M', color: 'Rouge'),
      );
      expect((selected as SelectionMade).variant.available, isFalse);
    });

    test('reports a combination the product does not sell', () {
      expect(
        selectVariant(variants, const VariantChoice(size: 'L', color: 'Noir')),
        isA<SelectionNoMatch>(),
      );
    });

    test('handles size-only and color-only variants, ignoring case', () {
      expect(
        selectVariant([
          _variant('38', null, true),
        ], const VariantChoice(size: '38')),
        isA<SelectionMade>(),
      );
      expect(
        selectVariant([
          _variant(null, 'Noir', false),
        ], const VariantChoice(color: 'noir')),
        isA<SelectionMade>(),
      );
    });

    test('marks options by what can be bought with the other choice', () {
      List<(String, bool)> read(List<VariantOption> options) => [
        for (final option in options) (option.value, option.available),
      ];
      expect(read(sizeOptions(variants, const VariantChoice())), [
        ('M', true),
        ('L', true),
        ('XL', false),
      ]);
      expect(read(sizeOptions(variants, const VariantChoice(color: 'Rouge'))), [
        ('M', false),
        ('L', true),
        ('XL', false),
      ]);
      expect(read(colorOptions(variants, const VariantChoice(size: 'M'))), [
        ('Noir', true),
        ('Rouge', false),
      ]);
    });

    test('treats spellings of one value as one option', () {
      final options = sizeOptions([
        _variant('M', 'Noir', false),
        _variant('m', 'Rouge', true),
      ], const VariantChoice());
      expect(options.length, 1);
      expect(options.single.value, 'M');
      expect(options.single.available, isTrue);
    });

    test('selecting a chosen value clears it', () {
      final choice = const VariantChoice().toggledSize('M');
      expect(choice.size, 'M');
      expect(choice.toggledSize('m').size, isNull);
      expect(choice.toggledColor('Noir').size, 'M');
    });
  });

  test('seller text keeps its own direction', () {
    expect(sellerTextDirection('ملحفة أنيقة'), TextDirection.rtl);
    expect(sellerTextDirection('Robe légère'), TextDirection.ltr);
    expect(sellerTextDirection('42 ملحفة'), TextDirection.rtl);
    expect(sellerTextDirection('42'), isNull);
  });
}
