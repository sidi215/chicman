import {
  ADDRESS_ERROR_CODES,
  addressCreateSchema,
  isInServiceArea,
  type AddressLocationSource,
  type CustomerAddress,
} from "@chicman/shared"
import type { z } from "zod"

import type { ApiResult } from "@/lib/api-client"

/** Text fields of the address form (spec 05). */
export const ADDRESS_TEXT_FIELDS = ["label", "city", "district", "landmark", "deliveryPhone"] as const
export type AddressTextField = (typeof ADDRESS_TEXT_FIELDS)[number]
export type AddressFormValues = Record<AddressTextField, string>

/** The pin. `GPS` only while it is exactly where the device position put it. */
export interface PinLocation {
  latitude: number
  longitude: number
  source: AddressLocationSource
  accuracyMeters: number | null
}

export type AddressFieldError = "required" | "tooLong" | "invalid" | "invalidPhone"
export type LocationError = "missing" | "outsideServiceArea"
export interface AddressFormErrors {
  fields: Partial<Record<AddressTextField, AddressFieldError>>
  location?: LocationError
}

export type AddressBody = Record<string, unknown>
export type AddressFormResult = { ok: true; body: AddressBody } | { ok: false; errors: AddressFormErrors }

export function emptyAddressForm(): AddressFormValues {
  return { label: "", city: "", district: "", landmark: "", deliveryPhone: "" }
}

export function addressFormValues(address: CustomerAddress): AddressFormValues {
  return {
    label: address.label ?? "",
    city: address.city,
    district: address.district,
    landmark: address.landmark,
    deliveryPhone: address.deliveryPhone ?? "",
  }
}

export function addressPin(address: CustomerAddress): PinLocation {
  return { latitude: address.latitude, longitude: address.longitude, source: address.locationSource, accuracyMeters: address.accuracyMeters }
}

/** The pin after the customer moved the map: placed by hand. */
export function movedPin(latitude: number, longitude: number): PinLocation {
  return { latitude, longitude, source: "MANUAL", accuracyMeters: null }
}

/** Same rounding as the API (6 decimals). */
const round6 = (value: number) => Math.round(value * 1e6) / 1e6

export function samePin(a: PinLocation, b: PinLocation): boolean {
  return round6(a.latitude) === round6(b.latitude) && round6(a.longitude) === round6(b.longitude) && a.source === b.source
}

function validate(values: AddressFormValues, pin: PinLocation | null): { ok: true; data: z.output<typeof addressCreateSchema> } | { ok: false; errors: AddressFormErrors } {
  const errors: AddressFormErrors = { fields: {} }
  if (pin === null) errors.location = "missing"
  else if (!isInServiceArea(pin.latitude, pin.longitude)) errors.location = "outsideServiceArea"
  const result = addressCreateSchema.safeParse({
    label: values.label.trim() === "" ? null : values.label,
    city: values.city,
    district: values.district,
    landmark: values.landmark,
    deliveryPhone: values.deliveryPhone.trim() === "" ? null : values.deliveryPhone,
    latitude: pin?.latitude ?? 18,
    longitude: pin?.longitude ?? -16,
    locationSource: pin?.source ?? "MANUAL",
    accuracyMeters: pin?.accuracyMeters ?? null,
    locationConfirmed: true,
  })
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0]
      if (typeof field !== "string" || !(ADDRESS_TEXT_FIELDS as readonly string[]).includes(field)) continue
      const key = field as AddressTextField
      if (errors.fields[key]) continue
      errors.fields[key] =
        key === "deliveryPhone" ? "invalidPhone" : issue.code === "too_small" ? "required" : issue.code === "too_big" ? "tooLong" : "invalid"
    }
  }
  if (!result.success || errors.location) return { ok: false, errors }
  return { ok: true, data: result.data }
}

/**
 * `POST /customers/me/addresses`, sent only after the customer confirmed the
 * pin and details (`locationConfirmed: true`).
 */
export function buildAddressCreate(values: AddressFormValues, pin: PinLocation | null): AddressFormResult {
  const result = validate(values, pin)
  if (!result.ok) return result
  const { label, deliveryPhone, accuracyMeters, ...rest } = result.data
  return {
    ok: true,
    body: {
      ...rest,
      ...(label ? { label } : {}),
      ...(deliveryPhone ? { deliveryPhone } : {}),
      ...(rest.locationSource === "GPS" && accuracyMeters != null ? { accuracyMeters } : {}),
    },
  }
}

/**
 * `PATCH …/:addressId`: changed fields only. A moved pin is sent with its
 * source and `locationConfirmed: true`; an unchanged pin is not sent.
 */
export function buildAddressUpdate(values: AddressFormValues, pin: PinLocation, current: CustomerAddress): AddressFormResult {
  const result = validate(values, pin)
  if (!result.ok) return result
  const data = result.data
  const body: AddressBody = {}
  if ((data.label ?? null) !== current.label) body.label = data.label ?? null
  if (data.city !== current.city) body.city = data.city
  if (data.district !== current.district) body.district = data.district
  if (data.landmark !== current.landmark) body.landmark = data.landmark
  if ((data.deliveryPhone ?? null) !== current.deliveryPhone) body.deliveryPhone = data.deliveryPhone ?? null
  if (!samePin(pin, addressPin(current))) {
    body.latitude = data.latitude
    body.longitude = data.longitude
    body.locationSource = data.locationSource
    if (data.locationSource === "GPS" && data.accuracyMeters != null) body.accuracyMeters = data.accuracyMeters
    body.locationConfirmed = true
  }
  return { ok: true, body }
}

export type AddressOutcome<T> =
  | { state: "ok"; data: T }
  | { state: "not-found" }
  | { state: "limit-reached" }
  | { state: "outside-service-area" }
  | { state: "invalid" }
  | { state: "not-bootstrapped" }
  | { state: "signed-out" }
  | { state: "unavailable" }
  | { state: "rate-limited" }
  | { state: "error" }

export function interpretAddressResult<T>(result: ApiResult<T>): AddressOutcome<T> {
  switch (result.kind) {
    case "ok":
      return { state: "ok", data: result.data }
    case "unauthorized":
      return { state: "signed-out" }
    case "forbidden":
      // A valid token without account setup.
      return { state: "not-bootstrapped" }
    case "auth-unavailable":
    case "network-error":
      return { state: "unavailable" }
    case "error":
      if (result.status === 404) return { state: "not-found" }
      if (result.status === 409 && result.code === ADDRESS_ERROR_CODES.limitReached) return { state: "limit-reached" }
      if (result.status === 400) return result.code === ADDRESS_ERROR_CODES.outsideServiceArea ? { state: "outside-service-area" } : { state: "invalid" }
      if (result.status === 429) return { state: "rate-limited" }
      if (result.status === 503) return { state: "unavailable" }
      return { state: "error" }
  }
}

/** Browser geolocation failure reasons (`GeolocationPositionError.code`). */
export type GeolocationFailure = "denied" | "unavailable" | "timeout" | "unsupported"

export function geolocationFailure(code: number | null): GeolocationFailure {
  if (code === null) return "unsupported"
  if (code === 1) return "denied"
  if (code === 3) return "timeout"
  return "unavailable"
}

/** The onboarding prompt's "later" choice is remembered on this device only. */
const PROMPT_KEY = "chicman-address-prompt-dismissed"

export function isAddressPromptDismissed(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(PROMPT_KEY) === "1"
  } catch {
    return false
  }
}

export function dismissAddressPrompt(storage: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(PROMPT_KEY, "1")
  } catch {
    // Storage blocked: the prompt shows again next time.
  }
}
