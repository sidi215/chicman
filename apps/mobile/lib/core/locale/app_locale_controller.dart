import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../storage/shared_preferences_provider.dart';

/// The interface language: the profile's `preferredLocale` once it is known,
/// or `null` to follow the device. It is kept on the device, so the app starts
/// in the right language, including offline and after signing out.
final appLocaleProvider = NotifierProvider<AppLocaleController, Locale?>(
  AppLocaleController.new,
);

class AppLocaleController extends Notifier<Locale?> {
  static const storageKey = 'chicman-locale';
  static const _languages = {'fr', 'ar'};

  @override
  Locale? build() {
    try {
      final stored = ref.read(sharedPreferencesProvider)?.getString(storageKey);
      return _languages.contains(stored) ? Locale(stored!) : null;
    } on Object catch (error) {
      debugPrint('Could not read the language: $error');
      return null;
    }
  }

  /// Applies [language] immediately, then saves it. Unknown values are ignored.
  Future<void> setLanguage(String language) async {
    if (!_languages.contains(language) || state?.languageCode == language) {
      return;
    }
    state = Locale(language);
    try {
      await ref
          .read(sharedPreferencesProvider)
          ?.setString(storageKey, language);
    } on Object catch (error) {
      // The language is applied; it is read from the profile again next time.
      debugPrint('Could not save the language: $error');
    }
  }
}
