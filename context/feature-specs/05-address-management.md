# 05 — Address Management

## Objective
Allow customers to create and manage delivery addresses for their orders.

## Scope

### Initial Address Setup
- Prompt the customer to set a delivery location after registration.
- Request permission to access the device's location.
- Retrieve the current GPS location when permission is granted.
- Display the location on a map.
- Allow the customer to adjust the map pin.
- Require customer confirmation before saving the location.

### Manual Address Entry
- Allow customers to enter their delivery location manually.
- Support cases where GPS is unavailable or permission is denied.

### Address Management
- Add delivery addresses.
- Display saved addresses.
- Edit existing addresses.
- Delete addresses.
- Set a default delivery address.
- Select an address during checkout.

## Business Rules
- Customers can manage only their own addresses.
- An address must be confirmed by the customer before saving.
- Customers can have multiple saved addresses.
- A default address can be selected for future orders.
- GPS permission is optional; manual entry must remain available.

## Acceptance Criteria
- Customers can add an address using GPS.
- Customers can adjust and confirm their map location.
- Customers can add an address manually.
- Customers can view, edit, and delete saved addresses.
- Customers can select a default address.
- Customers can select a delivery address during checkout.
- Address information is associated with the correct customer.
## Decisions (2026-11-08)

Confirmed by the project owner:

- **Every address has a map location.** GPS entry starts from the device position; manual entry means the customer places the pin themselves (pan and zoom the map). Text details are always collected too.
- **Fields (Mauritania-style):** `label` (optional, e.g. "Maison", "Bureau"), `city` (required), `district` (quartier, required), `landmark` (directions, required, e.g. "near the Ksar mosque, blue gate"), and an optional `deliveryPhone` (if absent, the profile phone is used). No street or postal code.
- **Map tiles:** MapLibre with OpenFreeMap vector tiles (`https://tiles.openfreemap.org`, no key). The style URL is configuration, so the provider can change without code changes.
- **Onboarding prompt:** skippable. Offered right after account setup, and on the account screen while the customer has no address. An address is required only at checkout.

Implementation details (decided with the implementation; open to revision):

- **Ownership:** an address belongs to the authenticated user (`CustomerAddress.userId`, set from the verified identity, never from the request). Owner routes take only the address ID, looked up together with the user; another customer's address → `404`. Bootstrapped users only (`403` before account setup).
- **Confirmation:** the client shows the pin and the details and asks the customer to confirm. Every create, and every update that changes the location, must carry `locationConfirmed: true`; otherwise `400`, nothing is written. The server records `locationConfirmedAt`.
- **GPS versus manual pin:** `locationSource` is `GPS` only while the pin is exactly where the device position put it; any move of the map by the customer makes it `MANUAL` (and drops `accuracyMeters`). Zooming alone keeps the center, so it keeps `GPS`. The pin is the map's fixed center: the customer moves the map under it (same on web and mobile).
- **Location:** `latitude` −90…90 and `longitude` −180…180, stored with 6 decimals (`DECIMAL(9,6)`, about 0.1 m). Deliveries are in Mauritania: the location must fall within its bounding box (latitude 14.6…27.4, longitude −17.2…−4.7), otherwise `400 ADDRESS_OUTSIDE_SERVICE_AREA`. `locationSource` is `GPS` or `MANUAL`; `accuracyMeters` (optional, GPS only) is kept for sellers' information.
- **Text fields:** plain text, NFC, trimmed, no control characters, rendered escaped. Bounds: `label` 1–50, `city` 1–100, `district` 1–100, `landmark` 1–300. `deliveryPhone` normalized to E.164 (`null` clears it). Strict allowlist: unknown or protected fields (`id`, `userId`, `isDefault`, timestamps, `locationConfirmedAt`) → `400`.
- **Limit:** at most 10 addresses per customer; an 11th → `409 ADDRESS_LIMIT_REACHED`.
- **Default address:** the first address becomes the default automatically. `POST …/:id/default` makes another one the default. Deleting the default makes the most recently updated remaining address the default. At most one default per customer (partial unique index); a customer with addresses always has one.
- **Deletion:** a hard delete. Orders (a later feature) must store a snapshot of the delivery address, never a reference that a deletion could break.
- **Routes:** `GET`/`POST /api/v1/customers/me/addresses`, `GET`/`PATCH`/`DELETE /api/v1/customers/me/addresses/:addressId`, `POST /api/v1/customers/me/addresses/:addressId/default`. Responses are built from an allowlist.
- **Rate limit:** address writes, 30 per user and 100 per IP per 10 minutes (Redis counters with the in-memory fallback).
- **Checkout:** no cart or checkout exists yet. This feature provides the API (list with `isDefault`) and the address list that checkout will reuse for selection. Wiring the selection into checkout belongs to the checkout feature.
- **No reverse geocoding:** no geocoding provider is configured. The customer types the city, district, and landmark.
- **Shop addresses (feature 06) are separate:** `Shop.address` is the shop's business address and is not a customer delivery address. Nothing in feature 06 changes.

