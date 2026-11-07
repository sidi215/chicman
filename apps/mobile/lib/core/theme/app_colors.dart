import 'package:flutter/material.dart';

import 'generated/design_tokens.g.dart';

/// Semantic colors come from `packages/design-tokens` (shared with the web).
/// [AppColors] is generated — run `pnpm tokens` after changing the tokens.
export 'generated/design_tokens.g.dart' show AppColors;

/// Shorthand access to the design-system colors of the current theme.
extension AppColorsContext on BuildContext {
  AppColors get appColors =>
      Theme.of(this).extension<AppColors>() ?? AppColors.light;
}
