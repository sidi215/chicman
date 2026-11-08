import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/domain/auth_failure.dart';
import 'package:chicman/features/auth/presentation/turnstile_field.dart';
import 'package:chicman/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fakes.dart';

const _config = AppConfig(
  supabaseUrl: 'https://p.supabase.co',
  supabasePublishableKey: 'k',
  apiBaseUrl: 'http://api.test',
  siteUrl: 'http://localhost:3000',
  turnstileSiteKey: '0xPUBLIC',
);

/// Plays the role of Cloudflare's document in the WebView.
class FakeChallenge {
  TurnstileHostArgs? args;
  final loads = <int>{};

  void _post(String message) => args!.onMessage('${args!.loadId}|$message');
  void ready() => _post('ready');
  void solve(String token) => _post('token:$token');
  void expire() => _post('expired');
  void reject() => _post('error:300030');
  void scriptFails() => _post('script-error');

  Widget build(BuildContext context, TurnstileHostArgs next) {
    args = next;
    loads.add(next.loadId);
    return const SizedBox.expand();
  }
}

Future<(FakeChallenge, FakeAuthRepository)> _openLogin(
  WidgetTester tester, {
  AppConfig config = _config,
}) async {
  await tester.binding.setSurfaceSize(const Size(500, 1400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final challenge = FakeChallenge();
  final repository = FakeAuthRepository();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(null),
        appConfigProvider.overrideWithValue(config),
        authRepositoryProvider.overrideWithValue(repository),
        apiClientProvider.overrideWithValue(fakeApi(status: 200)),
        incomingLinksProvider.overrideWithValue(null),
        turnstileHostProvider.overrideWithValue(challenge.build),
      ],
      child: const MyApp(),
    ),
  );
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const Key('login-email')), 'a@b.mr');
  await tester.enterText(find.byKey(const Key('login-password')), 'secret-123');
  return (challenge, repository);
}

Future<void> _submit(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('login-submit')));
  await tester.pumpAndSettle();
}

const _required = 'Terminez la vérification anti-robot.';

