import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/core/theme/app_theme.dart';
import 'package:chicman/core/theme/theme_mode_controller.dart';
import 'package:chicman/core/theme/widgets/theme_mode_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<ProviderContainer> containerWith(Map<String, Object> stored) async {
  SharedPreferences.setMockInitialValues(stored);
  final prefs = await SharedPreferences.getInstance();
  final container = ProviderContainer(
    overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('ThemeModeController', () {
    test('defaults to system when nothing is stored', () async {
      final container = await containerWith({});
      expect(container.read(themeModeProvider), ThemeMode.system);
    });

    test('restores the stored preference', () async {
      final container = await containerWith({'chicman-theme': 'dark'});
      expect(container.read(themeModeProvider), ThemeMode.dark);
    });

    test('ignores invalid stored values', () async {
      final container = await containerWith({'chicman-theme': 'purple'});
      expect(container.read(themeModeProvider), ThemeMode.system);
    });

    test('persists a new selection on the device', () async {
      final container = await containerWith({});
      await container.read(themeModeProvider.notifier).setMode(ThemeMode.light);

      expect(container.read(themeModeProvider), ThemeMode.light);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('chicman-theme'), 'light');
    });
  });

  testWidgets('selector switches the app theme', (tester) async {
    final container = await containerWith({});

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: Consumer(
          builder: (context, ref, _) => MaterialApp(
            theme: AppTheme.light,
            darkTheme: AppTheme.dark,
            themeMode: ref.watch(themeModeProvider),
            home: const Scaffold(body: Center(child: ThemeModeSelector())),
          ),
        ),
      ),
    );

    expect(find.text('Système'), findsOneWidget);
    await tester.tap(find.text('Sombre'));
    await tester.pumpAndSettle();

    expect(container.read(themeModeProvider), ThemeMode.dark);
    final context = tester.element(find.byType(ThemeModeSelector));
    expect(Theme.of(context).brightness, Brightness.dark);
  });
}
