"use client"

import type { CustomerAddress, CustomerAddressListResponse } from "@chicman/shared"
import { MAX_ADDRESSES_PER_CUSTOMER } from "@chicman/shared"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState, type FormEvent } from "react"

import { BrandLogo } from "@/components/brand/brand-logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/features/auth/auth-provider"
import { FormField, FormMessage } from "@/features/auth/components/form-field"
import { TextLink } from "@/features/auth/components/text-link"
import { apiRequest } from "@/lib/api-client"

import {
  addressFormValues,
  addressPin,
  buildAddressCreate,
  buildAddressUpdate,
  dismissAddressPrompt,
  emptyAddressForm,
  interpretAddressResult,
  type AddressFormErrors,
  type AddressFormValues,
  type AddressOutcome,
  type PinLocation,
} from "../address-form"
import { useAddressMessages, type AddressMessages } from "../messages"
import { LocationPicker } from "./location-picker"

type Notice = { tone: "info" | "error"; text: string } | null

function outcomeText(outcome: AddressOutcome<unknown>, t: AddressMessages): string {
  switch (outcome.state) {
    case "not-found":
      return t.notFound
    case "limit-reached":
      return t.limitReached
    case "outside-service-area":
      return t.locationErrors.outsideServiceArea
    case "invalid":
      return t.invalid
    case "unavailable":
      return t.unavailable
    case "rate-limited":
      return t.rateLimited
    default:
      return t.generic
  }
}

/** Calls the address API with the session token; 401 ends the session, 403 means account setup first. */
function useAddressApi() {
  const router = useRouter()
  const { status, getAccessToken, signOut } = useAuth()
  useEffect(() => {
    if (status === "signed-out" || status === "not-configured") router.replace("/login")
  }, [status, router])
  const call = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<AddressOutcome<T>> => {
      const token = await getAccessToken()
      if (!token) return { state: "signed-out" }
      const outcome = interpretAddressResult(await apiRequest<T>(path, token, init))
      if (outcome.state === "signed-out") void signOut()
      if (outcome.state === "not-bootstrapped") router.replace("/account")
      return outcome
    },
    [getAccessToken, signOut, router]
  )
  return { status, call }
}

function Shell({ t, children }: { t: AddressMessages; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 bg-page px-4 py-10">
      <BrandLogo label={t.brand} />
      {children}
    </main>
  )
}

