"use client"

import type { OwnerShopResponse, ShopStatus } from "@chicman/shared"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useId, useState, type ComponentProps, type FormEvent } from "react"

import { BrandLogo } from "@/components/brand/brand-logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/features/auth/auth-provider"
import { FormField, FormMessage } from "@/features/auth/components/form-field"
import { TextLink } from "@/features/auth/components/text-link"
import { apiRequest } from "@/lib/api-client"
import { cn } from "@/lib/utils"

import { uploadShopLogo } from "../logo-upload"
import { useLocale } from "@/lib/locale-provider"

import { formatDateTime, useShopMessages, type ShopMessages } from "../messages"
import {
  buildChangeRequest,
  buildShopCreate,
  buildShopUpdate,
  directlyEditableFields,
  emptyShopForm,
  interpretShopResult,
  isEmptyBody,
  mergeShopFormValues,
  shopFormValues,
  type ShopFieldErrors,
  type ShopFormField,
  type ShopFormValues,
  type ShopOutcome,
} from "../shop-form"

type Notice = { tone: "info" | "error"; text: string } | null
type View = { state: "loading" } | { state: "no-shop" } | { state: "shop"; shop: OwnerShopResponse } | { state: "unavailable" } | { state: "error" }

const STATUS_VARIANT: Record<ShopStatus, ComponentProps<typeof Badge>["variant"]> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
  SUSPENDED: "destructive",
}

/** Message for a failed outcome, or `null` when the caller handles it. */
function outcomeNotice(outcome: ShopOutcome, t: ShopMessages): Notice {
  switch (outcome.state) {
    case "already-exists":
      return { tone: "error", text: t.alreadyExists }
    case "conflict":
      return { tone: "error", text: t.conflict }
    case "change-request-open":
      return { tone: "error", text: t.changeRequestOpen }
    case "review-field":
      return { tone: "error", text: t.reviewField }
    case "forbidden":
      return { tone: "error", text: t.forbidden }
    case "invalid":
      return { tone: "error", text: t.invalid }
    case "unavailable":
      return { tone: "error", text: t.unavailable }
    case "rate-limited":
      return { tone: "error", text: t.rateLimited }
    case "error":
      return { tone: "error", text: t.generic }
    default:
      return null
  }
}

/**
 * Seller dashboard for the owner's shop (spec 06): application, status and
 * rejection reason, correction and resubmission, approved-shop editing,
 * `shopName`/`city` change requests, and the logo. The API enforces every
 * rule; this screen only shows what the current status allows.
 */
