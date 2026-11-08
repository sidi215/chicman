# UI Context

## Theme

Light-first soft modern e-commerce UI with full dark mode support. The theme follows the device by default, and users can choose System, Light, or Dark.

The design language features high-contrast black pill components, soft ambient surface tints, smooth rounded geometry, and a clean, high-density product canvas optimized for mobile-first fashion browsing in Mauritania.

The visual identity must remain consistent across Web (Next.js) and Mobile (Flutter), while respecting each platform's native interaction patterns and components.

The experience should feel modern, elegant, minimal, accessible, and focused on product discovery and shopping.

## Brand Logo

The Chicman logo is the lowercase **"chicman" wordmark** (source: `logo-chicman.jpeg`, black on white).

- **One master:** `packages/design-tokens/brand/chicman-wordmark.png`, made from the source logo: white removed (transparent), cropped, 1224 × 278 px, black ink. `pnpm tokens` copies it to `apps/web/public/brand/chicman-wordmark.png` and `apps/mobile/assets/brand/chicman_wordmark.png`, and `pnpm tokens:check` fails if a copy differs or the size in `tokens.ts` does not match the file.
- **Theme colour, never a fixed image:** the wordmark is drawn in the current text colour (`foreground` / `onSurface`): near-black in light mode, near-white in dark mode. Never place the original JPEG (white box) on a coloured or dark surface.
- **Sizes (tokens):** `brand-wordmark` 32 px (auth screens and headers) and `brand-wordmark-lg` 48 px (landing surfaces). Width follows the aspect ratio (`--brand-wordmark-aspect`, `AppBrand.wordmarkAspectRatio`).
- **Web:** `<BrandLogo label=… size="default" | "lg" />` (`apps/web/src/components/brand/brand-logo.tsx`), a CSS mask filled with `currentColor`, `role="img"` and an accessible label; in forced-colors mode it uses `CanvasText`. Size it with `size`, not a height class (`cn` does not resolve class conflicts).
- **Flutter:** `BrandWordmark(semanticLabel: …)` (`lib/core/theme/widgets/brand_wordmark.dart`), an asset tinted with `colorScheme.onSurface` (`BlendMode.srcIn`).
- **Accessible name:** the brand name for the current locale ("Chicman" / "شيكمان"). The wordmark itself stays in Latin script in both languages and is not mirrored in RTL.

## Colors

All components must use the defined semantic color tokens. Avoid hardcoded color values in individual components.

| Role | CSS Variable | Value |
|---|---|---|
| Page background | `--bg-base` | `#F4F7FB` |
| Surface | `--bg-surface` | `#FFFFFF` |
| Sub-surface / Muted background | `--bg-muted` | `#F0F2F5` |
| Primary text | `--text-primary` | `#09090B` |
| Muted text | `--text-muted` | `#71717A` |
| Primary accent | `--accent-primary` | `#09090B` |
| Highlight / Promo accent | `--accent-highlight` | `#B9D7FE` |
| Active filter chip | `--accent-chip-active` | `#09090B` |
| Inactive filter chip | `--accent-chip-inactive` | `#F0F2F5` |
| Border | `--border-default` | `#E4E4E7` |
| Error (fill) | `--state-error` | `#EF4444` |
| Success (fill) | `--state-success` | `#22C55E` |
| Warning (fill) / Rating star fill | `--state-warning` | `#F59E0B` |
| Error text | `--state-error-text` | `#B91C1C` |
| Success text | `--state-success-text` | `#166534` |
| Warning text | `--state-warning-text` | `#92400E` |

### Status Colors and Contrast

Each status has two tokens: a **fill** (`--state-*`) and a **foreground** (`--state-*-text`).

| Use | Token | Requirement |
|---|---|---|
| Tinted status backgrounds (for example `bg-success/15` badges and banners), decorative fills | Fill `--state-*` | None (not the carrier of meaning) |
| Status **text** | Foreground `--state-*-text` | ≥ 4.5:1 against the adjacent background (WCAG 2.2 SC 1.4.3) |
| **Meaningful** status icons (the icon conveys the status, such as a success check or a warning triangle) | Foreground `--state-*-text` | ≥ 3:1 against the adjacent background (WCAG 2.2 SC 1.4.11) |
| Input error borders | Fill `--state-error` | ≥ 3:1 (3.76:1 on white) |

