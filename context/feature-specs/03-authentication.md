# 03 — Authentication

## Goal

Implement email + password registration with mandatory email confirmation, login, logout, password recovery, and session management for customers, sellers, and administrators using Supabase Auth.

## Design & Architecture Decisions

- Use Supabase Auth for authentication.
- **The email address is the authentication identity.** Customers register with email and password through Supabase Auth. Email confirmation is mandatory before the customer can use an active Chicman account.
- **The phone number is required contact information, not an authentication identity.** It is collected during account setup after email confirmation, stored in the Chicman customer profile (spec 04), editable by the customer without verification, and is **not verified** in the initial release. It is never used for login or password recovery. Phone OTP verification is postponed to a later feature, and no SMS provider is required for the initial launch.
- Password recovery uses Supabase's email recovery flow. Passwords are stored only by Supabase Auth, never in the Chicman database. No custom password storage or custom authentication is implemented.
- Sellers use their own registered customer account (a customer becomes a seller through shop approval; see spec 06). Administrators authenticate through their assigned accounts, with email and password like everyone else.
- Express verifies Supabase access tokens.
- Application roles are managed by the backend and PostgreSQL.
- Supported roles: `CUSTOMER`, `SELLER`, `ADMIN`.
- Unapproved sellers cannot access selling operations.
- Authentication must work across web and mobile.

## Email Registration, Confirmation, Login, and Recovery

### Registration and Account Setup

Customer registration has three steps: **sign-up** (email and password), **email confirmation** (through the link), and **account setup** (the required phone number, then bootstrap). The flow works across devices: nothing from the device used for sign-up is needed to finish it.

1. **Sign-up.** The customer enters an email address and a password, and passes the Turnstile check (Bot Protection). The sign-up form does **not** ask for the phone number. The client calls `signUp({ email, password, options: { emailRedirectTo: "<SITE_URL>/auth/callback", captchaToken } })`.
2. Supabase creates the authentication identity (unconfirmed) and sends the confirmation email (custom template with a token-hash link; see Confirmation and Recovery Links). No session is issued while the email is unconfirmed.
3. The client shows the same "check your email" message whether or not the email is already registered (no account enumeration), with resend (`resend({ type: "signup", email, options: { emailRedirectTo } })`) and an option to correct the email address.
4. The customer opens the link on **any** device.
5. The link points to `<SITE_URL>/auth/callback`. If the Chicman mobile app is installed and the verified platform links are configured, the operating system opens the app. Otherwise the browser opens the web callback.
6. The callback verifies the token hash with Supabase Auth. This confirms the email and establishes a session **on the device that opened the link**.
7. The client calls `GET /api/v1/auth/session`. `403` (no application account yet) → account-setup screen. `200` → the account is already set up.
8. **Account setup.** The customer enters their phone number (required contact information). The client calls `POST /api/v1/customers/me` with `{ phone }`.
9. The API verifies the token (Access-Token Verification Contract), checks email confirmation from Supabase Auth on the server, validates and normalizes the phone, and bootstraps the account.
10. Bootstrap creates exactly one application `User` (holding `CUSTOMER`) and exactly one `CustomerProfile` (with the unverified phone), atomically and idempotently (spec 04).

**Cross-device continuation.** If the link was opened on another device (for example, sign-up in the mobile app, link opened in a laptop browser), the session exists only on that other device. The customer can finish account setup there. Or they can sign in with email and password on the original device: the email is now confirmed, and the session check (`403`) leads to account setup. Account setup runs on whichever device the customer is signed in on first. Bootstrap is idempotent, so starting it on two devices cannot create duplicates.

Rules:

- **No application records before account setup.** Neither sign-up nor email confirmation creates anything in PostgreSQL. The application `User` and `CustomerProfile` are created only when account setup completes, through a successful bootstrap with a valid phone. A confirmed identity that has not finished account setup has no application records, and every protected route except bootstrap returns `403`.
- A Supabase Auth identity may exist before email confirmation. An **unconfirmed identity never receives an active Chicman account**: bootstrap checks the confirmation status itself, from Supabase Auth on the server (spec 04), and refuses an unconfirmed identity. The project setting "Confirm email" is required as well, but the API does not rely on it alone.
- The API never trusts client-supplied user IDs, email-confirmation status, roles, or profile ownership. `user_metadata` (writable by the user) is never a source of identity, confirmation status, roles, or the phone number.
- **The phone number is collected at account setup, after email confirmation.** It is never recovered from the sign-up device, from client-side storage, or from Supabase `user_metadata`, and it is never sent to Supabase Auth. It is unverified contact information (see Future Phone Verification).
- Bootstrap guarantees (atomic, idempotent, retried on unique conflicts, never a success response with a missing `User` or `CustomerProfile`) are defined in spec 04 and are unchanged.

### Login

- Login is `signInWithPassword({ email, password, options: { captchaToken } })`, after the Turnstile check. Phone-based login does not exist.
- An unconfirmed email cannot sign in (Supabase returns `email_not_confirmed`). The client explains that the email must be confirmed and offers to resend the confirmation email.
- After login the client checks the session (`GET /api/v1/auth/session`). `403` leads to account setup. Logout and session persistence and restore are unchanged (see Implementation Notes).

### Password Recovery

- Recovery is Supabase's email recovery flow. After the Turnstile check, the client calls `resetPasswordForEmail(email, { redirectTo: "<SITE_URL>/auth/callback", captchaToken })` and always shows the same "if an account exists, an email was sent" message.
- The custom recovery template links to `/auth/callback` with a recovery token hash (see Confirmation and Recovery Links). The callback verifies it, which establishes a recovery session, then shows the "set a new password" screen. The password is set with `updateUser({ password })`.
- Recovery works across devices and in the browser when the app is not installed, like confirmation.
- SMS or phone-based recovery does not exist.

### Sign-in Email Changes

Not supported in the first release. The email is the Supabase Auth identity and is not a profile field: no Chicman screen or API endpoint edits it, no custom email-change workflow exists, and the clients do not expose Supabase's email-change call. Password recovery stays available. Email-change support (for example Supabase's secure email change, with confirmation of both addresses) is a possible future enhancement.

### Confirmation and Recovery Links (`/auth/callback`)

**One callback URL for web and mobile:** `<SITE_URL>/auth/callback`. On the web it is a Next.js route (`apps/web/src/app/auth/callback/`, implemented; see Implementation Notes). On mobile, the same HTTPS URL opens the app through Android App Links and iOS Universal Links (see Mobile Verified Links). When the app is not installed, or the links are not verified, the browser opens the web callback: this is the fallback.

**Custom email templates (token hash).** The confirmation and recovery templates build the link from the project's configured Site URL and the token hash. They never use a redirect destination taken from the request:

- Confirmation: `{{ .SiteURL }}/auth/callback#token_hash={{ .TokenHash }}&type=email`
- Recovery: `{{ .SiteURL }}/auth/callback#token_hash={{ .TokenHash }}&type=recovery`

The client verifies the hash with `verifyOtp({ token_hash, type })` (supabase-js; `verifyOTP(tokenHash:, type:)` in supabase_flutter). Despite its name, this call verifies the email link. It is not a phone OTP. Token-hash verification does not depend on state stored by the sign-up device (unlike a PKCE code exchange), which is what makes cross-device confirmation work. The templates are kept in the repository (`supabase/templates/`) and contain French and Arabic text.

**Development with Supabase's default email provider (current state).** No domain exists yet, so custom SMTP and the custom templates cannot be used: free projects accept custom templates only with custom SMTP. Until then, the project keeps Supabase's **default** templates and email provider, with mandatory email confirmation still enabled.
- The default link points to Supabase's own verify endpoint. Supabase verifies the link and redirects to the allowlisted `<SITE_URL>/auth/callback`, with the session in the fragment: `#access_token=…&refresh_token=…&type=signup|recovery`. This format does not depend on the sign-up device either (both clients use the implicit flow).
- The callback accepts this format alongside the token-hash format. It applies the same rules (read once, removed from the address bar immediately, never logged, fixed destinations; `signup` → account, `recovery` → new password; other types and error fragments → invalid-link screen). It hands the tokens to Supabase (`setSession`), which checks the access token (`getUser`), or refreshes the session, before storing anything.
- The default provider only delivers to the project team's addresses and is heavily rate-limited. Testing uses an authorized team email.
- The custom French and Arabic templates stay in `supabase/templates/` and are applied together with custom SMTP once a domain is verified. The token-hash path stays supported for that.

