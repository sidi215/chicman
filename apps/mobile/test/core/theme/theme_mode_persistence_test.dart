import 'dart:async';

import 'package:chicman/core/storage/shared_preferences_provider.dart';
import 'package:chicman/core/theme/theme_mode_controller.dart';
import 'package:chicman/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A store whose writes complete only when the test says so.
class ControlledStore implements ThemePreferenceStore {
  ThemeMode? persisted;
  final List<(ThemeMode, Completer<void>)> pending = [];
  int active = 0;
  int maxConcurrent = 0;

  @override
  ThemeMode? read() => persisted;

  @override
  Future<void> write(ThemeMode mode) async {
    final completer = Completer<void>();
    pending.add((mode, completer));
    active++;
    if (active > maxConcurrent) maxConcurrent = active;
    await completer.future;
    persisted = mode;
    active--;
  }

  /// Completes the write started at [index] (in start order).
  void complete(int index) => pending[index].$2.complete();
}

class FailingStore implements ThemePreferenceStore {
  @override
  ThemeMode? read() => throw StateError('read failed');

  @override
  Future<void> write(ThemeMode mode) =>
      Future.error(StateError('write failed'));
}

ProviderContainer containerWithStore(ThemePreferenceStore store) {
  final container = ProviderContainer(
    overrides: [themePreferenceStoreProvider.overrideWithValue(store)],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('startup without preference storage', () {
    test(
      'loadSharedPreferences returns null when initialization throws',
      () async {
        final prefs = await loadSharedPreferences(
          loader: () => Future.error(Exception('platform channel unavailable')),
        );
        expect(prefs, isNull);
      },
    );

    test(
      'loadSharedPreferences returns null when initialization hangs',
      () async {
        final prefs = await loadSharedPreferences(
          loader: () => Completer<SharedPreferences>().future,
          timeout: const Duration(milliseconds: 10),
        );
        expect(prefs, isNull);
      },
    );

    test(
      'loadSharedPreferences returns the instance when it succeeds',
      () async {
        SharedPreferences.setMockInitialValues({'chicman-theme': 'dark'});
        final prefs = await loadSharedPreferences();
        expect(prefs?.getString('chicman-theme'), 'dark');
      },
    );

    testWidgets(
      'app launches on the System theme and the selector still works',
      (tester) async {
        await tester.pumpWidget(
          ProviderScope(
            overrides: [sharedPreferencesProvider.overrideWithValue(null)],
            child: const MyApp(),
          ),
        );
        // The selector is on the auth screen, shown once the session resolves.
        await tester.pumpAndSettle();

        final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
        expect(app.themeMode, ThemeMode.system);

        await tester.tap(find.text('Sombre'));
        await tester.pumpAndSettle();
        expect(
          tester.widget<MaterialApp>(find.byType(MaterialApp)).themeMode,
          ThemeMode.dark,
        );
      },
    );
  });

  group('write ordering', () {
    test(
      'Light then Dark before the first write completes persists Dark',
      () async {
        final store = ControlledStore();
        final container = containerWithStore(store);
        final controller = container.read(themeModeProvider.notifier);

        final light = controller.setMode(ThemeMode.light);
        expect(container.read(themeModeProvider), ThemeMode.light);

        final dark = controller.setMode(ThemeMode.dark);
        // The UI reflects the latest selection immediately.
        expect(container.read(themeModeProvider), ThemeMode.dark);
        // The second write waits for the first one.
        expect(store.pending, hasLength(1));

        store.complete(0); // the Light write finishes
        await pumpEventQueue();
        expect(store.pending.map((p) => p.$1), [
          ThemeMode.light,
          ThemeMode.dark,
        ]);

        store.complete(1);
        await Future.wait([light, dark]);

        expect(store.persisted, ThemeMode.dark);
        expect(store.maxConcurrent, 1);
        expect(container.read(themeModeProvider), ThemeMode.dark);
      },
    );

    test('rapid selections coalesce to the latest one', () async {
      final store = ControlledStore();
      final container = containerWithStore(store);
      final controller = container.read(themeModeProvider.notifier);

      final first = controller.setMode(ThemeMode.light);
      unawaited(controller.setMode(ThemeMode.dark));
      unawaited(controller.setMode(ThemeMode.system));
      final last = controller.setMode(ThemeMode.dark);

      store.complete(0);
      await pumpEventQueue();
      store.complete(1);
      await Future.wait([first, last]);

      expect(store.pending.map((p) => p.$1), [ThemeMode.light, ThemeMode.dark]);
      expect(store.persisted, ThemeMode.dark);
    });

    test('storage failures keep the selection for the session', () async {
      final container = containerWithStore(FailingStore());
      expect(container.read(themeModeProvider), ThemeMode.system);

      await container.read(themeModeProvider.notifier).setMode(ThemeMode.light);
      expect(container.read(themeModeProvider), ThemeMode.light);
    });
  });
}
