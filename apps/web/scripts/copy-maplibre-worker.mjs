// Copies MapLibre's worker module from the installed package to
// public/maplibre/, so it is served from this site's origin (CSP
// `script-src 'self'`; MapLibre wraps it in a `blob:` worker). Runs before
// `dev` and `build`; the copy is git-ignored.
import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const source = join(dirname(require.resolve("maplibre-gl/package.json")), "dist", "maplibre-gl-worker.mjs")
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "maplibre", "maplibre-gl-worker.mjs")
mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