- Light fills must **not** be used for text or meaningful icons. On light surfaces the success and warning fills measure only 1.9–2.3:1, which fails even the 3:1 non-text minimum.
- Light-mode foregrounds meet at least 4.5:1 on `bg-surface`, `bg-base`, `bg-muted`, and the 15% status tint (minimum measured: success 6.26:1, warning 6.31:1, error 5.32:1), so they also satisfy 3:1 for icons. In dark mode the bright fills are already readable, so the dark foreground tokens equal the fills (5.15:1 or better).
- **Rating star:** the `--state-warning` fill may be used only where the numeric rating is shown as text next to it, so the star is not the only carrier of the rating. A star or star row that conveys the rating on its own is a meaningful icon and uses `--state-warning-text`.
- `pnpm tokens:check` enforces both the text (4.5:1) and icon (3:1) minimums for both palettes, so a palette change that breaks contrast fails the check.
- Web: `text-success-text` / `text-warning-text` / `text-error-text` for text and meaningful icons (icons inherit `currentColor`), together with `bg-success/15`-style tints. Flutter: `AppColors.stateSuccessText` / `stateWarningText` / `stateErrorText`. Input error messages and `onErrorContainer` use `stateErrorText`.

Flutter must use equivalent centralized color constants matching the web tokens.

Dark mode must have a corresponding semantic color palette while preserving the same design language.

### Foreground Tokens

Content colors for text and icons placed on filled accents.

| Role | CSS Variable | Light | Dark |
|---|---|---|---|
| On primary accent | `--accent-primary-foreground` | `#FFFFFF` | `#09090B` |
| On highlight | `--accent-highlight-foreground` | `#09090B` | `#FAFAFA` |
| On active chip | `--accent-chip-active-foreground` | `#FFFFFF` | `#09090B` |
| On inactive chip | `--accent-chip-inactive-foreground` | `#09090B` | `#FAFAFA` |

### Dark Palette

Dark mode inverts the black-pill language into white pills on a near-black canvas.

| CSS Variable | Dark Value |
|---|---|
| `--bg-base` | `#0A0A0C` |
| `--bg-surface` | `#18181B` |
| `--bg-muted` | `#232327` |
| `--text-primary` | `#FAFAFA` |
| `--text-muted` | `#A1A1AA` |
| `--accent-primary` | `#FAFAFA` |
| `--accent-highlight` | `#23395B` |
| `--accent-chip-active` | `#FAFAFA` |
| `--accent-chip-inactive` | `#232327` |
| `--border-default` | `#2E2E33` |
| `--state-error` | `#F87171` |
| `--state-success` | `#4ADE80` |
| `--state-warning` | `#FBBF24` |
| `--state-error-text` | `#F87171` |
| `--state-success-text` | `#4ADE80` |
| `--state-warning-text` | `#FBBF24` |

### Theme Switching

- Preferences: **System** (default), **Light**, **Dark**. With System, the app follows the OS color scheme, including live changes.
- The choice is persisted on the device under the key `chicman-theme`, with values `system` / `light` / `dark` (same on both platforms).
- **Web:** `src/lib/theme.ts` stores the preference in `localStorage`. An inline script in the root layout applies `.dark` on `<html>` before first paint (no flash) and reacts to OS, cross-tab, and in-page changes. UI: `components/theme/theme-selector.tsx` (`ThemeSelector`), hook `useThemePreference`.
- **Flutter:** `themeModeProvider` (Riverpod, `lib/core/theme/theme_mode_controller.dart`) persists through `shared_preferences` and drives `MaterialApp.themeMode`. UI: `ThemeModeSelector` (`lib/core/theme/widgets/`).
- Selector labels: French `Système / Clair / Sombre`, Arabic `النظام / فاتح / داكن`.
- **Placement:** the selector belongs in the **website header** (`StorefrontHeader`, done with spec 08), and in **customer profile settings** on web and mobile (web `/account/profile`, mobile profile settings screen, 2026-11-06). The preference stays device-local (`chicman-theme`); it is not a profile field and is not stored in PostgreSQL.

### Token Implementation

All values in this document are defined once in `packages/design-tokens/src/tokens.ts` and generated for each platform (`pnpm tokens`). See that package's README for the output list.

