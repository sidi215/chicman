import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/network/api_client.dart';
import '../data/auth_repository.dart';
import '../domain/account_setup.dart';
import '../domain/email_link.dart';
import '../domain/session_check.dart';

final appConfigProvider = Provider<AppConfig>(
  (ref) => AppConfig.fromEnvironment(),
);

/// The auth repository, or `null` when Supabase is not configured or could
/// not be initialized. Overridden in `main()`.
final authRepositoryProvider = Provider<AuthRepository?>((ref) => null);

final apiClientProvider = Provider<ApiClient>(
  (ref) => ApiClient(baseUrl: ref.watch(appConfigProvider).apiBaseUrl),
);

/// Current session: starts from the restored session, then follows changes.
final authSessionProvider = StreamProvider<AuthSession?>((ref) async* {
  final repository = ref.watch(authRepositoryProvider);
  if (repository == null) {
    yield null;
    return;
  }
  yield repository.currentSession;
  yield* repository.sessionChanges();
});

/// Verifies the session with the API. A 401 ends the session; a 503
/// (`AUTH_UNAVAILABLE`) or network error keeps it. Retry with
/// `ref.invalidate(sessionCheckProvider)`.
final sessionCheckProvider = FutureProvider.autoDispose<SessionCheck>((
  ref,
) async {
  final repository = ref.watch(authRepositoryProvider);
  if (repository == null) return const SessionCheckError();
  final token = await repository.accessToken();
  if (token == null) return const SessionSignedOut();
  final result = await ref
      .read(apiClientProvider)
      .get('/auth/session', accessToken: token, decode: ApiSession.fromJson);
  final check = interpretSessionCheck(result);
  if (shouldEndSession(check)) await repository.signOut();
  return check;
});

/// The bootstrapped customer account (`GET /customers/me`), shown on the
/// account screen. `null` when it cannot be loaded.
final customerAccountProvider = FutureProvider.autoDispose<CustomerAccount?>((
  ref,
) async {
  final repository = ref.watch(authRepositoryProvider);
  final token = await repository?.accessToken();
  if (token == null) return null;
  final result = await ref
      .read(apiClientProvider)
      .get(
        '/customers/me',
        accessToken: token,
        decode: CustomerAccount.fromJson,
      );
  return result is ApiOk<CustomerAccount> ? result.data : null;
});

/// Account setup: the contact phone (E.164), then bootstrap (spec 04).
Future<SetupOutcome> submitAccountSetup(WidgetRef ref, String phone) async {
  final repository = ref.read(authRepositoryProvider);
  final token = await repository?.accessToken();
  if (repository == null || token == null) return const SetupSignedOut();
  final outcome = interpretSetupResult(
    await ref
        .read(apiClientProvider)
        .send(
          'POST',
          '/customers/me',
          accessToken: token,
          body: {'phone': phone},
          decode: CustomerAccount.fromJson,
        ),
  );
  if (outcome is SetupSignedOut) await repository.signOut();
  return outcome;
}

/// The email link waiting to be verified (from App Links / Universal Links).
/// Each token is handled at most once per app run.
class PendingEmailLink extends Notifier<IncomingLink?> {
  final _seen = <String>{};

  @override
  IncomingLink? build() => null;

  void receive(IncomingLink incoming) {
    switch (incoming) {
      case NotAuthCallback():
        return;
      case ValidEmailLink(:final link):
        if (!_seen.add(link.id)) return;
        state = incoming;
      case InvalidEmailLink():
        state = incoming;
    }
  }

  void clear() => state = null;
}

final pendingEmailLinkProvider =
    NotifierProvider<PendingEmailLink, IncomingLink?>(PendingEmailLink.new);

/// `true` after a recovery link was verified: the signed-in user must set a
/// new password before reaching the account.
class PasswordRecovery extends Notifier<bool> {
  @override
  bool build() => false;

  void start() => state = true;
  void finish() => state = false;
}

final passwordRecoveryProvider = NotifierProvider<PasswordRecovery, bool>(
  PasswordRecovery.new,
);

/// Incoming links (App Links / Universal Links). Overridden in `main()` and
/// in tests; `null` disables link handling.
final incomingLinksProvider = Provider<Stream<Uri>?>((ref) => null);
