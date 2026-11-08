import 'package:flutter/widgets.dart';

import '../../../core/network/api_client.dart';

/// Public product discovery (spec 08). Same contract as
/// `packages/shared/src/products/catalog.ts`.
enum ProductCategory {
  clothing('CLOTHING'),
  shoes('SHOES'),
  fashionAccessories('FASHION_ACCESSORIES');

  const ProductCategory(this.apiValue);
  final String apiValue;

  static ProductCategory fromApi(Object? value) => values.firstWhere(
    (category) => category.apiValue == value,
    orElse: () => throw const FormatException('unknown category'),
  );
}

enum CatalogSort {
  newest('newest'),
  priceAsc('price_asc'),
  priceDesc('price_desc');

  const CatalogSort(this.apiValue);
  final String apiValue;
}

class PublicProductSummary {
  const PublicProductSummary({
    required this.id,
    required this.name,
    required this.category,
    required this.brand,
    required this.price,
    required this.available,
    required this.mainImageUrl,
    required this.shopName,
  });

  factory PublicProductSummary.fromJson(Object? json) {
    final map = json! as Map<String, dynamic>;
    final shop = map['shop'] as Map<String, dynamic>;
    return PublicProductSummary(
      id: map['id'] as String,
      name: map['name'] as String,
      category: ProductCategory.fromApi(map['category']),
      brand: map['brand'] as String?,
      price: map['price'] as String,
      available: map['available'] as bool,
      mainImageUrl: map['mainImageUrl'] as String,
      shopName: shop['name'] as String,
    );
  }

  final String id;
  final String name;
  final ProductCategory category;
  final String? brand;

  /// Decimal string in MRU, for example "1500.00".
  final String price;

  /// False when the relevant stock is zero. The product stays listed.
  final bool available;
  final String mainImageUrl;
  final String shopName;
}

class PublicVariant {
  const PublicVariant({
    required this.id,
    required this.size,
    required this.color,
    required this.available,
  });

  factory PublicVariant.fromJson(Map<String, dynamic> map) => PublicVariant(
    id: map['id'] as String,
    size: map['size'] as String?,
    color: map['color'] as String?,
    available: map['available'] as bool,
  );

  final String id;
  final String? size;
  final String? color;
  final bool available;
}

class PublicShop {
  const PublicShop({
    required this.name,
    required this.description,
    required this.city,
    required this.logoUrl,
  });

  factory PublicShop.fromJson(Map<String, dynamic> map) => PublicShop(
    name: map['name'] as String,
    description: map['description'] as String,
    city: map['city'] as String,
    logoUrl: map['logoUrl'] as String?,
  );

  final String name;
  final String description;
  final String city;
  final String? logoUrl;
}

class PublicProductDetail {
  const PublicProductDetail({
    required this.id,
    required this.name,
    required this.category,
    required this.brand,
    required this.price,
    required this.available,
    required this.description,
    required this.imageUrls,
    required this.variants,
    required this.shop,
  });

  factory PublicProductDetail.fromJson(Object? json) {
    final map = json! as Map<String, dynamic>;
    return PublicProductDetail(
      id: map['id'] as String,
      name: map['name'] as String,
      category: ProductCategory.fromApi(map['category']),
      brand: map['brand'] as String?,
      price: map['price'] as String,
      available: map['available'] as bool,
      description: map['description'] as String,
      imageUrls: [
        for (final image in map['images'] as List<dynamic>)
          (image as Map<String, dynamic>)['url'] as String,
      ],
      variants: [
        for (final variant in map['variants'] as List<dynamic>)
          PublicVariant.fromJson(variant as Map<String, dynamic>),
      ],
      shop: PublicShop.fromJson(map['shop'] as Map<String, dynamic>),
    );
  }

  final String id;
  final String name;
  final ProductCategory category;
  final String? brand;
  final String price;
  final bool available;
  final String description;

  /// In display order: the first is the main image.
  final List<String> imageUrls;
  final List<PublicVariant> variants;
  final PublicShop shop;
}

class CatalogPage {
  const CatalogPage({
    required this.products,
    required this.page,
    required this.pageSize,
    required this.total,
  });

  factory CatalogPage.fromJson(Object? json) {
    final map = json! as Map<String, dynamic>;
    return CatalogPage(
      products: [
        for (final product in map['products'] as List<dynamic>)
          PublicProductSummary.fromJson(product),
      ],
      page: map['page'] as int,
      pageSize: map['pageSize'] as int,
      total: map['total'] as int,
    );
  }

  final List<PublicProductSummary> products;
  final int page;
  final int pageSize;
  final int total;

  /// An empty listing has one page.
  int get pageCount => total == 0 ? 1 : (total + pageSize - 1) ~/ pageSize;
}

class CatalogFacets {
  const CatalogFacets({required this.sizes, required this.colors});

