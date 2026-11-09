import 'package:flutter/foundation.dart';

import '../../../core/network/api_client.dart';

/// Client side of the cart (spec 09), matching the web's `cart-logic.ts`. Prices,
/// stock, and availability are decided by the API: nothing here works out a
/// price, and these rules only choose which controls to offer for the state the
/// API reported.
const cartPath = '/customers/me/cart';

String cartItemPath(String itemId) =>
    '$cartPath/items/${Uri.encodeComponent(itemId)}';

/// The body of an add. It never carries a price, a shop, or an owner.
Map<String, Object?> addItemBody(
  String productId,
  String? variantId,
  int quantity,
) => {'productId': productId, 'variantId': ?variantId, 'quantity': quantity};

enum CartIssueCode {
  shopUnavailable('SHOP_UNAVAILABLE'),
  productArchived('PRODUCT_ARCHIVED'),
  productUnpublished('PRODUCT_UNPUBLISHED'),
  variantUnavailable('VARIANT_UNAVAILABLE'),
  insufficientStock('INSUFFICIENT_STOCK'),
  priceChanged('PRICE_CHANGED'),

  /// A code from a newer API: treated as remove-only until the app is updated.
  unknown('');

  const CartIssueCode(this.apiValue);
  final String apiValue;

  static CartIssueCode fromApi(String value) => CartIssueCode.values.firstWhere(
    (code) => code.apiValue == value,
    orElse: () => CartIssueCode.unknown,
  );

  /// The product page no longer exists.
  bool get hidesProduct => const {
    CartIssueCode.shopUnavailable,
    CartIssueCode.productArchived,
    CartIssueCode.productUnpublished,
    CartIssueCode.unknown,
  }.contains(this);

  /// The line can only be removed.
  bool get removeOnly =>
      hidesProduct || this == CartIssueCode.variantUnavailable;
}

@immutable
class CartIssue {
  const CartIssue(this.code, {this.availableQuantity, this.previousPrice});

  factory CartIssue.fromJson(Map<String, Object?> json) => CartIssue(
    CartIssueCode.fromApi(json['code'] as String),
    availableQuantity: json['availableQuantity'] as int?,
    previousPrice: json['previousPrice'] as String?,
  );

  final CartIssueCode code;

  /// Set on [CartIssueCode.insufficientStock]: `0` when sold out.
  final int? availableQuantity;

  /// Set on [CartIssueCode.priceChanged].
  final String? previousPrice;
}

/// Which quantity changes to offer; `null` disables a control. Each is the
/// customer's own action: nothing is changed for them.
@immutable
class QuantityControls {
  const QuantityControls({this.decreaseTo, this.increaseTo, this.correctTo});

  final int? decreaseTo;
  final int? increaseTo;

  /// The quantity that resolves an insufficient-stock warning, when one can.
  final int? correctTo;
}

@immutable
class CartItem {
  const CartItem({
    required this.id,
    required this.productId,
    required this.name,
    required this.imageUrl,
    required this.size,
    required this.color,
    required this.quantity,
    required this.unitPrice,
    required this.subtotal,
    required this.purchasable,
    required this.issues,
  });

  factory CartItem.fromJson(Map<String, Object?> json) => CartItem(
    id: json['id'] as String,
    productId: json['productId'] as String,
    name: json['name'] as String,
    imageUrl: json['imageUrl'] as String?,
    size: json['size'] as String?,
    color: json['color'] as String?,
    quantity: json['quantity'] as int,
    unitPrice: json['unitPrice'] as String,
    subtotal: json['subtotal'] as String,
    purchasable: json['purchasable'] as bool,
    issues: (json['issues'] as List)
        .map((issue) => CartIssue.fromJson(issue as Map<String, Object?>))
        .toList(growable: false),
  );

  final String id;
  final String productId;
  final String name;
  final String? imageUrl;
  final String? size;
  final String? color;
  final int quantity;
  final String unitPrice;
  final String subtotal;
  final bool purchasable;
  final List<CartIssue> issues;

  CartIssue? _issue(CartIssueCode code) {
    for (final issue in issues) {
      if (issue.code == code) return issue;
    }
    return null;
  }

  bool get canOpenProduct => !issues.any((issue) => issue.code.hidesProduct);

  /// The price to acknowledge, when the line has a price change.
  String? get priceToAccept =>
      _issue(CartIssueCode.priceChanged) == null ? null : unitPrice;