**Token handling:**

- The token hash is placed in the URL **fragment** (`#…`), which browsers never send to the server, so it does not reach web server, CDN, proxy, or analytics request logs, or the `Referer` header. If implementation shows that a fragment is incompatible with the mobile link handling, a query string is allowed only if `/auth/callback` is excluded from request logging at every layer. That fallback must be recorded in the Implementation Notes.
- The callback reads the token and **immediately removes it from the address bar** (`history.replaceState`) before doing anything else. The callback page sends `Referrer-Policy: no-referrer` and loads no third-party or analytics scripts (Turnstile included).
- The token is never written to any log, error report, crash report, or analytics event, in any client or in the API. (The API never receives it.)
- Verification runs **once** per token (guarded against double execution, for example React Strict Mode effects or a repeated deep-link event). The token is single-use, so a second attempt would show a false error.
- Only `type` values `email` and `recovery` are accepted. Anything else, or a missing token, shows the invalid-link screen.

**No arbitrary redirects.** The callback reads no `next`, `redirect_to`, or similar parameter. After success the destination is fixed: `email` → the session check (account setup or account), and `recovery` → the "set a new password" screen. Supabase only accepts `emailRedirectTo`/`redirectTo` values on the redirect allowlist (below).

**Expired, invalid, or already-used links.** Verification errors (for example `otp_expired`) show a localized "this link is invalid, has expired, or was already used" screen that does not reveal whether the email is registered:

- confirmation link: offers resending the confirmation email (the customer enters the email) and signing in, because a used link usually means the email is already confirmed;
- recovery link: offers requesting a new recovery email.

**No duplicate bootstrap.** The callback never calls bootstrap. Bootstrap is called only from the account-setup screen, with one request in flight (the submit control is disabled while it runs). The server is idempotent in any case (spec 04).

**App not installed.** The web callback confirms the email and signs the customer in on the web. They can continue on the web (account setup included), or open the mobile app later and sign in with email and password. If the app is installed but the link opens in the browser anyway (some email apps use in-app browsers), the same web fallback applies.

### Site URL and Redirect URL Allowlist

The site URL is configurable per environment and is **not decided for production**. It must not be hardcoded. Clients read it from configuration (web `NEXT_PUBLIC_SITE_URL`, mobile `--dart-define=SITE_URL`; implemented). The Supabase Site URL setting is the same value, because the email templates use `{{ .SiteURL }}`.

| Environment | Supabase Site URL | Redirect URL allowlist (exact entries, no wildcards) |
|---|---|---|
| Local (Supabase CLI) | `http://localhost:3000` | `http://localhost:3000/auth/callback` |
| Hosted development project | the development web URL | `<dev web URL>/auth/callback` |
| Production | `https://<production-domain>` (to be decided) | `https://<production-domain>/auth/callback` |

### Mobile Verified Links

None of this exists yet (Android has only the launcher intent filter; iOS has no entitlements file). The production domain stays configurable, so the host is injected per build, never hardcoded.

**Android App Links** (`apps/mobile/android/app/src/main/AndroidManifest.xml`):
- An intent filter on `MainActivity` with `android:autoVerify="true"`, action `VIEW`, categories `DEFAULT` and `BROWSABLE`, scheme `https`, the host from a Gradle manifest placeholder, and path prefix `/auth/callback`.
- Domain association file `https://<domain>/.well-known/assetlinks.json`: relation `delegate_permission/common.handle_all_urls`, namespace `android_app`, package `com.chicman.chicman`, and the SHA-256 fingerprints of the release signing certificate and, when used, the Play App Signing certificate. Debug fingerprints are allowed only on non-production domains.

**iOS Universal Links:**
- The Associated Domains capability with `applinks:<domain>` in `Runner.entitlements` (created; `applinks:$(APP_LINK_HOST)`). This needs the Apple Developer Team ID and a provisioning profile with Associated Domains.
- Domain association file `https://<domain>/.well-known/apple-app-site-association`: no file extension, served as `application/json` over HTTPS without redirects, with `applinks.details[].appIDs` = `<TeamID>.com.chicman.chicman` and `components` matching `/auth/callback*`.

**Hosting the association files.** Both are served by the web app on the production domain (for example from `apps/web/public/.well-known/`) with the required content types. Their values (fingerprints, Team ID) differ per environment and are added only once they are known.

**Flutter handling.** Incoming links are read with `app_links` (already a transitive dependency of `supabase_flutter`; it becomes a direct dependency when implemented). The app applies the same callback rules as the web: run once, fixed destinations, error screens, and no logging. At implementation, check with the versions in use that Flutter's built-in deep-link handling (`flutter_deeplinking_enabled`) and `supabase_flutter`'s automatic link detection neither consume nor log the link.

**Local testing.** Verified links need a deployed domain with the association files. Locally, mobile flows are tested through the browser fallback followed by sign-in in the app. Link opening itself is tested against a deployed non-production domain (for example with `adb shell pm verify-app-links` on Android, or on an iOS device).

### Email Testing and Delivery

**Local development: Supabase CLI and Inbucket.** Local auth development runs Supabase Auth with the Supabase CLI. This stack is separate from the Chicman Docker Compose stack, and the Chicman application database stays in Docker Compose.
- `supabase init` creates `supabase/config.toml` at the repository root (none exists yet). `supabase start` runs the local Auth stack in Docker, including the **Inbucket** email catcher.
- Every confirmation and recovery email stays local, and no real email is sent. Open the Inbucket web UI (default `http://127.0.0.1:54324`; `supabase status` prints the actual URLs), open the recipient's mailbox, and follow the link, which points to `http://localhost:3000/auth/callback`. Recent CLI versions ship Mailpit in the same role and on the same port, so check the installed version.
- `supabase/config.toml` (not created yet; the Supabase CLI is not installed):
  - `[auth]`: `site_url = "http://localhost:3000"`, and `additional_redirect_urls = ["http://localhost:3000/auth/callback"]`.
  - `[auth.email]`: `enable_signup = true` and `enable_confirmations = true`.
  - `[auth.captcha]`: Turnstile with a test secret key (Bot Protection).
  - `[auth.email.template.confirmation]` and `[auth.email.template.recovery]`: `subject` and `content_path`, pointing to `supabase/templates/`.
