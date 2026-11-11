import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_providers.dart';
import '../domain/favorites.dart';

enum FavoritesViewKind { loading, guest, needsSetup, ready, failed }

@immutable
class FavoritesView {
  const FavoritesView(
    this.kind, {
    this.list,
    this.failure,
    this.pending = const {},
  });

  final FavoritesViewKind kind;
  final FavoriteList? list;
  final FavoriteFailure? failure;

  /// Products whose change is in flight, so their heart can wait.
  final Set<String> pending;

  /// Empty until the list is known.
  Set<String> get productIds => list?.productIds ?? const {};

  FavoritesView withPending(Set<String> pending) =>
      FavoritesView(kind, list: list, failure: failure, pending: pending);
}

/// The signed-in customer's favorites, for the hearts and the favorites
/// screen, held the same way as the cart (`CartController`): every change shows
/// the list the API returns, and answers meant for a previous account are
/// dropped.
///
/// Every request that answers with the list (reads, adds, removes) runs one
/// at a time, in the order asked. Each answer is then the server's latest
/// list, so a slow earlier answer can never replace a newer one.
class FavoritesController extends Notifier<FavoritesView> {
  /// The account: answers to an older one are dropped.
  int _generation = 0;

  /// The end of this account's request queue.
  Future<void> _queue = Future<void>.value();

  @override
  FavoritesView build() {
    // The account, not the session object: a refreshed token changes nothing.
    final session = ref.watch(
      authSessionProvider.select(
        (session) => (session.isLoading, session.value?.userId),
      ),
    );
    _generation += 1;
    // A new account never waits behind the previous one's requests.
    _queue = Future<void>.value();
    final (loading, userId) = session;
    if (loading) return const FavoritesView(FavoritesViewKind.loading);
    if (userId == null) return const FavoritesView(FavoritesViewKind.guest);
    // Starting from `loading` means one account's list never shows for the next.
    Future.microtask(reload);
    return const FavoritesView(FavoritesViewKind.loading);
  }

  /// Reads the list again, so current prices and availability show.
  Future<void> reload() async {
    final generation = _generation;
    final outcome = await _queued('GET', favoritesPath);
    if (ref.mounted && generation == _generation) _show(outcome);
  }

  Future<FavoriteFailure?> add(String productId) => _change(productId, 'PUT');

  Future<FavoriteFailure?> remove(String productId) =>
      _change(productId, 'DELETE');

  Future<FavoriteFailure?> toggle(String productId) =>
      state.productIds.contains(productId) ? remove(productId) : add(productId);

  /// Resolves to `null`, or the failure to show the customer.
  Future<FavoriteFailure?> _change(String productId, String method) async {
    final generation = _generation;
    bool stale() => !ref.mounted || generation != _generation;

    state = state.withPending({...state.pending, productId});
    final outcome = await _queued(method, favoritePath(productId));
    if (stale()) return null;
    state = state.withPending({...state.pending}..remove(productId));
    // A refused change leaves the list on screen as it was.
    if (outcome case FavoritesFailed(:final failure)) return failure;
    _show(outcome);
    // Otherwise the session or the account is the problem, which now shows.
    return outcome is FavoritesLoaded ? null : FavoriteFailure.error;
  }

  /// Sends the request after every request queued before it, whether they
  /// succeeded or not. It belongs to the account it was asked for: if that
  /// account is gone when its turn comes, it is dropped unsent, so it can never
  /// run with the next account's token. Callers drop the answer as stale.
  Future<FavoriteOutcome> _queued(String method, String path) {
    final generation = _generation;
    final result = _queue.then<FavoriteOutcome>((_) {
      if (!ref.mounted || generation != _generation) {
        return const FavoritesSignedOut();
      }
      return _send(method, path, generation);
    });
    _queue = result.then<void>((_) {}, onError: (Object _) {});
    return result;
  }

  Future<FavoriteOutcome> _send(
    String method,
    String path,
    int generation,
  ) async {
    final repository = ref.read(authRepositoryProvider);
    final token = await repository?.accessToken();
    if (repository == null || token == null) return const FavoritesSignedOut();
    final outcome = interpretFavoriteResult(
      await ref
          .read(apiClientProvider)
          .send(
            method,
            path,
            accessToken: token,
            decode: FavoriteList.fromJson,
          ),
    );
    // Only the account that made the request may be signed out by its answer:
    // a late `401` for a previous account must not end the current session.
    if (outcome is FavoritesSignedOut &&
        ref.mounted &&
        generation == _generation) {
      await repository.signOut();
    }
    return outcome;
  }

  void _show(FavoriteOutcome outcome) {
    final pending = state.pending;
    state = switch (outcome) {
      FavoritesLoaded(:final list) => FavoritesView(
        FavoritesViewKind.ready,
        list: list,
        pending: pending,
      ),
      FavoritesSignedOut() => const FavoritesView(FavoritesViewKind.guest),
      FavoritesNotBootstrapped() => const FavoritesView(
        FavoritesViewKind.needsSetup,
      ),
      FavoritesFailed(:final failure) => FavoritesView(
        FavoritesViewKind.failed,
        failure: failure,
      ),
    };
  }
}

final favoritesProvider = NotifierProvider<FavoritesController, FavoritesView>(
  FavoritesController.new,
);
