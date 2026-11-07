import 'package:chicman/core/theme/app_theme.dart';
import 'package:chicman/core/theme/widgets/brand_wordmark.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Future<Image> pump(WidgetTester tester, ThemeData theme) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: theme,
        home: const Scaffold(
          body: Center(child: BrandWordmark(semanticLabel: 'Chicman')),
        ),
      ),
    );
    // MaterialApp animates theme changes.
    await tester.pumpAndSettle();
    return tester.widget<Image>(find.byType(Image));
  }

  testWidgets('uses the token asset and size, with an accessible label', (
    tester,
  ) async {
    final image = await pump(tester, AppTheme.light);
    expect((image.image as AssetImage).assetName, AppBrand.wordmarkAsset);
    expect(image.height, AppSizes.brandWordmark);
    expect(image.width, AppSizes.brandWordmark * AppBrand.wordmarkAspectRatio);
    expect(find.bySemanticsLabel('Chicman'), findsOneWidget);
  });

  testWidgets('is tinted with the theme text colour in light and dark', (
    tester,
  ) async {
    final light = await pump(tester, AppTheme.light);
    expect(light.color, AppTheme.light.colorScheme.onSurface);
    final dark = await pump(tester, AppTheme.dark);
    expect(dark.color, AppTheme.dark.colorScheme.onSurface);
    expect(dark.colorBlendMode, BlendMode.srcIn);
  });
}
