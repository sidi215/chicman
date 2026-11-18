import 'package:flutter/widgets.dart' show StringCharacters;

import '../../addresses/domain/address.dart';
import '../../orders/domain/orders.dart';

/// Buyer dashboard (same rules as the web, `features/buyer/buyer-dashboard.ts`):
/// picks from what the existing APIs return; nothing is worked out here.

/// The default address; the list puts it first, but the flag decides.
CustomerAddress? defaultAddress(List<CustomerAddress> addresses) {
  for (final address in addresses) {
    if (address.isDefault) return address;
  }
  return null;
}

/// One line for an address: its label when given, then the district and city.
String addressLine(CustomerAddress address) {
  final place = '${address.district}, ${address.city}';
  final label = address.label?.trim() ?? '';
  return label.isEmpty ? place : '$label · $place';
}

/// Shop orders still moving: waiting for the shop, or confirmed and not
/// finished (the web counts `PENDING` and `CONFIRMED`).
const _openLabels = {
  ShopOrderLabel.awaitingShop,
  ShopOrderLabel.preparing,
  ShopOrderLabel.readyForDelivery,
  ShopOrderLabel.outForDelivery,
  ShopOrderLabel.deliveryFailedRetry,
};

int openShopOrderCount(List<OrderSummary> orders) => orders.fold(
  0,
  (total, order) =>
      total +
      order.shops.where((shop) => _openLabels.contains(shop.label)).length,
);

/// The first name for the greeting, or null without a name.
String? greetingName(String? fullName) {
  final parts = (fullName ?? '').trim().split(RegExp(r'\s+'));
  return parts.first.isEmpty ? null : parts.first;
}

/// Up to two initials for the account avatar (first and last name), or null
/// without a name. Works for Arabic names too (first letter of each part).
String? initialsOf(String? fullName) {
  final parts = (fullName ?? '')
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .toList();
  if (parts.isEmpty) return null;
  final first = parts.first.characters.first;
  final last = parts.length > 1 ? parts.last.characters.first : '';
  return '$first$last'.toUpperCase();
}

/// A count as shown on a menu badge: `99+` beyond 99.
String countBadge(int count) => count > 99 ? '99+' : '$count';
