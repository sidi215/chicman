import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Device key-value storage, or `null` when it could not be initialized.
///
/// Loaded once in `main()` with [loadSharedPreferences] and injected with
/// `sharedPreferencesProvider.overrideWithValue(prefs)`, so reads are
/// synchronous everywhere else. Storage is optional: features must keep
/// working (without persistence) when this is `null`.
final sharedPreferencesProvider = Provider<SharedPreferences?>(
  (ref) => throw UnimplementedError(
    'sharedPreferencesProvider must be overridden in ProviderScope.',
  ),
);

/// Loads [SharedPreferences] without ever blocking app startup.
///
/// Returns `null` if the platform store throws or does not answer within
/// [timeout]; the caller then launches with defaults.
Future<SharedPreferences?> loadSharedPreferences({
  Future<SharedPreferences> Function() loader = SharedPreferences.getInstance,
  Duration timeout = const Duration(seconds: 3),
}) async {
  try {
    return await loader().timeout(timeout);
  } on Object catch (error) {
    debugPrint('Preferences unavailable, using defaults: $error');
    return null;
  }
}
