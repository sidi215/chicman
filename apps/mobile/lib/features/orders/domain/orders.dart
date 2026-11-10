import 'package:flutter/foundation.dart';

import '../../../core/network/api_client.dart';

/// Customer orders (spec 11), matching the web's `order-logic.ts`. The API
/// decides every status, whether a shop order can be cancelled (`canCancel`),
/// and what the customer may see; these rules only choose what to show and
/// what to send. Seller order screens are web only (O1).
const customerOrdersPath = '/customers/me/orders';

String customerOrderPath(String orderId) =>
    '$customerOrdersPath/${Uri.encodeComponent(orderId)}';

String customerCancelPath(String orderId, String shopOrderId) =>
    '${customerOrderPath(orderId)}/shop-orders/${Uri.encodeComponent(shopOrderId)}/cancel';

String customerOrdersPagePath(int page) => '$customerOrdersPath?page=$page';

/// Shop order statuses (D4, D7). Delivery progress is not an order status.
enum ShopOrderStatus {
  pending('PENDING'),
  confirmed('CONFIRMED'),
  rejected('REJECTED'),
  cancelled('CANCELLED'),
  expired('EXPIRED'),
  delivered('DELIVERED'),
  failedDelivery('FAILED_DELIVERY');

  const ShopOrderStatus(this.apiValue);
  final String apiValue;

  static ShopOrderStatus fromApi(String value) => ShopOrderStatus.values
      .firstWhere((status) => status.apiValue == value, orElse: () => pending);
}

/// Labels of a shop order (spec 11, section 11), in the shared map's order.
enum ShopOrderLabel {
  awaitingShop('AWAITING_SHOP'),
  preparing('PREPARING'),
  readyForDelivery('READY_FOR_DELIVERY'),
  outForDelivery('OUT_FOR_DELIVERY'),
  deliveryFailedRetry('DELIVERY_FAILED_RETRY'),
  delivered('DELIVERED'),
  undeliverable('UNDELIVERABLE'),
  rejected('REJECTED'),
  cancelled('CANCELLED'),
  expired('EXPIRED');

  const ShopOrderLabel(this.apiValue);
  final String apiValue;

  static ShopOrderLabel fromApi(String value) =>
      ShopOrderLabel.values.firstWhere(
        (label) => label.apiValue == value,
        orElse: () => awaitingShop,
      );
}

/// Every reason code a customer can be shown (spec 11, section 6).
const shopOrderReasonCodes = [
  'OUT_OF_STOCK',
  'CANNOT_DELIVER_TO_AREA',
  'PRICE_ERROR',
  'OTHER',
  'CUSTOMER_REQUESTED',
  'SHOP_UNAVAILABLE',
];

/// The customer's own cancellation reasons (S2-4). Optional; `OTHER` needs a text.
enum CustomerCancellationReason {
  changedMind('CHANGED_MIND'),
  orderedByMistake('ORDERED_BY_MISTAKE'),
  other('OTHER');

  const CustomerCancellationReason(this.apiValue);
  final String apiValue;
}

/// What the customer sees of a decision: the seller's or system's reason,
/// or "Annulée par Chicman". Never the customer's own text.
@immutable
class ShopOrderDecision {
  const ShopOrderDecision({this.cancelledBy, this.reason});

  factory ShopOrderDecision.fromJson(Map<String, Object?>? json) =>
      ShopOrderDecision(
        cancelledBy: json?['cancelledBy'] as String?,
        reason: json?['reason'] as String?,
      );

  /// `CUSTOMER`, `SELLER`, `CHICMAN`, `SYSTEM`, or `null`.
  final String? cancelledBy;

  /// A code from [shopOrderReasonCodes], shown translated.
  final String? reason;

  bool get byChicman => cancelledBy == 'CHICMAN';
}

@immutable
class OrderItem {
  const OrderItem({
    required this.id,
    required this.productName,
    required this.size,
    required this.color,
    required this.imageUrl,
    required this.unitPrice,
    required this.quantity,
    required this.lineTotal,
  });

