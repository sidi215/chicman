/**
 * Generates every platform theme definition from src/tokens.ts.
 *
 *   node src/generate.ts           write outputs
 *   node src/generate.ts --check   exit 1 if any output is stale (CI / typecheck)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { renderCss } from "./targets/css.ts";
import { renderDart } from "./targets/dart.ts";
import { renderNextFonts } from "./targets/next-fonts.ts";
import { blend, contrastRatio } from "./format.ts";
import { applyPubspecFonts, fontAssets, renderPubspecFonts } from "./targets/pubspec.ts";
import { tokens } from "./tokens.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const WEB = join(ROOT, "apps/web");
const MOBILE = join(ROOT, "apps/mobile");

interface Output {
  path: string;
  content: string | Buffer;
}

const PACKAGE = resolve(import.meta.dirname, "..");

function outputs(): Output[] {
  const pubspecPath = join(MOBILE, "pubspec.yaml");
  return [
    { path: join(WEB, "src/app/design-tokens.generated.css"), content: renderCss(tokens) },
    { path: join(WEB, "src/app/fonts.generated.ts"), content: renderNextFonts(tokens) },
    {
      path: join(MOBILE, "lib/core/theme/generated/design_tokens.g.dart"),
      content: renderDart(tokens),
    },
    {
      path: pubspecPath,
      content: applyPubspecFonts(readFileSync(pubspecPath, "utf8"), renderPubspecFonts(tokens)),
    },
    ...brandCopies(),
  ];
}

/** Byte-for-byte copies of the brand master into both apps. */
function brandCopies(): Output[] {
  const { wordmark } = tokens.brand;
  const master = readFileSync(join(PACKAGE, wordmark.source));
  return [
    { path: join(WEB, wordmark.web), content: master },
    { path: join(MOBILE, wordmark.mobile), content: master },
  ];
}

/** PNG intrinsic size from the IHDR chunk. */
function pngSize(file: Buffer): { width: number; height: number } | null {
  const signature = "89504e470d0a1a0a";
  if (file.length < 24 || file.subarray(0, 8).toString("hex") !== signature) return null;
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}

function validateContrast(): string[] {
  const errors: string[] = [];
  for (const mode of ["light", "dark"] as const) {
    const palette = tokens.color[mode];
    for (const rule of tokens.contrast) {
      const fg = palette[rule.foreground];
      const backgrounds: [name: string, hex: string][] = rule.backgrounds.map((role) => [
        role,
        palette[role],
      ]);
      if (rule.tint) {
        const { color, alpha, over } = rule.tint;
        const tinted = blend(palette[color], palette[over], alpha);
        backgrounds.push([`${color}/${alpha * 100}% over ${over}`, tinted]);
      }
      for (const [name, bg] of backgrounds) {
        const ratio = contrastRatio(fg, bg);
        if (ratio < rule.min) {
          errors.push(
            `Contrast (${mode}, ${rule.purpose}): ${rule.foreground} on ${name} is ${ratio.toFixed(2)}:1, needs ${rule.min}:1`,
          );
        }
      }
    }
  }
  return errors;
}

function validateBrand(): string[] {
  const { wordmark } = tokens.brand;
  const path = join(PACKAGE, wordmark.source);
  if (!existsSync(path)) return [`Missing brand master: packages/design-tokens/${wordmark.source}`];
  const size = pngSize(readFileSync(path));
  if (size === null) return [`Brand master is not a PNG: packages/design-tokens/${wordmark.source}`];
  if (size.width !== wordmark.width || size.height !== wordmark.height) {
    return [`Brand wordmark is ${size.width}×${size.height}, tokens say ${wordmark.width}×${wordmark.height}`];
  }
  return [];
}

function validate(): string[] {
  const missingFonts = fontAssets(tokens)
    .filter((asset) => !existsSync(join(MOBILE, asset)))
    .map((asset) => `Missing Flutter font asset: apps/mobile/${asset}`);
  return [...missingFonts, ...validateBrand(), ...validateContrast()];
}

function main(): void {
  const check = process.argv.includes("--check");
  const errors = validate();
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }

  const relative = (p: string) => p.slice(ROOT.length + 1);
  const stale: string[] = [];

  for (const { path, content } of outputs()) {
    const current = existsSync(path) ? readFileSync(path) : null;
    const expected = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    if (current !== null && current.equals(expected)) continue;
    if (check) {
      stale.push(relative(path));
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      console.log(`design-tokens: wrote ${relative(path)}`);
    }
  }

  if (check && stale.length > 0) {
    console.error(
      `design-tokens: generated files are out of date:\n  ${stale.join("\n  ")}\nRun \`pnpm tokens\`.`,
    );
    process.exit(1);
  }
  if (check) console.log("design-tokens: generated files are up to date.");
}

main();
