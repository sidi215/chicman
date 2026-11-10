import 'dart:math';

import 'package:flutter/foundation.dart';

import '../../../core/network/api_client.dart';
import '../../cart/domain/cart.dart';

export '../../orders/domain/orders.dart';

/// Client side of checkout (spec 10), matching the web's `checkout-logic.ts`.
/// The API decides every figure and every blocking problem; these rules only
/// choose what to show and what to send.
const checkoutPath = '/customers/me/checkout';
const idempotencyKeyHeader = 'Idempotency-Key';
const recipientNameMaxLength = 100;

String checkoutSummaryPath(String? addressId) => addressId == null
    ? checkoutPath
    : '$checkoutPath?addressId=${Uri.encodeQueryComponent(addressId)}';

/// Why the whole checkout is blocked (spec 10, section 8).
enum CheckoutProblemCode {
  cartEmpty('CART_EMPTY'),
  deliveryFeeNotSet('DELIVERY_FEE_NOT_SET'),
  ownShop('OWN_SHOP'),
  priceChanged('PRICE_CHANGED'),
  insufficientStock('INSUFFICIENT_STOCK'),

  /// A line that can only be removed, or a code from a newer API.
  unavailable('');

  const CheckoutProblemCode(this.apiValue);
  final String apiValue;

  static CheckoutProblemCode fromApi(String value) =>
      CheckoutProblemCode.values.firstWhere(
        (code) => code.apiValue == value,
        orElse: () => CheckoutProblemCode.unavailable,
      );
}

@immutable
class CheckoutProblem {
  const CheckoutProblem(this.code, {this.shopId, this.itemId});

  factory CheckoutProblem.fromJson(Map<String, Object?> json) =>
      CheckoutProblem(
        CheckoutProblemCode.fromApi(json['code'] as String),
        shopId: json['shopId'] as String?,
        itemId: json['itemId'] as String?,
      );

  final CheckoutProblemCode code;
  final String? shopId;
  final String? itemId;
}

/// The saved address as it would be copied onto the order (D11).
@immutable
class CheckoutAddress {
  const CheckoutAddress({
    required this.addressId,
    required this.label,
    required this.city,
    required this.district,
    required this.landmark,
    required this.deliveryPhone,
  });

  factory CheckoutAddress.fromJson(Map<String, Object?> json) =>
      CheckoutAddress(
        addressId: json['addressId'] as String,
        label: json['label'] as String?,
        city: json['city'] as String,
        district: json['district'] as String,
        landmark: json['landmark'] as String,
        deliveryPhone: json['deliveryPhone'] as String,
      );

  final String addressId;
  final String? label;
  final String city;
  final String district;
  final String landmark;

  /// The address's phone, otherwise the profile's. Never labelled verified.
  final String deliveryPhone;
}

@immutable
class CheckoutShop {
  const CheckoutShop({
    required this.shopId,
    required this.shopName,
    required this.items,
    required this.productsSubtotal,
    required this.deliveryFee,
    required this.total,
  });

  factory CheckoutShop.fromJson(Map<String, Object?> json) {
    final shop = json['shop'] as Map<String, Object?>;
    return CheckoutShop(
      shopId: shop['id'] as String,
      shopName: shop['name'] as String,
      items: (json['items'] as List)
          .map((item) => CartItem.fromJson(item as Map<String, Object?>))
          .toList(growable: false),
      productsSubtotal: json['productsSubtotal'] as String,
      deliveryFee: json['deliveryFee'] as String?,
      total: json['total'] as String?,
    );
  }

  final String shopId;
  final String shopName;
  final List<CartItem> items;
  final String productsSubtotal;

  /// `null` while the shop has not set its fee.
  final String? deliveryFee;
  final String? total;
}

@immutable
class CheckoutSummary {
  const CheckoutSummary({
    required this.shops,
    required this.itemCount,
    required this.productsSubtotal,
    required this.deliveryFeeTotal,
    required this.total,
    required this.address,
    required this.defaultRecipientName,
    required this.problems,
  });

  static CheckoutSummary fromJson(Object? json) {
    final map = json as Map<String, Object?>;
    final address = map['address'] as Map<String, Object?>?;
    return CheckoutSummary(
      shops: (map['shops'] as List)
          .map((shop) => CheckoutShop.fromJson(shop as Map<String, Object?>))
          .toList(growable: false),
      itemCount: map['itemCount'] as int,
      productsSubtotal: map['productsSubtotal'] as String,
      deliveryFeeTotal: map['deliveryFeeTotal'] as String?,
      total: map['total'] as String?,
      address: address == null ? null : CheckoutAddress.fromJson(address),
      defaultRecipientName: map['defaultRecipientName'] as String,
      problems: (map['problems'] as List)
          .map(
            (problem) =>
                CheckoutProblem.fromJson(problem as Map<String, Object?>),
          )
          .toList(growable: false),
    );
  }

  final List<CheckoutShop> shops;
  final int itemCount;
  final String productsSubtotal;
  final String? deliveryFeeTotal;