  /// A line above the stock can only go down to what is available, since the
  /// API refuses any quantity above it; a sold-out line waits or is removed.
  QuantityControls get controls {
    if (issues.any((issue) => issue.code.removeOnly)) {
      return const QuantityControls();
    }
    final short = _issue(CartIssueCode.insufficientStock);
    if (short != null) {
      final available = short.availableQuantity ?? 0;
      final correctTo = available > 0 ? available : null;
      return QuantityControls(decreaseTo: correctTo, correctTo: correctTo);
    }
    return QuantityControls(
      decreaseTo: quantity > 1 ? quantity - 1 : null,
      increaseTo: quantity + 1,
    );
  }
}

@immutable
class CartShopGroup {
  const CartShopGroup({
    required this.shopId,
    required this.shopName,
    required this.items,
    required this.subtotal,
  });

  factory CartShopGroup.fromJson(Map<String, Object?> json) {
    final shop = json['shop'] as Map<String, Object?>;
    return CartShopGroup(
      shopId: shop['id'] as String,
      shopName: shop['name'] as String,
      items: (json['items'] as List)
          .map((item) => CartItem.fromJson(item as Map<String, Object?>))
          .toList(growable: false),
      subtotal: json['subtotal'] as String,
    );
  }

  final String shopId;
  final String shopName;
  final List<CartItem> items;
  final String subtotal;
}

@immutable
class Cart {
  const Cart({
    required this.shops,
    required this.itemCount,
    required this.subtotal,
  });

  static Cart fromJson(Object? json) {
    final map = json as Map<String, Object?>;
    return Cart(
      shops: (map['shops'] as List)
          .map((shop) => CartShopGroup.fromJson(shop as Map<String, Object?>))
          .toList(growable: false),
      itemCount: map['itemCount'] as int,
      subtotal: map['subtotal'] as String,
    );
  }

  final List<CartShopGroup> shops;
  final int itemCount;
  final String subtotal;

  bool get isEmpty => shops.isEmpty;

  /// Some lines are left out of the subtotal, which the screen must say.
  bool get hasExcludedItems =>
      shops.any((shop) => shop.items.any((item) => !item.purchasable));
}

enum CartFailure {
  insufficientStock,
  variantRequired,
  variantNotFound,
  productNotFound,
  itemNotFound,
  itemUnavailable,
  priceChanged,
  limitReached,
  rateLimited,
  unavailable,
  error,
}

const _failureByCode = {
  'CART_INSUFFICIENT_STOCK': CartFailure.insufficientStock,
  'CART_VARIANT_REQUIRED': CartFailure.variantRequired,
  'CART_VARIANT_NOT_FOUND': CartFailure.variantNotFound,
  'CART_ITEM_NOT_FOUND': CartFailure.itemNotFound,
  'CART_ITEM_UNAVAILABLE': CartFailure.itemUnavailable,
  'CART_PRICE_CHANGED': CartFailure.priceChanged,
  'CART_LIMIT_REACHED': CartFailure.limitReached,
  'PRODUCT_NOT_FOUND': CartFailure.productNotFound,
};

sealed class CartOutcome {
  const CartOutcome();
}

final class CartLoaded extends CartOutcome {
  const CartLoaded(this.cart);
  final Cart cart;
}

final class CartSignedOut extends CartOutcome {
  const CartSignedOut();
}

/// A valid token without account setup.
final class CartNotBootstrapped extends CartOutcome {
  const CartNotBootstrapped();
}

final class CartFailed extends CartOutcome {
  const CartFailed(this.failure);
  final CartFailure failure;
}

CartOutcome interpretCartResult(ApiResult<Cart> result) => switch (result) {
  ApiOk<Cart>(:final data) => CartLoaded(data),
  ApiUnauthorized<Cart>() => const CartSignedOut(),
  ApiForbidden<Cart>() => const CartNotBootstrapped(),
  ApiAuthUnavailable<Cart>() ||
  ApiNetworkError<Cart>() => const CartFailed(CartFailure.unavailable),
  ApiError<Cart>(statusCode: 429) => const CartFailed(CartFailure.rateLimited),
  ApiError<Cart>(statusCode: 503) => const CartFailed(CartFailure.unavailable),
  ApiError<Cart>(:final code) => CartFailed(
    _failureByCode[code] ?? CartFailure.error,
  ),
};

/// The count on the cart icon, capped so it fits the badge.
String cartBadge(int count) => count > 99 ? '99+' : '$count';
