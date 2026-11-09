import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_providers.dart';
import '../domain/cart.dart';

enum CartViewKind { loading, guest, needsSetup, ready, failed }

@immutable
class CartView {
  const CartView(this.kind, {this.cart, this.failure});

  const CartView.ready(Cart this.cart)
    : kind = CartViewKind.ready,
      failure = null;

  final CartViewKind kind;
  final Cart? cart;
  final CartFailure? failure;

  /// Units across all lines; `0` until a cart is known.
  int get itemCount => cart?.itemCount ?? 0;
}

/// The signed-in customer's cart, for the app bar and the cart screen. Every
/// change shows the cart the API returns, and a refused change reads it again,
/// since a refusal usually means the product changed since it was shown.
class CartController extends Notifier<CartView> {
  /// Answers to an older request are dropped.
  int _generation = 0;

  @override
  CartView build() {
    // The account, not the session object: a refreshed token changes nothing.
    final session = ref.watch(
      authSessionProvider.select(
        (session) => (session.isLoading, session.value?.userId),
      ),
    );
    _generation += 1;
    final (loading, userId) = session;
    if (loading) return const CartView(CartViewKind.loading);
    if (userId == null) return const CartView(CartViewKind.guest);
    // Starting from `loading` means one account's cart never shows for the next.
    Future.microtask(reload);
    return const CartView(CartViewKind.loading);
  }

  /// Reads the cart again, so the server recalculates it.
  Future<void> reload() async {
    final generation = _generation;
    final outcome = await _send('GET', cartPath);
    if (ref.mounted && generation == _generation) _show(outcome);
  }

  Future<CartFailure?> add(String productId, String? variantId) =>
      _change('POST', '$cartPath/items', addItemBody(productId, variantId, 1));

  Future<CartFailure?> setQuantity(String itemId, int quantity) =>
      _change('PATCH', cartItemPath(itemId), {'quantity': quantity});

  /// The price shown is only compared with the current one by the API.
  Future<CartFailure?> acceptPrice(String itemId, String price) =>
      _change('POST', '${cartItemPath(itemId)}/accept-price', {'price': price});

  Future<CartFailure?> remove(String itemId) =>
      _change('DELETE', cartItemPath(itemId));

  /// Resolves to `null`, or the failure to show the customer.
  Future<CartFailure?> _change(
    String method,
    String path, [
    Map<String, Object?>? body,
  ]) async {
    final generation = _generation;
    bool stale() => !ref.mounted || generation != _generation;

    final outcome = await _send(method, path, body);
    // The account changed: this answer belongs to the previous one.
    if (stale()) return null;
    if (outcome case CartFailed(:final failure)) {
      // The change was refused, but what is on screen may still be valid.
      final current = await _send('GET', cartPath);
      if (stale()) return null;
      if (current is CartLoaded) _show(current);
      return failure;
    }
    _show(outcome);
    // Otherwise the session or the account is the problem, which now shows.
    return outcome is CartLoaded ? null : CartFailure.error;
  }

  Future<CartOutcome> _send(
    String method,
    String path, [
    Map<String, Object?>? body,
  ]) async {
    final repository = ref.read(authRepositoryProvider);
    final token = await repository?.accessToken();
    if (repository == null || token == null) return const CartSignedOut();
    final outcome = interpretCartResult(
      await ref
          .read(apiClientProvider)
          .send(
            method,
            path,
            accessToken: token,
            body: body,
            decode: Cart.fromJson,
          ),
    );
    if (outcome is CartSignedOut) await repository.signOut();
    return outcome;
  }

  void _show(CartOutcome outcome) {
    state = switch (outcome) {
      CartLoaded(:final cart) => CartView.ready(cart),
      CartSignedOut() => const CartView(CartViewKind.guest),
      CartNotBootstrapped() => const CartView(CartViewKind.needsSetup),
      CartFailed(:final failure) => CartView(
        CartViewKind.failed,
        failure: failure,
      ),
    };
  }
}

final cartProvider = NotifierProvider<CartController, CartView>(
  CartController.new,
);
