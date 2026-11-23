import 'dart:convert';

import 'package:chicman/core/config/app_config.dart';
import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/core/theme/app_theme.dart';
import 'package:chicman/features/auth/application/auth_providers.dart';
import 'package:chicman/features/auth/data/auth_repository.dart';
import 'package:chicman/features/moderation/domain/product_report.dart';
import 'package:chicman/features/moderation/presentation/report_messages.dart';
import 'package:chicman/features/moderation/presentation/report_product.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../auth/fakes.dart';

const _config = AppConfig(
  supabaseUrl: 'https://p.supabase.co',
  supabasePublishableKey: 'k',
  apiBaseUrl: 'http://api.test',
  siteUrl: 'https://shop.test',
);

const _productId = '11111111-1111-4111-8111-111111111111';

AuthRepository _signedIn() => FakeAuthRepository(
  restored: const AuthSession(userId: 'u1', email: 'a@b.c'),
);

Future<void> _pump(
  WidgetTester tester, {
  required ApiClient api,
  AuthRepository? repository,
  Locale? locale,
}) async {
  await tester.binding.setSurfaceSize(const Size(400, 1200));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(null),
        appConfigProvider.overrideWithValue(_config),
        authRepositoryProvider.overrideWithValue(repository),
        apiClientProvider.overrideWithValue(api),
      ],
      child: MaterialApp(
        theme: AppTheme.light,
        locale: locale,
        supportedLocales: const [Locale('fr'), Locale('ar')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: const Scaffold(
          body: ReportProductButton(productId: _productId, name: 'Robe brodée'),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Finder _key(String key) => find.byKey(Key(key));

void main() {
  group('report body (spec 19)', () {
    test('needs a reason, and a description with OTHER', () {
      expect(
        buildProductReport(_productId, null, '').error,
        ReportFormError.reasonRequired,
      );
      expect(
        buildProductReport(_productId, ProductReportReason.other, '  ').error,
        ReportFormError.detailsRequired,
      );
      expect(
        buildProductReport(
          _productId,
          ProductReportReason.counterfeit,
          '',
        ).body,
        {'productId': _productId, 'reasonCode': 'COUNTERFEIT'},
      );
      expect(
        buildProductReport(
          _productId,
          ProductReportReason.other,
          '  Vendu porté ',
        ).body,
        {
          'productId': _productId,
          'reasonCode': 'OTHER',
          'details': 'Vendu porté',
        },
      );
      expect(
        buildProductReport(
          _productId,
          ProductReportReason.notNew,
          'x' * 1001,
        ).error,
        ReportFormError.detailsLength,
      );
      expect(
        buildProductReport(
          _productId,
          ProductReportReason.notNew,
          'a\u0007b',
        ).error,
        ReportFormError.detailsInvalid,
      );
    });

    test('uses the API reason codes', () {
      expect(ProductReportReason.values.map((reason) => reason.code), [
        'COUNTERFEIT',
        'PROHIBITED_ITEM',
        'NOT_NEW',
        'NOT_FASHION',
        'MISLEADING_INFORMATION',
        'INAPPROPRIATE_CONTENT',
        'OTHER',
      ]);
    });

    test('reads a new report and a repeat the same way (PD-4)', () {
      expect(
        interpretReportResult(const ApiOk<Object?>(null, statusCode: 201)),
        ReportOutcome.sent,
      );
      expect(
        interpretReportResult(const ApiOk<Object?>(null, statusCode: 200)),
        ReportOutcome.sent,
      );
      expect(
        interpretReportResult(
          const ApiError<Object?>(404, 'PRODUCT_NOT_FOUND'),
        ),
        ReportOutcome.notFound,
      );
      expect(
        interpretReportResult(const ApiError<Object?>(429, 'RATE_LIMITED')),
        ReportOutcome.rateLimited,
      );
      expect(
        interpretReportResult(const ApiForbidden<Object?>('FORBIDDEN')),
        ReportOutcome.notAllowed,
      );
    });
  });

  group('report texts', () {
    test('has every text in French and Arabic', () {
      final [fr, ar] = ReportMessages.all;
      expect(ar.keys, fr.keys);
      for (final reason in ProductReportReason.values) {
        expect(fr.keys, contains('reason.${reason.name}'));
      }
      for (final error in ReportFormError.values) {
        expect(fr.keys, contains('error.${error.name}'));
      }
      for (final outcome in ReportOutcome.values) {
        expect(fr.keys, contains('outcome.${outcome.name}'));
      }
    });
  });

  group('report action', () {
    testWidgets('a guest sees the action and nothing is sent', (tester) async {
      final requests = <http.Request>[];
      await _pump(
        tester,
        api: routedApi(const {}, requests: requests),
        repository: FakeAuthRepository(),
      );
      expect(find.text('Signaler'), findsOneWidget);
      expect(
        requests.where((r) => r.url.path.contains('product-reports')),
        isEmpty,
      );
    });

    testWidgets('a seller account does not see it', (tester) async {
      await _pump(
        tester,
        api: routedApi({
          'GET /auth/session': (_) =>
              (200, {'userId': 'u1', 'accountType': 'SELLER'}),
        }),
        repository: _signedIn(),
      );
      expect(_key('report-product'), findsNothing);
    });

    testWidgets(
      'a buyer reports: the reason is required, then "Signalement envoyé"',
      (tester) async {
        Map<String, Object?>? sent;
        await _pump(
          tester,
          api: routedApi({
            'GET /auth/session': (_) =>
                (200, {'userId': 'u1', 'accountType': 'BUYER'}),
            'POST /customers/me/product-reports': (request) {
              sent = jsonDecode(request.body) as Map<String, Object?>;
              return (
                201,
                {
                  'reportId': 'r1',
                  'productId': _productId,
                  'reasonCode': 'OTHER',
                  'createdAt': '2026-11-20T10:00:00.000Z',
                },
              );
            },
          }),
          repository: _signedIn(),
        );
        await tester.tap(_key('report-product'));
        await tester.pumpAndSettle();
        expect(_key('report-sheet'), findsOneWidget);

        await tester.tap(_key('report-submit'));
        await tester.pumpAndSettle();
        expect(_key('report-reason-error'), findsOneWidget);
        expect(sent, isNull);

        await tester.tap(_key('report-reason-OTHER'));
        await tester.pumpAndSettle();
        await tester.tap(_key('report-submit'));
        await tester.pumpAndSettle();
        expect(
          find.text('Décrivez le problème pour le motif « Autre ».'),
          findsOneWidget,
        );
        expect(sent, isNull);

        await tester.enterText(_key('report-details'), 'Article déjà porté');
        await tester.tap(_key('report-submit'));
        await tester.pumpAndSettle();
        expect(sent, {
          'productId': _productId,
          'reasonCode': 'OTHER',
          'details': 'Article déjà porté',
        });
        expect(_key('report-sent'), findsOneWidget);
        expect(find.text('Signalement envoyé'), findsOneWidget);
      },
    );

    testWidgets('in Arabic, right to left, with a refusal shown', (
      tester,
    ) async {
      await _pump(
        tester,
        api: routedApi({
          'GET /auth/session': (_) =>
              (200, {'userId': 'u1', 'accountType': 'BUYER'}),
          'POST /customers/me/product-reports': (_) => (
            429,
            {
              'error': {'code': 'RATE_LIMITED'},
            },
          ),
        }),
        repository: _signedIn(),
        locale: const Locale('ar'),
      );
      expect(find.text('إبلاغ'), findsOneWidget);
      await tester.tap(_key('report-product'));
      await tester.pumpAndSettle();
      expect(
        Directionality.of(tester.element(_key('report-sheet'))),
        TextDirection.rtl,
      );
      await tester.tap(_key('report-reason-COUNTERFEIT'));
      await tester.pumpAndSettle();
      await tester.tap(_key('report-submit'));
      await tester.pumpAndSettle();
      expect(
        find.text('أرسلت بلاغات كثيرة. حاول مرة أخرى غدًا.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });
  });
}
