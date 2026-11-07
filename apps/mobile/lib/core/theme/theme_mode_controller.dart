import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../storage/shared_preferences_provider.dart';

/// Where the theme preference is persisted.
abstract interface class ThemePreferenceStore {
  /// The stored preference, or `null` if none (or invalid).
  ThemeMode? read();

  /// Persists [mode]. Callers never run two writes at once.
  Future<void> write(ThemeMode mode);
}

/// Persists to [SharedPreferences] as `system` / `light` / `dark`, the same
/// values the web stores under its `chicman-theme` key.
class SharedPreferencesThemeStore implements ThemePreferenceStore {
  SharedPreferencesThemeStore(this._prefs);

  static const storageKey = 'chicman-theme';

  final SharedPreferences _prefs;

  @override
  ThemeMode? read() =>
      ThemeMode.values.asNameMap()[_prefs.getString(storageKey)];

  @override
  Future<void> write(ThemeMode mode) => _prefs.setString(storageKey, mode.name);
}

/// Session-only fallback used when device storage is unavailable.
class InMemoryThemeStore implements ThemePreferenceStore {
  ThemeMode? _mode;

  @override
  ThemeMode? read() => _mode;

  @override
  Future<void> write(ThemeMode mode) async => _mode = mode;
}

final themePreferenceStoreProvider = Provider<ThemePreferenceStore>((ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  return prefs == null
      ? InMemoryThemeStore()
      : SharedPreferencesThemeStore(prefs);
});

/// Theme preference: System (default), Light, or Dark, persisted on the
/// device. With [ThemeMode.system] the app follows the OS setting.
final themeModeProvider = NotifierProvider<ThemeModeController, ThemeMode>(
  ThemeModeController.new,
);

class ThemeModeController extends Notifier<ThemeMode> {
  static const defaultMode = ThemeMode.system;

  /// The write loop currently running, if any.
  Future<void>? _persisting;

  /// Whether [state] changed after the running write started.
  bool _dirty = false;

  @override
  ThemeMode build() {
    try {
      return ref.read(themePreferenceStoreProvider).read() ?? defaultMode;
    } on Object catch (error) {
      debugPrint('Could not read theme preference: $error');
      return defaultMode;
    }
  }

  /// Applies [mode] immediately, then persists it.
  ///
  /// Platform stores do not guarantee that overlapping writes finish in call
  /// order (e.g. the Linux backend rewrites a file asynchronously per call),
  /// so writes are serialized: at most one runs at a time, and when it
  /// finishes the latest selection is written next. Intermediate selections
  /// may be skipped; the last one always wins. The returned future completes
  /// once the latest selection is persisted.
  Future<void> setMode(ThemeMode mode) {
    if (mode == state) return _persisting ?? Future.value();
    state = mode;
    _dirty = true;
    return _persisting ??= _persistLatest();
  }

  Future<void> _persistLatest() async {
    final store = ref.read(themePreferenceStoreProvider);
    try {
      while (_dirty) {
        _dirty = false;
        final mode = state;
        try {
          await store.write(mode);
        } on Object catch (error) {
          // The UI already shows the selection; keep it for this session.
          debugPrint('Could not persist theme preference: $error');
        }
      }
    } finally {
      _persisting = null;
    }
  }
}