  factory OrderItem.fromJson(Map<String, Object?> json) => OrderItem(
    id: json['id'] as String,
    productName: json['productName'] as String,
    size: json['size'] as String?,
    color: json['color'] as String?,
    imageUrl: json['imageUrl'] as String?,
    unitPrice: json['unitPrice'] as String,
    quantity: json['quantity'] as int,
    lineTotal: json['lineTotal'] as String,
  );

  final String id;
  final String productName;
  final String? size;
  final String? color;

  /// The image at placement (S2-7); `null` shows the placeholder.
  final String? imageUrl;
  final String unitPrice;
  final int quantity;
  final String lineTotal;
}

@immutable
class OrderDelivery {
  const OrderDelivery({
    required this.recipientName,
    required this.deliveryPhone,
    required this.city,
    required this.district,
    required this.landmark,
  });

  factory OrderDelivery.fromJson(Map<String, Object?> json) => OrderDelivery(
    recipientName: json['recipientName'] as String,
    deliveryPhone: json['deliveryPhone'] as String,
    city: json['city'] as String,
    district: json['district'] as String,
    landmark: json['landmark'] as String,
  );

  final String recipientName;
  final String deliveryPhone;
  final String city;
  final String district;
  final String landmark;
}

/// Failure reasons of a delivery attempt (spec 12, D5), shown translated.
const deliveryFailureReasons = [
  'CUSTOMER_UNREACHABLE',
  'CUSTOMER_ABSENT',
  'CUSTOMER_REFUSED',
  'ADDRESS_NOT_FOUND',
  'CUSTOMER_COULD_NOT_PAY',
  'OTHER',
];

@immutable
class DeliveryFailure {
  const DeliveryFailure({
    required this.attemptNumber,
    required this.reason,
    required this.failedAt,
  });

  factory DeliveryFailure.fromJson(Map<String, Object?> json) =>
      DeliveryFailure(
        attemptNumber: json['attemptNumber'] as int,
        reason: json['reason'] as String,
        failedAt: DateTime.parse(json['failedAt'] as String),
      );

  final int attemptNumber;

  /// A code from [deliveryFailureReasons].
  final String reason;
  final DateTime failedAt;
}

/// What the customer sees of the delivery (spec 12, section 9): the current
/// dispatch, the number of attempts, each failure reason, and the delivered
/// time. Never the seller's internal data. Customers ask for a new attempt
/// by phone.
@immutable
class DeliveryProgress {
  const DeliveryProgress({
    required this.attemptsCount,
    this.currentAttemptDispatchedAt,
    this.failures = const [],
    this.deliveredAt,
  });

  factory DeliveryProgress.fromJson(Map<String, Object?> json) {
    final current = json['currentAttemptDispatchedAt'] as String?;
    final delivered = json['deliveredAt'] as String?;
    return DeliveryProgress(
      attemptsCount: json['attemptsCount'] as int,
      currentAttemptDispatchedAt: current == null
          ? null
          : DateTime.parse(current),
      failures: (json['failures'] as List? ?? const [])
          .map(
            (failure) =>
                DeliveryFailure.fromJson(failure as Map<String, Object?>),
          )
          .toList(growable: false),
      deliveredAt: delivered == null ? null : DateTime.parse(delivered),
    );
  }

  final int attemptsCount;
  final DateTime? currentAttemptDispatchedAt;
  final List<DeliveryFailure> failures;
  final DateTime? deliveredAt;

  /// Nothing to show before the first dispatch.
  bool get isVisible => attemptsCount > 0;
}

@immutable
class ShopOrder {
  const ShopOrder({
    required this.id,
    required this.status,
    required this.label,
    required this.respondBy,
    required this.shopName,
    required this.contactPhone,
    required this.whatsappPhone,
    required this.productsSubtotal,
    required this.deliveryFee,
    required this.amountDue,
    required this.paymentStatus,
    required this.delivery,
    required this.items,
    this.decision = const ShopOrderDecision(),
    this.canCancel = false,
    this.deliveryProgress,
  });

