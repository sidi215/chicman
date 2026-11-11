import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/application/auth_providers.dart';
import '../domain/notifications.dart';

enum NotificationsViewKind { loading, guest, needsSetup, ready, failed }

@immutable
class NotificationsView {
  const NotificationsView(
    this.kind, {
    this.items = const [],
    this.nextCursor,
    this.loadingMore = false,
    this.unread = 0,
    this.failure,
    this.actionFailure,
  });

  final NotificationsViewKind kind;

  /// Newest first; empty until the list is read.
  final List<NotificationItem> items;
  final String? nextCursor;
  final bool loadingMore;

  /// Unread customer order notifications, for the bell; `0` until known.
  final int unread;

  /// Why the list could not be read.
  final NotificationFailure? failure;

  /// Why the last mark-read or load-more was refused; the list stays as it was.
  final NotificationFailure? actionFailure;

  bool get hasMore => nextCursor != null;
  bool get hasUnreadListed => items.any((item) => item.isUnread);

  NotificationsView copyWith({
    NotificationsViewKind? kind,
    List<NotificationItem>? items,
    String? Function()? nextCursor,
    bool? loadingMore,
    int? unread,
    NotificationFailure? Function()? failure,
    NotificationFailure? Function()? actionFailure,
  }) => NotificationsView(
    kind ?? this.kind,
    items: items ?? this.items,
    nextCursor: nextCursor == null ? this.nextCursor : nextCursor(),
    loadingMore: loadingMore ?? this.loadingMore,
    unread: unread ?? this.unread,
    failure: failure == null ? this.failure : failure(),
    actionFailure: actionFailure == null ? this.actionFailure : actionFailure(),
  );
}

/// The signed-in customer's order notifications (spec 15), with the cart's
/// account-change guard (`CartController`): answers to requests made for a
/// previous account are dropped, so one account's notifications never show
/// for the next. The count is read on sign-in, when the screen opens, after
/// each change, and when the app returns to the foreground; nothing is pushed.
class NotificationsController extends Notifier<NotificationsView> {
  /// The account: answers to an older one are dropped.
  int _generation = 0;

  @override
  NotificationsView build() {
    // The account, not the session object: a refreshed token changes nothing.
    final session = ref.watch(
      authSessionProvider.select(
        (session) => (session.isLoading, session.value?.userId),
      ),
    );
    _generation += 1;
    final (loading, userId) = session;
    if (loading) return const NotificationsView(NotificationsViewKind.loading);
    if (userId == null) {
      return const NotificationsView(NotificationsViewKind.guest);
    }
    Future.microtask(refreshCount);
    return const NotificationsView(NotificationsViewKind.loading);
  }

  bool _signedIn() => state.kind != NotificationsViewKind.guest && ref.mounted;

  /// Reads the unread count again; a failure keeps the last known count.
  Future<void> refreshCount() async {
    if (!_signedIn()) return;
    final generation = _generation;
    final outcome = await _send('GET', unreadCountPath, decodeUnreadCount);
    if (_stale(generation)) return;
    if (outcome case NotificationOk<int>(:final data)) {
      state = state.copyWith(unread: data);
    } else {
      _showSession(outcome);
    }
  }

  /// Reads the first page and the count again.
  Future<void> reload() async {
    if (!_signedIn()) return;
    final generation = _generation;
    final outcome = await _send(
      'GET',
      notificationListPath(null),
      NotificationPage.fromJson,
    );
    if (_stale(generation)) return;
    switch (outcome) {
      case NotificationOk<NotificationPage>(:final data):
        state = state.copyWith(
          kind: NotificationsViewKind.ready,
          items: data.items,
          nextCursor: () => data.nextCursor,
          loadingMore: false,
          failure: () => null,
          actionFailure: () => null,
        );
      case NotificationFailed<NotificationPage>(:final failure):
        state = state.copyWith(
          kind: NotificationsViewKind.failed,
          failure: () => failure,
        );
      case NotificationNotFound<NotificationPage>():
        state = state.copyWith(
          kind: NotificationsViewKind.failed,
          failure: () => NotificationFailure.error,
        );
      default:
        _showSession(outcome);
        return;
    }
    await refreshCount();
  }

