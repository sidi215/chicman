import 'dart:async';
import 'dart:convert';

import 'package:chicman/app_shell.dart';
import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/auth/domain/auth_failure.dart';
import 'package:chicman/features/auth/presentation/auth_gate.dart';
import 'package:chicman/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'fakes.dart';
import '../addresses/fake_map.dart';

const _host = 'chicman.test';
const _config = AppConfig(
  supabaseUrl: 'https://p.supabase.co',
  supabasePublishableKey: 'k',
  apiBaseUrl: 'http://api.test',
  siteUrl: 'https://$_host',
);

const _activeSession = {'userId': 'u1', 'accountType': 'BUYER'};
const _account = {
  'userId': 'u1',
  'accountType': 'BUYER',
  'profile': {'id': 'p1', 'phone': '+22222123456', 'fullName': null},
};

ApiClient _bootstrappedApi() => routedApi({
  'GET /auth/session': (_) => (200, _activeSession),
  'GET /accounts/me': (_) => (200, _account),
});

Future<void> pumpApp(
  WidgetTester tester, {
  required AuthRepository? repository,
  ApiClient? api,
  Stream<Uri>? links,
  Widget home = const AuthGate(),
}) async {
  await tester.binding.setSurfaceSize(const Size(500, 1400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(null),
        appConfigProvider.overrideWithValue(_config),
        authRepositoryProvider.overrideWithValue(repository),
        apiClientProvider.overrideWithValue(api ?? _bootstrappedApi()),
        incomingLinksProvider.overrideWithValue(links),
        fakeMapOverride,
      ],
      child: MyApp(home: home),
    ),
  );
  await tester.pumpAndSettle();
}

const _restored = AuthSession(userId: 'u1', email: 'aicha@example.com');

