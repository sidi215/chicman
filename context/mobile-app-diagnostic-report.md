# Mobile App Diagnostic Report

Date: 2026-11-10. Scope: the Flutter app in `apps/mobile` (features 03–11). Investigation only: no source, configuration, schema, or environment file was changed. Two throwaway probe tests were run from the session's scratch directory (outside the repository) to exercise the app's real code against the running local API; they are not part of the project.

## 1. Overall application health

**The code is healthy; the way the app is configured at build time is not.** No code defect was found that stops the app from starting or that breaks every screen. Every confirmed problem that can make "the whole app not work" comes from build-time configuration:

- the app reads its settings only from `--dart-define` values;
- the `.env` file and the IDE run configuration supply only part of them;
- the fallback values (`localhost`, no site URL) do not work on Android.

| Check | Result |
|---|---|
| `flutter pub get` | OK (newer versions exist, none required) |
| `flutter analyze` | No issues |
| `flutter test` | 233/233 pass |
| `flutter build apk --debug` (documented emulator defines) | Builds (59 s) |
| App on an emulator or phone | **Not run**: no device attached, emulator not started (section 12) |
| Local API (`:4000`), web (`:3000`), object storage (`:8333`) | Running; API health `200` |
| Hosted Supabase Auth | Reachable (`/auth/v1/health` `200`, 0.6 s) |
| Public API contracts with real data | `/products`, `/products/facets`, `/products/:id` decode correctly with the app's own decoders |
| Authenticated API contracts | Match the shared API types by inspection (profile, session, addresses, cart, checkout, orders); not exercised live, since that needs a real signed-in token |

Which symptom you see depends only on how the app was launched:

| How the app is launched | What the user sees |
|---|---|
| IDE "Run main.dart", or plain `flutter run` (no defines) | Login says "L'authentification n'est pas configurée." On an emulator or phone, the storefront shows the load error: the API address is `localhost`, which is the device itself |
| `flutter run --dart-define-from-file=.env` only | Login and sign-up show the CAPTCHA configuration error and send nothing. The storefront fails as above |
| `.env` plus `API_BASE_URL=http://10.0.2.2:4000` and `SITE_URL` (emulator, per README) | API works. **Every product image falls back to the placeholder**, because image URLs point to `localhost:8333` |
| Phone with `adb reverse` for 4000 and 8333, plus the README defines | Expected to work. Last confirmed on a phone for features 03–06; later features were never run on a device |

**Which of these the reported failure matches is not proven.** The report does not say how the app was launched. The first two rows reproduce "nothing works" exactly.

## 2. Does the app build and launch?

- **Builds:** yes. Analyzer clean, 233 tests pass, debug APK built with the current working tree (which includes the uncommitted feature 11 changes).
- **Launches:** startup cannot crash on configuration. `main()` (`lib/main.dart:16-44`) never throws for missing settings:
  - shared preferences fall back to `null`;
  - `initSupabaseAuth` returns `null` when the Supabase values are missing, when it throws, or after 5 s (`lib/core/auth/supabase_init.dart:17-47`);
  - `runApp` always runs.

  A probe that pumped the real `MyApp` and `AppShell`, with real HTTP and the default configuration, rendered the storefront and the account tab with no Flutter exception (`takeException()` returned `null`).
- **On a real device:** not verified in this investigation.

## 3. Main confirmed problems

| ID | Priority | Problem | Status |
|---|---|---|---|
| C1 | P0 (configuration) | No usable API address unless `API_BASE_URL` is passed by hand; the default `http://localhost:4000` cannot reach the computer's API from an emulator or phone | Confirmed (code, IDE config, probe) |
| C2 | P0 (configuration) | Login and sign-up are blocked when the app is started from `.env` alone: `.env` has the Turnstile site key but no `SITE_URL`, so the CAPTCHA fails closed | Confirmed (code, `.env` key names, README) |
| C3 | P0 (configuration) | The IDE run configuration passes no defines at all: authentication is disabled and the API address is `localhost` | Confirmed |
| C4 | P1 | Product images point to `http://localhost:8333/…`, which the emulator cannot reach: every image (storefront, product, cart, checkout, orders) shows the placeholder | Confirmed (live API response, API `.env` key) |
| C5 | P2 | When the API cannot be reached, the account screen says the **authentication** service is unavailable, which points the diagnosis to Supabase instead of the network | Confirmed (code) |
| C6 | P2 | A failed `GET /customers/me` silently hides the profile, orders, and shop buttons on the account screen, with no error and no retry | Confirmed (code) |
| C7 | P3 | No global error handler or logging: framework and asynchronous errors are only visible in a debug console | Confirmed (code) |
| C8 | P3 | `apps/mobile/README.md` is the Flutter template; the real run instructions are only in the root `README.md` | Confirmed |

