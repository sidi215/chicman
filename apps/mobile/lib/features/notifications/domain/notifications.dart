import 'package:flutter/foundation.dart';

import '../../../core/network/api_client.dart';

/// Client side of notifications (spec 15), matching the web's
/// `notifications-logic.ts`. The API decides the recipient, the audience, and
/// the resource; the app only renders the payload's codes and names and opens
/// the customer order, whose own screen checks access again.
///
/// Seller notifications are web only (O6.2, following O1): every request is
/// narrowed to the customer order notifications (`audience=CUSTOMER`). In-app
/// only: nothing is pushed to the device.
const notificationsPath = '/customers/me/notifications';
const _customerScope = 'audience=CUSTOMER';

String notificationListPath(String? cursor) => cursor == null
    ? '$notificationsPath?$_customerScope'
    : '$notificationsPath?$_customerScope&cursor=${Uri.encodeQueryComponent(cursor)}';

const unreadCountPath = '$notificationsPath/unread-count?$_customerScope';
const readAllPath = '$notificationsPath/read-all?$_customerScope';

String markReadPath(String id) =>
    '$notificationsPath/${Uri.encodeComponent(id)}/read';

@immutable
class NotificationItem {
  const NotificationItem({
    required this.id,
    required this.type,
    required this.payload,
    required this.orderId,
    required this.createdAt,
    required this.readAt,
  });

  factory NotificationItem.fromJson(Map<String, Object?> json) {
    final resource = json['resource'] as Map<String, Object?>? ?? const {};
    final opensOrder =
        json['audience'] == 'CUSTOMER' && resource['type'] == 'SHOP_ORDER';
    final readAt = json['readAt'] as String?;
    return NotificationItem(
      id: json['id'] as String,
      type: json['type'] as String,
      payload: Map<String, Object?>.unmodifiable(
        json['payload'] as Map<String, Object?>? ?? const {},
      ),
      // Only a customer shop order opens from the app.
      orderId: opensOrder ? resource['orderId'] as String? : null,
      createdAt: DateTime.parse(json['createdAt'] as String),
      readAt: readAt == null ? null : DateTime.parse(readAt),
    );
  }

  final String id;

  /// Kept as sent, so a type from a newer API still lists (generically).
  final String type;

  /// Codes, names, and figures only; rendered by `NotificationMessages`.
  final Map<String, Object?> payload;

  /// The customer order this notification opens, if any.
  final String? orderId;
  final DateTime createdAt;
  final DateTime? readAt;

  bool get isUnread => readAt == null;

  String? text(String key) => payload[key] as String?;

  NotificationItem markedRead(DateTime at) => isUnread
      ? NotificationItem(
          id: id,
          type: type,
          payload: payload,
          orderId: orderId,
          createdAt: createdAt,
          readAt: at,
        )
      : this;
}

@immutable
class NotificationPage {
  const NotificationPage(this.items, this.nextCursor);

  factory NotificationPage.fromJson(Object? json) {
    final map = json! as Map<String, Object?>;
    return NotificationPage(
      (map['items'] as List)
          .map(
            (item) => NotificationItem.fromJson(item as Map<String, Object?>),
          )
          .toList(growable: false),
      map['nextCursor'] as String?,
    );
  }

  /// Newest first, as the API sends them.
  final List<NotificationItem> items;

  /// `null` on the last page.
  final String? nextCursor;
}

int decodeUnreadCount(Object? json) =>
    (json! as Map<String, Object?>)['unread']! as int;

/// The decoder of `204 No Content` answers.
void decodeNothing(Object? _) {}

/// The count on the bell, capped so it fits the badge.
String unreadBadge(int count) => count > 99 ? '99+' : '$count';

/// Appends a further page, keeping each notification once.
List<NotificationItem> appendPage(
  List<NotificationItem> current,
  List<NotificationItem> next,
) {
  final seen = {for (final item in current) item.id};
  return [
    ...current,
    for (final item in next)
      if (!seen.contains(item.id)) item,
  ];
}

enum NotificationFailure { rateLimited, unavailable, error }

sealed class NotificationOutcome<T> {
  const NotificationOutcome();
}

final class NotificationOk<T> extends NotificationOutcome<T> {
  const NotificationOk(this.data);
  final T data;
}

final class NotificationSignedOut<T> extends NotificationOutcome<T> {
  const NotificationSignedOut();
}

/// A valid token without account setup.
final class NotificationNotBootstrapped<T> extends NotificationOutcome<T> {
  const NotificationNotBootstrapped();
}

/// The notification is not this user's (or is gone).
final class NotificationNotFound<T> extends NotificationOutcome<T> {
  const NotificationNotFound();
}

final class NotificationFailed<T> extends NotificationOutcome<T> {
  const NotificationFailed(this.failure);
  final NotificationFailure failure;
}

NotificationOutcome<T> interpretNotificationResult<T>(ApiResult<T> result) =>
    switch (result) {
      ApiOk<T>(:final data) => NotificationOk<T>(data),
      ApiUnauthorized<T>() => NotificationSignedOut<T>(),
      ApiForbidden<T>() => NotificationNotBootstrapped<T>(),
      ApiAuthUnavailable<T>() || ApiNetworkError<T>() => NotificationFailed<T>(
        NotificationFailure.unavailable,
      ),
      ApiError<T>(statusCode: 404) => NotificationNotFound<T>(),
      ApiError<T>(statusCode: 429) => NotificationFailed<T>(
        NotificationFailure.rateLimited,
      ),
      ApiError<T>(statusCode: 503) => NotificationFailed<T>(
        NotificationFailure.unavailable,
      ),
      ApiError<T>() => NotificationFailed<T>(NotificationFailure.error),
    };
