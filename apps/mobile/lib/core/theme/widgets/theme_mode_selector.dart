import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_theme.dart';
import '../theme_mode_controller.dart';

/// Segmented System / Light / Dark selector; the choice is saved on the
/// device. Mirrors the web `ThemeSelector`.
class ThemeModeSelector extends ConsumerWidget {
  const ThemeModeSelector({super.key});

  static const _labels = {
    'fr': {
      ThemeMode.system: 'Système',
      ThemeMode.light: 'Clair',
      ThemeMode.dark: 'Sombre',
    },
    'ar': {
      ThemeMode.system: 'النظام',
      ThemeMode.light: 'فاتح',
      ThemeMode.dark: 'داكن',
    },
  };

  static const _icons = {
    ThemeMode.system: Icons.desktop_windows_outlined,
    ThemeMode.light: Icons.light_mode_outlined,
    ThemeMode.dark: Icons.dark_mode_outlined,
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mode = ref.watch(themeModeProvider);
    final locale = Localizations.maybeLocaleOf(context)?.languageCode;
    final labels = _labels[locale] ?? _labels['fr']!;

    return SegmentedButton<ThemeMode>(
      showSelectedIcon: false,
      segments: [
        for (final option in ThemeMode.values)
          ButtonSegment(
            value: option,
            label: Text(labels[option]!),
            icon: Icon(_icons[option], size: AppIconSize.inline),
          ),
      ],
      selected: {mode},
      onSelectionChanged: (selection) =>
          ref.read(themeModeProvider.notifier).setMode(selection.single),
    );
  }
}