| ID | Priority | Suspected problem | Status |
|---|---|---|---|
| S1 | P2 | A slow Supabase start (over 5 s) disables authentication for the rest of the session, and the screen then says it is "not configured" | Suspected (code path; not reproduced) |
| S2 | — | Map rendering (MapLibre), GPS, the Turnstile WebView, and secure storage on the current Android image | Not verifiable without a device |

### C1 — The API address is wrong on Android unless set by hand (P0, configuration)

- **Where:**
  - `apps/mobile/lib/core/config/app_config.dart:26-29`: `API_BASE_URL` defaults to `http://localhost:4000`.
  - `apps/mobile/.env` defines only `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `TURNSTILE_SITE_KEY` (key names checked; values not read into this report).
- **What is wrong:** `localhost` on an emulator or phone is the device itself, not this computer. Without `adb reverse tcp:4000 tcp:4000`, every request fails with a connection error.
- **Why it breaks everything:** every screen except the static parts of the home page needs the API: storefront sections, listing, product details, filters, account session check, profile, addresses, cart, checkout, and orders. They all go through one `ApiClient` (`lib/features/auth/application/auth_providers.dart:19-21`).
- **Evidence:**
  - A probe with the app's own `ApiClient`: a refused port gives `ApiNetworkError` in 24 ms. An unroutable address (`10.0.2.2` seen from the computer) also gives `ApiNetworkError`, after the 15 s timeout (`lib/core/network/api_client.dart:58`).
  - Pumping the real app against a refused API: the storefront shows no products.
  - The probe printed the app's default configuration: `apiBaseUrl=http://localhost:4000`, `hasSupabase=false`.
- **Affects:** all API-backed screens (features 04–11), and the account area of feature 03.
- **Not a code regression:** the default has been the same since setup. The README documents the extra defines.

### C2 — Login and sign-up are blocked when the app runs from `.env` alone (P0, configuration)

- **Where:**
  - `app_config.dart:65-66`: `turnstileBaseUrl` is `null` without `SITE_URL`.
  - `lib/features/auth/presentation/turnstile_field.dart:247-255`: the field shows `captchaNotConfigured`.
  - `login_screen.dart:41, 64, 89`: the request is blocked while no CAPTCHA token exists.
- **What is wrong:** `.env` carries the Turnstile site key, so the CAPTCHA is required. `SITE_URL` must be passed separately (README: "`SITE_URL` is required with `TURNSTILE_SITE_KEY`"). Started with `--dart-define-from-file=.env` alone, the app refuses every login and sign-up. This is the intended fail-closed behaviour, decided on 2026-11-08 (progress tracker), but the `.env` file does not match it.
- **Affects:** login, registration, and so every signed-in feature (04–11).

### C3 — The IDE run configuration passes nothing (P0, configuration)

- **Where:** `apps/mobile/.idea/runConfigurations/main.dart.xml` sets only `filePath`; there is no `.vscode/launch.json`.
- **What happens:**
  - `hasSupabase` is false, so authentication is disabled and the login screen says "L'authentification n'est pas configurée." (reproduced by the probe);
  - the API address is the `localhost` default from C1.
- **Affects:** everything except the static storefront chrome.

### C4 — Product images are unreachable from the emulator (P1)

- **Where:** `apps/api/.env`: `MEDIA_PUBLIC_BASE_URL` is a `localhost:8333` address, as in `apps/api/.env.example:52`.
- **What happens:** the API returns image URLs such as `http://localhost:8333/…` (seen in the live `/products` response). On an emulator using `API_BASE_URL=http://10.0.2.2:4000` (the README's emulator instructions), that host is the emulator itself. Every product image therefore shows the placeholder (`CatalogImage`'s error builder, `lib/features/catalog/presentation/catalog_widgets.dart`).
- **Why it looks like a broken app:** the home grid, listings, details, cart, checkout, and orders all show placeholders. The README tells phone users to `adb reverse tcp:8333`, but not emulator users.
- **Affects:** features 08, 09, 10, 11 (images only; data still loads).

### C5 — An unreachable API is reported as an authentication outage (P2)

