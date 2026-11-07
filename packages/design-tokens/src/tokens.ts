/**
 * Chicman design tokens — the single source of truth for visual foundations.
 *
 * Every platform theme is generated from this file:
 *   pnpm tokens          regenerate web + Flutter outputs
 *   pnpm tokens:check    fail if generated outputs are out of date
 *
 * Never edit generated files by hand. See README.md for the output list.
 * Units: px for dimensions (converted to rem for the web), hex for colors.
 */

export type HexColor = `#${string}`;

/** Semantic color roles. Names map to CSS `--<name>` and Dart `camelCase`. */
export type ColorRole =
  | "bg-base"
  | "bg-surface"
  | "bg-muted"
  | "text-primary"
  | "text-muted"
  | "accent-primary"
  | "accent-primary-foreground"
  | "accent-highlight"
  | "accent-highlight-foreground"
  | "accent-chip-active"
  | "accent-chip-active-foreground"
  | "accent-chip-inactive"
  | "accent-chip-inactive-foreground"
  | "border-default"
  | "state-error"
  | "state-error-text"
  | "state-success"
  | "state-success-text"
  | "state-warning"
  | "state-warning-text";

export type Palette = Record<ColorRole, HexColor>;

/** WCAG 2.2 contrast requirement checked by `pnpm tokens:check`. */
export interface ContrastRule {
  /** `text`: WCAG 1.4.3 (normal text). `icon`: WCAG 1.4.11 (meaningful non-text). */
  purpose: "text" | "icon";
  foreground: ColorRole;
  /** Backgrounds the foreground must be readable on (both modes). */
  backgrounds: readonly ColorRole[];
  /** Fill drawn as a translucent tint behind the text, e.g. status badges. */
  tint?: { color: ColorRole; alpha: number; over: ColorRole };
  /** Minimum ratio: 4.5 for normal text, 3 for large text / UI components. */
  min: number;
}

export type FontWeight = 400 | 500 | 600 | 700;

export interface FontFamily {
  /** Google Fonts family name (web, loaded through next/font/google). */
  family: string;
  /** next/font/google export name. */
  nextFontExport: string;
  /** next/font subsets to preload. */
  nextFontSubsets: readonly string[];
  /** CSS variable set by next/font on <html>. */
  cssVariable: `--${string}`;
  /** Family name declared in the Flutter pubspec. */
  flutterFamily: string;
  /** Asset file prefix in apps/mobile/assets/fonts (e.g. PlusJakartaSans-Bold.ttf). */
  flutterAssetPrefix: string;
  weights: readonly FontWeight[];
  /** Generic CSS fallbacks appended to the stack. */
  cssGenericFallback: readonly string[];
}

export type FontKey = "sans" | "arabic" | "mono";

export interface FontSize {
  size: number;
  lineHeight: number;
}

export type FontSizeKey = "2xs" | "xs" | "sm" | "base" | "lg" | "xl" | "2xl" | "3xl" | "4xl";

/** Material 3 text roles; on the web they become `type-<kebab-role>` utilities. */
export type TextRoleKey =
  | "displayLarge"
  | "displayMedium"
  | "displaySmall"
  | "headlineLarge"
  | "headlineMedium"
  | "headlineSmall"
  | "titleLarge"
  | "titleMedium"
  | "titleSmall"
  | "bodyLarge"
  | "bodyMedium"
  | "bodySmall"
  | "labelLarge"
  | "labelMedium"
  | "labelSmall";

export interface TextRole {
  size: FontSizeKey;
  weight: FontWeight;
  /** Letter spacing in px. */
  tracking?: number;
}

export type RadiusKey = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "full";

