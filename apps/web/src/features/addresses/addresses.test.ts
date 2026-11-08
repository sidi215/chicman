import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { CustomerAddress } from "@chicman/shared"

import { classifyResponse } from "../../lib/api-client"
import {
  addressFormValues,
  addressPin,
  buildAddressCreate,
  buildAddressUpdate,
  dismissAddressPrompt,
  emptyAddressForm,
  geolocationFailure,
  interpretAddressResult,
  isAddressPromptDismissed,
  movedPin,
  samePin,
} from "./address-form"
import { ADDRESS_MESSAGES } from "./messages"

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const gpsPin = { latitude: 18.1012345678, longitude: -15.9987654321, source: "GPS" as const, accuracyMeters: 12 }
const values = { label: " Maison ", city: "Nouakchott", district: "Tevragh Zeina", landmark: "Portail bleu", deliveryPhone: "" }

const saved: CustomerAddress = {
  id: "a1",
  label: "Maison",
  city: "Nouakchott",
  district: "Tevragh Zeina",
  landmark: "Portail bleu",
  deliveryPhone: null,
  latitude: 18.101235,
  longitude: -15.998765,
  locationSource: "GPS",
  accuracyMeters: 12,
  locationConfirmedAt: "2026-11-08T10:00:00.000Z",
  isDefault: true,
  createdAt: "2026-11-08T10:00:00.000Z",
  updatedAt: "2026-11-08T10:00:00.000Z",
}

describe("address form (spec 05)", () => {
  it("builds a confirmed create body from the pin and details (allowlisted, normalized)", () => {
    assert.deepEqual(buildAddressCreate(values, gpsPin), {
      ok: true,
      body: {
        label: "Maison",
        city: "Nouakchott",
        district: "Tevragh Zeina",
        landmark: "Portail bleu",
        latitude: 18.101235,
        longitude: -15.998765,
        locationSource: "GPS",
        accuracyMeters: 12,
        locationConfirmed: true,
      },
    })
    const manual = buildAddressCreate({ ...values, label: "", deliveryPhone: "46000001" }, movedPin(18.09, -15.97))
    assert.ok(manual.ok)
    assert.equal(manual.ok && manual.body.locationSource, "MANUAL")
    assert.equal(manual.ok && "accuracyMeters" in manual.body, false)
    assert.equal(manual.ok && manual.body.deliveryPhone, "+22246000001")
    assert.equal(manual.ok && "label" in manual.body, false)
  })

  it("requires a pin in the service area and valid details", () => {
    assert.deepEqual(buildAddressCreate(emptyAddressForm(), null), {
      ok: false,
      errors: { fields: { city: "required", district: "required", landmark: "required" }, location: "missing" },
    })
    assert.deepEqual(buildAddressCreate(values, movedPin(48.85, 2.35)), { ok: false, errors: { fields: {}, location: "outsideServiceArea" } })
    const bad = buildAddressCreate({ ...values, landmark: "x".repeat(301), deliveryPhone: "12", city: "A\u0007" }, gpsPin)
    assert.deepEqual(bad, { ok: false, errors: { fields: { landmark: "tooLong", deliveryPhone: "invalidPhone", city: "invalid" } } })
  })

  it("an update sends only changed fields; a moved pin is re-confirmed, an unchanged one is not sent", () => {
    const form = addressFormValues(saved)
    assert.deepEqual(buildAddressUpdate(form, addressPin(saved), saved), { ok: true, body: {} })
    assert.deepEqual(buildAddressUpdate({ ...form, landmark: "Nouveau", label: "" }, addressPin(saved), saved), {
      ok: true,
      body: { label: null, landmark: "Nouveau" },
    })
    assert.deepEqual(buildAddressUpdate(form, movedPin(18.2, -15.9), saved), {
      ok: true,
      body: { latitude: 18.2, longitude: -15.9, locationSource: "MANUAL", locationConfirmed: true },
    })
  })

  it("a pin is GPS only while it is where the device put it", () => {
    assert.equal(samePin(gpsPin, { ...gpsPin, latitude: 18.10123459 }), true)
    assert.equal(samePin(gpsPin, movedPin(gpsPin.latitude, gpsPin.longitude)), false)
    assert.deepEqual(movedPin(1, 2), { latitude: 1, longitude: 2, source: "MANUAL", accuracyMeters: null })
  })

  it("maps API outcomes and geolocation failures", async () => {
    assert.deepEqual(interpretAddressResult(await classifyResponse(json(409, { error: { code: "ADDRESS_LIMIT_REACHED" } }))), { state: "limit-reached" })
    assert.deepEqual(interpretAddressResult(await classifyResponse(json(400, { error: { code: "ADDRESS_OUTSIDE_SERVICE_AREA" } }))), {
      state: "outside-service-area",
    })
    assert.deepEqual(interpretAddressResult(await classifyResponse(json(404, { error: { code: "ADDRESS_NOT_FOUND" } }))), { state: "not-found" })
    assert.deepEqual(interpretAddressResult(await classifyResponse(json(403, { error: { code: "FORBIDDEN" } }))), { state: "not-bootstrapped" })
    assert.deepEqual(interpretAddressResult(await classifyResponse(json(401, {}))), { state: "signed-out" })
    assert.deepEqual([1, 2, 3, null].map(geolocationFailure), ["denied", "unavailable", "timeout", "unsupported"])
  })

  it("the onboarding 'later' choice is device-local and survives blocked storage", () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    assert.equal(isAddressPromptDismissed(storage), false)
    dismissAddressPrompt(storage)
    assert.equal(isAddressPromptDismissed(storage), true)
    const blocked = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    }
    assert.equal(isAddressPromptDismissed(blocked), false)
    dismissAddressPrompt(blocked)
    assert.equal(isAddressPromptDismissed(null), false)
  })

  it("has the same message keys in French and Arabic", () => {
    const keys = (value: object): string[] =>
      Object.entries(value).flatMap(([key, child]) => (typeof child === "object" ? keys(child).map((k) => `${key}.${k}`) : [key]))
    assert.deepEqual(keys(ADDRESS_MESSAGES.ar).sort(), keys(ADDRESS_MESSAGES.fr).sort())
  })
})