/** `/account/addresses`: saved addresses, default choice, edit and delete (spec 05). */
export function AddressList() {
  const t = useAddressMessages()
  const { status, call } = useAddressApi()
  const [outcome, setOutcome] = useState<AddressOutcome<CustomerAddressListResponse> | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  const load = useCallback(async () => setOutcome(await call<CustomerAddressListResponse>("/customers/me/addresses")), [call])

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<CustomerAddressListResponse>("/customers/me/addresses").then((result) => {
      if (!cancelled) setOutcome(result)
    })
    return () => {
      cancelled = true
    }
  }, [status, call])

  async function act(id: string, path: string, method: string, success: string) {
    if (pending) return
    setPending(id)
    setNotice(null)
    try {
      const result = await call<unknown>(path, { method })
      setNotice(result.state === "ok" ? { tone: "info", text: success } : { tone: "error", text: outcomeText(result, t) })
      await load()
    } finally {
      setPending(null)
      setConfirmingDelete(null)
    }
  }

  const addresses = outcome?.state === "ok" ? outcome.data.addresses : []
  const full = addresses.length >= MAX_ADDRESSES_PER_CUSTOMER

  return (
    <Shell t={t}>
      <Card className="w-full max-w-xl rounded-3xl p-6">
        <CardHeader>
          <CardTitle className="type-headline-small">{t.listTitle}</CardTitle>
          <CardDescription>{t.listSubtitle}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {outcome === null ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
          {outcome !== null && outcome.state !== "ok" ? (
            <>
              <FormMessage tone="error">{outcomeText(outcome, t)}</FormMessage>
              <Button variant="outline" onClick={() => void load()}>
                {t.retry}
              </Button>
            </>
          ) : null}
          {outcome?.state === "ok" && addresses.length === 0 ? <FormMessage tone="info">{t.empty}</FormMessage> : null}
          {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
          <ul className="flex flex-col gap-3">
            {addresses.map((address) => (
              <li key={address.id} className="flex flex-col gap-2 rounded-2xl border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="type-title-small">{address.label ?? `${address.district}, ${address.city}`}</p>
                  {address.isDefault ? <Badge variant="success">{t.default}</Badge> : null}
                </div>
                <p className="type-body-medium">{`${address.district}, ${address.city}`}</p>
                <p className="type-body-small text-muted-foreground">{address.landmark}</p>
                {address.deliveryPhone ? (
                  <p className="type-body-small" dir="ltr">
                    {address.deliveryPhone}
                  </p>
                ) : null}
                {confirmingDelete === address.id ? (
                  <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.confirmDelete}>
                    <span className="type-body-medium">{t.confirmDelete}</span>
                    <Button
                      variant="destructive"
                      disabled={pending !== null}
                      onClick={() => void act(address.id, `/customers/me/addresses/${address.id}`, "DELETE", t.deleted)}
                    >
                      {t.delete}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmingDelete(null)}>
                      {t.cancel}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {address.isDefault ? null : (
                      <Button
                        variant="outline"
                        disabled={pending !== null}
                        onClick={() => void act(address.id, `/customers/me/addresses/${address.id}/default`, "POST", t.defaultChanged)}
                      >
                        {t.makeDefault}
                      </Button>
                    )}
                    <Link
                      href={`/account/addresses/${address.id}`}
                      className="inline-flex h-control items-center rounded-full border border-border px-5 type-label-large hover:bg-muted"
                    >
                      {t.edit}
                    </Link>
                    <Button variant="ghost" disabled={pending !== null} onClick={() => setConfirmingDelete(address.id)}>
                      {t.delete}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {outcome?.state === "ok" ? (
            full ? (
              <FormMessage tone="info">{t.limitReached}</FormMessage>
            ) : (
              <Link
                href="/account/addresses/new"
                className="inline-flex h-control items-center justify-center rounded-full bg-primary px-5 type-label-large text-primary-foreground hover:bg-primary/85"
              >
                {t.add}
              </Link>
            )
          ) : null}
          <TextLink href="/account">{t.backToAccount}</TextLink>
        </CardContent>
      </Card>
    </Shell>
  )
}

/**
 * Create (no `addressId`) or edit an address. Two steps: the map and
 * details, then a confirmation of the pin and details before saving
 * (`locationConfirmed: true`). `onboarding` adds "Plus tard".
 */
export function AddressEditor({ addressId, onboarding = false }: { addressId?: string; onboarding?: boolean }) {
  const t = useAddressMessages()
  const router = useRouter()
  const { status, call } = useAddressApi()
  const [current, setCurrent] = useState<CustomerAddress | null>(null)
  const [loadOutcome, setLoadOutcome] = useState<AddressOutcome<CustomerAddress> | null>(null)
  const [values, setValues] = useState<AddressFormValues>(emptyAddressForm)
  const [pin, setPin] = useState<PinLocation | null>(null)
  const [errors, setErrors] = useState<AddressFormErrors>({ fields: {} })
  const [step, setStep] = useState<"edit" | "confirm">("edit")
  const [body, setBody] = useState<Record<string, unknown> | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (status !== "signed-in" || addressId === undefined) return
    let cancelled = false
    void call<CustomerAddress>(`/customers/me/addresses/${encodeURIComponent(addressId)}`).then((result) => {
      if (cancelled) return
      setLoadOutcome(result)
      if (result.state === "ok") {
        setCurrent(result.data)
        setValues(addressFormValues(result.data))
        setPin(addressPin(result.data))
      }
    })
    return () => {
      cancelled = true
    }
  }, [status, call, addressId])

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice(null)
    const result = current ? buildAddressUpdate(values, pin ?? addressPin(current), current) : buildAddressCreate(values, pin)
    if (!result.ok) return setErrors(result.errors)
    setErrors({ fields: {} })
    if (Object.keys(result.body).length === 0) return setNotice({ tone: "info", text: t.noChanges })
    setBody(result.body)
    setStep("confirm")
  }

  async function save() {
    if (pending || body === null) return
    setPending(true)
    try {
      const result = current
        ? await call<CustomerAddress>(`/customers/me/addresses/${current.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        : await call<CustomerAddress>("/customers/me/addresses", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
      if (result.state === "ok") {
        router.push(onboarding ? "/account" : "/account/addresses")
        return
      }
      setStep("edit")
      setNotice({ tone: "error", text: outcomeText(result, t) })
    } finally {
      setPending(false)
    }
  }

  function later() {
    dismissAddressPrompt(typeof window === "undefined" ? null : window.localStorage)
    router.push("/account")
  }

  const editing = addressId !== undefined
  if (editing && (loadOutcome === null || loadOutcome.state !== "ok")) {
    return (
      <Shell t={t}>
        <FormMessage tone={loadOutcome === null ? "info" : "error"}>
          {loadOutcome === null ? t.loading : outcomeText(loadOutcome, t)}
        </FormMessage>
        <TextLink href="/account/addresses">{t.backToList}</TextLink>
      </Shell>
    )
  }

  const update = (patch: Partial<AddressFormValues>) => setValues((v) => ({ ...v, ...patch }))
  const title = editing ? t.editTitle : onboarding ? t.onboardingTitle : t.newTitle

  return (
    <Shell t={t}>
      <Card className="w-full max-w-xl rounded-3xl p-6">
        <CardHeader>
          <CardTitle className="type-headline-small">{step === "confirm" ? t.confirmTitle : title}</CardTitle>
          <CardDescription>{step === "confirm" ? t.confirmHint : onboarding ? t.onboardingSubtitle : t.mapHint}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <LocationPicker t={t} value={pin} onChange={setPin} interactive={step === "edit"} />
          {errors.location ? <FormMessage tone="error">{t.locationErrors[errors.location]}</FormMessage> : null}
          {step === "edit" ? (
            <form className="flex flex-col gap-4" onSubmit={review} noValidate aria-label={title}>
              {(["label", "city", "district", "landmark", "deliveryPhone"] as const).map((field) => (
                <FormField
                  key={field}
                  label={t.fields[field]}
                  placeholder={t.placeholders[field]}
                  maxLength={field === "landmark" ? 600 : 200}
                  {...(field === "deliveryPhone" ? { type: "tel", inputMode: "tel" as const, dir: "ltr", autoComplete: "tel" } : {})}
                  value={values[field]}
                  onChange={(e) => update({ [field]: e.target.value })}
                  error={errors.fields[field] && t.errors[errors.fields[field]]}
                />
              ))}
              <p className="type-body-small text-muted-foreground">{t.phoneHint}</p>
              {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
              <Button type="submit">{t.review}</Button>
              {onboarding ? (
                <Button type="button" variant="ghost" onClick={later}>
                  {t.later}
                </Button>
              ) : null}
            </form>
          ) : (
            <section className="flex flex-col gap-3" aria-label={t.confirmTitle}>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
                {(["label", "city", "district", "landmark", "deliveryPhone"] as const)
                  .filter((field) => values[field].trim() !== "")
                  .map((field) => (
                    <div key={field} className="contents">
                      <dt className="type-label-large text-muted-foreground">{t.fields[field]}</dt>
                      <dd className="type-body-medium">{values[field].trim()}</dd>
                    </div>
                  ))}
              </dl>
              <Button onClick={() => void save()} disabled={pending}>
                {pending ? t.saving : t.confirmSave}
              </Button>
              <Button variant="outline" onClick={() => setStep("edit")} disabled={pending}>
                {t.back}
              </Button>
            </section>
          )}
          <TextLink href={onboarding ? "/account" : "/account/addresses"}>{onboarding ? t.backToAccount : t.backToList}</TextLink>
        </CardContent>
      </Card>
    </Shell>
  )
}