export interface DesignTokens {
  color: { light: Palette; dark: Palette };
  /** Contrast requirements validated for both palettes. */
  contrast: readonly ContrastRule[];
  font: Record<FontKey, FontFamily>;
  /** Font stack order per font role (first = primary, rest = fallbacks). */
  fontStack: Record<FontKey, readonly FontKey[]>;
  fontSize: Record<FontSizeKey, FontSize>;
  textRole: Record<TextRoleKey, TextRole>;
  /** Monospace style (order references, codes). */
  monoText: TextRole;
  radius: Record<RadiusKey, number>;
  /** Semantic radius names → radius key. */
  radiusAlias: Record<"pill" | "card" | "container", RadiusKey>;
  spacing: {
    /** Base spacing unit in px (Tailwind `--spacing`). */
    unit: number;
    /** Steps exposed to Flutter as `AppSpacing.s<step>` (value = unit × step). */
    steps: readonly number[];
    /** Named spacing values, in units. */
    named: Record<"page-gutter", number>;
  };
  /** Component dimensions in px. Web: `h-<name>` / `size-<name>`. */
  size: Record<"control-sm" | "control" | "control-lg" | "touch-target" | "brand-wordmark" | "brand-wordmark-lg", number>;
  /** Icon sizes in px. Web: `size-icon-<name>`. */
  iconSize: Record<"inline" | "action" | "navigation", number>;
  /** Brand assets: one master file, copied to both apps by the generator. */
  brand: {
    wordmark: {
      /** Master image in `packages/design-tokens/` (black ink on transparent). */
      source: string;
      /** Intrinsic size in px; `pnpm tokens:check` verifies it matches the file. */
      width: number;
      height: number;
      /** Copies: web (served from `/public`) and Flutter asset paths. */
      web: string;
      mobile: string;
    };
  };
}