  factory CatalogFacets.fromJson(Object? json) {
    final map = json! as Map<String, dynamic>;
    return CatalogFacets(
      sizes: (map['sizes'] as List<dynamic>).cast<String>(),
      colors: (map['colors'] as List<dynamic>).cast<String>(),
    );
  }

  final List<String> sizes;
  final List<String> colors;
}

const _unchanged = Object();

/// The state of a product listing. Equal values share one provider instance.
@immutable
class CatalogFilters {
  const CatalogFilters({
    this.category,
    this.minPrice,
    this.maxPrice,
    this.availableOnly = false,
    this.size,
    this.color,
    this.sort = CatalogSort.newest,
    this.page = 1,
    this.pageSize,
  });

  final ProductCategory? category;
  final String? minPrice;
  final String? maxPrice;
  final bool availableOnly;
  final String? size;
  final String? color;
  final CatalogSort sort;
  final int page;

  /// Server default when null.
  final int? pageSize;

  /// A filter or sort change returns to the first page, which always exists.
  CatalogFilters changed({
    Object? minPrice = _unchanged,
    Object? maxPrice = _unchanged,
    bool? availableOnly,
    Object? size = _unchanged,
    Object? color = _unchanged,
    CatalogSort? sort,
  }) => CatalogFilters(
    category: category,
    minPrice: identical(minPrice, _unchanged)
        ? this.minPrice
        : minPrice as String?,
    maxPrice: identical(maxPrice, _unchanged)
        ? this.maxPrice
        : maxPrice as String?,
    availableOnly: availableOnly ?? this.availableOnly,
    size: identical(size, _unchanged) ? this.size : size as String?,
    color: identical(color, _unchanged) ? this.color : color as String?,
    sort: sort ?? this.sort,
    pageSize: pageSize,
  );

  /// Sizes and colors depend on the category, so a new category clears them.
  CatalogFilters withCategory(ProductCategory? next) => next == category
      ? this
      : CatalogFilters(
          category: next,
          minPrice: minPrice,
          maxPrice: maxPrice,
          availableOnly: availableOnly,
          sort: sort,
          pageSize: pageSize,
        );

  /// Keeps every filter and the sort order.
  CatalogFilters atPage(int next) => CatalogFilters(
    category: category,
    minPrice: minPrice,
    maxPrice: maxPrice,
    availableOnly: availableOnly,
    size: size,
    color: color,
    sort: sort,
    page: next,
    pageSize: pageSize,
  );

  /// Clears the filter sheet. The category and sort order remain.
  CatalogFilters cleared() =>
      CatalogFilters(category: category, sort: sort, pageSize: pageSize);

  int get activeCount =>
      [minPrice, maxPrice, size, color].where((value) => value != null).length +
      (availableOnly ? 1 : 0);

  String get apiPath {
    final query = <String, String>{
      if (category != null) 'category': category!.apiValue,
      'minPrice': ?minPrice,
      'maxPrice': ?maxPrice,
      if (availableOnly) 'availability': 'available',
      'size': ?size,
      'color': ?color,
      if (sort != CatalogSort.newest) 'sort': sort.apiValue,
      if (page > 1) 'page': '$page',
      if (pageSize != null) 'pageSize': '$pageSize',
    };
    return Uri(
      path: '/products',
      queryParameters: query.isEmpty ? null : query,
    ).toString();
  }

  @override
  bool operator ==(Object other) =>
      other is CatalogFilters && other.apiPath == apiPath;

  @override
  int get hashCode => apiPath.hashCode;
}

String facetsApiPath(ProductCategory? category) => category == null
    ? '/products/facets'
    : '/products/facets?category=${category.apiValue}';

enum PriceRangeError { invalidMin, invalidMax, range }

class PriceRange {
  const PriceRange({this.min, this.max, this.error});
  final String? min;
  final String? max;
  final PriceRangeError? error;
}

final _pricePattern = RegExp(r'^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$');

/// Returns null when [text] is not a valid bound. Uses strings throughout, so
/// a price never passes through floating point.
String? _normalizeBound(String text) {
  if (!_pricePattern.hasMatch(text)) return null;
  final parts = text.split('.');
  final fraction = (parts.length > 1 ? parts[1] : '').padRight(2, '0');
  return '${parts[0]}.$fraction';
}

/// Reads the price inputs. An empty input means no bound; "1 500,50" is accepted.
PriceRange parsePriceRange(String minText, String maxText) {
  String clean(String text) =>
      text.replaceAll(RegExp(r'\s'), '').replaceFirst(',', '.');
  final minInput = clean(minText);
  final maxInput = clean(maxText);
  final min = minInput.isEmpty ? null : _normalizeBound(minInput);
  if (minInput.isNotEmpty && min == null) {
    return const PriceRange(error: PriceRangeError.invalidMin);
  }
  final max = maxInput.isEmpty ? null : _normalizeBound(maxInput);
  if (maxInput.isNotEmpty && max == null) {
    return const PriceRange(error: PriceRangeError.invalidMax);
  }
  if (min != null &&
      max != null &&
      min.padLeft(13, '0').compareTo(max.padLeft(13, '0')) > 0) {
    return const PriceRange(error: PriceRangeError.range);
  }
  return PriceRange(min: min, max: max);
}