export function ShopDashboard() {
  const t = useShopMessages()
  const router = useRouter()
  const { status, getAccessToken, signOut } = useAuth()
  const [view, setView] = useState<View>({ state: "loading" })
  // Kept here: a successful change request remounts its keyed section.
  const [confirmation, setConfirmation] = useState<"fields" | "change-request" | null>(null)

  useEffect(() => {
    if (status === "signed-out" || status === "not-configured") router.replace("/login")
  }, [status, router])

  /** Calls the shop API and returns the interpreted outcome. */
  const call = useCallback(
    async (path: string, init?: RequestInit): Promise<ShopOutcome> => {
      const token = await getAccessToken()
      if (!token) return { state: "signed-out" }
      const outcome = interpretShopResult(await apiRequest<OwnerShopResponse>(path, token, init))
      if (outcome.state === "signed-out") void signOut()
      return outcome
    },
    [getAccessToken, signOut]
  )

  const load = useCallback(async () => {
    const outcome = await call("/sellers/me/shop")
    if (outcome.state === "ok") setView({ state: "shop", shop: outcome.shop })
    else if (outcome.state === "no-shop") setView({ state: "no-shop" })
    else if (outcome.state === "forbidden") router.replace("/account")
    else if (outcome.state === "unavailable") setView({ state: "unavailable" })
    else if (outcome.state !== "signed-out") setView({ state: "error" })
  }, [call, router])

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call("/sellers/me/shop").then((outcome) => {
      if (cancelled) return
      if (outcome.state === "ok") setView({ state: "shop", shop: outcome.shop })
      else if (outcome.state === "no-shop") setView({ state: "no-shop" })
      else if (outcome.state === "forbidden") router.replace("/account")
      else if (outcome.state === "unavailable") setView({ state: "unavailable" })
      else if (outcome.state !== "signed-out") setView({ state: "error" })
    })
    return () => {
      cancelled = true
    }
  }, [status, call, router])

  /** Sends a JSON mutation; on success shows the returned shop, on a conflict reloads. */
  const mutate = useCallback(
    async (path: string, method: string, body?: unknown): Promise<ShopOutcome> => {
      const outcome = await call(path, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      })
      if (outcome.state === "ok") setView({ state: "shop", shop: outcome.shop })
      if (outcome.state === "conflict" || outcome.state === "forbidden") await load()
      return outcome
    },
    [call, load]
  )

  /** A mutation whose success is confirmed in the given section. */
  const submitConfirmed = useCallback(
    async (section: "fields" | "change-request", path: string, method: string, body: unknown): Promise<ShopOutcome> => {
      setConfirmation(null)
      const outcome = await mutate(path, method, body)
      if (outcome.state === "ok") setConfirmation(section)
      return outcome
    },
    [mutate]
  )

  return (
    <main className="flex flex-1 flex-col items-center gap-6 bg-page px-4 py-10">
      <BrandLogo label={t.brand} />
      {view.state === "loading" || status !== "signed-in" ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
      {view.state === "unavailable" || view.state === "error" ? (
        <Card className="w-full max-w-xl rounded-3xl p-6">
          <CardContent className="flex flex-col gap-4">
            <FormMessage tone="error">{view.state === "unavailable" ? t.unavailable : t.generic}</FormMessage>
            <Button
              variant="outline"
              onClick={() => {
                setView({ state: "loading" })
                void load()
              }}
            >
              {t.retry}
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {view.state === "no-shop" ? <ApplicationForm t={t} onSubmit={(body) => mutate("/sellers/me/shop", "POST", body)} /> : null}
      {view.state === "shop" ? (
        <>
          <StatusCard t={t} shop={view.shop} onResubmit={() => mutate("/sellers/me/shop/resubmit", "POST")} />
          {view.shop.status === "SUSPENDED" ? null : (
            <>
              <LogoSection
                t={t}
                shop={view.shop}
                getAccessToken={getAccessToken}
                onUploaded={load}
                onRemove={() => mutate("/sellers/me/shop", "PATCH", { logoUrl: null })}
              />
              {/* Keyed by status, not updatedAt: logo changes and saves bump updatedAt and must not discard unsaved edits. */}
              <FieldsForm
                key={view.shop.status}
                t={t}
                shop={view.shop}
                confirmed={confirmation === "fields"}
                onSubmit={(body) => submitConfirmed("fields", "/sellers/me/shop", "PATCH", body)}
              />
            </>
          )}
          {view.shop.status === "APPROVED" ? (
            <ChangeRequestSection
              key={`cr-${view.shop.changeRequest?.id ?? "none"}-${view.shop.changeRequest?.status ?? ""}`}
              t={t}
              shop={view.shop}
              confirmed={confirmation === "change-request"}
              onSubmit={(body) => submitConfirmed("change-request", "/sellers/me/shop/change-requests", "POST", body)}
            />
          ) : view.shop.changeRequest ? (
            <ChangeRequestStatus t={t} shop={view.shop} />
          ) : null}
        </>
      ) : null}
      <TextLink href="/account">{t.backToAccount}</TextLink>
    </main>
  )
}

export function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="w-full max-w-xl rounded-3xl p-6">
      <CardHeader>
        <CardTitle className="type-title-large">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  )
}