- **Asymmetric signing keys locally.** The API accepts only `ES256`/`RS256`, so local Auth must sign with an asymmetric key (generated with the CLI's signing-key command and referenced from `config.toml`; check support in the installed CLI version). The key file is a secret and is not committed.
- Local values:
  - API: `SUPABASE_URL=http://127.0.0.1:54321`, `SUPABASE_JWKS_URL=http://127.0.0.1:54321/auth/v1/.well-known/jwks.json`, `SUPABASE_JWT_ISSUER=http://127.0.0.1:54321/auth/v1`.
  - Clients: the local publishable key from `supabase status`. The Android emulator reaches the host at `10.0.2.2`.

**Hosted development project.** Separate from local testing. Without custom SMTP, its built-in email service is for limited testing only: it is heavily rate-limited and delivers only to the project team's addresses. A hosted project **cannot** deliver email to a local Inbucket instance. Its templates are kept in sync with `supabase/templates/`.

**Production: Resend through Supabase custom SMTP** (selected candidate).
- Supabase project → Authentication → SMTP settings:
  - host `smtp.resend.com`, port `465` (TLS) or `587` (STARTTLS);
  - username `resend`, and as password a Resend API key with sending access only;
  - sender address on the verified Chicman sending domain, and sender name "Chicman".
- DNS for the sending domain (exact values come from Resend during domain verification):
  - **SPF**: the TXT record (and the MX record for bounces) on Resend's sending subdomain.
  - **DKIM**: the `resend._domainkey` TXT record.
  - **DMARC**: a `_dmarc` TXT record, starting with `p=none` and reporting, then tightened to `quarantine`/`reject` once SPF and DKIM align.
- The Resend API key (SMTP password) is stored only in the Supabase project's SMTP settings and the team's secret store. It is never in the repository, a Next.js environment variable, a Flutter `--dart-define`, or the API environment (the API does not send these emails).
- After custom SMTP is enabled, review Supabase's email rate limit.
- The sending domain, credentials, DNS records, and SMTP configuration are **deployment prerequisites** and are not configured yet (see `progress-tracker.md`).

### Bot Protection (Cloudflare Turnstile)

Cloudflare Turnstile protects **sign-up, login, and password-recovery** requests. It works in addition to rate limits, not instead of them.

- **Verification through Supabase Auth.** Supabase Auth's CAPTCHA protection is enabled with Turnstile as the provider. The client renders the Turnstile widget, obtains a token, and passes it as `options.captchaToken` to `signUp`, `signInWithPassword`, and `resetPasswordForEmail`. Resending the confirmation email (`resend`) passes a token too, if Supabase requires one for that call; check this during implementation. Supabase Auth verifies the token with Cloudflare on the server, using the Turnstile secret key from the project's CAPTCHA settings, and rejects requests without a valid token.
- **The client result is never trusted alone.** The widget's success callback grants nothing. Only the server-side verification counts, and the client never decides that the check passed.
- **Backend validation, if ever needed.** These three flows go from the client to Supabase Auth, so the Chicman API does not verify Turnstile for them. If a Chicman API endpoint later needs Turnstile, the API verifies each token with Cloudflare's Siteverify endpoint using the secret key. It checks `success`, the expected `hostname` and `action`, and treats tokens as single-use.
- **Tokens:** single-use, and valid for 5 minutes. The client resets the widget after every submit attempt (success or failure) and when the token expires. Tokens are never logged.
- **Fail closed:** if the widget cannot load or the check fails, the request is not accepted. The client shows a localized message with a retry. There is no bypass in hosted environments.
- **Keys:**
  - The **site key** is public. Web uses `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and mobile `--dart-define=TURNSTILE_SITE_KEY` (both configured).
  - The **secret key** is stored only in Supabase's CAPTCHA settings and the team's secret store. To set it through `supabase/apply-auth-config.mjs`, pass `TURNSTILE_SECRET_KEY` only when running the script; never store it in a repository env file (it was removed from `apps/api/.env` on 2026-11-06, where nothing read it). For local Supabase it would be read in `supabase/config.toml` from an untracked environment variable. It never appears in a client, the repository, or a `NEXT_PUBLIC_*` variable.
- **Hostnames:** each Turnstile widget is restricted to Chicman's hostnames (`localhost` for development; the production domain once decided).
- **Web:** the widget appears on `/register`, `/login`, and the password-recovery request screen. The Content Security Policy allows `https://challenges.cloudflare.com` for scripts and frames. Turnstile is **not** loaded on `/auth/callback` (no third-party scripts there). Setting the new password after recovery uses the recovery session and needs no CAPTCHA.
- **Mobile:** Flutter has no native Turnstile widget. The widget runs in a `webview_flutter` WebView whose document is bundled in the app and loaded with `SITE_URL` as its base URL, so the widget sees the site's hostname (`localhost` in development), which must be in the widget's hostname list. A page fetched from `SITE_URL` would not work on an emulator, where `localhost` is the device itself.
- **Local development and tests** use Cloudflare's documented Turnstile test keys (always pass, always fail) and never the production keys. Local Supabase: `[auth.captcha]` with `enabled = true`, `provider = "turnstile"`, and `secret = "env(…)"` in `supabase/config.toml`; check this against the installed CLI version.
- **Language:** the widget follows the app locale (`fr` or `ar`).

### Abuse Protection and Sessions

- **Bot protection:** Cloudflare Turnstile on sign-up, login, and password recovery (Bot Protection, above).
- **Supabase Auth rate limits** (sign-ups, emails sent, verifications, token refreshes) are reviewed and set for each environment. The email limit is sized for the custom SMTP provider.
- **The Chicman API rate-limits** account bootstrap and profile updates per user and per IP address, using Redis counters (see `architecture.md`, Storage Model). If Redis fails, the same limits are enforced with per-process counters (protection is never switched off). If the limiter itself fails, the request gets `503`.
- **Supabase Auth rate limits** cover sign-up, sign-in, recovery, resend, verification, and token refresh (see the Supabase rate-limits guide). The built-in email provider sends at most 2 emails per hour.
- **Secret keys:** the Supabase secret (or service-role) key may only ever exist on the API's trusted infrastructure. Clients only ever receive the publishable key. The API currently needs no secret key, so none is configured (`SUPABASE_SECRET_KEY` was removed from `apps/api/.env` on 2026-11-06 as unused).
- **Sessions** are managed by the Supabase SDKs (token refresh included). Tokens, token hashes, and `Authorization` headers are never logged. Logout uses local scope, which clears local tokens even when offline.
- **Mobile session storage:** the session is stored in platform secure storage (`flutter_secure_storage`: Keystore-backed AES-GCM on Android, the Keychain with `first_unlock_this_device` on iOS) through a `LocalStorage` adapter (`core/auth/secure_session_storage.dart`), not in the SDK default `shared_preferences`. A session saved by the earlier plaintext storage is moved once and the plaintext copy is deleted. Web sessions are unchanged (`localStorage` via `supabase-js`).

### Supabase Project Configuration

Required for every environment (local through `supabase/config.toml`; hosted projects through their settings):

- Email provider enabled, with email and password sign-up allowed. Phone sign-in disabled.
- "Confirm email" enabled.
- Site URL and the exact redirect allowlist entry (Site URL and Redirect URL Allowlist).
- Custom confirmation and recovery templates with token-hash links (Confirmation and Recovery Links).
- Asymmetric JWT signing keys (see Access-Token Verification Contract).
- Auth rate limits reviewed.
- CAPTCHA protection enabled with Turnstile and the environment's secret key (test keys locally; production keys only in production).
- Production only: Resend custom SMTP with a verified sending domain (Email Testing and Delivery).
- No SMS provider for the initial launch.

### Future Phone Verification

Phone verification may be added by a later feature (for example SMS OTP, with an SMS provider). It is not a hidden dependency of the initial launch. Until it exists:

- every stored phone number is unverified, and no API response, screen, or record may present it as verified;
- email confirmation does not verify the phone number, and the two are separate states;
- the phone number is never linked to the Supabase Auth identity (no `phone` on the Supabase user) and is never used for login or recovery.

## Access-Token Verification Contract

Every protected API request carries a Supabase access token as `Authorization: Bearer <token>`. The API accepts the request only if **all** of the following hold. Otherwise it responds `401 Unauthorized` with no detail about which check failed. The one exception is a token that cannot be checked because the signing key material is unavailable: that is `503`, not `401` (see Authentication Response Codes).

| Check | Requirement |
|---|---|
| Format | Exactly one `Bearer` token in the `Authorization` header. Tokens in query strings, cookies, or the request body are ignored. |
| Signature | Verified against the Supabase project's public keys (JWKS), fetched from `SUPABASE_JWKS_URL` (`https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`) and cached, with a refetch on an unknown `kid`. Only the asymmetric algorithms allowed by configuration (`ES256`, `RS256`) are accepted. `none` and `HS*` are rejected, and the algorithm in the token header is never trusted on its own. |
| Issuer | `iss` exactly equals `SUPABASE_JWT_ISSUER` (`https://<project-ref>.supabase.co/auth/v1`). |
| Audience | `aud` equals or contains `SUPABASE_JWT_AUDIENCE` (`authenticated`). |
| Expiry | `exp` is present and in the future. Clock tolerance is at most 30 seconds. `nbf`/`iat`, if present, must not be in the future beyond the same tolerance. |
| Subject | `sub` is present and a valid UUID (the Supabase Auth user ID). |

### Authentication Response Codes

| Situation | Response | Meaning for the client |
|---|---|---|
| Missing or malformed `Authorization` header, or a token that cannot be parsed or names a disallowed algorithm | `401 Unauthorized` | Credentials are invalid. |
| The key for the token's `kid` is available (cached, or retrieved by a successful refresh) and any check fails: invalid signature, wrong issuer or audience, expired or not yet valid, missing or invalid `sub` | `401 Unauthorized` | Credentials are invalid. |
| The token's `kid` is absent from a key set that was successfully retrieved (including a negative-cache hit) | `401 Unauthorized` | Credentials are invalid. |
| The key for the token's `kid` is not cached, and retrieving or refreshing the JWKS fails because of a timeout or network error (including while a failed refresh is backing off) | `503 Service Unavailable`, error code `AUTH_UNAVAILABLE` | Authentication infrastructure is temporarily unavailable. The token was neither accepted nor found invalid. |

- `401` bodies never say which check failed. The `503` body carries only the `AUTH_UNAVAILABLE` code, so clients can tell the two cases apart.
- A `503` never grants access (fail closed). It is also never proof that the session is invalid: clients keep the session and retry later instead of logging the user out or discarding tokens.

Verification happens only on the server, with a maintained JWT/JOSE library (no hand-written verification). A decoded but unverified payload is never used for any decision.

**Identity and roles come from verified server-side data:**

- The verified `sub` is the only identity input. The API loads the application user from PostgreSQL by `supabaseUserId = sub`.
- The application roles (`CUSTOMER`, `SELLER`, `ADMIN`; a user may hold several, for example `CUSTOMER` and `SELLER`) are read from PostgreSQL (`UserRole`) on each request. It is never taken from token claims. Supabase's `role` claim is the Postgres role (`authenticated`), not an application role. Custom claims, request headers, query parameters, and request bodies are never used either.
- Client-supplied identity or role values (for example `userId`, `role`, `shopId` ownership hints) never grant permissions. Resource ownership is always resolved server-side from the authenticated user.
- A valid token for which no application user exists has no role. It can only call the idempotent account and profile bootstrap endpoint (see spec 04), and any other protected route returns `403`.

### JWKS Retrieval Hardening

An attacker can send tokens with arbitrary `kid` values. Key retrieval must therefore be bounded so that it cannot be used to flood the Supabase JWKS endpoint or stall the API. The key store (`apps/api/src/modules/auth/`) guarantees the following itself. It does not rely on library defaults.

| Concern | Requirement |
|---|---|
| Request timeout | Every JWKS request is aborted after `SUPABASE_JWKS_TIMEOUT_MS` (default 3000). A timeout or network error means a token whose key is not already cached cannot be verified: it is not accepted, and the response is `503` (`AUTH_UNAVAILABLE`), not `401`. |
| Single flight | At most **one** JWKS request is in flight per process. Concurrent verifications that need a refresh await that same request. |
| Refresh cooldown | After any refresh attempt (successful or not), no new refresh starts for `SUPABASE_JWKS_COOLDOWN_MS` (default 30000). After consecutive failures the interval grows exponentially, capped at 5 minutes, and resets after a successful refresh. |
| Negative cache | An unknown `kid` (not present after a successful refresh) is remembered for the cooldown window and rejected without network access. The cache is bounded (at most 1000 entries, oldest evicted) so random `kid`s cannot exhaust memory. |
| Cache lifetime | A successfully fetched key set is cached for up to `SUPABASE_JWKS_MAX_AGE_MS` (default 600000, matching the Supabase edge cache). Known `kid`s verify without network access. |
| Stale on error | If a refresh fails, the last good key set stays in use for known `kid`s. A refresh failure never removes working keys. |
| Fail closed | A token is **never** accepted because its key could not be retrieved. Unknown `kid` after a successful refresh → `401`. `kid` not cached and the key set cannot be retrieved (timeout or network error) → `503` (`AUTH_UNAVAILABLE`), which clients must not treat as a logout. See Authentication Response Codes. |
| Key rotation | A token with a new `kid` triggers a refresh (subject to cooldown and single flight) and verifies once the new key is published. Keys removed from the JWKS stop verifying after the next refresh. Supabase recommends waiting 20 minutes after adding a standby key before signing with it, which is well beyond the cooldown. |

When the JOSE library is selected, verify in its source and documentation which of these protections it already provides (for example timeout, cooldown, and request de-duplication options) and configure them explicitly. Any guarantee in this table that the library does not provide must be implemented in the key store wrapper. Library defaults are never assumed.

**Configuration** (`apps/api/src/config/`, validated at startup; the API refuses to start if any required value is missing): `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE`. Optional, with the defaults above: `SUPABASE_JWKS_TIMEOUT_MS`, `SUPABASE_JWKS_COOLDOWN_MS`, `SUPABASE_JWKS_MAX_AGE_MS`.

The Supabase project must use asymmetric JWT signing keys. With a legacy shared-secret (HS256) project the JWKS endpoint returns no keys, and tokens would have to be verified by calling the Auth server instead.

## Authorization Contract

- **Authentication failure** (no token or a failed check) → `401`, except when key material is unavailable → `503` (`AUTH_UNAVAILABLE`; see Authentication Response Codes). **Authenticated but not permitted** → `403`. The middleware order is: verify token → load user and role from PostgreSQL → role check → resource or ownership check.
- **Normal seller operations require an approved shop, not just the role.** A request to a normal seller operation (products, inventory, seller orders, delivery) is allowed only if:
  1. the user (authenticated) holds the `SELLER` role in the database, **and**
  2. the target shop is owned by that user (it is resolved from the authenticated user; `Shop.ownerUserId` is unique), **and**
  3. that shop's `Shop.status` is `APPROVED` in PostgreSQL.

  The shop and its status are loaded server-side for every request (`requireApprovedSeller`). Client-provided approval status, shop ID, ownership, or role values are ignored. A seller whose shop is `PENDING`, `REJECTED`, or `SUSPENDED` gets `403`, even with role `SELLER`.
- **`SELLER` role transitions** (defined in spec 06, identical in `architecture.md`):
  - **Initial approval** (`PENDING` → `APPROVED`, including approval of a resubmitted application) grants `SELLER` if not already held, and the shop becomes eligible for normal seller operations.
  - **Resubmission** (`REJECTED` → `PENDING`, by the owner) changes no role and never grants `SELLER`; only a later approval does.
  - **Suspension** (`APPROVED` → `SUSPENDED`) retains `SELLER`; it is not revoked, and normal seller operations are blocked by the status check.
  - **Reinstatement** (`SUSPENDED` → `APPROVED`) retains the existing `SELLER` role with no new grant, and is recorded as `REINSTATED`.
  - No role-revocation rule is defined. The role alone never authorizes operations on a pending, rejected, or suspended shop.
- `requireApprovedSeller` is **not** applied to shop onboarding (shop creation, which submits the initial application; resubmission of a rejected application; pending or rejected application management; status viewing). Those operations have their own rules, defined in `feature-specs/06-shop-management.md`.
- The authoritative status is `Shop.status` (see `architecture.md`, Auth and Access Model). Status ownership (defined in spec 06):
  - **Administrator only:** approval (`PENDING` → `APPROVED`), rejection (`PENDING` → `REJECTED`), suspension (`APPROVED` → `SUSPENDED`), and reinstatement (`SUSPENDED` → `APPROVED`).
  - **Shop owner:** only resubmission of their own rejected application (`REJECTED` → `PENDING`), through the authorized resubmission workflow. Shop creation also sets the initial `PENDING` status.
  - The owner can never approve, reject, suspend, or reinstate a shop, and no client-provided status value is ever applied.

  The approval workflow belongs to feature 06 and is out of scope here.

## Implementation Details

**Backend:**
- `apps/api/src/modules/auth/`
- `apps/api/src/middleware/`
- `apps/api/src/config/`

**Web:**
- `apps/web/src/features/auth/`
- `apps/web/src/lib/`
- `apps/web/src/app/auth/callback/` (confirmation and recovery callback)
- `apps/web/public/.well-known/` (`assetlinks.json`, `apple-app-site-association`; added once the domain and signing values are known)

**Mobile:**
- `apps/mobile/lib/features/auth/`
- `apps/mobile/lib/core/`
- `apps/mobile/android/app/src/main/AndroidManifest.xml` (App Links intent filter)
- `apps/mobile/ios/Runner/Runner.entitlements` (Associated Domains)

**Supabase (local development):**
- `supabase/templates/` (confirmation and recovery templates; shared with hosted projects) and `supabase/apply-auth-config.mjs`; `supabase/config.toml` is not created yet (`supabase init`)

**Database:**
- User profile and role models in Prisma schema.

**Do not touch:**
- Product management.
- Shopping cart.
- Checkout and order management.
- Seller shop approval workflows.

## Implementation Notes

Decisions made while implementing this spec. They do not change the contracts above.

**JOSE library (`jose` 6.x) evaluation.** `jose` is used for JWT verification (`jwtVerify`, with `algorithms`, `issuer`, `audience`, `clockTolerance: 30`, `requiredClaims: ["exp", "sub"]`) and to import JWKs. Its `createRemoteJWKSet` is **not** used. It has a timeout, cooldown, and cache age, and it de-duplicates in-flight fetches. However, a failed fetch is retried on every request (no failure cooldown or backoff), it has no negative cache, and it does not separate "unknown `kid`" from "key set unavailable". The key store (`modules/auth/jwks-key-store.ts`) therefore implements every guarantee in the hardening table itself. `jose` does not check that `iat` is not in the future, so the verifier checks it.

**Algorithm binding.** The header `alg` must be in the allowlist **and** equal the algorithm of the key found for its `kid` (from the JWK `alg`, or inferred: EC P-256 → `ES256`, RSA → `RS256`). Symmetric (`oct`) and private JWKs in the key set are never imported. A token without `kid` → `401`.

**Header parsing.** The scheme is case-insensitive (`Bearer`/`bearer`) and must be followed by exactly one token. More than one `Authorization` header → `401`; Node keeps only the first duplicate, so duplicates are counted from the raw headers.

**Middleware** (`apps/api/src/middleware/`, composed in `modules/auth/auth.guards.ts`):

| Guard | Chain | Use |
|---|---|---|
| `tokenOnly` | `authenticate` → `loadAppUser` | Account bootstrap only (spec 04). `req.appUser` may be `null`. |
| `user` | `tokenOnly` → `requireAppUser` | Any route for bootstrapped users (`403` before bootstrap). |
| `role(...roles)` | `user` → `requireRole` | Role-restricted routes, for example `role("ADMIN")` on `modules/admin/`. |
| `approvedSeller` | `user` → `requireApprovedSeller` | Normal seller operations. Sets `req.sellerShop`; handlers scope every lookup to `req.sellerShop.id`, so another shop's resources are `404`. |

Error bodies are `{ "error": { "code": "…" } }` (`UNAUTHORIZED` 401 with `WWW-Authenticate: Bearer`, `AUTH_UNAVAILABLE` 503, `FORBIDDEN` 403, `NOT_FOUND` 404). The codes are shared in `@chicman/shared` (`AUTH_ERROR_CODES`).

**Session endpoint.** `GET /api/v1/auth/session` (guard `user`) returns `{ userId, roles }` from PostgreSQL. Clients use it to check the session with the API: `401` → end the session, `503 AUTH_UNAVAILABLE` or a network error → keep it and offer a retry, `403` → valid session without an application account (bootstrap, spec 04).

**Database.** Migration `auth_users_roles_shops`: `User` (`supabaseUserId` unique), `UserRole` (composite primary key `userId` + `role`), and a **minimal `Shop`** (`ownerUserId` unique, `status`, default `PENDING`). The shop holds only what `requireApprovedSeller` needs. Feature 06 adds the application fields, audit records, and workflow. `CustomerProfile` belongs to feature 04.

**Client flow history.** The first client implementation used phone + password with SMS OTP. It was replaced by the email flow on 2026-11-05. The API token verification, guards, and session endpoint did not change.

**Client auth flow (web and mobile, implemented).**
- **Sign-up:** `signUp({ email, password, options: { emailRedirectTo: "<SITE_URL>/auth/callback", captchaToken } })`. A `user_already_exists`/`email_exists` error is shown as success (no enumeration). Then comes the "check your email" step, with resend and a "change email" option.
- **Login:** `signInWithPassword` with `captchaToken`. `email_not_confirmed` shows a message and a resend button.
- **Recovery:** `resetPasswordForEmail` with `redirectTo` and `captchaToken`. Every outcome except rate limit, CAPTCHA, network, or an invalid address shows the generic "sent" message.
- **Account setup:** the session check `403` shows the account-setup form (phone), which calls `POST /api/v1/customers/me` with one request in flight.
- Password strength is enforced by the Supabase project's password policy; the client only checks that the password is not empty and matches its confirmation.
- Logout is `signOut({ scope: "local" })`. Sessions persist on the device (web: `localStorage`; mobile: `supabase_flutter`) and are restored on launch.

**Web callback (`apps/web/src/app/auth/callback/`, `features/auth/callback.ts`).**
- The fragment is parsed (`token_hash` must match `[A-Za-z0-9_-]{8,512}`; type `email` or `recovery`; Supabase error fragments are invalid) and removed with `history.replaceState` before verification.
- Verification runs once: the promise is kept in a ref, so React Strict Mode's second effect reuses it.
- Success leaves through `window.location.replace` to `/account` (email) or `/auth/update-password` (recovery). Links on the invalid-link screen are plain `<a>` elements. These full page loads keep the callback's strict CSP from carrying over to other pages.
- `next.config.ts` sends `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on `/auth/*`. `/auth/callback` also gets its own CSP: `connect-src` is limited to the site and Supabase, and no third-party scripts are allowed.
- The supabase-js client uses `detectSessionInUrl: false`.
- Verified in a browser against the hosted project with a fake token: one `POST /auth/v1/verify` (403), the fragment removed, the invalid-link screen shown, no CSP violations.
- **Fragment-only navigation:** a second link opened in a tab that already shows `/auth/callback` only changes the fragment (no page load). The page then reloads, so the new link is processed once, from scratch.
- **Live browser tests (2026-11-06, hosted project, no real token used):**
  - Supabase's expired or reused link redirect (`#error=access_denied&error_code=otp_expired`) → invalid-link screen, no Supabase request.
  - Tampered default-format session tokens → `GET /auth/v1/user` 403 → invalid-link screen.
  - Tampered token hashes (`type=email`, `type=recovery`) → `POST /auth/v1/verify` 403 → invalid-link screen (recovery shows the "new link" hint).
  - Hostile `redirect_to`/`next` in the query and fragment are ignored: the page stays on the site, the only links are `/login` and `/register`, and nothing is requested from the other origin.
  - In every case the query and fragment are removed from the address bar and no session is stored. The application database is unchanged (1 user, 1 profile, 1 history entry before and after).

**Security headers and site-wide CSP** (`apps/web/next.config.ts`, set as HTTP headers, not a meta tag).
- **All routes:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy` (camera, microphone, payment, and USB off; geolocation for this site only), and `X-Powered-By` removed.
- **HTTPS only:** `Strict-Transport-Security` and `upgrade-insecure-requests` are added only when `NEXT_PUBLIC_SITE_URL` is `https://` (pending the production domain).
- **CSP:** `default-src 'self'`; `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com` (`'unsafe-eval'` in development only); `connect-src 'self'` plus the Supabase and API origins from configuration (`ws:` in development only); `frame-src https://challenges.cloudflare.com`; `frame-ancestors 'none'`; `base-uri 'none'`; `form-action 'self'`; `object-src 'none'`; `img-src 'self' data: blob:`; `font-src 'self'` (next/font self-hosts the fonts).
- **`/auth/callback`** keeps a stricter policy (no Turnstile, `frame-src 'none'`), `no-referrer`, and `no-store`.
- **Why not nonces:** every page is prerendered (static, with `cacheComponents`), and a per-request nonce would force dynamic rendering of every route. Next.js inlines its bootstrap scripts, so `'unsafe-inline'` is needed for scripts. The policy is a host allowlist instead. Revisit if pages become dynamic.
- **Pending origins** (not used yet, so not allowed): media storage (Cloudflare R2), map tiles and workers (MapLibre/OpenStreetMap, needs `worker-src blob:`), and the production site, API, and Supabase origins once the domain exists.
- **Verified (production build, browser):** the headers on `/login`, `/account`, and `/auth/callback`; Turnstile loads and produces tokens on `/login`, `/register`, and `/forgot-password` with no violation reported by Chicman's pages. The console shows CSP messages from inside Cloudflare's challenge frame; that is Cloudflare's own frame policy, not Chicman's.

**Turnstile.**
- **Web:** `features/auth/turnstile.tsx` loads the script explicitly and renders the widget, with a visible loading line and, on failure, an error message with a retry button (a new widget, or a new script load).
  - The token resets after every attempt, expiry, timeout, or error.
  - A request is blocked client-side while the widget is enabled and has no token; the server-side check is Supabase's.
  - Sign-up, password sign-in, recovery, and resend each pass the current token as `captchaToken`.
- **Without `NEXT_PUBLIC_TURNSTILE_SITE_KEY`:** the widget is disabled and no `captchaToken` is sent (development only). Hosted environments must set the key, and Supabase CAPTCHA must be enabled there.
- **Mobile:** `TurnstileField` loads a bundled HTML document with `loadHtmlString(…, baseUrl: <SITE_URL origin>)`. The document posts `ready`, `token:<value>`, `expired`, or `error` to the `ChicmanTurnstile` JavaScript channel. The site key and language are JSON-encoded into the script. Navigation is limited to the site host and `challenges.cloudflare.com`. The field shows loading, error, and retry states, and each submit discards the token and loads a new challenge. The earlier web page `/auth/turnstile` was removed: an emulator could not load it from `localhost`.
- **Site key:** the existing Cloudflare widget's **site key** is configured in `apps/web/.env.local` (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`) and `apps/mobile/.env` (`TURNSTILE_SITE_KEY`). The secret key is in neither.
- **Hostname verification (2026-11-06):** on `http://localhost:3000`, the real widget issued a token; one diagnostic Siteverify call returned `success: true`, `hostname: "localhost"`, `action: "signup"`. The token was never printed. The mobile WebView uses the same hostname through its base URL, but that path still needs an on-device check.
- **CAPTCHA is enabled on the hosted development project** (Turnstile, secret set; enabled by the project owner; also observed read-only with `apply-auth-config.mjs --show` on 2026-11-06). A password login without a token returned `400 captcha_failed` (`no captcha_token found`) before any account check. Sign-up and recovery without a token were not sent separately. Real web flows with Turnstile (login and recovery for an unregistered address) worked after it was enabled.

**Mobile links.**
- `supabase_flutter` is initialized with `detectSessionInUri: false`, and Flutter's built-in deep linking is disabled (Android `flutter_deeplinking_enabled`, iOS `FlutterDeepLinkingEnabled`). `app_links` delivers the initial link and later links (`core/auth/email_link_listener.dart`). The gate accepts only `https://<SITE_URL host>/auth/callback` and handles each token once (`PendingEmailLink`).
- **Android:** the App Links intent filter (`autoVerify`, `https`, path prefix `/auth/callback`). Its host comes from `-Pchicman.appLinkHost` or the `SITE_URL` `--dart-define`, decoded in `app/build.gradle.kts`, with the fallback `app-links.invalid`, which never verifies. Verified in a debug build: `SITE_URL=https://staging.chicman.example` produced that host in the merged manifest.
- **iOS:** `Runner/Runner.entitlements` (`applinks:$(APP_LINK_HOST)`) and the `APP_LINK_HOST` build setting (default `app-links.invalid`; set per environment). Not built: iOS cannot be built on this Linux machine.
- The `.well-known` association files are not created yet; they need the domain, signing fingerprints, and Team ID.

**API account setup (spec 04), implemented.**
- **Email-confirmation check:** `modules/auth/email-confirmation.ts` calls `GET <SUPABASE_URL>/auth/v1/user` with the user's token and the **publishable** key. The API needs no secret key. The record's `id` must equal `sub`, and confirmation is `email_confirmed_at`. Supabase 401/403 → `401`; a timeout, network error, or 5xx → `503 AUTH_UNAVAILABLE`.
- **Raw token:** `authenticate` keeps the raw token in `req.accessToken` for that call only.
- **New configuration:** `SUPABASE_PUBLISHABLE_KEY` (required), `SUPABASE_AUTH_TIMEOUT_MS` (default 3000), `REDIS_URL` (required when `NODE_ENV=production`; otherwise in-memory counters), and `TRUST_PROXY_HOPS` (default 0).

**Rate limits** (`middleware/rate-limit.ts`, Redis fixed-window counters with `INCR` + `PEXPIRE NX`):
- bootstrap: 10 per user and 60 per IP address per 10 minutes;
- profile update: 20 per user and 100 per IP address per 10 minutes;
- over the limit → `429 RATE_LIMITED` with `Retry-After`;
- **Redis failure (reviewed 2026-11-06):** `FallbackRateLimiter` enforces the same limits with in-process counters and warns at most once a minute, without request data. This is weaker with several API instances, because each counts separately, but protection is never switched off. If the limiter itself throws, the middleware returns `503 SERVICE_UNAVAILABLE` (fail closed). This replaces the earlier fail-open behaviour.
- **Sign-up, sign-in, recovery, and resend** are limited by Supabase Auth, not the API (built-in email: 2 emails per hour; IP-based buckets for sign-up/sign-in, verification, and the token endpoint). `node supabase/apply-auth-config.mjs --show` prints the hosted project's values (read-only).
- **Open question (production):** Supabase counts `GET /auth/v1/user`, which the API calls for the email-confirmation check, in the per-IP "sign-ups and sign-ins" bucket (30 per 5 minutes). Every account setup comes from the API server's IP, so at scale the check would hit that limit. The options need a decision: the Admin API with the secret key on the API, or `Sb-Forwarded-For` with the secret key and IP forwarding enabled.
- **Error logging:** the API's 500 handler logs only the error type, code, and stack frames, never the message (which could quote row data) or request data.
- **Temporary database outages → `503 SERVICE_UNAVAILABLE` (2026-11-06)** (`apps/api/src/lib/database-errors.ts`, error handler):
  - **503 cases:** Prisma `P1001` (unreachable), `P1002`/`P1008` (timeouts), `P1017` (connection closed), and `P2024` (pool timeout); driver-adapter kinds `DatabaseNotReachable`, `ConnectionClosed`, `SocketTimeout`, and `TooManyConnections`; and PostgreSQL SQLSTATEs `08000`/`08001`/`08003`/`08006`, `57P01`–`57P03`, and `53300`.
  - **Response:** `{"error":{"code":"SERVICE_UNAVAILABLE"}}`, logged as `Database unavailable (<code> <kind> <sqlstate>)`, never the message, URL, or credentials.
  - **Still `500 INTERNAL_ERROR`:** misconfiguration (`P1000` wrong credentials, `P1003` missing database), query and constraint errors, and programming errors, logged with type, code, and stack.
  - **Clients:** both already treat `503` as temporary (keep the session, offer a retry).
  - **Tests:** `test/database-errors.test.ts` (classification), `test/error-logging.test.ts`: a real unreachable database → 503; real division by zero, wrong password, and missing database → 500.
- **Failure logging (2026-11-06):** a failed email-confirmation check logs `Email-confirmation check unavailable: <timeout | network error | HTTP n | invalid JSON>`; a failed JWKS refresh logs `JWKS refresh failed (n in a row): <network error | timeout | http status n | invalid response>` (fixed text since 2026-11-07; it previously logged the error message, for example `fetch failed`). Neither logs tokens, headers, URLs, or error messages. The API logs no requests, so headers and bodies never reach the logs.

**Rate-limit, logging, and anti-enumeration verification (2026-11-06).**
- **Configured limits:**

  | Flow | Enforced by | Limit |
  |---|---|---|
  | Account setup `POST /customers/me` | Chicman API (Redis) | 10 per user and 60 per IP per 10 min |
  | Profile update `PATCH /customers/me` | Chicman API (Redis) | 20 per user and 100 per IP per 10 min |
  | Sign-up, login, recovery, resend | Supabase Auth (hosted, read with `--show`) | emails 2/h (built-in provider); `rate_limit_verify` 30, `rate_limit_otp` 30, `rate_limit_token_refresh` 150 (Supabase guide: sign-ups/sign-ins 30 per 5 min per IP; token endpoint 150 per 5 min per IP) |

- **Chicman API limits, executed** (`test/rate-limit-integration.test.ts`, real Redis and PostgreSQL, its own Redis key namespace):
  - each limit allows exactly its configured count, then returns `429` with the body `{"error":{"code":"RATE_LIMITED"}}` only and `Retry-After` ≤ 600;
  - the Redis counter carries the 10-minute TTL and the window resets on expiry;
  - a refused request writes nothing;
  - two API instances share the counters;
  - during a Redis outage (TCP proxy closed), limits stay enforced in memory, with one warning;
  - after recovery, counting returns to Redis;
  - a limiter that throws → `503 SERVICE_UNAVAILABLE` (`test/rate-limit.test.ts`).
- **Supabase limits:** read only. They were not exceeded deliberately, because that means flooding the hosted project (not local infrastructure). The clients map `429` and `over_*_rate_limit` to "Trop de tentatives" (unit tests).
- **CAPTCHA enforcement:** with CAPTCHA enabled on the hosted project (Turnstile), a password login without a token returned `400 captcha_failed` (`no captcha_token found`) before any account check (executed once). Sign-up and recovery without a token were not sent separately.
- **Error logging, executed** (`test/error-logging.test.ts`): an unexpected exception, a database connection failure (wrong port, password in the URL), a Redis connection failure (password in the URL), Supabase Auth unreachable, and a JWKS HTTP 500. In each case the client sees a generic body (`INTERNAL_ERROR` / `503`) or the request is still served with memory limits. Developers get the error type, code, stack frames, or failure reason. The logs contain no password, token, `Authorization` header, connection URL, CAPTCHA secret, email, or phone.
- **Anti-enumeration:**
  - **Executed live (unregistered address, through the UI with a real Turnstile token):** login with a wrong password → `400 {"code":"invalid_credentials","message":"Invalid login credentials"}`, message "Adresse e-mail ou mot de passe incorrect.", no resend option. Recovery → `200 {}`, the generic "Si un compte existe…" message, no email.
  - **Registered address:** not executed (needs a controlled address; manual). Supabase source: a wrong password for a registered address returns the same `invalid_credentials`.
  - **Unit tests:** the clients give identical outcomes for registered and unregistered addresses in login, recovery, and sign-up.
  - **Sign-up with an unregistered address:** not executed (it creates an account and sends an email).

**Client configuration.**
- **Web:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` (falls back to the page origin), and `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- **Mobile:** `--dart-define` (or `--dart-define-from-file=.env`) `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `API_BASE_URL`, `SITE_URL`, and `TURNSTILE_SITE_KEY`.
- Only public values are used on clients; client bundles were checked for secret keys.
- Without this configuration both apps still launch and show that authentication is not configured. Mobile Supabase initialization never blocks startup (5 s timeout).

**Free-plan restriction (confirmed 2026-11-05; current decision: keep the default provider until a domain exists — see Development with Supabase's default email provider).** Supabase rejects custom email templates on free projects that use the built-in email service: "Email template modification is not available for free tier projects using the default email provider." Custom SMTP (Resend) is therefore needed **before** the token-hash templates can be applied, including for development. Until then, Supabase's default emails use its own link format, which `/auth/callback` rejects as invalid.

**Hosted Auth settings.** `supabase/apply-auth-config.mjs` applies the settings above through the Management API (`PATCH /v1/projects/{ref}/config/auth`), with a dry run by default, in two steps (step 2, the templates, runs only once custom SMTP is configured):
- site URL, exact redirect allowlist, email on / phone off, confirmations required, secure email change;
- bilingual subjects and the token-hash templates from `supabase/templates/`;
- Turnstile CAPTCHA, when `TURNSTILE_SECRET_KEY` is set;
- custom SMTP (Resend defaults: `smtp.resend.com`, port 465, user `resend`), when `SMTP_PASS` (Resend API key) and `SMTP_SENDER_EMAIL` are set. The password is sent but never printed.

**Live end-to-end verification (hosted development project, 2026-11-05).** With Supabase's default email provider and an authorized team email, the web flow passed:
- registration;
- confirmation email delivery and confirmation through `/auth/callback` (default-template link);
- account setup with the phone;
- login;
- recovery email delivery and password reset.

Afterwards, Supabase held 1 confirmed user with no auth phone, and the local database held one `User` (CUSTOMER), one `CustomerProfile`, and one `ACCOUNT_SETUP` phone-history entry.

Not covered by this test, and still pending:
- mobile live flows;
- cross-device links;
- unconfirmed-login and expired-link cases;
- Turnstile (no real credentials);
- custom SMTP, branded templates, and external recipients (domain).

**Hosted project state (inspected through the Supabase MCP on 2026-11-05):** ES256 JWKS, email on, phone off, `mailer_autoconfirm: false`, 0 Auth users, empty `public` schema, no security advisories. The Chicman tables live in the local Docker PostgreSQL, not in the hosted database.

## Verification Status (2026-11-06)

Summary of the evidence recorded in this spec and in `progress-tracker.md`. Only executed checks are listed as tested.

**Implemented and tested**
- **Android, manually verified and complete by the project owner (2026-11-06):** authentication on the Android app.
- **Web, live on the hosted development project** (default email provider, authorized team email, 2026-11-05): registration, confirmation email, `/auth/callback`, account setup with the phone, login, recovery email, and password reset.
- **Callback (browser, hosted project, 2026-11-06):**
  - Supabase's expired or reused redirect (`otp_expired`), tampered session tokens, tampered confirmation and recovery token hashes, and redirect injection → invalid-link screen;
  - in every case the URL is cleaned, no session is stored, and no records are written.
- **Turnstile:**
  - real site key on `localhost` (web): tokens issued; Siteverify `hostname: localhost`;
  - CAPTCHA enabled on the hosted project by the project owner; a login without a token → `captcha_failed`.
- **Anti-enumeration:**
  - unregistered address, live: login → `invalid_credentials` with the generic message; recovery → `200 {}` with the generic message;
  - unit tests: identical client outcomes for registered and unregistered addresses.
- **API (automated):** token verification and JWKS hardening; authorization; rate limits with Redis, the in-memory fallback, and recovery; safe error logging; 503 for temporary database outages.
- **Clients (automated):** web and Flutter unit and widget tests, including callback parsing, Turnstile document encoding, and secure session storage (adapter tests with a mocked keystore).

**Implemented, not manually verified**
- **Registered-address anti-enumeration, live:** login with a wrong password, the recovery email arriving, and sign-up with an existing address.
- **CAPTCHA:** sign-up and recovery requests without a token; the web Turnstile failure and retry states.
- **Real expired emails, cross-device confirmation, and login with an unconfirmed email.**
- **The phone-history retention worker** in a running environment (the purge function is tested; no scheduled run is recorded).

**Not implemented**
- Local Supabase CLI setup (`supabase/config.toml`, Inbucket).
- The production approach to the email-confirmation check at scale (decision pending; see Implementation Notes, Rate limits).

**Deferred until a domain or production infrastructure exists**
- The production Site URL and redirect allowlist; Resend custom SMTP with SPF, DKIM, and DMARC; the branded French and Arabic templates; external-recipient email testing.
- Android App Links (`assetlinks.json`, release signing fingerprints) and iOS Universal Links (`apple-app-site-association`, Team ID, Associated Domains); iOS build and testing (no macOS available).
- Production CSP origins and HSTS.

## Verification Checklist

- [x] Customer can sign up with email and password; the sign-up form has no phone field. *(Verified end to end on the hosted development Supabase project (web, default email provider, authorized team email, 2026-11-05). Mobile: widget tests.)*
- [x] No `User` or `CustomerProfile` exists after sign-up or after email confirmation alone; both exist only after account setup completes. *(API tests; after the live test the local database held exactly one `User` (CUSTOMER), one `CustomerProfile`, and one `ACCOUNT_SETUP` history entry, and the Supabase user has no auth phone.)*
- [ ] Sign-up, login, and password-recovery requests without a valid Turnstile token are rejected by Supabase Auth (server-side), and a forged client-side "success" does not get through. *(CAPTCHA is enabled on the hosted project. Login without a token → `400 captcha_failed` (executed 2026-11-06). Sign-up and recovery without a token: not sent yet.)*
- [ ] Turnstile fails closed with a localized retry message; the widget resets after each attempt and on expiry; tokens are never logged; Turnstile is not loaded on `/auth/callback`. *(Implemented on web and mobile; web loading and tokens checked in a browser with the real site key; Android authentication manually verified by the project owner; the callback CSP blocks Turnstile. The failure and retry states still need a manual check.)*
- [x] Local development and tests use Turnstile test keys only. *(Tests run with Turnstile disabled; the browser check used Cloudflare's test site key.)*
- [x] Sign-up sends a confirmation email; no session exists and no Chicman account is bootstrapped before the email is confirmed. *(Supabase default template, verified end to end on the hosted development Supabase project (web, default email provider, authorized team email, 2026-11-05). Custom token-hash template: pending domain setup and custom SMTP.)*
- [ ] Local confirmation and recovery emails are received in Inbucket (Supabase CLI); no real email is sent.
- [x] The confirmation link opens `/auth/callback` in the browser and establishes the session there. *(Verified end to end on the hosted development Supabase project (web, default email provider, authorized team email, 2026-11-05); default-template link format.)*
- [ ] The confirmation link works on a device other than the sign-up device (cross-device). *(Supported by design; not tested live yet.)*
- [ ] With the app installed and verified links configured, the same link opens the mobile app on Android (App Links) and iOS (Universal Links); without the app, the browser fallback works. *(In-app handling tested; the Android intent filter is built from `SITE_URL`. Pending: domain, association files, signing, and an iOS build.)*
- [ ] Expired, invalid, and already-used links show the localized invalid-link screen with resend or sign-in options, and never reveal whether the email is registered. *(Browser-tested against the hosted project with Supabase's `otp_expired` redirect and tampered tokens: invalid-link screen, URL cleaned, no session, no records. Pending manual check: a real expired email and a reused real link.)*
- [x] The token hash is removed from the address bar after it is read, is never logged (client, API, or request logs), and verification runs once per link. *(Web: browser check, one verify request. Mobile: widget test, duplicate links ignored. The token sits in the fragment, so it never reaches the server.)*
- [x] The callback follows no client-supplied redirect destination, and the Supabase redirect allowlist contains only the exact `/auth/callback` entries. *(Unit tests; hosted development allowlist `http://localhost:3000/auth/callback` applied by `apply-auth-config.mjs` step 1, and the live confirmation and recovery links landed on `/auth/callback`. The production allowlist is pending the domain.)*
- [x] After confirmation, account setup asks for the phone number and bootstraps exactly once, even if started on two devices. *(Account setup verified end to end on the hosted development Supabase project (web, default email provider, authorized team email, 2026-11-05); exactly-once under concurrency covered by the API tests against PostgreSQL.)*
- [x] Bootstrap refuses an identity whose email is not confirmed, based on Supabase Auth server-side data, not client input (spec 04). *(API tests; the server-side check against the hosted project accepted the confirmed user in the live test. A live attempt with an unconfirmed identity was not run.)*
- [ ] An unconfirmed email cannot log in; the client offers resending the confirmation email.
- [ ] The registration and recovery screens show the same message for registered and unregistered emails (no account enumeration). *(Implemented and unit-tested: "already registered" errors map to success, and recovery always shows the generic message. Supabase Auth returns `email_not_confirmed` only after a correct password, and the same `invalid_credentials` for an unknown email or a wrong password (verified in the Supabase Auth source). Live check with a registered email pending.)*
- [x] Customer can recover a password through the email recovery link on the web and set a new password. *(Recovery email and reset verified end to end on the hosted development Supabase project (web, default email provider, authorized team email, 2026-11-05).)*
- [x] Password recovery on mobile (Android). *(Manually verified by the project owner, 2026-11-06.)*
- [ ] Password recovery cross-device and through the browser fallback from the app. *(Not tested live.)*
- [x] No screen or endpoint lets the customer change the sign-in email. *(Code: the only `updateUser` calls on web and mobile set the password; `email` is not in the `PATCH` allowlist, and a `PATCH` with `email` → `400` (API test).)*
- [x] Customer can log in and log out with email and password. *(Login verified end to end on the hosted development Supabase project (web, default email provider, authorized team email, 2026-11-05), including after the password reset. Logout verified in a browser.)*
- [x] The phone number is never sent to Supabase Auth as an identity, is never used for login or recovery, and is never shown as verified. *(Code: no Supabase Auth call on web or mobile carries a phone (web unit test asserts it for sign-up); the hosted Supabase user has no auth phone after the live test; web and mobile label the phone "non vérifié"; API tests: no verified flag.)*
- [x] No client bundle or build configuration contains the Supabase secret key, SMTP credentials, or the Turnstile secret key. *(Web `.next/static` and the Android debug APK scanned; the only matches are the SDKs' key-prefix checks.)*
- [ ] Production: Resend custom SMTP delivers confirmation and recovery emails from the verified sending domain, with SPF, DKIM, and DMARC passing. *(Pending domain setup.)*
- [ ] Branded (custom-template) confirmation and recovery emails reach external recipients (not only team addresses). *(Pending domain setup.)*
- [x] Authentication session is restored correctly. *(Web: a stored session restored on reload in a production build and accepted by the real API. Mobile: widget test with a restored session.)*
- [x] Backend rejects invalid or expired tokens.
- [x] Token verification tests (signed with a test key pair served as a JWKS):
  - [x] Valid token → accepted, and identity is the verified `sub`.
  - [x] Invalid signature (wrong key, tampered payload) → `401`.
  - [x] `alg: none` or an HS256 token → `401`.
  - [x] Wrong issuer → `401`. Wrong audience → `401`.
  - [x] Expired token (beyond tolerance) → `401`.
  - [x] Missing `sub`, or a `sub` that is not a UUID → `401`.
  - [x] Missing or malformed `Authorization` header → `401`.
- [x] JWKS hardening tests (against a local JWKS server with request counting and controllable latency):
  - [x] Valid token with a cached `kid` → accepted with no JWKS request.
  - [x] Many tokens with random unknown `kid`s within the cooldown → at most one JWKS request, and all are rejected.
  - [x] 100 concurrent verifications needing a refresh → exactly one JWKS request.
  - [x] 50 concurrent verifications with distinct unknown `kid`s on a cold cache → exactly one JWKS request, all `401`; repeating them within the cooldown → no further request (negative cache).
  - [x] A failed refresh logs only a fixed reason (`network error`, `timeout`, `http status N`, `invalid response`), never the error message or the JWKS host.
  - [x] JWKS server slower than the timeout → verification fails closed (`503`, `AUTH_UNAVAILABLE`) within the timeout bound, and the token is not accepted.
  - [x] JWKS network error (for example connection refused) with an uncached `kid` → `503` (`AUTH_UNAVAILABLE`), not `401`.
  - [x] Unknown `kid` after a successful refresh → `401`, not `503`.
  - [x] An invalid, expired, or wrong-audience token whose key is cached → `401` even while the JWKS endpoint is down.
  - [x] After a failed refresh, known `kid`s still verify, and the retry interval backs off.
  - [x] Key rotation: a token signed with a newly published key verifies after one refresh, and a key removed from the JWKS stops verifying after the next refresh.
- [x] Client-provided roles cannot grant permissions: a `CUSTOMER` sending `role: ADMIN`/`SELLER` in a token claim, header, query, or body is still treated as `CUSTOMER`.
- [x] Seller authorization tests *(against PostgreSQL, through fixture routes that use the production guards until the seller and admin routes exist)*:
  - [x] `SELLER` with an `APPROVED` shop they own → allowed.
  - [x] `SELLER` with a `PENDING`, `REJECTED`, or `SUSPENDED` shop → `403` for normal seller operations.
  - [x] `SELLER` targeting another seller's shop or its resources → `404` (not disclosed; see spec 06).
  - [x] Request body claiming `status: APPROVED` does not change the outcome.
  - [x] A shop owner cannot approve, reject, suspend, or reinstate their own shop (`403`). *(Resubmission of a rejected application is spec 06 and is not implemented yet.)*
  - [x] `CUSTOMER` → `403`. Unauthenticated → `401`.
  - [x] An `APPROVED` shop owner without the `SELLER` role → `403`; `SELLER` without a shop → `403`.
  - [ ] *(spec 06, not implemented yet)* Onboarding is not behind `requireApprovedSeller`: an authenticated customer without a shop can create an application (`201`); an owner can view and manage their own pending application, resubmit their own rejected application, and view their own rejected or suspended shop's status. These routes use the onboarding rules of spec 06 (Authorization rules), not the approved-seller guard.
- [x] API rate limits: account setup 10 per user / 60 per IP and profile update 20 per user / 100 per IP per 10 minutes, then `429 RATE_LIMITED` with `Retry-After`; shared across API instances through Redis; enforced in memory during a Redis outage; `503` if the limiter fails. *(Executed 2026-11-06 against real Redis and PostgreSQL: `test/rate-limit-integration.test.ts`, `test/rate-limit.test.ts`.)*
- [x] Error responses are generic and logs contain no secrets: unexpected exceptions → `500 INTERNAL_ERROR`; temporary database outages → `503 SERVICE_UNAVAILABLE`; misconfiguration and query errors stay `500`; logs never contain passwords, tokens, `Authorization` headers, connection URLs, CAPTCHA secrets, emails, or phones. *(Executed 2026-11-06: `test/error-logging.test.ts`, `test/database-errors.test.ts`.)*
- [x] Role-based access is enforced.
- [x] Users cannot access protected resources without permission.
- [x] Web and mobile authentication work correctly. *(Web: verified end to end on the hosted development project (2026-11-05). Android: manually verified and complete by the project owner (2026-11-06). iOS: not built or tested (no macOS); tracked with Universal Links, deferred.)*