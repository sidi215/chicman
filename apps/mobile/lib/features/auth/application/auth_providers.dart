import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/locale/app_locale_controller.dart';
import '../../../core/network/api_client.dart';
import '../data/auth_repository.dart';
import '../domain/account_setup.dart';
import '../domain/email_link.dart';
import '../domain/registration_intent.dart';
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

/// Verifies the session with the API, once per signed-in account (a refreshed
/// token changes nothing), and gives the account type (AT-1). A 401 ends the
/// session; a 503 (`AUTH_UNAVAILABLE`) or network error keeps it. Retry, or
/// read it again after setup, with `ref.invalidate(sessionCheckProvider)`.
final sessionCheckProvider = FutureProvider<SessionCheck>((ref) async {
  final userId = ref.watch(
    authSessionProvider.select((session) => session.value?.userId),
  );
  if (userId == null) return const SessionSignedOut();
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

/// What the buyer features (cart, favorites, notifications, orders, checkout)
/// load for: `(loading, userId)`, like the session they used to watch, but
/// waiting for the account type (AT-1). A Seller or Administrator account is
/// treated as signed out, so these features never call the API for it; the
/// shell shows such accounts the "managed on the web" screen (Q5). A Buyer, or
/// an identity not set up yet, loads as before.
final buyerSessionProvider = Provider<(bool, String?)>((ref) {
  final session = ref.watch(authSessionProvider);
  if (session.isLoading) return (true, null);
  final userId = session.value?.userId;
  if (userId == null) return (false, null);
  return switch (ref.watch(sessionCheckProvider)) {
    AsyncData(value: SessionActive(:final session)) =>
      session.isBuyer ? (false, userId) : (false, null),
    AsyncData() || AsyncError() => (false, userId),
    _ => (true, null),
  };
});

/// The signed-in account (`GET /accounts/me`), shown on the account screen.
/// `null` when it cannot be loaded.
final customerAccountProvider = FutureProvider.autoDispose<CustomerAccount?>((
  ref,
) async {
  final repository = ref.watch(authRepositoryProvider);
  final token = await repository?.accessToken();
  if (token == null) return null;
  final result = await ref
      .read(apiClientProvider)
      .get(accountPath, accessToken: token, decode: CustomerAccount.fromJson);
  return result is ApiOk<CustomerAccount> ? result.data : null;
});

/// The app follows the profile's language: it is read when a signed-in user is
/// first seen, at launch or at sign-in. Token refreshes keep the same user, so
/// they read nothing. A failed read leaves the current language; the next launch
/// tries again. Kept alive by `MyApp`.
final profileLocaleSyncProvider = Provider<void>((ref) {
  String? syncedUserId;

  Future<void> sync() async {
    final repository = ref.read(authRepositoryProvider);
    final token = await repository?.accessToken();
    if (token == null) return;
    final languageBefore = ref.read(appLocaleProvider);
    final result = await ref
        .read(apiClientProvider)
        .get(accountPath, accessToken: token, decode: CustomerAccount.fromJson);
    // A save made during the read is newer than what was read.
    if (result is! ApiOk<CustomerAccount> ||
        ref.read(appLocaleProvider) != languageBefore) {
      return;
    }
    await ref
        .read(appLocaleProvider.notifier)
        .setLanguage(result.data.preferredLocale);
  }

  ref.listen(authSessionProvider, (_, session) {
    if (session is! AsyncData<AuthSession?>) return;
    final userId = session.value?.userId;
    if (userId == syncedUserId) return;
    syncedUserId = userId;
    if (userId != null) sync();
  }, fireImmediately: true);
});

/// Account setup (AT-1): a Buyer account with its contact phone (E.164). The
/// type comes from the registration intent; the mobile app is buyer only, so
/// without an intent it records the buyer intent for the signed-in identity
/// and tries once more. A seller intent is completed on the web.
///
/// Setup takes only the phone, so a new account starts in the default
/// language. It then saves [languageCode], the language its owner is using, so
/// the app does not change language on the next launch.
Future<SetupOutcome> submitAccountSetup(
  WidgetRef ref,
  String phone, {
  required String languageCode,
}) async {
  final repository = ref.read(authRepositoryProvider);
  final token = await repository?.accessToken();
  final userId = repository?.currentSession?.userId;
  if (repository == null || token == null || userId == null) {
    return const SetupSignedOut();
  }
  final api = ref.read(apiClientProvider);
  Future<SetupOutcome> attempt() async => interpretSetupResult(
    await api.send(
      'POST',
      accountSetupPath,
      accessToken: token,
      body: {'phone': phone},
      decode: CustomerAccount.fromJson,
    ),
  );
  var outcome = await attempt();
  if (outcome is SetupIntentRequired &&
      await recordBuyerIntent(api, userId) == IntentOutcome.recorded) {
    outcome = await attempt();
  }
  if (outcome is SetupSignedOut) await repository.signOut();
  if (outcome is SetupDone) {
    if (outcome.account.preferredLocale != languageCode) {
      await api.send(
        'PATCH',
        accountPath,
        accessToken: token,
        body: {'preferredLocale': languageCode},
        decode: CustomerAccount.fromJson,
      );
    }
    await ref.read(appLocaleProvider.notifier).setLanguage(languageCode);
  }
  return outcome;
}

/// The identity's own registration intent (`GET /registration-intents/me`),
/// read by the setup screen: `BUYER`, `SELLER` (completed on the web), or
/// `null`. Errors read as `null`, so setup still offers the buyer account.
final ownIntentProvider = FutureProvider.autoDispose<String?>((ref) async {
  final repository = ref.watch(authRepositoryProvider);
  final token = await repository?.accessToken();
  if (token == null) return null;
  final result = await ref
      .read(apiClientProvider)
      .get(ownIntentPath, accessToken: token, decode: decodeIntent);
  return result is ApiOk<String?> ? result.data : null;
});

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

/// A request from a pushed screen to show the account tab, for example to sign
/// in before adding to the cart. The shell listens; only the change matters.
class AccountTabRequest extends Notifier<int> {
  @override
  int build() => 0;

  void request() => state += 1;
}

final accountTabRequestProvider = NotifierProvider<AccountTabRequest, int>(
  AccountTabRequest.new,
);

/// Incoming links (App Links / Universal Links). Overridden in `main()` and
/// in tests; `null` disables link handling. The source may be a
/// single-subscription stream (`appLinkStream` is): read [appLinksProvider].
final incomingLinksProvider = Provider<Stream<Uri>?>((ref) => null);

/// [incomingLinksProvider] as one shared broadcast stream, created once.
/// `AuthGate` is mounted again whenever the shell switches between the buyer
/// dock and the "managed on the web" screen; each new gate subscribes again,
/// which a single-subscription stream refuses ("Stream has already been
/// listened to"), even after the previous subscription was cancelled. The
/// source is listened to once, from the first gate on, so the launch link is
/// delivered once and later gates receive the links that follow.
final appLinksProvider = Provider<Stream<Uri>?>(
  (ref) => ref.watch(incomingLinksProvider)?.asBroadcastStream(),
);