/** Multi-line text field with the same look as `Input`. */
export function TextAreaField({
  label,
  error,
  ...props
}: { label: string; error?: string | undefined } & ComponentProps<"textarea">) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="type-label-large">
        {label}
      </label>
      <textarea
        id={id}
        rows={5}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="w-full min-w-0 rounded-2xl border border-input bg-surface px-5 py-3 type-body-medium text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
        {...props}
      />
      {error ? (
        <p id={errorId} className="type-body-small text-error-text">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** The text fields of the shop, limited to `fields`. */
function ShopFields({
  t,
  fields,
  values,
  errors,
  onChange,
}: {
  t: ShopMessages
  fields: readonly ShopFormField[]
  values: ShopFormValues
  errors: ShopFieldErrors
  onChange: (patch: Partial<ShopFormValues>) => void
}) {
  return (
    <>
      {fields.map((field) => {
        const error = errors[field] && t.errors[errors[field]]
        if (field === "description") {
          return (
            <TextAreaField
              key={field}
              label={t.fields.description}
              maxLength={4000}
              value={values.description}
              onChange={(e) => onChange({ description: e.target.value })}
              error={error}
            />
          )
        }
        const phone = field === "contactPhone" || field === "whatsappPhone"
        return (
          <FormField
            key={field}
            label={t.fields[field]}
            maxLength={field === "address" ? 600 : 200}
            {...(phone ? { type: "tel", inputMode: "tel" as const, dir: "ltr", autoComplete: "tel" } : {})}
            value={values[field]}
            onChange={(e) => onChange({ [field]: e.target.value })}
            error={error}
          />
        )
      })}
      {fields.includes("contactPhone") ? <p className="type-body-small text-muted-foreground">{t.phoneHint}</p> : null}
    </>
  )
}

function ApplicationForm({ t, onSubmit }: { t: ShopMessages; onSubmit: (body: unknown) => Promise<ShopOutcome> }) {
  const [values, setValues] = useState<ShopFormValues>(emptyShopForm)
  const [errors, setErrors] = useState<ShopFieldErrors>({})
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setNotice(null)
    const result = buildShopCreate(values)
    if (!result.ok) return setErrors(result.errors)
    setErrors({})
    setPending(true)
    try {
      setNotice(outcomeNotice(await onSubmit(result.body), t))
    } finally {
      setPending(false)
    }
  }

  return (
    <SectionCard title={t.applyTitle} description={t.applySubtitle}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate aria-label={t.applyTitle}>
        <ShopFields
          t={t}
          fields={["shopName", "description", "contactPhone", "whatsappPhone", "city", "address"]}
          values={values}
          errors={errors}
          onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        />
        {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
        <Button type="submit" disabled={pending}>
          {pending ? t.submitting : t.submitApplication}
        </Button>
      </form>
    </SectionCard>
  )
}

function StatusCard({ t, shop, onResubmit }: { t: ShopMessages; shop: OwnerShopResponse; onResubmit: () => Promise<ShopOutcome> }) {
  const locale = useLocale()
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState(false)

  async function resubmit() {
    if (pending) return
    setPending(true)
    try {
      const outcome = await onResubmit()
      setNotice(outcome.state === "ok" ? { tone: "info", text: t.resubmitted } : outcomeNotice(outcome, t))
    } finally {
      setPending(false)
    }
  }

  return (
    <SectionCard title={t.title}>
      <div className="flex flex-wrap items-center gap-3">
        {shop.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- verified media URL, served as-is
          <img src={shop.logoUrl} alt="" className="size-14 rounded-2xl border border-border object-cover" />
        ) : null}
        <p className="type-title-medium">{shop.shopName}</p>
        <Badge variant={STATUS_VARIANT[shop.status]}>{t.status[shop.status]}</Badge>
      </div>
      <p className="type-body-medium text-muted-foreground">{t.statusHelp[shop.status]}</p>
      {shop.status === "APPROVED" ? <TextLink href="/seller/products">{t.myProducts}</TextLink> : null}
      {shop.latestDecision ? (
        <p className="type-body-small text-muted-foreground">
          {`${t.latestDecision} : ${t.decision[shop.latestDecision.type]} · ${formatDateTime(shop.latestDecision.decidedAt, locale)}`}
        </p>
      ) : null}
      {shop.status === "REJECTED" && shop.rejection ? (
        <section className="flex flex-col gap-2 rounded-2xl bg-destructive/10 p-4" aria-labelledby="rejection-title">
          <p id="rejection-title" className="type-title-small text-error-text">
            {t.rejectionTitle}
          </p>
          {/* Plain text, rendered escaped. */}
          <p className="type-body-medium whitespace-pre-line">{shop.rejection.applicantReason}</p>
          <p className="type-body-small text-muted-foreground">{`${t.rejectedOn} ${formatDateTime(shop.rejection.rejectedAt, locale)}`}</p>
        </section>
      ) : null}
      {shop.status === "SUSPENDED" ? <FormMessage tone="info">{t.suspendedNotice}</FormMessage> : null}
      {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
      {shop.status === "REJECTED" ? (
        <Button onClick={() => void resubmit()} disabled={pending}>
          {pending ? t.submitting : t.resubmit}
        </Button>
      ) : null}
    </SectionCard>
  )
}

function FieldsForm({
  t,
  shop,
  confirmed,
  onSubmit,
}: {
  t: ShopMessages
  shop: OwnerShopResponse
  confirmed: boolean
  onSubmit: (body: unknown) => Promise<ShopOutcome>
}) {
  const [values, setValues] = useState<ShopFormValues>(() => shopFormValues(shop))
  const [syncedShop, setSyncedShop] = useState(shop)
  const [errors, setErrors] = useState<ShopFieldErrors>({})
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState(false)
  const fields = directlyEditableFields(shop.status)

  // A refreshed shop updates untouched fields; unsaved edits stay.
  if (shop !== syncedShop) {
    setSyncedShop(shop)
    setValues((current) => mergeShopFormValues(current, shopFormValues(syncedShop), shopFormValues(shop)))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setNotice(null)
    const result = buildShopUpdate(values, shop)
    if (!result.ok) return setErrors(result.errors)
    setErrors({})
    if (isEmptyBody(result.body)) return setNotice({ tone: "info", text: t.noChanges })
    setPending(true)
    const sent = values
    try {
      const outcome = await onSubmit(result.body)
      // Saved fields show the server's normalized values.
      if (outcome.state === "ok") setValues((current) => mergeShopFormValues(current, sent, shopFormValues(outcome.shop)))
      else setNotice(outcomeNotice(outcome, t))
    } finally {
      setPending(false)
    }
  }

  return (
    <SectionCard title={t.editTitle} description={shop.status === "APPROVED" ? t.editApprovedHint : undefined}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate aria-label={t.editTitle}>
        <ShopFields t={t} fields={fields} values={values} errors={errors} onChange={(patch) => setValues((c) => ({ ...c, ...patch }))} />
        {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : confirmed ? <FormMessage tone="info">{t.saved}</FormMessage> : null}
        <Button type="submit" disabled={pending}>
          {pending ? t.saving : t.save}
        </Button>
      </form>
    </SectionCard>
  )
}

function ChangeRequestStatus({ t, shop }: { t: ShopMessages; shop: OwnerShopResponse }) {
  const locale = useLocale()
  const request = shop.changeRequest
  if (!request) return null
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-muted p-4">
      <p className="type-label-large">{t.changeRequest[request.status]}</p>
      {request.proposedShopName !== null ? (
        <p className="type-body-small">{`${t.fields.shopName} — ${t.proposed} : ${request.proposedShopName}`}</p>
      ) : null}
      {request.proposedCity !== null ? <p className="type-body-small">{`${t.fields.city} — ${t.proposed} : ${request.proposedCity}`}</p> : null}
      <p className="type-body-small text-muted-foreground">{formatDateTime(request.decidedAt ?? request.submittedAt, locale)}</p>
    </div>
  )
}

function ChangeRequestSection({
  t,
  shop,
  confirmed,
  onSubmit,
}: {
  t: ShopMessages
  shop: OwnerShopResponse
  confirmed: boolean
  onSubmit: (body: unknown) => Promise<ShopOutcome>
}) {
  const [values, setValues] = useState({ shopName: shop.shopName, city: shop.city })
  const [errors, setErrors] = useState<ShopFieldErrors>({})
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState(false)
  const open = shop.changeRequest?.status === "PENDING"

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setNotice(null)
    const result = buildChangeRequest(values, shop)
    if (!result.ok) return setErrors(result.errors)
    setErrors({})
    if (isEmptyBody(result.body)) return setNotice({ tone: "info", text: t.noChanges })
    setPending(true)
    try {
      const outcome = await onSubmit(result.body)
      if (outcome.state !== "ok") setNotice(outcomeNotice(outcome, t))
    } finally {
      setPending(false)
    }
  }

  return (
    <SectionCard title={t.changeRequestTitle} description={t.changeRequestHint}>
      <p className="type-body-small text-muted-foreground">{`${t.current} : ${shop.shopName} · ${shop.city}`}</p>
      <ChangeRequestStatus t={t} shop={shop} />
      {open ? null : (
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate aria-label={t.changeRequestTitle}>
          <ShopFields
            t={t}
            fields={["shopName", "city"]}
            values={{ ...emptyShopForm(), ...values }}
            errors={errors}
            onChange={(patch) => setValues((c) => ({ shopName: patch.shopName ?? c.shopName, city: patch.city ?? c.city }))}
          />
          {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? t.submitting : t.submitChangeRequest}
          </Button>
        </form>
      )}
      {open && notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
      {open && !notice && confirmed ? <FormMessage tone="info">{t.changeRequestSent}</FormMessage> : null}
    </SectionCard>
  )
}

function LogoSection({
  t,
  shop,
  getAccessToken,
  onUploaded,
  onRemove,
}: {
  t: ShopMessages
  shop: OwnerShopResponse
  getAccessToken: () => Promise<string | null>
  onUploaded: () => Promise<void>
  onRemove: () => Promise<ShopOutcome>
}) {
  const inputId = useId()
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState(false)

  async function onFile(file: File | undefined) {
    if (!file || pending) return
    setPending(true)
    setNotice({ tone: "info", text: t.uploadingLogo })
    try {
      const outcome = await uploadShopLogo(file, { getAccessToken })
      switch (outcome.state) {
        case "ok":
          await onUploaded()
          return setNotice({ tone: "info", text: t.logoSaved })
        case "rejected":
          return setNotice({ tone: "error", text: t.logoErrors[outcome.code] })
        case "unsupported-type":
        case "too-large":
        case "expired":
          return setNotice({ tone: "error", text: t.logoErrors[outcome.state] })
        case "forbidden":
          return setNotice({ tone: "error", text: t.forbidden })
        case "rate-limited":
          return setNotice({ tone: "error", text: t.rateLimited })
        case "unavailable":
          return setNotice({ tone: "error", text: t.unavailable })
        default:
          return setNotice({ tone: "error", text: t.generic })
      }
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    if (pending) return
    setPending(true)
    try {
      const outcome = await onRemove()
      setNotice(outcome.state === "ok" ? { tone: "info", text: t.logoRemoved } : outcomeNotice(outcome, t))
    } finally {
      setPending(false)
    }
  }

  return (
    <SectionCard title={t.logoTitle} description={t.logoHint}>
      <div className="flex flex-wrap items-center gap-4">
        {shop.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- verified media URL, served as-is
          <img src={shop.logoUrl} alt={t.logoTitle} className="size-24 rounded-2xl border border-border object-cover" />
        ) : null}
        <label
          htmlFor={inputId}
          className={cn(
            "inline-flex h-control cursor-pointer items-center rounded-full border border-border px-5 type-label-large hover:bg-muted",
            pending && "pointer-events-none opacity-50"
          )}
        >
          {t.chooseLogo}
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={pending}
          onChange={(e) => {
            void onFile(e.target.files?.[0])
            e.target.value = ""
          }}
        />
        {shop.logoUrl ? (
          <Button variant="ghost" onClick={() => void remove()} disabled={pending}>
            {t.removeLogo}
          </Button>
        ) : null}
      </div>
      {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
    </SectionCard>
  )
}
