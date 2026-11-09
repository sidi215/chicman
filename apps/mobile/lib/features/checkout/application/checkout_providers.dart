import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_providers.dart';
import '../../cart/application/cart_providers.dart';
import '../domain/checkout.dart';

enum CheckoutViewKind { loading, guest, needsSetup, failed, ready, placed }

@immutable
class CheckoutView {
  const CheckoutView(
    this.kind, {
    this.summary,
    this.order,
    this.failure,
    this.placing = false,
  });

  final CheckoutViewKind kind;
  final CheckoutSummary? summary;
  final CustomerOrder? order;

  /// Why the summary could not be read, or why the last placement was refused.
  final CheckoutFailure? failure;
  final bool placing;
}

/// Checkout for the signed-in customer (spec 10). Every figure and problem
/// comes from the API. Answers to requests made for a previous account are
/// dropped, as in `CartController`.
class CheckoutController extends Notifier<CheckoutView> {
  /// Moves on when the account changes; older answers are dropped.
  int _generation = 0;

  /// The chosen address; `null` uses the default one.
  String? _addressId;

  /// One key per attempt the customer starts, kept only while its outcome is unknown.
  String? _attemptKey;

  /// Generates the attempt key. Replaceable in tests.
  @visibleForTesting
  static String Function() keyFactory = newIdempotencyKey;

  @override
  CheckoutView build() {
    final session = ref.watch(
      authSessionProvider.select(
        (session) => (session.isLoading, session.value?.userId),
      ),
    );
    _generation += 1;
    _addressId = null;
    _attemptKey = null;
    final (loading, userId) = session;
    if (loading) return const CheckoutView(CheckoutViewKind.loading);
    if (userId == null) return const CheckoutView(CheckoutViewKind.guest);
    Future.microtask(reload);
    return const CheckoutView(CheckoutViewKind.loading);
  }

  /// Reads the summary again, for the chosen address.
  Future<void> reload() async {
    final generation = _generation;
    final address = _addressId;
    final outcome = await _send(
      'GET',
      checkoutSummaryPath(address),
      CheckoutSummary.fromJson,
    );
    if (!ref.mounted || generation != _generation) return;
    // A chosen address that no longer exists falls back to the default one.
    if (outcome case CheckoutFailed(
      failure: CheckoutFailure.addressNotFound,
    ) when address != null) {
      _addressId = null;
      return reload();
    }
    state = switch (outcome) {
      CheckoutOk(:final data) => CheckoutView(
        CheckoutViewKind.ready,
        summary: data,
      ),
      CheckoutSignedOut() => const CheckoutView(CheckoutViewKind.guest),
      CheckoutNotBootstrapped() => const CheckoutView(
        CheckoutViewKind.needsSetup,
      ),
      CheckoutFailed(:final failure) => CheckoutView(
        CheckoutViewKind.failed,
        failure: failure,
      ),
    };
  }

  /// The customer chose an address in the address list's selection mode.
  Future<void> chooseAddress(String addressId) {
    _addressId = addressId;
    return reload();
  }

  /// Places the order. Resolves once the answer is shown.
  Future<void> place(String recipientName) async {
    final current = state;
    final summary = current.summary;
    if (current.kind != CheckoutViewKind.ready ||
        current.placing ||
        summary == null) {
      return;
    }
    final body = summary.placementBody(recipientName);
    if (body == null) return;
    final generation = _generation;
    final key = _attemptKey ??= keyFactory();
    state = CheckoutView(
      CheckoutViewKind.ready,
      summary: summary,
      placing: true,
    );

    final outcome = await _send(
      'POST',
      checkoutPath,
      CustomerOrder.fromJson,
      body: body,
      headers: {idempotencyKeyHeader: key},
    );
    if (!ref.mounted || generation != _generation) return;
    switch (outcome) {
      case CheckoutOk(:final data):
        _attemptKey = null;
        state = CheckoutView(CheckoutViewKind.placed, order: data);
        // The ordered lines are gone: the app bar count follows the server.
        await ref.read(cartProvider.notifier).reload();
      case CheckoutSignedOut():
        state = const CheckoutView(CheckoutViewKind.guest);
      case CheckoutNotBootstrapped():
        state = const CheckoutView(CheckoutViewKind.needsSetup);
      case CheckoutFailed(:final failure):
        if (!failure.keepsAttemptKey) _attemptKey = null;
        if (failure == CheckoutFailure.addressNotFound) _addressId = null;
        if (failure.needsFreshSummary) {
          await reload();
          if (!ref.mounted || generation != _generation) return;
          // The fresh read failed or the session ended: that is what shows.
          if (state.kind != CheckoutViewKind.ready) return;
        }
        state = CheckoutView(
          CheckoutViewKind.ready,
          summary: state.summary ?? summary,
          failure: failure,
        );
    }
  }

  Future<CheckoutOutcome<T>> _send<T>(
    String method,
    String path,
    T Function(Object? json) decode, {
    Map<String, Object?>? body,
    Map<String, String> headers = const {},
  }) async {
    final repository = ref.read(authRepositoryProvider);
    final token = await repository?.accessToken();
    if (repository == null || token == null) return CheckoutSignedOut<T>();
    final outcome = interpretCheckoutResult(
      await ref
          .read(apiClientProvider)
          .send(
            method,
            path,
            accessToken: token,
            body: body,
            headers: headers,
            decode: decode,
          ),
    );
    if (outcome is CheckoutSignedOut<T>) await repository.signOut();
    return outcome;
  }
}

final checkoutProvider =
    NotifierProvider.autoDispose<CheckoutController, CheckoutView>(
      CheckoutController.new,
    );