- **Web:** `design-tokens.generated.css` provides the CSS variables and Tailwind theme. `globals.css` maps shadcn/ui variables (`--background`, `--primary`, …) onto them. Utilities:
  - Colors: `bg-page` (page background; named `page` so it does not collide with the `text-base` font-size utility), `bg-surface`, `bg-highlight` / `text-highlight-foreground`, `bg-chip-active` / `bg-chip-inactive`. Status fills: `bg-success`, `bg-warning`, `bg-error` (with opacity for tints). Status text: `text-success-text`, `text-warning-text`, `text-error-text`.
  - Text roles: `type-display-large` … `type-label-small`, `type-mono`.
  - Sizes: `h-control-sm` / `h-control` / `h-control-lg`, `size-touch-target`, `size-icon-inline` / `-action` / `-navigation`, `px-page-gutter`.
- **Flutter:** generated `AppColors` (`ThemeExtension`, read with `context.appColors`), `AppTextStyles`, `AppRadius`, `AppSpacing`, `AppSizes`, and `AppIconSize`. `AppTheme` derives the Material `ColorScheme` and component themes from them.

## Typography

| Role | Font | Variable |
|---|---|---|
| UI text | Plus Jakarta Sans / Inter | `--font-sans` |
| Arabic Display | Noto Sans Arabic | `--font-arabic` |
| Code/mono | JetBrains Mono | `--font-mono` |

Use consistent typography hierarchy across web and mobile, with appropriate sizing and line heights for each screen size.

Arabic must use Noto Sans Arabic with full RTL support.

Font stack (same order on both platforms): Plus Jakarta Sans first, falling back to Noto Sans Arabic for Arabic glyphs. Weights 400/500/600/700 (mono: 400/500). Web loads the fonts with `next/font/google`. Flutter bundles static TTFs in `apps/mobile/assets/fonts/` (SIL OFL 1.1).

### Type Scale

On the web, use the `type-<role>` utility (for example `type-title-medium`), which sets size, line height, weight, and tracking together. The Tailwind size column shows the underlying font-size token.

| Flutter role | Web class | Size / line height | Weight |
|---|---|---|---|
| `displayLarge` | `text-4xl` | 36 / 40 | 700 |
| `displayMedium` | `text-3xl` | 30 / 36 | 700 |
| `displaySmall` | `text-2xl` | 24 / 32 | 700 |
| `headlineLarge` | `text-2xl` | 24 / 32 | 600 |
| `headlineMedium` | `text-xl` | 20 / 28 | 600 |
| `headlineSmall`, `titleLarge` | `text-lg` | 18 / 28 | 600 |
| `titleMedium` | `text-base` | 16 / 24 | 600 |
| `titleSmall`, `labelLarge` | `text-sm` | 14 / 20 | 600 |
| `bodyLarge` | `text-base` | 16 / 24 | 400 |
| `bodyMedium` | `text-sm` | 14 / 20 | 400 |
| `bodySmall` | `text-xs` | 12 / 16 | 400 |
| `labelMedium` | `text-xs` | 12 / 16 | 500 |

## Border Radius

| Context | Class |
|---|---|
| Inline / small UI (CTAs, Tags, Filters, Floating Nav) | `rounded-full` |
| Inputs / Search Bar | `rounded-full` |
| Cards / Offer Banners | `rounded-2xl` |
| Product Containers & Modals | `rounded-3xl` |

Flutter must reproduce equivalent rounded geometry using centralized `BorderRadius` definitions.

| Tailwind | Value | Flutter (`AppRadius`) |
|---|---|---|
| `rounded-full` | 9999px | `full` / `pill` |
| `rounded-2xl` | 16px | `xxl` / `card` |
| `rounded-3xl` | 24px | `xxxl` / `container`, `sheet` (top corners) |

Spacing uses a 4-pt scale (Tailwind `--spacing`; Flutter `AppSpacing.s1`–`s12`, so `s4` = 16px). Control heights: `control` = 44px (buttons, inputs), `control-lg` = 48px, `control-sm` = 36px (filter chips, small buttons). Minimum touch target: 44px.

## Component Library

