import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/features/auth/domain/account_setup.dart';
import 'package:chicman/features/auth/domain/auth_failure.dart';
import 'package:chicman/features/auth/domain/email.dart';
import 'package:chicman/features/auth/domain/email_link.dart';
import 'package:chicman/features/auth/domain/phone_number.dart';
import 'package:chicman/features/auth/domain/session_check.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'fakes.dart';

Future<SessionCheck> check(int status, [Object? body]) async =>
    interpretSessionCheck(
      await fakeApi(
        status: status,
        body: body,
      ).get('/auth/session', accessToken: 't', decode: ApiSession.fromJson),
    );

void main() {
  group('phone normalization (same rule as web)', () {
    test('normalizes to E.164', () {
      expect(normalizePhoneNumber('22 12 34 56'), '+22222123456');
      expect(normalizePhoneNumber('+222 22-12-34-56'), '+22222123456');
      expect(normalizePhoneNumber('00222 22123456'), '+22222123456');
      expect(normalizePhoneNumber('+33 6 12 34 56 78'), '+33612345678');
    });

    test('rejects invalid input', () {
      for (final value in ['', '123', 'abcdefgh', '+0123456789', '2212345']) {
        expect(normalizePhoneNumber(value), isNull, reason: value);
      }
    });
  });

  group('API session check (spec 03)', () {
    test('200 → active, with roles from the API', () async {
      final result = await check(200, {
        'userId': 'u1',
        'roles': ['CUSTOMER'],
      });
      expect(result, isA<SessionActive>());
      expect((result as SessionActive).session.roles, ['CUSTOMER']);
    });

    test('401 ends the session', () async {
      final result = await check(401, {
        'error': {'code': 'UNAUTHORIZED'},
      });
      expect(result, isA<SessionSignedOut>());
      expect(shouldEndSession(result), isTrue);
    });

    test('503 AUTH_UNAVAILABLE keeps the session', () async {
      final result = await check(503, {
        'error': {'code': 'AUTH_UNAVAILABLE'},
      });
      expect(result, isA<SessionUnavailable>());
      expect(shouldEndSession(result), isFalse);
    });

    test('a network error keeps the session', () async {
      final api = ApiClient(
        baseUrl: 'http://api.test',
        httpClient: MockClient((_) => throw http.ClientException('offline')),
      );
      final result = interpretSessionCheck(
        await api.get(
          '/auth/session',
          accessToken: 't',
          decode: ApiSession.fromJson,
        ),
      );
      expect(result, isA<SessionUnavailable>());
      expect(shouldEndSession(result), isFalse);
    });

    test('403 → not bootstrapped; other errors keep the session', () async {
      expect(await check(403), isA<SessionNotBootstrapped>());
      for (final result in [
        await check(500),
        await check(503, {
          'error': {'code': 'OTHER'},
        }),
      ]) {
        expect(result, isA<SessionCheckError>());
        expect(shouldEndSession(result), isFalse);
      }
    });

    test('sends the token only as a Bearer Authorization header', () async {
      final requests = <http.Request>[];
      await fakeApi(
        status: 200,
        body: {'userId': 'u1', 'roles': <String>[]},
        requests: requests,
      ).get(
        '/auth/session',
        accessToken: 'abc.def.ghi',
        decode: ApiSession.fromJson,
      );
      expect(requests.single.headers['authorization'], 'Bearer abc.def.ghi');
      expect(
        requests.single.url.toString(),
        'http://api.test/api/v1/auth/session',
      );
    });
  });

  test('maps Supabase error codes', () {
    expect(
      authFailureFromCode('invalid_credentials'),
      AuthFailure.invalidCredentials,
    );
    expect(
      authFailureFromCode('email_not_confirmed'),
      AuthFailure.emailNotConfirmed,
    );
    expect(authFailureFromCode('captcha_failed'), AuthFailure.captchaFailed);
    expect(
      authFailureFromCode('over_email_send_rate_limit'),
      AuthFailure.rateLimited,
    );
    expect(isEnumerationSensitive('user_already_exists'), isTrue);
    expect(isEnumerationSensitive('email_exists'), isTrue);
    expect(isEnumerationSensitive('weak_password'), isFalse);
    expect(
      authFailureFromCode(null, statusCode: '429'),
      AuthFailure.rateLimited,
    );
    expect(authFailureFromCode('unknown'), AuthFailure.generic);
  });

  group('email (same rule as web)', () {
    test('normalizes and rejects implausible addresses', () {
      expect(normalizeEmail('  Aicha@Example.COM '), 'aicha@example.com');
      for (final value in ['', 'a', 'a@b', 'a b@c.d', '@b.mr']) {
        expect(normalizeEmail(value), isNull, reason: value);
      }
    });
  });

  group('email links (spec 03)', () {
    const host = 'chicman.test';
    final hash = 'a' * 56;
    IncomingLink parse(String url) =>
        parseIncomingLink(Uri.parse(url), host: host);

    test(
      'accepts token_hash with type email or recovery on /auth/callback',
      () {
        final email = parse(
          'https://$host/auth/callback#token_hash=$hash&type=email',
        );
        expect(email, isA<ValidEmailLink>());
        expect(
          (email as ValidEmailLink).link,
          EmailLink(tokenHash: hash, type: EmailLinkType.email),
        );
        final recovery = parse(
          'https://$host/auth/callback#token_hash=$hash&type=recovery',
        );
        expect((recovery as ValidEmailLink).link.type, EmailLinkType.recovery);
      },
    );

    test('accepts Supabase default-template redirects (session tokens)', () {
      const jwt = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln';
      const base =
          'access_token=$jwt&expires_in=3600&refresh_token=abcdefgh12&token_type=bearer';
      final signup = parse('https://$host/auth/callback#$base&type=signup');
      expect(
        (signup as ValidEmailLink).link,
        const EmailLink.session(
          accessToken: jwt,
          refreshToken: 'abcdefgh12',
          type: EmailLinkType.email,
        ),
      );
      final recovery = parse('https://$host/auth/callback#$base&type=recovery');
      expect((recovery as ValidEmailLink).link.type, EmailLinkType.recovery);
      for (final fragment in [
        '$base&type=magiclink',
        base,
        'access_token=nope&refresh_token=abcdefgh12&type=signup',
        'access_token=$jwt&type=signup',
      ]) {
        expect(
          parse('https://$host/auth/callback#$fragment'),
          isA<InvalidEmailLink>(),
          reason: fragment,
        );
      }
      expect(signup.link.toString(), isNot(contains('abcdefgh12')));
    });

    test('ignores other hosts, schemes, and paths', () {
      for (final url in [
        'https://evil.test/auth/callback#token_hash=$hash&type=email',
        'http://$host/auth/callback#token_hash=$hash&type=email',
        'https://$host/account#token_hash=$hash&type=email',
      ]) {
        expect(parse(url), isA<NotAuthCallback>(), reason: url);
      }
      expect(
        parseIncomingLink(Uri.parse('https://$host/auth/callback'), host: null),
        isA<NotAuthCallback>(),
      );
    });

    test('invalid callbacks show the invalid-link screen', () {
      for (final fragment in [
        '',
        'type=email',
        'token_hash=$hash',
        'token_hash=$hash&type=signup',
        'token_hash=short&type=email',
        'error=access_denied&error_code=otp_expired',
      ]) {
        expect(
          parse('https://$host/auth/callback#$fragment'),
          isA<InvalidEmailLink>(),
          reason: fragment,
        );
      }
    });

    test('never prints the token', () {
      expect(
        EmailLink(tokenHash: hash, type: EmailLinkType.email).toString(),
        isNot(contains(hash)),
      );
    });
  });

  group('configuration', () {
    test(
      'builds the callback, link host, and Turnstile base URL from SITE_URL',
      () {
        const config = AppConfig(
          supabaseUrl: 'https://p.supabase.co',
          supabasePublishableKey: 'k',
          apiBaseUrl: 'http://api',
          siteUrl: 'https://chicman.test/',
          turnstileSiteKey: 'site-key',
        );
        expect(config.authCallbackUrl, 'https://chicman.test/auth/callback');
        expect(config.appLinkHost, 'chicman.test');
        expect(config.turnstileBaseUrl, 'https://chicman.test/');
        const bare = AppConfig(
          supabaseUrl: '',
          supabasePublishableKey: '',
          apiBaseUrl: '',
        );
        expect(bare.authCallbackUrl, isNull);
        expect(bare.turnstileBaseUrl, isNull);
      },
    );
  });

  group('account setup responses (spec 04)', () {
    Future<SetupOutcome> setup(int status, [Object? body]) async =>
        interpretSetupResult(
          await fakeApi(status: status, body: body).send(
            'POST',
            '/customers/me',
            accessToken: 't',
            body: {'phone': '+22222123456'},
            decode: CustomerAccount.fromJson,
          ),
        );
    final account = {
      'userId': 'u1',
      'roles': ['CUSTOMER'],
      'profile': {'phone': '+22222123456', 'fullName': null},
    };

    test('maps bootstrap responses', () async {
      expect(await setup(201, account), isA<SetupDone>());
      expect(await setup(200, account), isA<SetupDone>());
      expect(
        await setup(400, {
          'error': {'code': 'INVALID_PHONE'},
        }),
        isA<SetupInvalidPhone>(),
      );
      expect(
        await setup(403, {
          'error': {'code': 'EMAIL_NOT_CONFIRMED'},
        }),
        isA<SetupEmailNotConfirmed>(),
      );
      expect(await setup(401), isA<SetupSignedOut>());
      expect(
        await setup(503, {
          'error': {'code': 'AUTH_UNAVAILABLE'},
        }),
        isA<SetupUnavailable>(),
      );
      expect(
        await setup(429, {
          'error': {'code': 'RATE_LIMITED'},
        }),
        isA<SetupRateLimited>(),
      );
    });
  });
}