void main() {
  testWidgets('signed out on launch → email login screen', (tester) async {
    await pumpApp(tester, repository: FakeAuthRepository());
    expect(find.text('Connexion'), findsWidgets);
    expect(find.text('Adresse e-mail'), findsOneWidget);
    expect(find.text('Numéro de téléphone'), findsNothing);
  });

  testWidgets('a restored session opens the account directly', (tester) async {
    await pumpApp(tester, repository: FakeAuthRepository(restored: _restored));
    expect(find.byKey(const Key('buyer-dashboard')), findsOneWidget);
    expect(find.text('Connecté en tant que aicha@example.com'), findsOneWidget);
    expect(
      find.text('Téléphone de contact (non vérifié) : +22222123456'),
      findsOneWidget,
    );
  });

  testWidgets('login validates input, then signs in with the email', (
    tester,
  ) async {
    final repository = FakeAuthRepository();
    await pumpApp(tester, repository: repository);

    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pump();
    expect(find.text('Adresse e-mail invalide.'), findsOneWidget);
    expect(find.text('Saisissez un mot de passe.'), findsOneWidget);
    expect(repository.calls, isEmpty);

    await tester.enterText(
      find.byKey(const Key('login-email')),
      ' Aicha@Example.com ',
    );
    await tester.enterText(find.byKey(const Key('login-password')), 'secret');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    expect(repository.calls, ['signIn aicha@example.com']);
    expect(find.byKey(const Key('buyer-dashboard')), findsOneWidget);
  });

  testWidgets('an unconfirmed email cannot log in and can resend', (
    tester,
  ) async {
    final repository = FakeAuthRepository()
      ..signInFailure = AuthFailure.emailNotConfirmed;
    await pumpApp(tester, repository: repository);
    await tester.enterText(find.byKey(const Key('login-email')), 'a@b.mr');
    await tester.enterText(find.byKey(const Key('login-password')), 'pw');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    expect(find.textContaining("n'est pas encore confirmée"), findsOneWidget);
    await tester.tap(find.byKey(const Key('login-resend')));
    await tester.pumpAndSettle();
    expect(repository.calls, ['signIn a@b.mr', 'resend a@b.mr']);
    expect(
      find.textContaining('nouvel e-mail de confirmation'),
      findsOneWidget,
    );
    expect(find.text('Connexion'), findsWidgets);
  });

  testWidgets(
    'sign-up asks for email and password only, then "check your email"',
    (tester) async {
      final repository = FakeAuthRepository();
      await pumpApp(tester, repository: repository);
      await tester.tap(find.byKey(const Key('login-to-register')));
      await tester.pumpAndSettle();
      expect(find.text('Numéro de téléphone'), findsNothing);

      await tester.enterText(find.byKey(const Key('register-email')), 'a@b.mr');
      await tester.enterText(find.byKey(const Key('register-password')), 'pw');
      await tester.enterText(
        find.byKey(const Key('register-confirm')),
        'other',
      );
      await tester.tap(find.byKey(const Key('register-submit')));
      await tester.pump();
      expect(
        find.text('Les mots de passe ne correspondent pas.'),
        findsOneWidget,
      );

      await tester.enterText(find.byKey(const Key('register-confirm')), 'pw');
      await tester.tap(find.byKey(const Key('register-submit')));
      await tester.pumpAndSettle();
      expect(repository.calls, ['register a@b.mr']);
      expect(find.text('Vérifiez votre boîte e-mail'), findsOneWidget);
      // Not signed in yet: no session before email confirmation.
      expect(repository.currentSession, isNull);

      await tester.tap(find.byKey(const Key('register-resend')));
      await tester.pumpAndSettle();
      expect(repository.calls.last, 'resend a@b.mr');
    },
  );

  testWidgets(
    'confirmation link → session → account setup with phone → account',
    (tester) async {
      final repository = FakeAuthRepository();
      final links = StreamController<Uri>();
      addTearDown(links.close);
      var bootstrapped = false;
      final requests = <http.Request>[];
      final api = routedApi({
        'GET /auth/session': (_) => bootstrapped
            ? (200, _activeSession)
            : (
                403,
                {
                  'error': {'code': 'FORBIDDEN'},
                },
              ),
        'POST /accounts/me/setup': (request) {
          final phone = (jsonDecode(request.body) as Map)['phone'];
          if (phone != '+22222123456') {
            return (
              400,
              {
                'error': {'code': 'INVALID_PHONE'},
              },
            );
          }
          bootstrapped = true;
          return (201, _account);
        },
        'GET /accounts/me': (_) => (200, _account),
      }, requests: requests);
      await pumpApp(
        tester,
        repository: repository,
        api: api,
        links: links.stream,
      );

      links.add(
        Uri.parse(
          'https://$_host/auth/callback#token_hash=${'a' * 56}&type=email',
        ),
      );
      await tester.pumpAndSettle();
      expect(repository.calls, ['verify email']);
      expect(find.text('Finaliser votre compte'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('setup-phone')), '12');
      await tester.tap(find.byKey(const Key('setup-submit')));
      await tester.pump();
      expect(find.text('Numéro de téléphone invalide.'), findsOneWidget);
      expect(requests.where((r) => r.method == 'POST'), isEmpty);

      await tester.enterText(
        find.byKey(const Key('setup-phone')),
        '22 12 34 56',
      );
      await tester.tap(find.byKey(const Key('setup-submit')));
      await tester.pumpAndSettle();
      final post = requests.singleWhere((r) => r.method == 'POST');
      expect(jsonDecode(post.body), {'phone': '+22222123456'});
      expect(post.headers['authorization'], 'Bearer access-token');
      // The account already has the language in use: nothing more to save.
      expect(requests.where((r) => r.method == 'PATCH'), isEmpty);
      // Spec 05: the delivery address is offered right after setup (skippable).
      expect(find.text('Où souhaitez-vous être livré ?'), findsOneWidget);
      await tester.tap(find.byKey(const Key('address-later')));
      await tester.pumpAndSettle();
      expect(find.textContaining('(non vérifié)'), findsOneWidget);
    },
  );

  group('account types (AT-1, Q5: the app is for buyers)', () {
    for (final (type, text) in [
      ('SELLER', 'Votre compte vendeur se gère sur le site web de Chicman.'),
      (
        'ADMIN',
        "Votre compte d'administration se gère sur le site web de Chicman.",
      ),
    ]) {
      testWidgets('a $type account sees only that it is managed on the web', (
        tester,
      ) async {
        final requests = <http.Request>[];
        final repository = FakeAuthRepository(restored: _restored);
        await pumpApp(
          tester,
          repository: repository,
          home: const AppShell(),
          api: routedApi({
            'GET /auth/session': (_) =>
                (200, {'userId': 'u1', 'accountType': type}),
          }, requests: requests),
        );
        expect(find.byKey(const Key('managed-on-web')), findsOneWidget);
        expect(find.textContaining(text), findsOneWidget);
        // No buyer screen: no dock, and no buyer route was ever called.
        expect(find.byKey(const Key('dock-home')), findsNothing);
        expect(
          requests.where((r) => r.url.path.contains('/customers/me/')),
          isEmpty,
        );
        await tester.tap(find.byKey(const Key('managed-on-web-logout')));
        await tester.pumpAndSettle();
        expect(repository.calls, contains('signOut'));
      });
    }

    testWidgets(
      'signing out of a non-buyer account remounts the gate without re-listening to the link stream',
      (tester) async {
        // Regression (SM A165F): "Stream has already been listened to" in
        // AuthGate.initState. App links arrive on a single-subscription
        // stream, and the shell mounts a new AuthGate when it switches from
        // the "managed on the web" screen to the buyer dock.
        final repository = FakeAuthRepository(restored: _restored);
        final links = StreamController<Uri>();
        addTearDown(links.close);
        await pumpApp(
          tester,
          repository: repository,
          home: const AppShell(),
          links: links.stream,
          api: routedApi({
            'GET /auth/session': (_) =>
                (200, {'userId': 'u1', 'accountType': 'SELLER'}),
          }),
        );
        expect(find.byKey(const Key('managed-on-web')), findsOneWidget);

        await tester.tap(find.byKey(const Key('managed-on-web-logout')));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.byKey(const Key('dock-home')), findsOneWidget);

        // The new gate still receives links.
        links.add(
          Uri.parse(
            'https://$_host/auth/callback#token_hash=${'e' * 56}&type=email',
          ),
        );
        await tester.pumpAndSettle();
        expect(repository.calls, ['signOut', 'verify email']);
      },
    );

    testWidgets('a seller registration is completed on the web, not here', (
      tester,
    ) async {
      final requests = <http.Request>[];
      await pumpApp(
        tester,
        repository: FakeAuthRepository(restored: _restored),
        api: routedApi({
          'GET /auth/session': (_) => (
            403,
            {
              'error': {'code': 'FORBIDDEN'},
            },
          ),
          'GET /registration-intents/me': (_) =>
              (200, {'accountType': 'SELLER'}),
        }, requests: requests),
      );
      expect(find.byKey(const Key('setup-seller-intent')), findsOneWidget);
      expect(find.byKey(const Key('setup-phone')), findsNothing);
      expect(requests.where((r) => r.method == 'POST'), isEmpty);
    });

    testWidgets(
      'without an intent, setup records the buyer intent and tries once more',
      (tester) async {
        final requests = <http.Request>[];
        var intent = false;
        await pumpApp(
          tester,
          repository: FakeAuthRepository(restored: _restored),
          api: routedApi({
            'GET /auth/session': (_) => (
              403,
              {
                'error': {'code': 'FORBIDDEN'},
              },
            ),
            'GET /registration-intents/me': (_) => (200, {'accountType': null}),
            'POST /registration-intents': (_) {
              intent = true;
              return (204, null);
            },
            'POST /accounts/me/setup': (_) => intent
                ? (201, _account)
                : (
                    409,
                    {
                      'error': {'code': 'REGISTRATION_INTENT_REQUIRED'},
                    },
                  ),
          }, requests: requests),
        );
        await tester.enterText(
          find.byKey(const Key('setup-phone')),
          '22 12 34 56',
        );
        await tester.tap(find.byKey(const Key('setup-submit')));
        await tester.pumpAndSettle();
        final recorded = requests.singleWhere(
          (r) => r.url.path.endsWith('/registration-intents'),
        );
        expect(jsonDecode(recorded.body), {
          'supabaseUserId': 'u1',
          'accountType': 'BUYER',
        });
        expect(recorded.headers.containsKey('authorization'), isFalse);
        expect(
          requests.where((r) => r.url.path.endsWith('/accounts/me/setup')),
          hasLength(2),
        );
        expect(find.text('Où souhaitez-vous être livré ?'), findsOneWidget);
      },
    );
  });

  testWidgets('a new account keeps the language it was set up in', (
    tester,
  ) async {
    tester.platformDispatcher.localesTestValue = const [Locale('ar')];
    addTearDown(tester.platformDispatcher.clearLocalesTestValue);
    var bootstrapped = false;
    final requests = <http.Request>[];
    final api = routedApi({
      'GET /auth/session': (_) => bootstrapped
          ? (200, _activeSession)
          : (
              403,
              {
                'error': {'code': 'FORBIDDEN'},
              },
            ),
      'POST /accounts/me/setup': (_) {
        bootstrapped = true;
        return (201, _account);
      },
      'PATCH /accounts/me': (_) => (200, _account),
      'GET /accounts/me': (_) => bootstrapped
          ? (200, _account)
          : (
              403,
              {
                'error': {'code': 'FORBIDDEN'},
              },
            ),
    }, requests: requests);
    await pumpApp(
      tester,
      repository: FakeAuthRepository(
        restored: const AuthSession(userId: 'u1', email: 'a@b.mr'),
      ),
      api: api,
    );
    await tester.enterText(find.byKey(const Key('setup-phone')), '22 12 34 56');
    await tester.tap(find.byKey(const Key('setup-submit')));
    await tester.pumpAndSettle();
    final patch = requests.singleWhere((r) => r.method == 'PATCH');
    expect(jsonDecode(patch.body), {'preferredLocale': 'ar'});
    expect(
      Directionality.of(tester.element(find.byType(Scaffold).first)),
      TextDirection.rtl,
    );
  });

  testWidgets('the same link is handled once; other links are ignored', (
    tester,
  ) async {
    final repository = FakeAuthRepository();
    final links = StreamController<Uri>();
    addTearDown(links.close);
    await pumpApp(tester, repository: repository, links: links.stream);
    final link = Uri.parse(
      'https://$_host/auth/callback#token_hash=${'b' * 56}&type=email',
    );
    links
      ..add(link)
      ..add(link)
      ..add(
        Uri.parse(
          'https://evil.test/auth/callback#token_hash=${'c' * 56}&type=email',
        ),
      );
    await tester.pumpAndSettle();
    expect(repository.calls, ['verify email']);
  });

  testWidgets('an expired or used link shows the invalid-link screen', (
    tester,
  ) async {
    final repository = FakeAuthRepository()
      ..verifyFailure = AuthFailure.generic;
    final links = StreamController<Uri>();
    addTearDown(links.close);
    await pumpApp(tester, repository: repository, links: links.stream);
    links.add(
      Uri.parse(
        'https://$_host/auth/callback#token_hash=${'d' * 56}&type=email',
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Lien invalide'), findsOneWidget);
    await tester.tap(find.byKey(const Key('callback-login')));
    await tester.pumpAndSettle();
    expect(find.text('Connexion'), findsWidgets);
    expect(repository.currentSession, isNull);
  });

  testWidgets('recovery link → set a new password → account', (tester) async {
    final repository = FakeAuthRepository();
    final links = StreamController<Uri>();
    addTearDown(links.close);
    await pumpApp(tester, repository: repository, links: links.stream);
    links.add(
      Uri.parse(
        'https://$_host/auth/callback#token_hash=${'e' * 56}&type=recovery',
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Nouveau mot de passe'), findsWidgets);
    await tester.enterText(find.byKey(const Key('new-password')), 'n3w');
    await tester.enterText(
      find.byKey(const Key('new-password-confirm')),
      'n3w',
    );
    await tester.tap(find.byKey(const Key('new-password-submit')));
    await tester.pumpAndSettle();
    expect(repository.calls, ['verify recovery', 'updatePassword']);
    await tester.tap(find.byKey(const Key('new-password-continue')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('buyer-dashboard')), findsOneWidget);
  });

  testWidgets(
    'password recovery request shows the same message for any address',
    (tester) async {
      final repository = FakeAuthRepository();
      await pumpApp(tester, repository: repository);
      await tester.tap(find.byKey(const Key('login-forgot')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('forgot-email')), 'x@y.mr');
      await tester.tap(find.byKey(const Key('forgot-submit')));
      await tester.pumpAndSettle();
      expect(repository.calls, ['reset x@y.mr']);
      expect(find.textContaining('Si un compte existe'), findsOneWidget);
    },
  );

  testWidgets('logout returns to the login screen', (tester) async {
    final repository = FakeAuthRepository(restored: _restored);
    await pumpApp(tester, repository: repository);
    await tester.tap(find.byKey(const Key('account-logout')));
    await tester.pumpAndSettle();
    expect(repository.calls, ['signOut']);
    expect(find.text('Connexion'), findsWidgets);
  });

  testWidgets('API 503 AUTH_UNAVAILABLE keeps the session and offers retry', (
    tester,
  ) async {
    final repository = FakeAuthRepository(restored: _restored);
    await pumpApp(
      tester,
      repository: repository,
      api: fakeApi(
        status: 503,
        body: {
          'error': {'code': 'AUTH_UNAVAILABLE'},
        },
      ),
    );
    expect(find.text('Mon compte'), findsOneWidget);
    expect(find.textContaining('momentanément indisponible'), findsOneWidget);
    expect(find.byKey(const Key('account-retry')), findsOneWidget);
    expect(repository.calls, isNot(contains('signOut')));
  });

  testWidgets('API 401 ends the session', (tester) async {
    final repository = FakeAuthRepository(restored: _restored);
    await pumpApp(
      tester,
      repository: repository,
      api: fakeApi(
        status: 401,
        body: {
          'error': {'code': 'UNAUTHORIZED'},
        },
      ),
    );
    expect(repository.calls, ['signOut']);
    expect(find.text('Connexion'), findsWidgets);
  });

  testWidgets('without Supabase configuration the app still launches', (
    tester,
  ) async {
    await pumpApp(tester, repository: null);
    expect(find.text('Connexion'), findsWidgets);
    expect(
      find.text("L'authentification n'est pas configurée."),
      findsOneWidget,
    );
  });

  testWidgets('Arabic renders the login screen right-to-left', (tester) async {
    tester.platformDispatcher.localesTestValue = const [Locale('ar')];
    addTearDown(tester.platformDispatcher.clearLocalesTestValue);
    await pumpApp(tester, repository: FakeAuthRepository());
    expect(find.text('تسجيل الدخول'), findsWidgets);
    final direction = Directionality.of(
      tester.element(find.text('البريد الإلكتروني')),
    );
    expect(direction, TextDirection.rtl);
  });
}