  Future<void> loadMore() async {
    final cursor = state.nextCursor;
    if (cursor == null || state.loadingMore) return;
    final generation = _generation;
    state = state.copyWith(loadingMore: true, actionFailure: () => null);
    final outcome = await _send(
      'GET',
      notificationListPath(cursor),
      NotificationPage.fromJson,
    );
    if (_stale(generation)) return;
    switch (outcome) {
      case NotificationOk<NotificationPage>(:final data):
        state = state.copyWith(
          items: appendPage(state.items, data.items),
          nextCursor: () => data.nextCursor,
          loadingMore: false,
        );
      case NotificationFailed<NotificationPage>(:final failure):
        state = state.copyWith(
          loadingMore: false,
          actionFailure: () => failure,
        );
      default:
        state = state.copyWith(loadingMore: false);
        _showSession(outcome);
    }
  }

  /// Idempotent on the API: an already read notification stays as it was.
  Future<void> markRead(NotificationItem item) async {
    if (!item.isUnread) return;
    final generation = _generation;
    final outcome = await _send('POST', markReadPath(item.id), decodeNothing);
    if (_stale(generation)) return;
    switch (outcome) {
      // `NotFound`: it is gone for this user; nothing to mark.
      case NotificationOk<void>() || NotificationNotFound<void>():
        final now = DateTime.now().toUtc();
        state = state.copyWith(
          items: [
            for (final listed in state.items)
              listed.id == item.id ? listed.markedRead(now) : listed,
          ],
          actionFailure: () => null,
        );
        await refreshCount();
      case NotificationFailed<void>(:final failure):
        state = state.copyWith(actionFailure: () => failure);
      default:
        _showSession(outcome);
    }
  }

  /// Marks the customer order notifications read; seller notifications, read
  /// on the web, are left as they are.
  Future<void> markAllRead() async {
    final generation = _generation;
    final outcome = await _send('POST', readAllPath, decodeNothing);
    if (_stale(generation)) return;
    switch (outcome) {
      case NotificationOk<void>():
        final now = DateTime.now().toUtc();
        state = state.copyWith(
          items: [for (final item in state.items) item.markedRead(now)],
          unread: 0,
          actionFailure: () => null,
        );
        await refreshCount();
      case NotificationFailed<void>(:final failure):
        state = state.copyWith(actionFailure: () => failure);
      default:
        _showSession(outcome);
    }
  }

  bool _stale(int generation) => !ref.mounted || generation != _generation;

  void _showSession<T>(NotificationOutcome<T> outcome) {
    switch (outcome) {
      case NotificationSignedOut<T>():
        state = const NotificationsView(NotificationsViewKind.guest);
      case NotificationNotBootstrapped<T>():
        state = const NotificationsView(NotificationsViewKind.needsSetup);
      default:
        break;
    }
  }

  Future<NotificationOutcome<T>> _send<T>(
    String method,
    String path,
    T Function(Object? json) decode,
  ) async {
    final generation = _generation;
    final repository = ref.read(authRepositoryProvider);
    final token = await repository?.accessToken();
    if (repository == null || token == null) return NotificationSignedOut<T>();
    if (_stale(generation)) return NotificationSignedOut<T>();
    final outcome = interpretNotificationResult(
      await ref
          .read(apiClientProvider)
          .send(method, path, accessToken: token, decode: decode),
    );
    // Only the account that made the request may be signed out by its answer.
    if (outcome is NotificationSignedOut<T> && !_stale(generation)) {
      await repository.signOut();
    }
    return outcome;
  }
}

final notificationsProvider =
    NotifierProvider<NotificationsController, NotificationsView>(
      NotificationsController.new,
    );