  factory ShopOrder.fromJson(Map<String, Object?> json) {
    final shop = json['shop'] as Map<String, Object?>;
    final payment = json['payment'] as Map<String, Object?>;
    final progress = json['deliveryProgress'] as Map<String, Object?>?;
    return ShopOrder(
      id: json['id'] as String,
      status: ShopOrderStatus.fromApi(json['status'] as String),
      label: ShopOrderLabel.fromApi(json['label'] as String),
      respondBy: DateTime.parse(json['respondBy'] as String),
      shopName: shop['name'] as String,
      contactPhone: shop['contactPhone'] as String,
      whatsappPhone: shop['whatsappPhone'] as String?,
      productsSubtotal: json['productsSubtotal'] as String,
      deliveryFee: json['deliveryFee'] as String,
      amountDue: payment['amountDue'] as String,
      paymentStatus: payment['status'] as String,
      delivery: OrderDelivery.fromJson(
        json['delivery'] as Map<String, Object?>,
      ),
      items: (json['items'] as List)
          .map((item) => OrderItem.fromJson(item as Map<String, Object?>))
          .toList(growable: false),
      decision: ShopOrderDecision.fromJson(
        json['decision'] as Map<String, Object?>?,
      ),
      // Decided by the API; anything else means "not cancellable".
      canCancel: json['canCancel'] == true,
      deliveryProgress: progress == null
          ? null
          : DeliveryProgress.fromJson(progress),
    );
  }

  final String id;
  final ShopOrderStatus status;
  final ShopOrderLabel label;
  final DateTime respondBy;
  final String shopName;

  /// The shop's phones at placement. Never labelled verified.
  final String contactPhone;
  final String? whatsappPhone;
  final String productsSubtotal;
  final String deliveryFee;

  /// Cash to pay this shop on delivery.
  final String amountDue;

  /// `PENDING`, `COLLECTED`, `FAILED`, or `CANCELLED` (spec 13).
  final String paymentStatus;
  final OrderDelivery delivery;
  final List<OrderItem> items;
  final ShopOrderDecision decision;
  final bool canCancel;

  /// `null` until the seller confirms (spec 12).
  final DeliveryProgress? deliveryProgress;

  /// A failed attempt the customer can ask the shop, by phone, to retry.
  bool get showsRetryByPhone => label == ShopOrderLabel.deliveryFailedRetry;

  /// Returns and exchanges are arranged with the shop (D10).
  bool get showsReturnsNotice => status == ShopOrderStatus.delivered;

  /// Shown until the seller answers.
  bool get showsDeadline => status == ShopOrderStatus.pending;
}

@immutable
class CustomerOrder {
  const CustomerOrder({
    required this.id,
    required this.reference,
    required this.deliveryFeeTotal,
    required this.total,
    required this.shopOrders,
    this.createdAt,
  });

  static CustomerOrder fromJson(Object? json) {
    final map = json as Map<String, Object?>;
    final createdAt = map['createdAt'] as String?;
    return CustomerOrder(
      id: map['id'] as String,
      reference: map['reference'] as String,
      createdAt: createdAt == null ? null : DateTime.parse(createdAt),
      deliveryFeeTotal: map['deliveryFeeTotal'] as String,
      total: map['total'] as String,
      shopOrders: (map['shopOrders'] as List)
          .map((order) => ShopOrder.fromJson(order as Map<String, Object?>))
          .toList(growable: false),
    );
  }

  final String id;
  final String reference;
  final DateTime? createdAt;
  final String deliveryFeeTotal;
  final String total;
  final List<ShopOrder> shopOrders;
}

/// One row of the order list: the reference and each shop's label.
@immutable
class OrderSummary {
  const OrderSummary({
    required this.id,
    required this.reference,
    required this.createdAt,
    required this.total,
    required this.itemsCount,
    required this.shops,
  });

  factory OrderSummary.fromJson(Map<String, Object?> json) => OrderSummary(
    id: json['id'] as String,
    reference: json['reference'] as String,
    createdAt: DateTime.parse(json['createdAt'] as String),
    total: json['total'] as String,
    itemsCount: json['itemsCount'] as int,
    shops: (json['shopOrders'] as List)
        .map((shop) {
          final map = shop as Map<String, Object?>;
          return (
            name: map['shopName'] as String,
            label: ShopOrderLabel.fromApi(map['label'] as String),
          );
        })
        .toList(growable: false),
  );

