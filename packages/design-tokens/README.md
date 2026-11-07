# @chicman/design-tokens

Single source of truth for Chicman's visual foundations: colors (light and dark), fonts, type scale, spacing, component sizes, icon sizes, and corner radii.

Web and Flutter themes are **generated** from [`src/tokens.ts`](src/tokens.ts). Do not maintain design values anywhere else.

## Commands (from the repository root)

| Command | What it does |
|---|---|
| `pnpm tokens` | Regenerate every platform output |
| `pnpm tokens:check` | Fail if a generated output is stale or a font asset is missing |

`pnpm typecheck` runs the check too, so stale outputs fail CI.

## Generated outputs

Generated files are committed, so the Flutter app builds without Node. They start with a `GENERATED` header and must not be edited by hand.

| Output | Contents |
|---|---|
| `apps/web/src/app/design-tokens.generated.css` | Color variables (`:root` / `.dark`), Tailwind `@theme` (spacing, sizes, icon sizes, font sizes, radii, font stacks), `type-*` text-role utilities |
| `apps/web/src/app/fonts.generated.ts` | `next/font/google` loaders. next/font needs literal options, so these calls are generated |
| `apps/mobile/lib/core/theme/generated/design_tokens.g.dart` | `AppColors` (`ThemeExtension`), `AppFontFamilies`, `AppTextStyles`, `AppRadius`, `AppSpacing`, `AppSizes`, `AppIconSize` |
| `apps/mobile/pubspec.yaml` (between the `design-tokens:fonts` markers) | Flutter font asset declarations |

The platform theme files only *adapt* the tokens; they hold no raw values:

- Web: `apps/web/src/app/globals.css` maps tokens onto shadcn/ui variables and Tailwind color utilities.
- Flutter: `apps/mobile/lib/core/theme/app_theme.dart` builds the Material 3 `ThemeData` from the generated classes.

## Brand assets

`brand/chicman-wordmark.png` is the master of the Chicman wordmark (see `context/ui-context.md`, Brand Logo). `tokens.brand.wordmark` records its intrinsic size and the two copy targets. The generator copies the file byte for byte into `apps/web/public/brand/` and `apps/mobile/assets/brand/`, and `--check` fails if a copy is stale or the size does not match. To replace the logo, replace the master, update `width`/`height`, and run `pnpm tokens`.

## Changing a token

1. Edit `src/tokens.ts`.
2. Run `pnpm tokens`.
3. If you added a font weight, add the matching static TTF to `apps/mobile/assets/fonts/` (`pnpm tokens:check` reports missing files).
4. Commit the token change together with the regenerated files.

Naming rules: color roles map to CSS `--<role>` and Dart `camelCase`. Radius `2xl` / `3xl` map to Dart `xxl` / `xxxl`. Text roles map to the web `type-<kebab-role>` utilities (for example `titleMedium` → `type-title-medium`).

Scope: this package holds visual tokens only. Application types, schemas, and API contracts belong in `@chicman/shared`.
