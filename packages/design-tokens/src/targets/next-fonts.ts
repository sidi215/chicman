import { GENERATED_NOTICE, camelCase } from "../format.ts";
import type { DesignTokens, FontKey } from "../tokens.ts";

/**
 * Web output: next/font/google loaders. next/font requires literal options,
 * so the loader calls are generated rather than built at runtime.
 */
export function renderNextFonts(tokens: DesignTokens): string {
  const keys = Object.keys(tokens.font) as FontKey[];
  const exports = [...new Set(keys.map((k) => tokens.font[k].nextFontExport))].sort();
  const names = keys.map((k) => camelCase(`font-${k}`));

  const lines: string[] = [];
  lines.push(...GENERATED_NOTICE.split("\n").map((l) => `// ${l}`), "");
  lines.push(`import { ${exports.join(", ")} } from "next/font/google";`, "");

  keys.forEach((key, i) => {
    const font = tokens.font[key];
    const quote = (values: readonly (string | number)[]) =>
      values.map((v) => `"${v}"`).join(", ");
    lines.push(`export const ${names[i]} = ${font.nextFontExport}({`);
    lines.push(`  variable: "${font.cssVariable}",`);
    lines.push(`  subsets: [${quote(font.nextFontSubsets)}],`);
    lines.push(`  weight: [${quote(font.weights)}],`);
    lines.push("});", "");
  });

  lines.push("/** Class names that define every font CSS variable; apply on <html>. */");
  lines.push(`export const fontVariables = [`);
  for (const name of names) lines.push(`  ${name}.variable,`);
  lines.push(`].join(" ");`);

  return `${lines.join("\n")}\n`;
}