**Web:**
- shadcn/ui customized on top of Tailwind CSS (Base UI primitives).
- Components live in `components/ui/`. Current set: `Button` (pill; variants `default`, `secondary`, `outline`, `highlight`, `ghost`, `destructive`, `link`), `Input` (pill), `Card` (rounded-2xl), `Badge`, and `Chip` (filter chip; pressed = active).
- Use logical utilities (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`) so layouts mirror in RTL. The root layout sets `lang`/`dir` and wraps the app in Base UI's `DirectionProvider`.
- Lucide React for icons.
- Use reusable components and consistent design tokens.

**Mobile:**
- Flutter native widgets.
- Material 3 as the foundation, customized to match the marketplace design system.
- Reusable shared widgets for buttons, cards, inputs, filters, product displays, and navigation.
- Centralized theme configuration for colors, typography, spacing, and radius (`lib/core/theme/`: `AppColors`, `AppTypography`, `AppTheme`, `AppRadius`, `AppSpacing`, `AppIconSize`, `AppSizes`).
- Use directional APIs (`EdgeInsetsDirectional`, `AlignmentDirectional`) so layouts mirror in RTL. Supported locales are `fr` and `ar` through `flutter_localizations`. The app follows the profile's language, and the device's until that is known.
- **Prices:** French groups thousands with a no-break space (U+00A0), on web and mobile: `1 500,50 MRU`. The narrow one (U+202F) is barely visible in Plus Jakarta Sans. Arabic: `1,500.50 أوقية`.
- **Language switch (web):** `LanguageSwitch` offers the other language, written in that language, in `StorefrontHeader` and `AuthShell`. It keeps the current page and query, and does a full page load because the document's language and direction change.

Web and mobile must share the same visual language but use platform-native component implementations.

## Layout Patterns

- **Navigation (Web):** Top header with a profile entry (avatar images are out of scope for the initial release), localized greeting, notification icon, theme selector (System / Light / Dark), and shopping bag drawer trigger. Built so far (spec 08): wordmark, theme selector, account or login entry, and category links; sticky from the `md` breakpoint up. The others arrive with their features.

- **Navigation (Mobile):** Compact top app bar with profile, notifications, and shopping bag actions.

- **Floating Dock (Mobile):** Fixed bottom navigation bar anchored over the view with rounded pill styling, containing Home, Search, Favorites, and Profile destinations. Built so far (spec 08): Home and Account (`AppShell`); Search and Favorites arrive with their features.

- **Search & Filter Bar:** Full-width rounded search input accompanied by a horizontal scrollable row of rounded category filter chips: All, Clothing, Shoes, and Fashion accessories, the only supported categories (spec 08). The search input arrives with search.

- **Mobile Search & Filters:** Touch-friendly search, horizontally scrollable categories, and filter/sorting bottom sheets.

- **Hero Offer Section:** Floating soft-blue card (`--accent-highlight`) featuring promo text, CTA button, and featured product cutout asset. Adapt the layout to smaller mobile screens. Built so far (spec 08): the marketplace tagline and a link to all products; no promotion or cutout, because no promotions exist yet.

- **Product Grid (Web):** Two-column responsive layout on smaller screens, expanding on larger screens.

- **Product Grid (Mobile):** Two-column product layout with optimized spacing and touch-friendly interactions.

- **Product Cards:** 3:4 portrait product images, floating black pill action buttons (Shop), heart icon favorite overlays, store/vendor name, price in Ouguiya (MRU), and star rating indicator. Built so far (spec 08, web `ProductCard`, Flutter `ProductCard`): image, name, price, shop, and an unavailable badge; the Shop button, heart, and rating arrive with the cart, favorites, and reviews.

- **Product Details:** Dedicated product detail experience with large product imagery, product variants, seller information, pricing, and prominent add-to-cart action.

- **Shopping Cart:** Shopping bag drawer on web and a dedicated cart screen on mobile. Support products from multiple sellers.

- **Checkout:** Clear, simplified checkout experience optimized for mobile, including delivery location selection and order confirmation.

- **Modals & Overlays:** Rounded-3xl containers, soft backdrop, clear actions, and mobile bottom-sheet adaptations where appropriate.

- **Responsive Behavior:** Adapt layouts to mobile, tablet, and desktop while maintaining consistent hierarchy and spacing.

- **Localization:** Support French (LTR) and Arabic (RTL), including direction-aware layouts, alignment, spacing, and navigation.

- **Currency:** Consistent MRU (Ouguiya) price formatting across all platforms.

## Icons

Use Lucide icons consistently across both platforms.

**Web:**
- Lucide React.
- Stroke-based outline icons only.
- `h-4 w-4` for inline badges and ratings.
- `h-5 w-5` for action buttons and header actions.
- `h-6 w-6` for navigation items.

**Mobile:**
- Lucide-style stroke-based outline icons.
- Use consistent visual weight and proportions.
- Standard sizes: 16px for inline elements, 20px for actions, and 24px for navigation.
- Interactive touch targets should generally be at least 44–48 logical pixels.