  final String id;
  final String reference;
  final DateTime createdAt;
  final String total;
  final int itemsCount;
  final List<({String name, ShopOrderLabel label})> shops;
}

@immutable
class OrderPage {
  const OrderPage({
    required this.orders,
    required this.page,
    required this.pageSize,
    required this.total,
  });

  static OrderPage fromJson(Object? json) {
    final map = json as Map<String, Object?>;
    return OrderPage(
      orders: (map['orders'] as List)
          .map((order) => OrderSummary.fromJson(order as Map<String, Object?>))
          .toList(growable: false),
      page: map['page'] as int,
      pageSize: map['pageSize'] as int,
      total: map['total'] as int,
    );
  }

  final List<OrderSummary> orders;
  final int page;
  final int pageSize;
  final int total;

  bool get hasMore => page * pageSize < total;
}

enum OrderFailure {
  notFound,
  conflict,
  expired,
  invalid,
  rateLimited,
  unavailable,
  error;

  /// The shown state is out of date: read it again.
  bool get needsReload => this == conflict || this == expired;
}

const _failureByCode = {
  'ORDER_NOT_FOUND': OrderFailure.notFound,
  'SHOP_ORDER_NOT_FOUND': OrderFailure.notFound,
  'SHOP_ORDER_STATUS_CONFLICT': OrderFailure.conflict,
  'SHOP_ORDER_EXPIRED': OrderFailure.expired,
};

sealed class OrderOutcome<T> {
  const OrderOutcome();
}

final class OrderOk<T> extends OrderOutcome<T> {
  const OrderOk(this.data);
  final T data;
}

final class OrderSignedOut<T> extends OrderOutcome<T> {
  const OrderSignedOut();
}

final class OrderNotBootstrapped<T> extends OrderOutcome<T> {
  const OrderNotBootstrapped();
}

final class OrderFailed<T> extends OrderOutcome<T> {
  const OrderFailed(this.failure);
  final OrderFailure failure;
}

OrderOutcome<T> interpretOrderResult<T>(ApiResult<T> result) =>
    switch (result) {
      ApiOk<T>(:final data) => OrderOk(data),
      ApiUnauthorized<T>() => OrderSignedOut<T>(),
      ApiForbidden<T>() => OrderNotBootstrapped<T>(),
      ApiAuthUnavailable<T>() ||
      ApiNetworkError<T>() => OrderFailed<T>(OrderFailure.unavailable),
      ApiError<T>(statusCode: 429) => OrderFailed<T>(OrderFailure.rateLimited),
      ApiError<T>(statusCode: 503) => OrderFailed<T>(OrderFailure.unavailable),
      ApiError<T>(statusCode: 400) => OrderFailed<T>(OrderFailure.invalid),
      ApiError<T>(:final code) => OrderFailed<T>(
        _failureByCode[code] ?? OrderFailure.error,
      ),
    };

enum CancellationTextError { required, tooShort, tooLong, invalid }

const cancellationTextMinLength = 3;
const cancellationTextMaxLength = 200;
final _controlCharacters = RegExp(r'[\u0000-\u001f\u007f-\u009f]');

/// The API's rule for the `OTHER` explanation: plain text, 3–200 characters
/// after trimming. Unicode normalization is left to the API (NFC).
CancellationTextError? cancellationTextError(String text) {
  final trimmed = text.trim();
  if (trimmed.isEmpty) return CancellationTextError.required;
  // UTF-16 units, as the API (zod) counts them.
  if (trimmed.length < cancellationTextMinLength) {
    return CancellationTextError.tooShort;
  }
  if (trimmed.length > cancellationTextMaxLength) {
    return CancellationTextError.tooLong;
  }
  if (_controlCharacters.hasMatch(trimmed)) {
    return CancellationTextError.invalid;
  }
  return null;
}

/// The cancellation body: no reason, a reason, or `OTHER` with its text.
Map<String, Object?> cancellationBody(
  CustomerCancellationReason? reason,
  String text,
) => switch (reason) {
  null => const {},
  CustomerCancellationReason.other => {
    'reason': reason.apiValue,
    'reasonText': text.trim(),
  },
  _ => {'reason': reason.apiValue},
};