void main() {
  group('diagnostics', () {
    test(
      'error codes and diagnostic lines parse without changing the token',
      () {
        final rejected = parseTurnstileMessage('3|error:110200', 3);
        expect((rejected! as TurnstileRejected).code, '110200');
        expect(
          parseTurnstileMessage('3|diag:env host=localhost', 3),
          isA<TurnstileDiagnostic>(),
        );
      },
    );

    test('log lines carry no token, query string, or unbounded text', () {
      final token = 'a' * 200;
      expect(sanitizeTurnstileLog('value $token end'), 'value <redacted> end');
      expect(
        sanitizeTurnstileLog('http 500 https://x.test/p?secret=1#f'),
        'http 500 https://x.test/p',
      );
      expect(sanitizeTurnstileLog('word ' * 200).length, 300);
    });

    test('the document includes diagnostics only when asked', () {
      final plain = turnstileDocument(siteKey: 'k', language: 'fr');
      final debug = turnstileDocument(
        siteKey: 'k',
        language: 'fr',
        diagnostics: true,
      );
      expect(plain, isNot(contains('diag(')));
      expect(debug, contains('function diag(m)'));
      expect(plain, contains("post('error:' + code)"));
    });
  });

  group('parseTurnstileMessage', () {
    test('accepts only messages of the current challenge', () {
      expect(parseTurnstileMessage('3|ready', 3), isA<TurnstileReady>());
      final token = parseTurnstileMessage('3|token:abc', 3);
      expect((token! as TurnstileToken).token, 'abc');
      expect(parseTurnstileMessage('2|token:old', 3), isNull);
      expect(parseTurnstileMessage('token:noid', 3), isNull);
    });

    test('a missing token or an unknown message is a rejection', () {
      expect(parseTurnstileMessage('3|token:', 3), isA<TurnstileRejected>());
      expect(parseTurnstileMessage('3|error', 3), isA<TurnstileRejected>());
      expect(parseTurnstileMessage('3|???', 3), isA<TurnstileRejected>());
      expect(parseTurnstileMessage('3|expired', 3), isA<TurnstileExpired>());
      expect(
        parseTurnstileMessage('3|script-error', 3),
        isA<TurnstileScriptFailed>(),
      );
    });
  });

  testWidgets(
    'sign-in receives the token; the next attempt needs a fresh one',
    (tester) async {
      final (challenge, repository) = await _openLogin(tester);
      repository.signInFailure = AuthFailure.invalidCredentials;
      challenge.ready();
      challenge.solve('token-1');
      await tester.pump();
      await _submit(tester);
      expect(repository.captchaTokens, ['token-1']);

      // The token was consumed: a new challenge, and no request without it.
      expect(challenge.loads.length, 2);
      await _submit(tester);
      expect(repository.captchaTokens, ['token-1']);
      expect(find.text(_required), findsOneWidget);

      // A late message of the consumed challenge cannot bring a token back.
      challenge.args!.onMessage('${challenge.args!.loadId - 1}|token:stale');
      await tester.pump();
      await _submit(tester);
      expect(repository.captchaTokens, ['token-1']);

      challenge.solve('token-2');
      await tester.pump();
      await _submit(tester);
      expect(repository.captchaTokens, ['token-1', 'token-2']);
    },
  );

  testWidgets('sign-up receives the token', (tester) async {
    final (challenge, repository) = await _openLogin(tester);
    await tester.tap(find.byKey(const Key('login-to-register')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('register-email')), 'a@b.mr');
    await tester.enterText(
      find.byKey(const Key('register-password')),
      'Secret-12345',
    );
    await tester.enterText(
      find.byKey(const Key('register-confirm')),
      'Secret-12345',
    );
    await tester.tap(find.byKey(const Key('register-submit')));
    await tester.pumpAndSettle();
    expect(repository.calls, isEmpty, reason: 'no token: nothing is sent');

    challenge.solve('signup-token');
    await tester.pump();
    await tester.tap(find.byKey(const Key('register-submit')));
    await tester.pumpAndSettle();
    expect(repository.calls, ['register a@b.mr']);
    expect(repository.captchaTokens, ['signup-token']);
  });

  testWidgets('an expired token is discarded; nothing is sent', (tester) async {
    final (challenge, repository) = await _openLogin(tester);
    challenge.solve('token');
    await tester.pump();
    challenge.expire();
    await tester.pump();
    expect(
      find.text('La vérification anti-robot a expiré. Recommencez-la.'),
      findsOneWidget,
    );
    await _submit(tester);
    expect(repository.calls, isEmpty);
    expect(find.text(_required), findsOneWidget);
  });

  testWidgets('a rejected challenge blocks the request and offers retry', (
    tester,
  ) async {
    final (challenge, repository) = await _openLogin(tester);
    challenge.reject();
    await tester.pump();
    expect(
      find.text('La vérification anti-robot a échoué. Réessayez.'),
      findsOneWidget,
    );
    await _submit(tester);
    expect(repository.calls, isEmpty);

    final before = challenge.args!.loadId;
    await tester.tap(find.byKey(const Key('turnstile-retry')));
    await tester.pump();
    expect(challenge.args!.loadId, greaterThan(before));
    challenge.solve('after-retry');
    await tester.pump();
    await _submit(tester);
    expect(repository.captchaTokens, ['after-retry']);
  });

  testWidgets(
    'script failure and WebView load failure offer retry; nothing is sent',
    (tester) async {
      const unavailable =
          'Impossible de charger la vérification anti-robot. Vérifiez votre connexion et réessayez.';
      final (challenge, repository) = await _openLogin(tester);
      challenge.scriptFails();
      await tester.pump();
      expect(find.text(unavailable), findsOneWidget);
      await tester.tap(find.byKey(const Key('turnstile-retry')));
      await tester.pump();
      challenge.args!.onLoadFailed();
      await tester.pump();
      expect(find.text(unavailable), findsOneWidget);
      await _submit(tester);
      expect(repository.calls, isEmpty);
    },
  );

  testWidgets('a challenge that never loads times out (no network)', (
    tester,
  ) async {
    final (_, repository) = await _openLogin(tester);
    await tester.pump(turnstileLoadTimeout + const Duration(seconds: 1));
    expect(find.byKey(const Key('turnstile-retry')), findsOneWidget);
    await _submit(tester);
    expect(repository.calls, isEmpty);
  });

  testWidgets('a missing token (empty) is a failure, not an empty token sent', (
    tester,
  ) async {
    final (challenge, repository) = await _openLogin(tester);
    challenge.solve('');
    await tester.pump();
    await _submit(tester);
    expect(repository.calls, isEmpty);
  });

  testWidgets(
    'cancelling: leaving the screen sends nothing and leaves no timer',
    (tester) async {
      final (challenge, repository) = await _openLogin(tester);
      await tester.tap(find.byKey(const Key('login-to-register')));
      await tester.pumpAndSettle();
      expect(challenge.args, isNotNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(turnstileLoadTimeout + const Duration(seconds: 1));
      expect(repository.calls, isEmpty);
    },
  );

  testWidgets(
    'Supabase refusing the token shows the failure and needs a new one',
    (tester) async {
      final (challenge, repository) = await _openLogin(tester);
      repository.signInFailure = AuthFailure.captchaFailed;
      challenge.solve('refused');
      await tester.pump();
      final before = challenge.args!.loadId;
      await _submit(tester);
      expect(
        find.text('La vérification anti-robot a échoué. Réessayez.'),
        findsOneWidget,
      );
      expect(challenge.args!.loadId, greaterThan(before));
    },
  );

  testWidgets(
    'a site key without SITE_URL fails closed: an error, no request',
    (tester) async {
      final (challenge, repository) = await _openLogin(
        tester,
        config: const AppConfig(
          supabaseUrl: 'https://p.supabase.co',
          supabasePublishableKey: 'k',
          apiBaseUrl: 'http://api.test',
          turnstileSiteKey: '0xPUBLIC',
        ),
      );
      expect(challenge.args, isNull);
      expect(find.byKey(const Key('turnstile-not-configured')), findsOneWidget);
      await _submit(tester);
      expect(repository.calls, isEmpty);
      expect(find.text(_required), findsOneWidget);
    },
  );

  testWidgets('without a site key there is no challenge (development only)', (
    tester,
  ) async {
    final (challenge, repository) = await _openLogin(
      tester,
      config: const AppConfig(
        supabaseUrl: 'https://p.supabase.co',
        supabasePublishableKey: 'k',
        apiBaseUrl: 'http://api.test',
        siteUrl: 'http://localhost:3000',
      ),
    );
    expect(challenge.args, isNull);
    await _submit(tester);
    expect(repository.captchaTokens, [null]);
  });
}
