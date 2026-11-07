import { GENERATED_NOTICE, kebabCase, num, rem } from "../format.ts";
import type { DesignTokens, FontKey, Palette } from "../tokens.ts";

function palette(colors: Palette): string[] {
  return Object.entries(colors).map(([role, hex]) => `  --${role}: ${hex.toLowerCase()};`);
}

function fontStack(tokens: DesignTokens, key: FontKey): string {
  const stack = tokens.fontStack[key];
  const vars = stack.map((k) => `var(${tokens.font[k].cssVariable})`);
  const primary = tokens.font[stack[0] ?? key];
  return [...vars, ...primary.cssGenericFallback].join(", ");
}

/** Web output: CSS variables + Tailwind v4 theme and `type-*` utilities. */
export function renderCss(tokens: DesignTokens): string {
  const lines: string[] = [];
  const notice = GENERATED_NOTICE.split("\n").map((l) => ` * ${l}`);
  lines.push("/*", ...notice, " */", "");

  lines.push(":root {", "  color-scheme: light;", ...palette(tokens.color.light), "}", "");
  lines.push(".dark {", "  color-scheme: dark;", ...palette(tokens.color.dark), "}", "");

  lines.push("@theme {");
  lines.push(`  --spacing: ${rem(tokens.spacing.unit)};`);
  for (const [name, units] of Object.entries(tokens.spacing.named)) {
    lines.push(`  --spacing-${name}: ${rem(units * tokens.spacing.unit)};`);
  }
  for (const [name, px] of Object.entries(tokens.size)) {
    lines.push(`  --spacing-${name}: ${rem(px)};`);
  }
  for (const [name, px] of Object.entries(tokens.iconSize)) {
    lines.push(`  --spacing-icon-${name}: ${rem(px)};`);
  }
  lines.push("");
  for (const [name, { size, lineHeight }] of Object.entries(tokens.fontSize)) {
    lines.push(`  --text-${name}: ${rem(size)};`);
    lines.push(`  --text-${name}--line-height: ${rem(lineHeight)};`);
  }
  lines.push("");
  for (const [name, px] of Object.entries(tokens.radius)) {
    lines.push(`  --radius-${name}: ${name === "full" ? `${px}px` : rem(px)};`);
  }
  lines.push("}", "");

  lines.push("@theme inline {");
  for (const key of Object.keys(tokens.fontStack) as FontKey[]) {
    lines.push(`  --font-${key}: ${fontStack(tokens, key)};`);
  }
  lines.push("}", "");

  const roles = [...Object.entries(tokens.textRole), ["mono", tokens.monoText] as const];
  for (const [role, { size, weight, tracking }] of roles) {
    lines.push(`@utility type-${kebabCase(role)} {`);
    if (role === "mono") lines.push("  font-family: var(--font-mono);");
    lines.push(`  font-size: var(--text-${size});`);
    lines.push(`  line-height: var(--text-${size}--line-height);`);
    lines.push(`  font-weight: ${weight};`);
    lines.push(`  letter-spacing: ${tracking ? `${num(tracking)}px` : "0"};`);
    lines.push("}", "");
  }

  const { wordmark } = tokens.brand;
  const webUrl = `/${wordmark.web.replace(/^public\//, "")}`;
  lines.push(
    "/* Brand wordmark: drawn as a mask in the current text colour. */",
    ":root {",
    `  --brand-wordmark-url: url("${webUrl}");`,
    `  --brand-wordmark-aspect: ${wordmark.width} / ${wordmark.height};`,
    "}",
  );

  return `${lines.join("\n").trimEnd()}\n`;
}
