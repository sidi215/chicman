// Writes public/.well-known/assetlinks.json (Android App Links for
// <SITE_URL>/auth/callback, spec 03) from the build environment:
//   ANDROID_PACKAGE_NAME  e.g. com.chicman.chicman
//   ANDROID_CERT_SHA256   the release signing certificate's SHA-256
//                         fingerprint (AA:BB:…); several, comma-separated
//                         (for example yours and Google Play's).
// Without both, any earlier file is removed and nothing is served, so a
// development build never publishes a wrong fingerprint. Runs before
// `next build`; the output is git-ignored. Production: QA-01 runbook
// (infrastructure/render/README.md).
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", ".well-known", "assetlinks.json")
const packageName = (process.env.ANDROID_PACKAGE_NAME ?? "").trim()
const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? "")
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter((value) => value !== "")

if (packageName === "" || fingerprints.length === 0) {
  rmSync(target, { force: true })
  console.log("assetlinks.json: ANDROID_PACKAGE_NAME or ANDROID_CERT_SHA256 not set; not served")
} else {
  const invalid = fingerprints.filter((value) => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value))
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName) || invalid.length > 0) {
    console.error("assetlinks.json: ANDROID_PACKAGE_NAME must be a package name and ANDROID_CERT_SHA256 SHA-256 fingerprints (AA:BB:…, 32 bytes)")
    process.exit(1)
  }
  const statement = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: fingerprints },
    },
  ]
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(statement, null, 2)}\n`)
  console.log(`assetlinks.json: ${packageName}, ${fingerprints.length} fingerprint(s)`)
}