export const tokens: DesignTokens = {
  color: {
    light: {
      "bg-base": "#F4F7FB",
      "bg-surface": "#FFFFFF",
      "bg-muted": "#F0F2F5",
      "text-primary": "#09090B",
      "text-muted": "#71717A",
      "accent-primary": "#09090B",
      "accent-primary-foreground": "#FFFFFF",
      "accent-highlight": "#B9D7FE",
      "accent-highlight-foreground": "#09090B",
      "accent-chip-active": "#09090B",
      "accent-chip-active-foreground": "#FFFFFF",
      "accent-chip-inactive": "#F0F2F5",
      "accent-chip-inactive-foreground": "#09090B",
      "border-default": "#E4E4E7",
      "state-error": "#EF4444",
      "state-error-text": "#B91C1C",
      "state-success": "#22C55E",
      "state-success-text": "#166534",
      "state-warning": "#F59E0B",
      "state-warning-text": "#92400E",
    },
    dark: {
      "bg-base": "#0A0A0C",
      "bg-surface": "#18181B",
      "bg-muted": "#232327",
      "text-primary": "#FAFAFA",
      "text-muted": "#A1A1AA",
      "accent-primary": "#FAFAFA",
      "accent-primary-foreground": "#09090B",
      "accent-highlight": "#23395B",
      "accent-highlight-foreground": "#FAFAFA",
      "accent-chip-active": "#FAFAFA",
      "accent-chip-active-foreground": "#09090B",
      "accent-chip-inactive": "#232327",
      "accent-chip-inactive-foreground": "#FAFAFA",
      "border-default": "#2E2E33",
      "state-error": "#F87171",
      "state-error-text": "#F87171",
      "state-success": "#4ADE80",
      "state-success-text": "#4ADE80",
      "state-warning": "#FBBF24",
      "state-warning-text": "#FBBF24",
    },
  },

  // Status fills (`state-*`) are for tinted backgrounds and decorative fills.
  // Meaningful status text AND icons use the `state-*-text` roles, which must
  // be readable on every surface and on the 15% status tint used by badges.
  // WCAG 2.2 AA: 4.5:1 for normal text (1.4.3), 3:1 for meaningful icons and
  // other non-text indicators (1.4.11).
  contrast: (["success", "warning", "error"] as const).flatMap((status) =>
    ([["text", 4.5], ["icon", 3]] as const).map(([purpose, min]) => ({
      purpose,
      foreground: `state-${status}-text` as const,
      backgrounds: ["bg-surface", "bg-base", "bg-muted"] as const,
      tint: { color: `state-${status}` as const, alpha: 0.15, over: "bg-surface" as const },
      min,
    })),
  ),

  font: {
    sans: {
      family: "Plus Jakarta Sans",
      nextFontExport: "Plus_Jakarta_Sans",
      nextFontSubsets: ["latin", "latin-ext"],
      cssVariable: "--font-plus-jakarta-sans",
      flutterFamily: "PlusJakartaSans",
      flutterAssetPrefix: "PlusJakartaSans",
      weights: [400, 500, 600, 700],
      cssGenericFallback: ["ui-sans-serif", "system-ui", "sans-serif"],
    },
    arabic: {
      family: "Noto Sans Arabic",
      nextFontExport: "Noto_Sans_Arabic",
      nextFontSubsets: ["arabic"],
      cssVariable: "--font-noto-sans-arabic",
      flutterFamily: "NotoSansArabic",
      flutterAssetPrefix: "NotoSansArabic",
      weights: [400, 500, 600, 700],
      cssGenericFallback: ["ui-sans-serif", "system-ui", "sans-serif"],
    },
    mono: {
      family: "JetBrains Mono",
      nextFontExport: "JetBrains_Mono",
      nextFontSubsets: ["latin"],
      cssVariable: "--font-jetbrains-mono",
      flutterFamily: "JetBrainsMono",
      flutterAssetPrefix: "JetBrainsMono",
      weights: [400, 500],
      cssGenericFallback: ["ui-monospace", "monospace"],
    },
  },

  fontStack: {
    sans: ["sans", "arabic"],
    arabic: ["arabic", "sans"],
    mono: ["mono"],
  },

  fontSize: {
    "2xs": { size: 11, lineHeight: 16 },
    xs: { size: 12, lineHeight: 16 },
    sm: { size: 14, lineHeight: 20 },
    base: { size: 16, lineHeight: 24 },
    lg: { size: 18, lineHeight: 28 },
    xl: { size: 20, lineHeight: 28 },
    "2xl": { size: 24, lineHeight: 32 },
    "3xl": { size: 30, lineHeight: 36 },
    "4xl": { size: 36, lineHeight: 40 },
  },

  textRole: {
    displayLarge: { size: "4xl", weight: 700, tracking: -0.5 },
    displayMedium: { size: "3xl", weight: 700, tracking: -0.5 },
    displaySmall: { size: "2xl", weight: 700, tracking: -0.25 },
    headlineLarge: { size: "2xl", weight: 600 },
    headlineMedium: { size: "xl", weight: 600 },
    headlineSmall: { size: "lg", weight: 600 },
    titleLarge: { size: "lg", weight: 600 },
    titleMedium: { size: "base", weight: 600 },
    titleSmall: { size: "sm", weight: 600 },
    bodyLarge: { size: "base", weight: 400 },
    bodyMedium: { size: "sm", weight: 400 },
    bodySmall: { size: "xs", weight: 400 },
    labelLarge: { size: "sm", weight: 600 },
    labelMedium: { size: "xs", weight: 500 },
    labelSmall: { size: "2xs", weight: 500 },
  },

  monoText: { size: "sm", weight: 400 },

  radius: {
    sm: 4,
    md: 6,
    lg: 8,
    xl: 12,
    "2xl": 16,
    "3xl": 24,
    "4xl": 32,
    full: 9999,
  },

  radiusAlias: {
    pill: "full",
    card: "2xl",
    container: "3xl",
  },

  spacing: {
    unit: 4,
    steps: [1, 2, 3, 4, 5, 6, 8, 10, 12],
    named: { "page-gutter": 4 },
  },

  size: {
    "control-sm": 36,
    control: 44,
    "control-lg": 48,
    "touch-target": 44,
    // Height of the Chicman wordmark in headers and auth screens.
    "brand-wordmark": 32,
    // Larger wordmark for landing / splash surfaces.
    "brand-wordmark-lg": 48,
  },

  iconSize: {
    inline: 16,
    action: 20,
    navigation: 24,
  },

  brand: {
    // Derived from the brand logo (logo-chicman.jpeg): white removed, cropped.
    wordmark: {
      source: "brand/chicman-wordmark.png",
      width: 1224,
      height: 278,
      web: "public/brand/chicman-wordmark.png",
      mobile: "assets/brand/chicman_wordmark.png",
    },
  },
};
