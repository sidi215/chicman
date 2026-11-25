# Chicman production on free providers: Render, Netlify, Supabase, Cloudflare R2 (QA-01)

Runbook for launching Chicman V1 with **no paid service**. The decisions of
the project owner (2026-11-20 and 2026-11-21) are: free providers only, with
their limits; the API on **Render**; the web site on **Netlify**; production
search on **PostgreSQL** (no Meilisearch). The limits are listed in
[Limits](#limits).

## What runs where

| Need | Provider (free) | Configuration |
|---|---|---|
| API **and** background worker (one container) | **Render** free web service, Frankfurt | `render.yaml`, `apps/api/Dockerfile.prod`, `apps/api/scripts/start-api-and-worker.mjs` |
| Rate-limit counters | **Render Key Value** free (25 MB) | `render.yaml` |
| Web site (Next.js) | **Netlify** free (300 credits a month) | `apps/web/netlify.toml` |
| Database (PostgreSQL) | **Supabase** free, the production project's own database (500 MB) | Session pooler URL |
| Authentication and its e-mails | **Supabase** Auth + **Gmail SMTP** (about 500 e-mails a day) | `supabase/apply-auth-config.mjs` |
| Product images and shop logos | **Cloudflare R2** free (10 GB, no egress fees), public through `r2.dev` | Buckets, CORS, two tokens |
| Product search | **PostgreSQL** (`SEARCH_ENGINE=postgres`) | Word match on name, brand, description, and shop; no typo tolerance |
| Bot protection | **Cloudflare Turnstile** | Add the Netlify host to the widget |
| Keep-alive and monitoring | **UptimeRobot** free, 5-minute checks | Keeps the API awake (see below) |
| Database backups | **GitHub Actions**, nightly, encrypted, 14 days | `.github/workflows/db-backup.yml` |
| Android app | APK in the R2 media bucket; release-signed | `apps/mobile/android/key.properties` |
| iOS | Not possible for free (Apple's program is paid) | — |

```
Browser ──► Netlify (Next.js) ──server-side reads──► Render: API + worker ──► Supabase Postgres
   │                                                       │  └──► Render Key Value
   ├──► Render API (https://chicman-api.onrender.com/api/v1)│
   ├──► R2 presigned uploads (<account>.r2.cloudflarestorage.com) ◄── signs
   └──► R2 public images (pub-<id>.r2.dev)
Supabase Auth ── e-mails through Gmail SMTP;  UptimeRobot ── pings /api/v1/health every 5 min
```

**Why one Render service.** Render's free plan has no background workers or disks, gives
**750 instance hours per workspace per month**, and puts a service to sleep after
**15 idle minutes** (waking takes about a minute). The API and the worker therefore run
together in one container. A 5-minute health ping keeps it awake, so the worker's jobs
(order expiry, reminders, delivery closure, cleanups) keep running. That uses about
**744 hours** in a 31-day month: **create no other free service in this Render workspace.**

The code is on `develop`; Render and Netlify deploy from **`main`**, and the backup
schedule runs from the default branch. Merge first.

---

## 1. Names

Choose two free hostnames, and check they are available while creating the services:
- Render service `chicman-api` → `https://chicman-api.onrender.com` (the **API URL**). Render adds a suffix if the name is taken; use the URL it shows.
- Netlify site `chicman` → `https://chicman.netlify.app` (the **site URL**).

Below, replace them with your real URLs.

## 2. Supabase production project (database and auth)

1. Create a **new free project**, separate from development, in **Central EU (Frankfurt)**, next to Render. Keep the database password.
2. *Settings → JWT Keys*: use **asymmetric signing keys** (the API accepts only ES256/RS256).
3. *Settings → API Keys*: copy the **publishable** key. The secret key is not needed.
4. *Connect* → **Session pooler** connection string (host `aws-0-<region>.pooler.supabase.com`, port **5432**). This is the `DATABASE_URL`.
   - Not the direct connection: it is IPv6 only, and Render connects over IPv4.
   - Not the transaction pooler (port 6543): the worker's advisory locks need a session.
5. *Database → Settings → Connection pooling*: raise the **pool size** to 30. The worker holds one connection per job lock (about 8) besides the API's and worker's pools.

## 3. Cloudflare R2 (images)

1. In the Cloudflare dashboard, enable **R2**. Cloudflare asks for a payment method; the free tier (10 GB storage, no egress fees) is not charged.
2. Create two buckets in a European location: `chicman-uploads` (private, browser uploads) and `chicman-media` (public images).
3. `chicman-media` → *Settings → Public access → R2.dev subdomain*: **Allow**. Copy `https://pub-<id>.r2.dev`: this is `MEDIA_PUBLIC_BASE_URL`. Never make `chicman-uploads` public.
4. *R2 → Manage API tokens*:
   - **Object Read & Write**, limited to the two buckets: for Render (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
   - **Admin Read & Write**, temporary: for step 3.5 only. Delete it afterwards.

   The S3 endpoint is `https://<account-id>.r2.cloudflarestorage.com`.
5. Set the upload CORS rule from your machine (the buckets exist, so only CORS is applied):
   ```sh
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com S3_REGION=auto \
   S3_ACCESS_KEY_ID=<admin key id> S3_SECRET_ACCESS_KEY=<admin secret> \
   S3_UPLOADS_BUCKET=chicman-uploads S3_MEDIA_BUCKET=chicman-media \
   MEDIA_PUBLIC_BASE_URL=https://pub-<id>.r2.dev CORS_ORIGINS=https://chicman.netlify.app \
   pnpm --filter @chicman/api storage:setup
   ```
   Without `--public-acl`: R2 has no ACLs; step 3.3 made the media bucket public.

## 4. Render: the API

1. render.com → *New → Blueprint* → connect the GitHub repository. Render reads `render.yaml` and creates `chicman-api` and `chicman-redis`, both free, in Frankfurt. Automatic deploys are **off** (`autoDeployTrigger: off`): CI deploys (see [Deploying updates](#deploying-updates)). Deploy manually this first time.
2. Fill in the values marked `sync: false`:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase session pooler URL (step 2.4) |
   | `CORS_ORIGINS` | `https://chicman.netlify.app` |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_JWKS_URL` | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` |
   | `SUPABASE_JWT_ISSUER` | `https://<ref>.supabase.co/auth/v1` |
   | `SUPABASE_PUBLISHABLE_KEY` | from step 2.3 |
   | `CATALOG_INTERNAL_KEY` | `openssl rand -hex 32`; the **same** value goes to Netlify |
   | `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com`, **with nothing after `.com`**. The bucket page's "S3 API" URL ends in the bucket name; the API refuses to start with it, because objects would be stored under the wrong keys and every image would return 404. |
   | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the Object Read & Write token |
   | `MEDIA_PUBLIC_BASE_URL` | `https://pub-<id>.r2.dev` |

3. The first deploy builds the image (several minutes). At each start the container applies pending migrations (`prisma migrate deploy`), then starts the API and the worker. A failed migration stops the start, and Render keeps the previous deploy.
4. Check: `curl https://chicman-api.onrender.com/api/v1/health` returns `{"status":"ok"}`. In the logs, look for `Worker started` and `SEARCH_ENGINE=postgres`.

## 5. Netlify: the web site

1. app.netlify.com → *Add new project → Import from Git* → the repository. Then:
   - **Package directory:** `apps/web`; leave **Base directory** empty.
   - **Production branch:** `main`.
   - Build settings come from `apps/web/netlify.toml`.
2. *Project configuration → Environment variables*:

   | Variable | Value | Used at |
   |---|---|---|
   | `NEXT_PUBLIC_SITE_URL` | `https://chicman.netlify.app` | build |
   | `NEXT_PUBLIC_API_URL` | `https://chicman-api.onrender.com` | build |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | build |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from step 2.3 | build |
   | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key | build |
   | `NEXT_PUBLIC_STORAGE_UPLOAD_ORIGIN` | `https://<account-id>.r2.cloudflarestorage.com` | build |
   | `NEXT_PUBLIC_MEDIA_BASE_URL` | `https://pub-<id>.r2.dev` | build |
   | `ANDROID_PACKAGE_NAME` | `com.chicman.chicman` | build |
   | `ANDROID_CERT_SHA256` | release key fingerprint (step 9) | build |
   | `API_INTERNAL_URL` | `https://chicman-api.onrender.com` | runtime |
   | `CATALOG_INTERNAL_KEY` | same as on Render | runtime |
   | `TRUST_PROXY_HOPS` | `1` (check, step 7) | runtime |

   The `NEXT_PUBLIC_*` values and the Content-Security-Policy are fixed at build time: **redeploy after changing any of them**.
3. First deploy: create the build hook ([Deploying updates](#deploying-updates), step 2) and run `curl -X POST -d '{}' <hook URL>`. A build started from the UI or by a git push is skipped by `netlify.toml`. Each production build and all traffic use credits (300 a month). `netlify.toml` skips every build not started by the build hook: git pushes, deploy previews, branch deploys.
4. If the build fails with a doubled path such as `apps/web/apps/web/.next`, change `publish` in `netlify.toml` to `.next`. If the site fails at runtime with `Cannot find module 'next/…'`, add the environment variable `PNPM_FLAGS=--shamefully-hoist`. Both are known Netlify issues with pnpm monorepos.

## 6. Auth e-mail and Turnstile

1. **Turnstile:** add `chicman.netlify.app` to the widget's hostnames (or create a production widget).
2. **Gmail:** create a dedicated account, turn on 2-Step Verification, and create an **App password**.
3. Apply the Auth settings with a Supabase personal access token. Run it first without `--apply`:
   ```sh
   SUPABASE_ACCESS_TOKEN=<token> SUPABASE_PROJECT_REF=<ref> SITE_URL=https://chicman.netlify.app \
   SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_USER=<gmail> SMTP_PASS=<app password> \
   SMTP_SENDER_EMAIL=<gmail> SMTP_SENDER_NAME=Chicman TURNSTILE_SECRET_KEY=<secret> \
   node supabase/apply-auth-config.mjs --apply
   ```
   It sets the site URL, the single redirect `https://chicman.netlify.app/auth/callback`, custom SMTP, CAPTCHA, and the bilingual templates.
4. *Authentication → Rate limits*: keep e-mails per hour at 30 or below (Gmail's daily limit).

## 7. Keep-alive, monitoring, and checks

**UptimeRobot** (free), with e-mail alerts:
- HTTP(S) monitor `https://chicman-api.onrender.com/api/v1/health`, keyword `ok`, every **5 minutes**. This is also the **keep-alive**: without it the API sleeps, the worker stops, and the first visitor waits about a minute.
- HTTP(S) monitor `https://chicman.netlify.app/favicon.ico`: a static file, so it uses almost no Netlify credits (a page would run a server function each time).

Checks before launch:
1. `curl https://chicman.netlify.app/.well-known/assetlinks.json` shows the package and fingerprint.
2. A search on the site returns results; the API answers `"search":{"degraded":false}` (`curl 'https://chicman-api.onrender.com/api/v1/products?q=robe'`).
3. `curl -s -o /dev/null -w '%{http_code}' https://pub-<id>.r2.dev/` is not `200` (no public listing).
4. A buyer registers with an outside e-mail, receives the Gmail confirmation, completes setup; password recovery works.
5. A seller registers. The first administrator is created **from your machine**, because Render's free plan has no shell:
   `DATABASE_URL=<session pooler URL> pnpm --filter @chicman/api admin:provision -- --supabase-user-id <uuid>`.
   The administrator approves the shop, and the seller uploads a photo, which appears from `r2.dev`.
6. Checkout, confirmation, delivery, and collection, as in the QA audit's section 5.
7. After 30 minutes without visits, the site still answers at once (keep-alive working), and the Render logs show the 5-minute jobs.
8. **Client addresses (open):** Render appends to `X-Forwarded-For`, and the number of proxies is not documented; Netlify's is not either. Per-IP rate limits depend on `TRUST_PROXY_HOPS` on both. Ask Render and Netlify support how many proxies add an entry for this service, and set the values accordingly. Until then, per-IP limits may group visitors or be bypassable; per-user limits are unaffected.

## 8. Backups

- **Database:** `.github/workflows/db-backup.yml` runs nightly. Add the repository secrets `PRODUCTION_DATABASE_URL` (session pooler URL) and `BACKUP_PASSPHRASE` (long and random; keep a copy offline). Run it once by hand (*Actions → Database backup → Run workflow*) and check the artifact. Backups are kept 14 days.
- **Restore** a downloaded artifact into the production database, with the Render service suspended:
  ```sh
  gpg --decrypt chicman-<time>.dump.gpg > chicman.dump
  pg_restore --clean --if-exists --no-owner --dbname "<session pooler URL>" chicman.dump
  ```
- **Images** live in R2. Cloudflare stores them durably; there is no free versioning, so a deleted object is gone.

## 9. Android release

1. Create the release key once and back it up:
   ```sh
   keytool -genkeypair -v -keystore ~/chicman-release.jks -alias chicman -keyalg RSA -keysize 4096 -validity 10000
   keytool -list -v -keystore ~/chicman-release.jks -alias chicman | grep SHA256
   ```
2. `apps/mobile/android/key.properties` (git-ignored): `storeFile`, `storePassword`, `keyAlias=chicman`, `keyPassword`.
3. Put the fingerprint in Netlify's `ANDROID_CERT_SHA256` and redeploy. For Google Play's fingerprint too, list both, comma-separated.
4. Build:
   ```sh
   flutter build apk --release \
     --dart-define=SUPABASE_URL=https://<ref>.supabase.co \
     --dart-define=SUPABASE_PUBLISHABLE_KEY=<key> \
     --dart-define=API_BASE_URL=https://chicman-api.onrender.com \
     --dart-define=SITE_URL=https://chicman.netlify.app \
     --dart-define=TURNSTILE_SITE_KEY=<site key>
   ```
5. Upload `app-release.apk` to the `chicman-media` bucket as `downloads/chicman.apk` (dashboard upload). It is then at `https://pub-<id>.r2.dev/downloads/chicman.apk`; link it from the site or share it.
6. On a phone: `adb shell pm get-app-links com.chicman.chicman` shows `verified`.

## Deploying updates

Only CI deploys (`.github/workflows/ci.yml`, QA-05). On a push to `main`, the `checks`, `api`, and `mobile` jobs must all pass; then the `deploy` job calls:
- Render's **deploy hook** when `apps/api`, `render.yaml`, `packages/shared`, or the workspace manifests changed (the container applies migrations at start);
- Netlify's **build hook** when `apps/web`, `packages/shared`, or the workspace manifests changed.

Set it up once:
1. Render → `chicman-api` → *Settings → Deploy Hook*: copy the URL into the GitHub repository secret `RENDER_DEPLOY_HOOK_URL`.
2. Netlify → *Project configuration → Build & deploy → Build hooks → Add build hook* (name `ci`, branch `main`): copy the URL into the secret `NETLIFY_BUILD_HOOK_URL`.
3. GitHub → *Settings → Branches*: protect `main` and require the `Typecheck, lint, web tests and build`, `API tests (PostgreSQL, Redis, Meilisearch, S3)`, and `Flutter analyze and tests` checks before merging.

Without the secrets, `deploy` logs that it skipped and succeeds. The hook URLs deploy on their own: keep them secret.

## Limits

Accepted for the free launch; each is a reason to upgrade later.

| Limit | Effect | Way out later |
|---|---|---|
| Render: 750 hours a month, one awake service, 512 MB and 0.1 CPU | Slow under load; a second free service would exhaust the hours and suspend the API mid-month | Render Starter (paid) |
| Render sleeps when the keep-alive fails, and may restart free services | About one minute of waiting for the next visitor; worker jobs pause meanwhile | Paid instance |
| API and worker share one container | A crash of either restarts both | Separate paid worker |
| Netlify: 300 credits a month | When used up, the **site pauses until the next month** | Netlify paid plan, or fewer builds |
| Netlify server functions run far from Frankfurt | Server-rendered pages read the API with extra latency | Paid region choice, or host web with the API |
| PostgreSQL search | No typo tolerance or relevance ranking; words must match | Meilisearch on a paid instance with a disk (spec 18) |
| Supabase free: 500 MB database, 50,000 monthly users, pause after 7 days without activity | Ample at launch. The API's jobs query the database every 5 minutes, which should keep it active (to confirm in the first week) | Supabase Pro |
| No managed backups | The nightly GitHub copy is the only backup; at most a day of data at risk | Supabase Pro (daily backups, point in time) |
| Gmail SMTP | About 500 e-mails a day, sent from a `@gmail.com` address | Resend or Brevo with an own domain |
| `r2.dev` public URL | Rate-limited by Cloudflare, not meant for heavy production traffic | A custom domain on R2 (needs an own domain) |
| `*.onrender.com` and `*.netlify.app` hosts | Less trusted by users and mail filters | An own domain (about USD 10 a year): update both platforms, Supabase (step 6.3), Turnstile, CORS, and rebuild the APK |
| APK outside Google Play; no iOS | Manual installs; iPhone users use the web | Google Play (USD 25 once); Apple (paid) |
