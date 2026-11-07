import 'package:flutter/material.dart';

import 'generated/design_tokens.g.dart';

/// Typography of the Chicman design system.
///
/// Families, the type scale, and weights are generated from
/// `packages/design-tokens` (shared with the web `type-*` utilities).
/// Latin text uses Plus Jakarta Sans; Arabic glyphs fall back to
/// Noto Sans Arabic — the same font stack order as the web `--font-sans`.
abstract final class AppTypography {
  /// `--font-sans`.
  static const String fontSans = AppFontFamilies.sans;

  /// `--font-arabic`.
  static const String fontArabic = AppFontFamilies.arabic;

  /// `--font-mono`.
  static const String fontMono = AppFontFamilies.mono;

  /// Fallbacks applied to every UI text style (Arabic script support).
  static const List<String> fontFallback = AppFontFamilies.sansFallback;

  /// Material 3 text roles in [color].
  static TextTheme textTheme(Color color) => AppTextStyles.textTheme(color);

  /// Monospace style (`type-mono` on the web), e.g. order references.
  static TextStyle mono(Color color) => AppTextStyles.mono(color);
}
