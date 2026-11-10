import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_providers.dart';
import '../domain/orders.dart';

enum OrderViewKind { loading, guest, needsSetup, failed, ready }

@immutable
class OrderListView {
  const OrderListView(
    this.kind, {
    this.orders = const [],
    this.hasMore = false,
    this.loadingMore = false,
    this.failure,
  });

  final OrderViewKind kind;
  final List<OrderSummary> orders;
  final bool hasMore;
  final bool loadingMore;
  final OrderFailure? failure;
}

@immutable
class OrderDetailView {
  const OrderDetailView(
    this.kind, {
    this.order,
    this.failure,
    this.cancelling,
    this.notice,
  });

  final OrderViewKind kind;
  final CustomerOrder? order;

  /// Why the order could not be read, or why the last cancellation was refused.
  final OrderFailure? failure;

  /// The shop order whose cancellation is in flight.
  final String? cancelling;

  /// Set once a cancellation succeeded.
  final bool? notice;
}

/// Sends a request for the signed-in customer; a session the API refuses ends here.
Future<OrderOutcome<T>> _send<T>(
  Ref ref,
  String method,
  String path,
  T Function(Object? json) decode, {
  Map<String, Object?>? body,
}) async {
  final repository = ref.read(authRepositoryProvider);
  final token = await repository?.accessToken();
  if (repository == null || token == null) return OrderSignedOut<T>();
  final outcome = interpretOrderResult(
    await ref
        .read(apiClientProvider)
        .send(method, path, accessToken: token, body: body, decode: decode),
  );
  if (outcome is OrderSignedOut<T>) await repository.signOut();
  return outcome;
}

/// The account, not the session object: a refreshed token changes nothing.
(bool, String?) _watchAccount(Ref ref) => ref.watch(
  authSessionProvider.select(
    (session) => (session.isLoading, session.value?.userId),
  ),
);

/// The customer's orders, newest first (spec 11). Answers to requests made
/// for a previous account are dropped, as in `CartController`.
class OrderListController extends Notifier<OrderListView> {
  int _generation = 0;
  int _page = 0;

  @override
  OrderListView build() {
    final (loading, userId) = _watchAccount(ref);
    _generation += 1;
    _page = 0;
    if (loading) return const OrderListView(OrderViewKind.loading);
    if (userId == null) return const OrderListView(OrderViewKind.guest);
    Future.microtask(reload);
    return const OrderListView(OrderViewKind.loading);
  }

  /// Reads the first page again.
  Future<void> reload() async {
    final generation = _generation;
    final outcome = await _send(
      ref,
      'GET',
      customerOrdersPagePath(1),
      OrderPage.fromJson,
    );
    if (!ref.mounted || generation != _generation) return;
    state = switch (outcome) {
      OrderOk(:final data) => () {
        _page = 1;
        return OrderListView(
          OrderViewKind.ready,
          orders: data.orders,
          hasMore: data.hasMore,
        );
      }(),
      OrderSignedOut() => const OrderListView(OrderViewKind.guest),
      OrderNotBootstrapped() => const OrderListView(OrderViewKind.needsSetup),
      OrderFailed(:final failure) => OrderListView(
        OrderViewKind.failed,
        failure: failure,
      ),
    };
  }

  /// Appends the next page.
  Future<void> loadMore() async {
    final current = state;
    if (current.kind != OrderViewKind.ready ||
        !current.hasMore ||
        current.loadingMore) {
      return;
    }
    final generation = _generation;
    state = OrderListView(
      OrderViewKind.ready,
      orders: current.orders,
      hasMore: true,
      loadingMore: true,
    );
    final outcome = await _send(
      ref,
      'GET',
      customerOrdersPagePath(_page + 1),
      OrderPage.fromJson,
    );
    if (!ref.mounted || generation != _generation) return;
    if (outcome case OrderOk(:final data)) {
      _page += 1;
      final known = {for (final order in current.orders) order.id};
      state = OrderListView(
        OrderViewKind.ready,
        orders: [
          ...current.orders,
          ...data.orders.where((order) => !known.contains(order.id)),
        ],
        hasMore: data.hasMore,
      );
    } else {
      state = OrderListView(
        OrderViewKind.ready,
        orders: current.orders,
        hasMore: true,
      );
    }
  }
}

final orderListProvider =
    NotifierProvider.autoDispose<OrderListController, OrderListView>(
      OrderListController.new,
    );

/// One order of the customer's, and the cancellation of a pending shop order.
class OrderDetailController extends Notifier<OrderDetailView> {
  OrderDetailController(this.orderId);

  final String orderId;
  int _generation = 0;

  @override
  OrderDetailView build() {
    final (loading, userId) = _watchAccount(ref);
    _generation += 1;
    if (loading) return const OrderDetailView(OrderViewKind.loading);
    if (userId == null) return const OrderDetailView(OrderViewKind.guest);
    Future.microtask(reload);
    return const OrderDetailView(OrderViewKind.loading);
  }

  Future<void> reload() async {
    final generation = _generation;
    final outcome = await _send(
      ref,
      'GET',
      customerOrderPath(orderId),
      CustomerOrder.fromJson,
    );
    if (!ref.mounted || generation != _generation) return;
    state = _viewOf(outcome, state.failure);
  }

  OrderDetailView _viewOf(
    OrderOutcome<CustomerOrder> outcome, [
    OrderFailure? keptFailure,
  ]) => switch (outcome) {
    OrderOk(:final data) => OrderDetailView(
      OrderViewKind.ready,
      order: data,
      failure: keptFailure,
    ),
    OrderSignedOut() => const OrderDetailView(OrderViewKind.guest),
    OrderNotBootstrapped() => const OrderDetailView(OrderViewKind.needsSetup),
    OrderFailed(:final failure) => OrderDetailView(
      OrderViewKind.failed,
      failure: failure,
    ),
  };

  /// Cancels one pending shop order. Returns `true` once it is cancelled.
  Future<bool> cancel(String shopOrderId, Map<String, Object?> body) async {
    final current = state;
    final order = current.order;
    if (current.kind != OrderViewKind.ready ||
        order == null ||
        current.cancelling != null) {
      return false;
    }
    final generation = _generation;
    state = OrderDetailView(
      OrderViewKind.ready,
      order: order,
      cancelling: shopOrderId,
    );
    final outcome = await _send(
      ref,
      'POST',
      customerCancelPath(orderId, shopOrderId),
      CustomerOrder.fromJson,
      body: body,
    );
    if (!ref.mounted || generation != _generation) return false;
    switch (outcome) {
      case OrderOk(:final data):
        state = OrderDetailView(OrderViewKind.ready, order: data, notice: true);
        return true;
      case OrderFailed(:final failure):
        state = OrderDetailView(
          OrderViewKind.ready,
          order: order,
          failure: failure,
        );
        // The order changed meanwhile: show its current state with the message.
        if (failure.needsReload) await reload();
        return false;
      default:
        state = _viewOf(outcome);
        return false;
    }
  }
}

final orderDetailProvider = NotifierProvider.autoDispose
    .family<OrderDetailController, OrderDetailView, String>(
      OrderDetailController.new,
    );
