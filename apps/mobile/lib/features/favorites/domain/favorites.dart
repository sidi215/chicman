import 'package:flutter/foundation.dart';

import '../../../core/network/api_client.dart';
import '../../catalog/domain/catalog.dart';

/// Client side of favorites (spec 14), matching the web's `favorites-logic.ts`.
/// The list lives in the customer's account and the API decides each product's
/// current state; nothing here works out a price or an availability.
/// Favorites never touch the cart.
const favoritesPath = '/customers/me/favorites';

/// No body: the product is in the path and the owner comes from the session.
String favoritePath(String productId) =>
    '$favoritesPath/${Uri.encodeComponent(productId)}';

/// Products in the list, at most (`FAVORITES_MAX_ITEMS` in `@chicman/shared`).
const favoritesMaxItems = 200;

enum FavoriteState {
  available('AVAILABLE'),
  soldOut('SOLD_OUT'),

  /// No longer public: no price, no shop, no link. Also used for a state from
  /// a newer API, until the app is updated.
  unavailable('UNAVAILABLE');

  const FavoriteState(this.apiValue);
  final String apiValue;

  static FavoriteState fromApi(String value) => FavoriteState.values.firstWhere(
    (state) => state.apiValue == value,
    orElse: () => FavoriteState.unavailable,
  );
}

@immutable
class FavoriteItem {
  const FavoriteItem({
    required this.productId,
    required this.name,
    required this.imageUrl,
    required this.state,
    required this.product,
  });

  factory FavoriteItem.fromJson(Map<String, Object?> json) {
    final state = FavoriteState.fromApi(json['state'] as String);
    final product = json['product'];
    return FavoriteItem(
      productId: json['productId'] as String,
      name: json['name'] as String,
      imageUrl: json['imageUrl'] as String?,
      state: state,
      // A hidden product never carries a price, even from a newer API.
      product: state == FavoriteState.unavailable || product == null
          ? null
          : PublicProductSummary.fromJson(product),
    );
  }

  final String productId;
  final String name;
  final String? imageUrl;
  final FavoriteState state;

  /// The current public card; `null` when the product is no longer public.
  final PublicProductSummary? product;

  /// Only a product that is still public has a page to open.
  bool get canOpen => product != null;
}

@immutable
class FavoriteList {
  const FavoriteList(this.items);

  factory FavoriteList.fromJson(Object? json) {
    final map = json! as Map<String, Object?>;
    return FavoriteList(
      (map['items'] as List)
          .map((item) => FavoriteItem.fromJson(item as Map<String, Object?>))
          .toList(growable: false),
    );
  }

  /// Most recently added first, as the API sends them.
  final List<FavoriteItem> items;

  bool get isEmpty => items.isEmpty;

  Set<String> get productIds => {for (final item in items) item.productId};
}

enum FavoriteFailure {
  productNotFound,
  limitReached,
  rateLimited,
  unavailable,
  error,
}

const _failureByCode = {
  'PRODUCT_NOT_FOUND': FavoriteFailure.productNotFound,
  'FAVORITE_LIMIT_REACHED': FavoriteFailure.limitReached,
};

sealed class FavoriteOutcome {
  const FavoriteOutcome();
}

final class FavoritesLoaded extends FavoriteOutcome {
  const FavoritesLoaded(this.list);
  final FavoriteList list;
}

final class FavoritesSignedOut extends FavoriteOutcome {
  const FavoritesSignedOut();
}

/// A valid token without account setup.
final class FavoritesNotBootstrapped extends FavoriteOutcome {
  const FavoritesNotBootstrapped();
}

final class FavoritesFailed extends FavoriteOutcome {
  const FavoritesFailed(this.failure);
  final FavoriteFailure failure;
}

FavoriteOutcome interpretFavoriteResult(ApiResult<FavoriteList> result) =>
    switch (result) {
      ApiOk<FavoriteList>(:final data) => FavoritesLoaded(data),
      ApiUnauthorized<FavoriteList>() => const FavoritesSignedOut(),
      ApiForbidden<FavoriteList>() => const FavoritesNotBootstrapped(),
      ApiAuthUnavailable<FavoriteList>() || ApiNetworkError<FavoriteList>() =>
        const FavoritesFailed(FavoriteFailure.unavailable),
      ApiError<FavoriteList>(statusCode: 429) => const FavoritesFailed(
        FavoriteFailure.rateLimited,
      ),
      ApiError<FavoriteList>(statusCode: 503) => const FavoritesFailed(
        FavoriteFailure.unavailable,
      ),
      ApiError<FavoriteList>(:final code) => FavoritesFailed(
        _failureByCode[code] ?? FavoriteFailure.error,
      ),
    };
