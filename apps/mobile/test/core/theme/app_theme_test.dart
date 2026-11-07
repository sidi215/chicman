import 'package:chicman/core/theme/app_colors.dart';
import 'package:chicman/core/theme/app_theme.dart';
import 'package:chicman/core/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AppColors', () {
    test('light tokens match context/ui-context.md', () {
      const c = AppColors.light;
      expect(c.bgBase, const Color(0xFFF4F7FB));
      expect(c.bgSurface, const Color(0xFFFFFFFF));
      expect(c.bgMuted, const Color(0xFFF0F2F5));
      expect(c.textPrimary, const Color(0xFF09090B));
      expect(c.textMuted, const Color(0xFF71717A));
      expect(c.accentPrimary, const Color(0xFF09090B));
      expect(c.accentHighlight, const Color(0xFFB9D7FE));
      expect(c.accentChipActive, const Color(0xFF09090B));
      expect(c.accentChipInactive, const Color(0xFFF0F2F5));
      expect(c.borderDefault, const Color(0xFFE4E4E7));
      expect(c.stateError, const Color(0xFFEF4444));
      expect(c.stateSuccess, const Color(0xFF22C55E));
      expect(c.stateWarning, const Color(0xFFF59E0B));
      expect(c.stateSuccessText, const Color(0xFF166534));
      expect(c.stateWarningText, const Color(0xFF92400E));
      expect(c.stateErrorText, const Color(0xFFB91C1C));
    });

    test('status text tokens meet WCAG AA (4.5:1) on light surfaces', () {
      const c = AppColors.light;
      double ratio(Color a, Color b) {
        final l1 = a.computeLuminance(), l2 = b.computeLuminance();
        return (l1 > l2 ? l1 + 0.05 : l2 + 0.05) /
            (l1 > l2 ? l2 + 0.05 : l1 + 0.05);
      }

      for (final text in [
        c.stateSuccessText,
        c.stateWarningText,
        c.stateErrorText,
      ]) {
        for (final bg in [c.bgSurface, c.bgBase, c.bgMuted]) {
          expect(ratio(text, bg), greaterThanOrEqualTo(4.5));
        }
      }
    });

    test('input error text uses the readable error token', () {
      final style = AppTheme.light.inputDecorationTheme.errorStyle;
      expect(style?.color, AppColors.light.stateErrorText);
    });
  });

  group('AppTheme', () {
    for (final (name, theme, colors, brightness) in [
      ('light', AppTheme.light, AppColors.light, Brightness.light),
      ('dark', AppTheme.dark, AppColors.dark, Brightness.dark),
    ]) {
      test('$name theme is built from the design tokens', () {
        expect(theme.useMaterial3, isTrue);
        expect(theme.brightness, brightness);
        expect(theme.extension<AppColors>(), colors);
        expect(theme.scaffoldBackgroundColor, colors.bgBase);
        expect(theme.colorScheme.primary, colors.accentPrimary);
        expect(theme.colorScheme.surface, colors.bgSurface);
        expect(theme.textTheme.bodyMedium!.fontFamily, AppTypography.fontSans);
        expect(
          theme.textTheme.bodyMedium!.fontFamilyFallback,
          contains(AppTypography.fontArabic),
        );
      });
    }
  });

  group('text direction', () {
    Future<TextDirection> directionFor(
      WidgetTester tester,
      Locale locale,
    ) async {
      late TextDirection direction;
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light,
          locale: locale,
          supportedLocales: const [Locale('fr'), Locale('ar')],
          localizationsDelegates: GlobalMaterialLocalizations.delegates,
          home: Builder(
            builder: (context) {
              direction = Directionality.of(context);
              return const SizedBox.shrink();
            },
          ),
        ),
      );
      return direction;
    }

    testWidgets('French is LTR', (tester) async {
      expect(await directionFor(tester, const Locale('fr')), TextDirection.ltr);
    });

    testWidgets('Arabic is RTL', (tester) async {
      expect(await directionFor(tester, const Locale('ar')), TextDirection.rtl);
    });
  });
}
