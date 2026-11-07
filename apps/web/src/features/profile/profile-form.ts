import {
  API_ERROR_CODES,
  FULL_NAME_MAX_LENGTH,
  normalizePhoneNumber,
  type CustomerProfile,
  type CustomerProfileResponse,
  type CustomerProfileUpdateRequest,
  type Locale,
} from "@chicman/shared"

import type { ApiResult } from "@/lib/api-client"

/** What the profile settings form edits (the spec 04 allowlist, nothing else). */
export interface ProfileFormValues {
  fullName: string
  preferredLocale: Locale
  phone: string
}

export type ProfileField = "fullName" | "phone"
export type ProfileErrorKey = "fullNameRequired" | "fullNameTooLong" | "fullNameInvalid" | "invalidPhone"
export type ProfileFieldErrors = Partial<Record<ProfileField, ProfileErrorKey>>

/**
 * `ok` with the fields that changed (possibly none), or the field errors.
 * `changes` only ever holds allowlisted keys, so the request body cannot
 * carry anything else.
 */
export type ProfileFormResult =
  | { ok: true; changes: CustomerProfileUpdateRequest }
  | { ok: false; errors: ProfileFieldErrors }

// Same rule as the API (`customer.schemas.ts`).
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

export function profileFormValues(profile: CustomerProfile): ProfileFormValues {
  return { fullName: profile.fullName ?? "", preferredLocale: profile.preferredLocale, phone: profile.phone }
}

/**
 * Validates the form like the API does and keeps only the fields that differ
 * from the stored profile. The phone is compared after E.164 normalization,
 * so re-entering the same number in another format is not a change.
 */
export function buildProfileUpdate(values: ProfileFormValues, current: CustomerProfile): ProfileFormResult {
  const errors: ProfileFieldErrors = {}
  const changes: CustomerProfileUpdateRequest = {}

  const fullName = values.fullName.normalize("NFC").trim()
  if (fullName === "") {
    // A name can be left unset, but once set it cannot be cleared (1–100 characters).
    if (current.fullName !== null) errors.fullName = "fullNameRequired"
  } else if (fullName.length > FULL_NAME_MAX_LENGTH) {
    errors.fullName = "fullNameTooLong"
  } else if (CONTROL_CHARACTERS.test(fullName)) {
    errors.fullName = "fullNameInvalid"
  } else if (fullName !== current.fullName) {
    changes.fullName = fullName
  }

  if (values.preferredLocale !== current.preferredLocale) changes.preferredLocale = values.preferredLocale

  const phone = normalizePhoneNumber(values.phone)
  if (phone === null) errors.phone = "invalidPhone"
  else if (phone !== current.phone) changes.phone = phone

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, changes }
}

export function hasChanges(changes: CustomerProfileUpdateRequest): boolean {
  return Object.keys(changes).length > 0
}

/** What the settings screen does with a `GET` or `PATCH /customers/me` response. */
export type ProfileOutcome =
  | { state: "ok"; account: CustomerProfileResponse }
  | { state: "invalid-phone" }
  | { state: "invalid" }
  | { state: "not-bootstrapped" }
  | { state: "signed-out" }
  | { state: "unavailable" }
  | { state: "rate-limited" }
  | { state: "error" }

export function interpretProfileResult(result: ApiResult<CustomerProfileResponse>): ProfileOutcome {
  switch (result.kind) {
    case "ok":
      return { state: "ok", account: result.data }
    case "unauthorized":
      return { state: "signed-out" }
    case "auth-unavailable":
    case "network-error":
      return { state: "unavailable" }
    case "forbidden":
      // Valid token without application records: account setup comes first.
      return { state: "not-bootstrapped" }
    case "error":
      if (result.status === 400) return result.code === API_ERROR_CODES.invalidPhone ? { state: "invalid-phone" } : { state: "invalid" }
      if (result.status === 404) return { state: "not-bootstrapped" }
      if (result.status === 429) return { state: "rate-limited" }
      if (result.status === 503) return { state: "unavailable" }
      return { state: "error" }
  }
}