  /// The amount payable on delivery; `null` while a fee is missing.
  final String? total;
  final CheckoutAddress? address;
  final String defaultRecipientName;
  final List<CheckoutProblem> problems;

  /// Placement is offered only without problems, with an address, and with every fee.
  bool get canPlace =>
      problems.isEmpty &&
      address != null &&
      total != null &&
      shops.every((shop) => shop.deliveryFee != null);

  /// The placement body. `expected` repeats the figures the customer is shown,
  /// so the API refuses the order if any changed; it never stores them.
  Map<String, Object?>? placementBody(String recipientName) {
    final chosen = address;
    if (!canPlace || chosen == null) return null;
    return {
      'addressId': chosen.addressId,
      'recipientName': recipientName,
      'expected': {
        'total': total,
        'shops': [
          for (final shop in shops)
            {
              'shopId': shop.shopId,
              'productsSubtotal': shop.productsSubtotal,
              'deliveryFee': shop.deliveryFee,
            },
        ],
      },
    };
  }

  CheckoutShop? shop(String? id) {
    for (final shop in shops) {
      if (shop.shopId == id) return shop;
    }
    return null;
  }
}

enum CheckoutFailure {
  blocked,
  totalsChanged,
  cartEmpty,
  addressNotFound,
  invalid,
  rateLimited,
  unavailable,
  error;

  /// Only an unknown outcome keeps the attempt's key: retrying with it then
  /// returns the order if the first request created it.
  bool get keepsAttemptKey => this == unavailable;

  /// Something changed: the summary must be read again before another attempt.
  bool get needsFreshSummary =>
      const {blocked, totalsChanged, cartEmpty, addressNotFound}.contains(this);
}

const _failureByCode = {
  'CHECKOUT_BLOCKED': CheckoutFailure.blocked,
  'CHECKOUT_TOTALS_CHANGED': CheckoutFailure.totalsChanged,
  'CHECKOUT_CART_EMPTY': CheckoutFailure.cartEmpty,
  'ADDRESS_NOT_FOUND': CheckoutFailure.addressNotFound,
};

sealed class CheckoutOutcome<T> {
  const CheckoutOutcome();
}

final class CheckoutOk<T> extends CheckoutOutcome<T> {
  const CheckoutOk(this.data);
  final T data;
}

final class CheckoutSignedOut<T> extends CheckoutOutcome<T> {
  const CheckoutSignedOut();
}

final class CheckoutNotBootstrapped<T> extends CheckoutOutcome<T> {
  const CheckoutNotBootstrapped();
}

final class CheckoutFailed<T> extends CheckoutOutcome<T> {
  const CheckoutFailed(this.failure);
  final CheckoutFailure failure;
}

/// `201` creates the order; `200` returns the one an earlier attempt with the
/// same key created: both mean the order exists.
CheckoutOutcome<T> interpretCheckoutResult<T>(ApiResult<T> result) =>
    switch (result) {
      ApiOk<T>(:final data) => CheckoutOk(data),
      ApiUnauthorized<T>() => CheckoutSignedOut<T>(),
      ApiForbidden<T>() => CheckoutNotBootstrapped<T>(),
      ApiAuthUnavailable<T>() ||
      ApiNetworkError<T>() => CheckoutFailed<T>(CheckoutFailure.unavailable),
      ApiError<T>(statusCode: 429) => CheckoutFailed<T>(
        CheckoutFailure.rateLimited,
      ),
      ApiError<T>(statusCode: 503) => CheckoutFailed<T>(
        CheckoutFailure.unavailable,
      ),
      ApiError<T>(statusCode: 400) => CheckoutFailed<T>(
        CheckoutFailure.invalid,
      ),
      ApiError<T>(:final code) => CheckoutFailed<T>(
        _failureByCode[code] ?? CheckoutFailure.error,
      ),
    };

enum RecipientError { required, tooLong, invalid }

final _controlCharacters = RegExp(r'[\u0000-\u001f\u007f-\u009f]');

/// The API's rule (plain text, 1–100 characters after trimming). Unicode
/// normalization is left to the API, which applies NFC.
RecipientError? recipientError(String name) {
  final trimmed = name.trim();
  if (trimmed.isEmpty) return RecipientError.required;
  // UTF-16 units, as the API (zod) counts them.
  if (trimmed.length > recipientNameMaxLength) {
    return RecipientError.tooLong;
  }
  if (_controlCharacters.hasMatch(trimmed)) return RecipientError.invalid;
  return null;
}

/// A random (version 4) UUID, new for each attempt the customer starts.
String newIdempotencyKey([Random? random]) {
  final source = random ?? Random.secure();
  final bytes = List<int>.generate(16, (_) => source.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0'));
  final s = hex.join();
  return '${s.substring(0, 8)}-${s.substring(8, 12)}-${s.substring(12, 16)}-'
      '${s.substring(16, 20)}-${s.substring(20)}';
}
