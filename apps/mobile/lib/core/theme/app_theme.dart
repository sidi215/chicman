import 'package:flutter/material.dart';

import 'app_typography.dart';
import 'generated/design_tokens.g.dart';

/// Dimension tokens (generated from `packages/design-tokens`).
export 'generated/design_tokens.g.dart'
    show AppBrand, AppIconSize, AppRadius, AppSizes, AppSpacing;

/// Material 3 themes customized to the Chicman design system.
///
/// Light is the default; dark is provided with the same design language.
/// Direction (LTR for French, RTL for Arabic) comes from the active locale,
/// so widgets should use directional APIs (`EdgeInsetsDirectional`,
/// `AlignmentDirectional`, `start`/`end`).
abstract final class AppTheme {
  static final ThemeData light = _build(AppColors.light, Brightness.light);
  static final ThemeData dark = _build(AppColors.dark, Brightness.dark);

  static ThemeData _build(AppColors c, Brightness brightness) {
    final colorScheme = ColorScheme(
      brightness: brightness,
      primary: c.accentPrimary,
      onPrimary: c.accentPrimaryForeground,
      primaryContainer: c.accentHighlight,
      onPrimaryContainer: c.accentHighlightForeground,
      secondary: c.accentPrimary,
      onSecondary: c.accentPrimaryForeground,
      secondaryContainer: c.bgMuted,
      onSecondaryContainer: c.textPrimary,
      tertiary: c.accentHighlight,
      onTertiary: c.accentHighlightForeground,
      tertiaryContainer: c.accentHighlight,
      onTertiaryContainer: c.accentHighlightForeground,
      error: c.stateError,
      onError: c.accentPrimaryForeground,
      errorContainer: c.stateError.withValues(alpha: 0.12),
      onErrorContainer: c.stateErrorText,
      surface: c.bgSurface,
      onSurface: c.textPrimary,
      onSurfaceVariant: c.textMuted,
      surfaceDim: c.bgBase,
      surfaceBright: c.bgSurface,
      surfaceContainerLowest: c.bgSurface,
      surfaceContainerLow: c.bgSurface,
      surfaceContainer: c.bgSurface,
      surfaceContainerHigh: c.bgMuted,
      surfaceContainerHighest: c.bgMuted,
      outline: c.borderDefault,
      outlineVariant: c.borderDefault,
      inverseSurface: c.textPrimary,
      onInverseSurface: c.bgSurface,
      inversePrimary: c.accentPrimaryForeground,
      shadow: Colors.black,
      scrim: Colors.black,
      surfaceTint: Colors.transparent,
    );

    final textTheme = AppTypography.textTheme(c.textPrimary);
    final labelStyle = textTheme.labelLarge!;

    const buttonPadding = EdgeInsets.symmetric(horizontal: AppSpacing.s5);
    const buttonMinSize = Size(64, AppSizes.control);
    const pillShape = StadiumBorder();

    final filledStyle = FilledButton.styleFrom(
      backgroundColor: c.accentPrimary,
      foregroundColor: c.accentPrimaryForeground,
      disabledBackgroundColor: c.accentPrimary.withValues(alpha: 0.5),
      disabledForegroundColor: c.accentPrimaryForeground.withValues(alpha: 0.8),
      minimumSize: buttonMinSize,
      padding: buttonPadding,
      shape: pillShape,
      textStyle: labelStyle,
      elevation: 0,
      iconSize: AppIconSize.action,
    );

    OutlineInputBorder inputBorder(Color color, [double width = 1]) =>
        OutlineInputBorder(
          borderRadius: AppRadius.pill,
          borderSide: BorderSide(color: color, width: width),
        );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: c.bgBase,
      canvasColor: c.bgBase,
      dividerColor: c.borderDefault,
      fontFamily: AppTypography.fontSans,
      fontFamilyFallback: AppTypography.fontFallback,
      textTheme: textTheme,
      extensions: [c],
      appBarTheme: AppBarThemeData(
        backgroundColor: c.bgBase,
        foregroundColor: c.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        titleTextStyle: textTheme.titleLarge,
        iconTheme: IconThemeData(
          color: c.textPrimary,
          size: AppIconSize.action,
        ),
      ),
      iconTheme: IconThemeData(color: c.textPrimary, size: AppIconSize.action),
      filledButtonTheme: FilledButtonThemeData(style: filledStyle),
      elevatedButtonTheme: ElevatedButtonThemeData(style: filledStyle),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          backgroundColor: c.bgSurface,
          foregroundColor: c.textPrimary,
          side: BorderSide(color: c.borderDefault),
          minimumSize: buttonMinSize,
          padding: buttonPadding,
          shape: pillShape,
          textStyle: labelStyle,
          iconSize: AppIconSize.action,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: c.textPrimary,
          minimumSize: buttonMinSize,
          padding: buttonPadding,
          shape: pillShape,
          textStyle: labelStyle,
          iconSize: AppIconSize.action,
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          foregroundColor: c.textPrimary,
          minimumSize: const Size.square(AppSizes.touchTarget),
          iconSize: AppIconSize.action,
          shape: pillShape,
        ),
      ),
      inputDecorationTheme: InputDecorationThemeData(
        filled: true,
        fillColor: c.bgSurface,
        hintStyle: textTheme.bodyMedium!.copyWith(color: c.textMuted),
        labelStyle: textTheme.bodyMedium!.copyWith(color: c.textMuted),
        prefixIconColor: c.textMuted,
        suffixIconColor: c.textMuted,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.s5,
          vertical: AppSpacing.s3,
        ),
        constraints: const BoxConstraints(minHeight: AppSizes.control),
        border: inputBorder(c.borderDefault),
        enabledBorder: inputBorder(c.borderDefault),
        focusedBorder: inputBorder(c.textMuted, 1.5),
        // Error text uses the readable text token; borders keep the fill.
        errorStyle: textTheme.bodySmall!.copyWith(color: c.stateErrorText),
        errorBorder: inputBorder(c.stateError),
        focusedErrorBorder: inputBorder(c.stateError, 1.5),
        disabledBorder: inputBorder(c.borderDefault.withValues(alpha: 0.5)),
      ),
      cardTheme: CardThemeData(
        color: c.bgSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.card,
          side: BorderSide(color: c.borderDefault),
        ),
      ),
      chipTheme: ChipThemeData(
        color: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? c.accentChipActive
              : c.accentChipInactive,
        ),
        labelStyle: textTheme.labelLarge!.copyWith(
          fontWeight: FontWeight.w500,
          color: WidgetStateColor.resolveWith(
            (states) => states.contains(WidgetState.selected)
                ? c.accentChipActiveForeground
                : c.accentChipInactiveForeground,
          ),
        ),
        iconTheme: IconThemeData(size: AppIconSize.inline),
        side: BorderSide.none,
        shape: pillShape,
        showCheckmark: false,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s2),
      ),
      badgeTheme: BadgeThemeData(
        backgroundColor: c.accentPrimary,
        textColor: c.accentPrimaryForeground,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: c.bgSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.container),
        titleTextStyle: textTheme.titleLarge,
        contentTextStyle: textTheme.bodyMedium,
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: c.bgSurface,
        surfaceTintColor: Colors.transparent,
        modalBackgroundColor: c.bgSurface,
        elevation: 0,
        modalElevation: 0,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AppRadius.xxxl),
          ),
        ),
        showDragHandle: true,
        dragHandleColor: c.borderDefault,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: c.bgSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        height: 64,
        indicatorColor: c.bgMuted,
        indicatorShape: pillShape,
        iconTheme: WidgetStatePropertyAll(
          IconThemeData(color: c.textPrimary, size: AppIconSize.navigation),
        ),
        labelTextStyle: WidgetStatePropertyAll(textTheme.labelMedium),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: c.accentPrimary,
        contentTextStyle: textTheme.bodyMedium!.copyWith(
          color: c.accentPrimaryForeground,
        ),
        actionTextColor: c.accentHighlight,
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.card),
        elevation: 0,
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll(
            Size(0, AppSizes.controlSm),
          ),
          shape: const WidgetStatePropertyAll(pillShape),
          side: WidgetStatePropertyAll(BorderSide(color: c.borderDefault)),
          textStyle: WidgetStatePropertyAll(textTheme.labelMedium),
          iconSize: const WidgetStatePropertyAll(AppIconSize.inline),
          backgroundColor: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.selected)
                ? c.accentChipActive
                : c.bgSurface,
          ),
          foregroundColor: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.selected)
                ? c.accentChipActiveForeground
                : c.textMuted,
          ),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: c.borderDefault,
        thickness: 1,
        space: 1,
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: c.accentPrimary,
        linearTrackColor: c.bgMuted,
        circularTrackColor: c.bgMuted,
      ),
      textSelectionTheme: TextSelectionThemeData(
        cursorColor: c.accentPrimary,
        selectionColor: c.accentHighlight,
        selectionHandleColor: c.accentPrimary,
      ),
    );
  }
}