- **Where:**
  - `lib/features/auth/domain/session_check.dart:53`: `ApiNetworkError` is mapped to `SessionUnavailable`.
  - `account_screen.dart` then shows `authUnavailable`: "Le service d'authentification est momentanément indisponible…"
- **Why it matters:** with C1, a signed-in user is told that **authentication** is down while Supabase is fine (health `200`). That sends the investigation in the wrong direction. The session is kept and a retry button is shown, which is correct.
- **Affects:** the account tab (feature 03/04).

### C6 — Account entry points disappear silently (P2)

- **Where:**
  - `lib/features/auth/application/auth_providers.dart:54-67`: `customerAccountProvider` returns `null` for **any** failure (network, `403`, `500`, a decoding error).
  - `lib/features/auth/presentation/account_screen.dart:91`: `_ContactPhone` then renders nothing.
- **Effect:** after a successful session check, a transient `GET /customers/me` failure removes the phone, "Paramètres du profil", "Mes commandes", and "Ma boutique" buttons, with no message and no retry.
- **Affects:** features 04, 06, and 11 entry points.

### C7 — No global error handling (P3)

- **Where:** `lib/main.dart`. No `FlutterError.onError`, `PlatformDispatcher.instance.onError`, `runZonedGuarded`, or `ErrorWidget.builder` anywhere in `lib/`.
- **Effect:** framework errors and uncaught asynchronous errors are only printed to the debug console. A release build would show a grey box, with nothing logged.

### C8 — The mobile README is the Flutter template (P3)

- **Where:** `apps/mobile/README.md`. The required defines and `adb reverse` steps are only in the root `README.md:103-140`, which makes C1–C4 easy to hit.

### S1 — A slow Supabase start disables authentication for the session (P2, suspected)

- **Where:** `lib/core/auth/supabase_init.dart:17` (5 s timeout) and `:44-47` (any failure returns `null`).
- **Effect:** `authRepositoryProvider` is `null` for the whole run, and login shows "not configured". There is no retry until the app restarts. On a slow first start (cold network, emulator) the app would claim authentication is not configured.
- **Status:** not reproduced. Supabase answered in 0.6 s from this machine.

## 4. Startup and initialization

Order of startup (`lib/main.dart:16-44`):

1. `WidgetsFlutterBinding.ensureInitialized()`.
2. `loadSharedPreferences()`, which falls back to `null`.
3. `AppConfig.fromEnvironment()` (compile-time defines only; `flutter_dotenv` is a dependency but is **not used** anywhere in `lib/`).
4. `initSupabaseAuth` (5 s timeout, never throws).
5. `runApp` with overrides for preferences, config, auth repository, and incoming links.

