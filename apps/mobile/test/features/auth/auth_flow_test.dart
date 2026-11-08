import 'dart:async';
import 'dart:convert';

import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/auth/domain/auth_failure.dart';
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

const _activeSession = {
  'userId': 'u1',
  'roles': ['CUSTOMER'],
};
const _account = {
  'userId': 'u1',
  'roles': ['CUSTOMER'],
  'profile': {'id': 'p1', 'phone': '+22222123456', 'fullName': null},
};

ApiClient _bootstrappedApi() => routedApi({
  'GET /auth/session': (_) => (200, _activeSession),
  'GET /customers/me': (_) => (200, _account),
});

Future<void> pumpApp(
  WidgetTester tester, {
  required AuthRepository? repository,
  ApiClient? api,
  Stream<Uri>? links,
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
      child: const MyApp(),
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
    expect(find.text('Mon compte'), findsOneWidget);
    expect(find.text('Connecté en tant que aicha@example.com'), findsOneWidget);
    expect(find.text('Session active. Rôles : CUSTOMER'), findsOneWidget);
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
    expect(find.text('Mon compte'), findsOneWidget);
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
        'POST /customers/me': (request) {
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
        'GET /customers/me': (_) => (200, _account),
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
      // Spec 05: the delivery address is offered right after setup (skippable).
      expect(find.text('Où souhaitez-vous être livré ?'), findsOneWidget);
      await tester.tap(find.byKey(const Key('address-later')));
      await tester.pumpAndSettle();
      expect(find.text('Session active. Rôles : CUSTOMER'), findsOneWidget);
      expect(find.textContaining('(non vérifié)'), findsOneWidget);
    },
  );

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
    expect(find.text('Mon compte'), findsOneWidget);
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