enum CatalogOutcomeKind { ok, notFound, rateLimited, unavailable, error }

class CatalogOutcome<T> {
  const CatalogOutcome(this.kind, [this.data]);
  final CatalogOutcomeKind kind;
  final T? data;
}

CatalogOutcome<T> interpretCatalogResult<T>(ApiResult<T> result) =>
    switch (result) {
      ApiOk<T>(:final data) => CatalogOutcome(CatalogOutcomeKind.ok, data),
      ApiNetworkError<T>() ||
      ApiAuthUnavailable<T>() => CatalogOutcome(CatalogOutcomeKind.unavailable),
      ApiError<T>(statusCode: 404) => CatalogOutcome(
        CatalogOutcomeKind.notFound,
      ),
      ApiError<T>(statusCode: 429) => CatalogOutcome(
        CatalogOutcomeKind.rateLimited,
      ),
      ApiError<T>(statusCode: 503) => CatalogOutcome(
        CatalogOutcomeKind.unavailable,
      ),
      _ => CatalogOutcome(CatalogOutcomeKind.error),
    };

/// Size and color selection on a product page. Availability itself comes from
/// the API; this only finds which variant the customer has chosen. A seller's
/// values ignore case within a product, so "M" and "m" are one option.
@immutable
class VariantChoice {
  const VariantChoice({this.size, this.color});
  final String? size;
  final String? color;

  VariantChoice toggledSize(String value) =>
      VariantChoice(size: sameOption(size, value) ? null : value, color: color);

  VariantChoice toggledColor(String value) =>
      VariantChoice(size: size, color: sameOption(color, value) ? null : value);
}

bool sameOption(String? a, String? b) => a?.toLowerCase() == b?.toLowerCase();

class VariantOption {
  const VariantOption(this.value, {required this.available});
  final String value;

  /// False when no in-stock variant has this value, given the other choice.
  final bool available;
}

List<VariantOption> _options(
  List<PublicVariant> variants,
  String? Function(PublicVariant) read,
  bool Function(PublicVariant) fitsOther,
) {
  final spellings = <String, String>{};
  final available = <String, bool>{};
  for (final variant in variants) {
    final value = read(variant);
    if (value == null) continue;
    final key = value.toLowerCase();
    spellings.putIfAbsent(key, () => value);
    available[key] =
        (available[key] ?? false) || (variant.available && fitsOther(variant));
  }
  return [
    for (final MapEntry(:key, :value) in spellings.entries)
      VariantOption(value, available: available[key]!),
  ];
}

List<VariantOption> sizeOptions(
  List<PublicVariant> variants,
  VariantChoice choice,
) => _options(
  variants,
  (variant) => variant.size,
  (variant) => choice.color == null || sameOption(variant.color, choice.color),
);

List<VariantOption> colorOptions(
  List<PublicVariant> variants,
  VariantChoice choice,
) => _options(
  variants,
  (variant) => variant.color,
  (variant) => choice.size == null || sameOption(variant.size, choice.size),
);

sealed class VariantSelection {
  const VariantSelection();
}

/// Nothing is chosen, or the choice is not finished.
final class SelectionIncomplete extends VariantSelection {
  const SelectionIncomplete();
}

/// The chosen combination is not sold by this product.
final class SelectionNoMatch extends VariantSelection {
  const SelectionNoMatch();
}

final class SelectionMade extends VariantSelection {
  const SelectionMade(this.variant);
  final PublicVariant variant;
}

VariantSelection selectVariant(
  List<PublicVariant> variants,
  VariantChoice choice,
) {
  if (choice.size == null && choice.color == null) {
    return const SelectionIncomplete();
  }
  for (final variant in variants) {
    if (sameOption(variant.size, choice.size) &&
        sameOption(variant.color, choice.color)) {
      return SelectionMade(variant);
    }
  }
  final compatible = variants.any(
    (variant) =>
        (choice.size == null || sameOption(variant.size, choice.size)) &&
        (choice.color == null || sameOption(variant.color, choice.color)),
  );
  return compatible ? const SelectionIncomplete() : const SelectionNoMatch();
}

final _firstStrongLetter = RegExp(r'[A-Za-zÀ-ɏ֐-ࣿיִ-﷿ﹰ-﻿]');
final _rightToLeft = RegExp(r'[֐-ࣿיִ-﷿ﹰ-﻿]');

/// Seller content keeps its own direction, like `dir="auto"` on the web.
TextDirection? sellerTextDirection(String text) {
  final letter = _firstStrongLetter.stringMatch(text);
  if (letter == null) return null;
  return _rightToLeft.hasMatch(letter) ? TextDirection.rtl : TextDirection.ltr;
}