- **Initial route:** `MyApp(home: AppShell())`. `AppShell` keeps the storefront and `AuthGate` mounted in an `IndexedStack`. There is no splash screen.
- **Can one initialization failure stop the whole app?** No. No failure stops `runApp`. A missing or wrong configuration degrades every feature at once instead (C1–C3), which looks the same to a user.
- **Infinite loading:** none found in code. Every provider ends in data or error. Requests time out after 15 s (5 minutes for presigned uploads).
  - One probe kept the storefront spinner past 10 s with a refused connection.
  - The same request in real time failed in 24 ms.
  - So the spinner came from the probe (`testWidgets`' fake clock), not from the app, and is not counted as a finding.

## 5. Navigation

Navigation is imperative (`Navigator.push` with `MaterialPageRoute`). There is no named router or route table, so there are no broken route names or argument casts.

| Area | Entry point | Reachable |
|---|---|---|
| Home / storefront | `AppShell` tab 0 | Yes |
| Product listing, filters, sort | Home chips and "Voir tout" → `ProductListScreen`; filter and sort sheets | Yes |
| Product details | Card tap → `ProductDetailScreen` | Yes |
| Search | Not implemented (feature 18) | — |
| Auth (login, register, recovery, update password, callback) | `AppShell` tab 1 → `AuthGate` | Yes |
| Account setup | `AccountScreen` when the API answers `403` | Yes |
| Profile settings | Account → "Paramètres du profil" | Yes, unless hidden by C6 |
| Addresses and map | Account → "Mes adresses"; checkout address choice | Yes |
| Shop (spec 06) | Account → "Ma boutique" | Yes, unless hidden by C6 |
| Cart | App bar bag icon on storefront screens | Yes |
| Checkout | Cart → "Passer la commande" | Yes |
| Orders (feature 11, uncommitted) | Account → "Mes commandes"; checkout confirmation → "Suivre ma commande" | Yes, unless hidden by C6 |
| Notifications | Not implemented (feature 15) | — |

Email links (`EmailLinkListener`) switch to the account tab through `pendingEmailLinkProvider`.

## 6. Authentication

- **Configuration:** `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` come from defines only (C3). Auth options (`supabase_init.dart:27-41`):
  - automatic deep-link detection is off;
  - the implicit flow is used;
  - sessions go to secure storage (`SecureSessionStorage`, Android Keystore) on mobile.
- **Access token:** `SupabaseAuthRepository.accessToken()` (`lib/features/auth/data/auth_repository.dart:82-90`) returns the current token, refreshes it when it has expired, and falls back to the old token if the refresh fails. Background refresh is the SDK's. Token changes emit through `onAuthStateChange` (line 79).
- **Logout:** local scope (`auth_repository.dart:201-203`).
- **State listeners:** `authSessionProvider` starts from the restored session, then follows changes. Account-dependent controllers (cart, checkout, orders) watch only `(isLoading, userId)`, so a token refresh does not reset them.
- **Independent of the backend:** yes. Supabase sign-in, recovery, and session restore talk only to Supabase, which is reachable (health `200`). After sign-in, the account screen needs the Chicman API (session check, `/customers/me`), so C1 makes a successful login **look** broken (see C5).
- **Bearer token:** attached only as `Authorization: Bearer …` by `ApiClient.send` (`api_client.dart:76-104`). Callers cannot replace it.
- **Not verified here:** registration, email confirmation, session restore after restart, and token refresh on a device. They were last verified on a real phone (Samsung, Android 16) on 2026-11-06 and 2026-11-08, per the progress tracker; no auth code changed in features 07–11.

## 7. API connectivity

- **Base URL:** see C1. Android networking:
  - emulator: `10.0.2.2`, or `localhost` with `adb reverse`;
  - phone: `localhost` with `adb reverse` (README).
- **HTTP versus HTTPS:** the development API and media are plain `http`. Android's cleartext rule applies to Java networking stacks; Dart's `HttpClient` in this SDK does not check it (no such check exists in the bundled SDK sources). Plain-HTTP API calls and `Image.network` are therefore not blocked by the manifest, which sets no `usesCleartextTraffic`.
- **Headers:** `accept: application/json`, `content-type` only with a body, `Idempotency-Key` for checkout.
- **Serialization and parsing:** JSON body. A `2xx` response that fails to decode becomes `ApiError(status, 'INVALID_RESPONSE')` and is shown as a generic error. Error bodies are read for `error.code`.
- **Timeouts, retries, interceptors:** 15 s timeout; no automatic retry (by design: retries are user-initiated, and checkout keeps its idempotency key); no interceptors; no Dio (the app uses `package:http`).

**Endpoints:** every path the app calls exists on the API (compared with the route list):

| Area | Paths |
|---|---|
| Catalog | `/products`, `/products/facets`, `/products/:id` |
| Auth and profile | `/auth/session`, `/customers/me` (GET, POST, PATCH) |
| Addresses | `/customers/me/addresses[/:id[/default]]` |
| Cart | `/customers/me/cart[/items[/:id[/accept-price]]]` |
| Checkout | `/customers/me/checkout` |
| Orders | `/customers/me/orders[/:id[/shop-orders/:id/cancel]]` |
| Shop | `/sellers/me/shop[/…]` |

**Bodies and responses:** they match the shared contracts. For example:
- accept-price sends `{price}`, matching `cartItemAcceptPriceSchema`;
- the profile decoder reads `userId`, `roles`, `profile.{phone, fullName, preferredLocale}`;
- the address and cart decoders read the fields of `CustomerAddress` and the cart group/item types.

**Live check:** public catalog endpoints decoded successfully with real data (6 products, facets, one product detail).

**Not exercised live:** authenticated endpoints (no real token). They are covered by `MockClient` tests and by inspection only.

## 8. State management (Riverpod)

- **Session-dependent controllers** (`CartController`, `CheckoutController`, `OrderListController`, `OrderDetailController`):
  - they watch the account (`isLoading`, `userId`) and start from `loading` for each new account;
  - they drop answers from a previous account (generation counter);
  - they check `ref.mounted` after every `await`.
- **Catalog providers:** `FutureProvider.autoDispose` keyed by filters; every outcome is a value (`CatalogOutcome`), so errors reach the UI with a retry.
- **No circular dependencies found.** No provider throws during build. `appConfigProvider` and `apiClientProvider` are plain `Provider`s, overridden in `main()`.
- **Shared failure point:** `apiClientProvider` is shared by every API-backed feature, so a wrong base URL (C1) breaks all of them at once. That is the only shared provider whose failure spreads.
- **Swallowed errors:** `customerAccountProvider` (C6). `profileLocaleSyncProvider` ignores a failed profile read on purpose (documented behaviour).
- **Refresh after changes:**
  - cart changes show the API's returned cart;
  - checkout reloads the cart after placement;
  - order cancellation shows the returned order and re-reads it after a `409`.

## 9. Individual screens

| Area | Route | Providers | Data | Loading / empty / error / success | Depends on |
|---|---|---|---|---|---|
| Home / storefront | Yes | OK | Live OK | Spinner / — / failure view with retry / sections | API (C1), media (C4) |
| Listing, filters, sort | Yes | OK | Live OK | All four | API, media |
| Product details | Yes | OK | Live OK | All four; variant selection | API, media |
| Search | Not built | — | — | — | Feature 18 |
| Login, register, recovery | Yes | OK | Supabase | Errors mapped; CAPTCHA states | Supabase defines (C3), `SITE_URL` (C2) |
| Account and setup | Yes | OK | API | Checking / setup / error with retry | API (C1), C5, C6 |
| Profile settings | Yes | OK | API | Covered by tests | API; entry hidden by C6 |
| Addresses and map | Yes | OK | API | Covered by tests (fake map) | API; MapLibre and GPS on a device unverified |
| Shop (spec 06) | Yes | OK | API | Covered by tests | API; entry hidden by C6 |
| Cart | Yes | OK | API | All four; account guard | API, media |
| Checkout | Yes | OK | API | All four; idempotency key kept only while the outcome is unknown | API, cart |
| Orders (feature 11, uncommitted) | Yes | OK | API | All four; cancellation sheet | API; entry hidden by C6 |
| Notifications | Not built | — | — | — | Feature 15 |

## 10. Localization and UI

- **Locales:** `fr` and `ar` through `GlobalMaterialLocalizations.delegates` (`main.dart:62-63`). The app follows the profile's language, else the device's (`appLocaleProvider`).
- **Dictionaries:** French and Arabic key parity is tested for auth, catalog, cart, checkout, addresses, profile, shop, and orders. No missing keys were found by the tests.
- **RTL:** directional insets are used, and widget tests cover RTL for checkout and orders. The Arabic layout on a device is unverified.
- **Theme:** generated tokens (`AppTheme.light/dark`); `themeModeProvider` persists through shared preferences and falls back to System when storage is unavailable (tested).
- **Shared widgets:** `CatalogImage` has an error placeholder, so missing images (C4) degrade without exceptions. `BrandWordmark` is an asset.
- **Map:** MapLibre with the OpenFreeMap style (`mapStyleUrl`, `lib/features/addresses/domain/address.dart:14`). Rendering needs a GPU and a device, so it is unverified here.
- **Runtime UI exceptions:** none in the probe runs or in the 233 tests.

## 11. Android configuration

- **Manifest** (`android/app/src/main/AndroidManifest.xml`):
  - `INTERNET` and location permissions are declared;
  - App Links intent filter for `https://${appLinkHost}/auth/callback`; the host comes from `SITE_URL` or `-Pchicman.appLinkHost`, else `app-links.invalid` (`android/app/build.gradle.kts:20-23`), which never verifies (expected without a domain).
- **SDK levels:** `minSdk`, `targetSdk`, and `compileSdk` follow Flutter's defaults; Java and Kotlin 17.
- **Release build:** signed with the debug key (template TODO). Not a cause of the current problem, but release builds are not distributable.
- **`flutter doctor`:**
  - some Android SDK licenses are not accepted (the debug build still succeeded);
  - the Linux desktop toolchain lacks GTK (irrelevant to Android).
- **Devices:** no device attached (`adb devices` is empty). AVDs exist: `Medium_Phone`, `Medium_Phone_2`, `Medium_Phone_API_36.0`, `Pixel_7_Pro`, `Pixel_8_Pro`.

## 12. Feature verification matrix

| Feature | Code inspection | Automated tests | Runtime verification | Status |
|---|---|---|---|---|
| 03 Authentication | Done; no defect in code; config issues C2, C3, C5 | Pass (auth domain, flow, Turnstile) | Not in this investigation; earlier real-phone login (2026-11-08) | Works when configured; blocked by C2/C3 |
| 04 Customer profile, locale | Done; C6 | Pass | Not run | OK in code; C6 |
| 05 Addresses and map | Done | Pass (fake map) | Not run (map, GPS) | OK in code; device unverified |
| 06 Shop (mobile) | Done | Pass | Not run; earlier owner check (2026-11-07) | OK in code; C6 |
| 07 Products (seller) | No mobile screens (by scope) | — | — | Not applicable |
| 08 Discovery | Done; live contracts OK | Pass | Live API decode only; no device | OK; images C4 |
| 09 Cart | Done | Pass | Not run | OK in code; needs API |
| 10 Checkout | Done; no regression found (below) | Pass | Not run | OK in code; needs API |
| 11 Orders (uncommitted) | Done | Pass (11) | Not run | OK in code; needs API |
| Theme, language, shell | Done | Pass | Probe render only | OK |

**Did checkout (feature 10) cause a regression? No evidence of one.**
- **`ApiClient.send` gained an optional `headers` argument.** It is spread before the authorization header, so callers cannot replace it, and `get` and `getPublic` delegate unchanged.
- **Address list selection mode.** It is additive (`selectForCheckout`).
- **Cart reload after placement.** It uses the existing controller.
- **Tests and analyzer.** All tests pass and the analyzer is clean.

**Feature 11's uncommitted mobile changes** move the order models into `features/orders/domain/orders.dart`, which checkout re-exports. Checkout's labels now come from the order messages. Both are covered by the passing checkout and orders tests.

## 13. Not verified

- **No emulator was started:** about 3 GB of RAM was free. The progress tracker records that the last emulator boot (2026-11-09) ended with the machine restarting under memory pressure, so it was not risked without your approval.
- **App on an Android emulator or phone:** startup, Logcat, network errors on the device, MapLibre, GPS permission, the Turnstile WebView, secure storage, App Links.
- **Real Supabase sign-in, registration, confirmation, session restore after restart, and token refresh:** needs your credentials and the CAPTCHA.
- **Authenticated API endpoints against the live API:** needs a real token.
- **iOS:** not built on this machine.
- **The exact command or IDE action behind the reported failure:** unknown; it determines which of C1–C4 you hit.

## 14. Recommended fix order

1. **Make the build configuration complete and consistent (C1, C2, C3, C8).** Choose one development network setup, and document it in `apps/mobile/README.md`. Suggested:
   - use `adb reverse tcp:4000 tcp:4000` and `adb reverse tcp:8333 tcp:8333` on both emulator and phone;
   - then `API_BASE_URL=http://localhost:4000` and `SITE_URL=http://localhost:3000` work everywhere;
   - add `API_BASE_URL` and `SITE_URL` to `apps/mobile/.env` (public values; you edit the file), so `--dart-define-from-file=.env` is enough;
   - add `--dart-define-from-file=.env` to the IDE run configuration.

   Optionally, make the app state a missing API address explicitly instead of falling back to `localhost`. No code change is strictly required.
2. **Make media reachable (C4).** With `adb reverse tcp:8333 tcp:8333` on the emulator too, the current `localhost:8333` URLs work. The alternative is a development `MEDIA_PUBLIC_BASE_URL` that devices can reach. This depends on the choice in step 1.
3. **Tell network failures apart from auth failures (C5).** Map `ApiNetworkError` from the session check to its own "API unreachable" state and message (French and Arabic). Independent of the other steps.
4. **Stop hiding account entry points (C6).** Turn `customerAccountProvider` into a value with error states and show a retry, keeping the buttons that need no profile data.
5. **Recover from a slow Supabase start (S1).** Retry initialization, or keep the pending SDK start instead of disabling auth; report "unavailable" rather than "not configured" after a timeout.
6. **Add global error reporting (C7):** `FlutterError.onError` and `PlatformDispatcher.instance.onError` logging error types (no personal data, per code standards), plus a friendly `ErrorWidget` in release.
7. **Run on a device** (after freeing memory, or with a USB phone): the README flow, Logcat captured, then the per-feature checks in the progress tracker's Next Steps (features 08–11).
8. **Later, unrelated to this failure:** a release signing configuration; accept the Android SDK licenses.
