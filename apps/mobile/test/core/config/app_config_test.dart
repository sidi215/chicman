import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/config/configuration_error_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

AppConfig _config({
  String supabaseUrl = 'https://ref.supabase.co',
  String apiBaseUrl = 'http://localhost:4000',
  String siteUrl = 'http://localhost:3000',
  String turnstileSiteKey = '0x4AAAAAAAtest',
}) => AppConfig(
  supabaseUrl: supabaseUrl,
  supabasePublishableKey: 'sb_publishable_test',
  apiBaseUrl: apiBaseUrl,
  siteUrl: siteUrl,
  turnstileSiteKey: turnstileSiteKey,
);

void main() {
  group('URL validation', () {
    test('accepts http and https URLs with a host', () {
      for (final value in [
        'http://localhost:3000',
        'https://localhost:3000/',
        'http://10.0.2.2:4000',
        'https://chicman.mr',
        ' http://localhost:3000 ',
      ]) {
        expect(AppConfig.isHttpUrl(value), isTrue, reason: value);
      }
    });

    test('refuses malformed schemes and missing hosts', () {
      for (final value in [
        'htt://localhost:3000',
        'htp://localhost:3000',
        'ftp://localhost:3000',
        'localhost:3000',
        'http:/localhost:3000',
        'http://',
        '',
        'not a url',
      ]) {
        expect(AppConfig.isHttpUrl(value), isFalse, reason: value);
      }
    });
  });

  group('the crash on the device (SITE_URL=htt://localhost:3000)', () {
    final config = _config(siteUrl: 'htt://localhost:3000');

    test('is reported as a configuration problem', () {
      expect(config.problems, [
        const ConfigProblem('SITE_URL', 'htt://localhost:3000'),
      ]);
    });

    test(
      'no derived value throws: Turnstile fails closed, no callback or link host',
      () {
        expect(() => config.turnstileBaseUrl, returnsNormally);
        expect(config.turnstileBaseUrl, isNull);
        expect(config.turnstileRequired, isTrue, reason: 'never bypassed');
        expect(config.authCallbackUrl, isNull);
        expect(config.appLinkHost, isNull);
      },
    );
  });

  group('the expected Android configuration (README, physical device)', () {
    final config = _config();

    test('is valid', () => expect(config.problems, isEmpty));

    test(
      'gives Turnstile the localhost origin, the callback, and the link host',
      () {
        expect(config.turnstileBaseUrl, 'http://localhost:3000/');
        expect(config.authCallbackUrl, 'http://localhost:3000/auth/callback');
        expect(config.appLinkHost, 'localhost');
      },
    );

    test('an https site keeps its origin, without a path', () {
      final https = _config(siteUrl: 'https://chicman.mr/fr/');
      expect(https.turnstileBaseUrl, 'https://chicman.mr/');
      expect(https.authCallbackUrl, 'https://chicman.mr/fr/auth/callback');
    });
  });

  group('other settings', () {
    test('every unusable URL is listed by its --dart-define name', () {
      final config = _config(
        supabaseUrl: 'htps://ref.supabase.co',
        apiBaseUrl: 'localhost:4000',
        siteUrl: 'htt://localhost:3000',
      );
      expect(config.problems.map((problem) => problem.name), [
        'SUPABASE_URL',
        'API_BASE_URL',
        'SITE_URL',
      ]);
    });

    test('optional values may be empty', () {
      expect(_config(supabaseUrl: '', siteUrl: '').problems, isEmpty);
      // A site key without SITE_URL keeps failing closed (README).
      final noSite = _config(siteUrl: '');
      expect(noSite.turnstileRequired, isTrue);
      expect(noSite.turnstileBaseUrl, isNull);
    });
  });

  group('configuration error screen', () {
    const problems = [ConfigProblem('SITE_URL', 'htt://localhost:3000')];

    testWidgets('names the bad value in French', (tester) async {
      tester.platformDispatcher.localesTestValue = const [Locale('fr')];
      addTearDown(tester.platformDispatcher.clearLocalesTestValue);
      await tester.pumpWidget(const ConfigurationErrorApp(problems: problems));
      expect(find.text('Configuration invalide'), findsOneWidget);
      expect(find.text('SITE_URL = "htt://localhost:3000"'), findsOneWidget);
    });

    testWidgets('reads right to left in Arabic', (tester) async {
      tester.platformDispatcher.localesTestValue = const [Locale('ar')];
      addTearDown(tester.platformDispatcher.clearLocalesTestValue);
      await tester.pumpWidget(const ConfigurationErrorApp(problems: problems));
      expect(find.text('إعدادات التطبيق غير صالحة'), findsOneWidget);
      expect(
        Directionality.of(
          tester.element(find.byKey(const Key('configuration-error'))),
        ),
        TextDirection.rtl,
      );
    });
  });
}