## Implementation Notes (2026-11-08)

- **API:** `apps/api/src/modules/addresses/` (`AddressService`, routes), migration `customer_addresses` (partial unique index for the default; E.164, non-blank, and service-area `CHECK`s). Writes lock the customer's `User` row, so the limit and the single default hold under concurrency. Switching the default does not change `updatedAt` (list order and default promotion follow the customer's own edits).
- **Shared:** `packages/shared/src/addresses/address.ts` (schemas, limits, service area, error codes, response types).
- **Web:** `apps/web/src/features/addresses/`; pages `/account/addresses`, `/account/addresses/new` (`?onboarding=1`), `/account/addresses/[addressId]`. MapLibre `maplibre-gl` 6.15.0; its worker is copied to `public/maplibre/` before `dev`/`build` (`scripts/copy-maplibre-worker.mjs`). CSP: the map style origin (`NEXT_PUBLIC_MAP_STYLE_URL`, default OpenFreeMap) in `connect-src`, and `worker-src 'self' blob:`. MapLibre's stylesheet sets `.maplibregl-map { position: relative }`: the map container is sized directly (an absolutely positioned container collapses and never receives drags).
- **Mobile:** `apps/mobile/lib/features/addresses/`; `maplibre_gl` ^0.27.1 and `geolocator` ^14.1.2. Location permission is requested only when the customer taps "Utiliser ma position" (Android `ACCESS_FINE/COARSE_LOCATION`, iOS `NSLocationWhenInUseUsageDescription`). The map view and the device locator are providers, replaced by fakes in widget tests. `MAP_STYLE_URL` (`--dart-define`) overrides the style.
- **Onboarding:** after account setup both apps open the address screen with "Plus tard"; the account screen offers the address while none exists, until "Plus tard" (stored on the device).
- **Feature 06 is unchanged:** `Shop.address` remains the shop's business address. Only the shared test harness mounts the address routes too.

## Verification Checklist

- [x] Customers can add an address using GPS. *(API, web browser check with a real geolocation position, mobile widget test.)*
- [x] Customers can adjust and confirm their map location. *(Moving the map makes the pin manual; a confirmation step precedes every save; the API refuses an unconfirmed location.)*
- [x] Customers can add an address manually. *(Pin placed by moving the map; GPS denied or unavailable keeps this path.)*
- [x] Customers can view, edit, and delete saved addresses. *(A moved pin must be confirmed again.)*
- [x] Customers can select a default address. *(First address automatic; default switch; deleting the default promotes the most recently updated address; one default under concurrency.)*
- [ ] Customers can select a delivery address during checkout. *(No cart or checkout exists yet. The list API with `isDefault` and the address list are ready; the selection is wired by the checkout feature.)*
- [x] Address information is associated with the correct customer. *(`userId` from the verified identity; other customers' addresses → `404`; protected fields refused.)*
- [x] Out-of-area pins, invalid fields, and an 11th address are refused, and nothing is written.
- [ ] Manual check by the project owner: web signed in and Android device (real GPS permission prompt and map gestures).
