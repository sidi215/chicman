import {
  GENERATED_NOTICE,
  camelCase,
  dartColor,
  dartRadiusName,
  num,
} from "../format.ts";
import type { ColorRole, DesignTokens, FontKey, TextRole } from "../tokens.ts";

function textStyle(
  tokens: DesignTokens,
  role: TextRole,
  font: FontKey,
  indent: string,
): string {
  const { size, lineHeight } = tokens.fontSize[role.size];
  const fallback = tokens.fontStack[font].length > 1;
  const parts = [
    `fontFamily: AppFontFamilies.${font}`,
    ...(fallback ? [`fontFamilyFallback: AppFontFamilies.${font}Fallback`] : []),
    `fontSize: ${num(size)}`,
    `height: ${num(lineHeight)} / ${num(size)}`,
    `fontWeight: FontWeight.w${role.weight}`,
    `letterSpacing: ${num(role.tracking ?? 0)}`,
    "color: color",
  ];
  const inner = `${indent}  `;
  return `TextStyle(\n${inner}${parts.join(`,\n${inner}`)},\n${indent})`;
}

/** Flutter output: AppColors ThemeExtension + typography and dimension constants. */
export function renderDart(tokens: DesignTokens): string {
  const roles = Object.keys(tokens.color.light) as ColorRole[];
  const fields = roles.map((role) => ({ role, name: camelCase(role) }));
  const out: string[] = [];
  const push = (...l: string[]) => out.push(...l);

  push(...GENERATED_NOTICE.split("\n").map((l) => `// ${l}`), "");
  push("import 'package:flutter/material.dart';", "");

  // Colors ------------------------------------------------------------------
  push(
    "/// Semantic color tokens of the Chicman design system (light and dark).",
    "///",
    "/// Registered as a [ThemeExtension] by `AppTheme`; read it in widgets with",
    "/// `context.appColors` instead of hardcoding colors.",
    "@immutable",
    "class AppColors extends ThemeExtension<AppColors> {",
    "  const AppColors({",
    ...fields.map((f) => `    required this.${f.name},`),
    "  });",
    "",
  );
  for (const f of fields) push(`  /// \`--${f.role}\`.`, `  final Color ${f.name};`, "");

  for (const mode of ["light", "dark"] as const) {
    push(`  static const AppColors ${mode} = AppColors(`);
    for (const f of fields) {
      push(`    ${f.name}: Color(${dartColor(tokens.color[mode][f.role])}),`);
    }
    push("  );", "");
  }

  push("  @override", "  AppColors copyWith({");
  for (const f of fields) push(`    Color? ${f.name},`);
  push("  }) {", "    return AppColors(");
  for (const f of fields) push(`      ${f.name}: ${f.name} ?? this.${f.name},`);
  push("    );", "  }", "");

  push(
    "  @override",
    "  AppColors lerp(ThemeExtension<AppColors>? other, double t) {",
    "    if (other is! AppColors) return this;",
    "    return AppColors(",
  );
  for (const f of fields) push(`      ${f.name}: Color.lerp(${f.name}, other.${f.name}, t)!,`);
  push("    );", "  }", "}", "");

  // Typography ----------------------------------------------------------------
  const fontKeys = Object.keys(tokens.font) as FontKey[];
  push("/// Font families declared in `pubspec.yaml` (bundled assets).");
  push("abstract final class AppFontFamilies {");
  for (const key of fontKeys) {
    push(`  static const String ${key} = '${tokens.font[key].flutterFamily}';`);
  }
  for (const key of fontKeys) {
    const rest = tokens.fontStack[key].slice(1);
    if (rest.length === 0) continue;
    push(`  static const List<String> ${key}Fallback = [${rest.join(", ")}];`);
  }
  push("}", "");

  push("/// Material 3 text roles (web: `type-<role>` utilities).");
  push("abstract final class AppTextStyles {");
  push("  static TextTheme textTheme(Color color) {", "    return TextTheme(");
  for (const [role, def] of Object.entries(tokens.textRole)) {
    push(`      ${role}: ${textStyle(tokens, def, "sans", "      ")},`);
  }
  push("    );", "  }", "");
  push("  /// Monospace style (web: `type-mono`).");
  push("  static TextStyle mono(Color color) {");
  push(`    return ${textStyle(tokens, tokens.monoText, "mono", "    ")};`);
  push("  }", "}", "");

  // Dimensions -----------------------------------------------------------------
  push("/// Corner radii (web: `rounded-<key>`).", "abstract final class AppRadius {");
  for (const [key, px] of Object.entries(tokens.radius)) {
    push(`  static const double ${dartRadiusName(key)} = ${num(px)};`);
  }
  push("");
  for (const [alias, key] of Object.entries(tokens.radiusAlias)) {
    push(
      `  static const BorderRadius ${alias} =`,
      `      BorderRadius.all(Radius.circular(${dartRadiusName(key)}));`,
    );
  }
  push("}", "");

  push(
    `/// Spacing on a ${tokens.spacing.unit}px grid (web: Tailwind spacing, \`s4\` = \`4\`).`,
    "abstract final class AppSpacing {",
  );
  for (const step of tokens.spacing.steps) {
    push(`  static const double s${step} = ${num(step * tokens.spacing.unit)};`);
  }
  for (const [name, units] of Object.entries(tokens.spacing.named)) {
    push(`  static const double ${camelCase(name)} = ${num(units * tokens.spacing.unit)};`);
  }
  push("}", "");

  push("/// Component dimensions (web: `h-<name>` / `size-<name>`).", "abstract final class AppSizes {");
  for (const [name, px] of Object.entries(tokens.size)) {
    push(`  static const double ${camelCase(name)} = ${num(px)};`);
  }
  push("}", "");

  push("/// Icon sizes (web: `size-icon-<name>`).", "abstract final class AppIconSize {");
  for (const [name, px] of Object.entries(tokens.iconSize)) {
    push(`  static const double ${camelCase(name)} = ${num(px)};`);
  }
  push("}", "");

  const { wordmark } = tokens.brand;
  push(
    "/// Brand assets (master in `packages/design-tokens/brand/`).",
    "abstract final class AppBrand {",
    `  static const String wordmarkAsset = '${wordmark.mobile}';`,
    `  static const double wordmarkAspectRatio = ${num(wordmark.width / wordmark.height)};`,
    "}",
  );

  return `${out.join("\n")}\n`;
}
