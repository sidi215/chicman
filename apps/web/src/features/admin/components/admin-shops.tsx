"use client"

import type { AdminShopDetailResponse, AdminShopListResponse, ShopStatus } from "@chicman/shared"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useId, useState, type FormEvent } from "react"

import { BrandLogo } from "@/components/brand/brand-logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Chip } from "@/components/ui/chip"
import { useAuth } from "@/features/auth/auth-provider"
import { FormMessage } from "@/features/auth/components/form-field"
import { TextLink } from "@/features/auth/components/text-link"
import { formatDateTime } from "@/features/shop/messages"
import { apiRequest } from "@/lib/api-client"

import {
  availableDecisions,
  buildDecision,
  interpretAdminResult,
  reasonFieldFor,
  type AdminOutcome,
  type DecisionFormResult,
  type ShopDecisionAction,
} from "../admin-shops"
import { useAdminMessages, type AdminMessages } from "../messages"

type Filter = ShopStatus | "changes"
const FILTERS: Filter[] = ["PENDING", "changes", "APPROVED", "SUSPENDED", "REJECTED"]

function filterQuery(filter: Filter): string {
  return filter === "changes" ? "openChangeRequest=true" : `status=${filter}`
}

function errorText(state: AdminOutcome<unknown>["state"], t: AdminMessages): string {
  switch (state) {
    case "forbidden":
      return t.forbidden
    case "own-shop":
      return t.ownShop
    case "not-found":
      return t.notFound
    case "conflict":
      return t.conflict
    case "invalid":
      return t.invalid
    case "unavailable":
      return t.unavailable
    default:
      return t.generic
  }
}

/** Calls an admin endpoint with the session token. The API enforces the ADMIN role. */
function useAdminApi() {
  const router = useRouter()
  const { status, getAccessToken, signOut } = useAuth()
  useEffect(() => {
    if (status === "signed-out" || status === "not-configured") router.replace("/login")
  }, [status, router])
  const call = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<AdminOutcome<T>> => {
      const token = await getAccessToken()
      if (!token) return { state: "signed-out" }
      const outcome = interpretAdminResult(await apiRequest<T>(path, token, init))
      if (outcome.state === "signed-out") void signOut()
      return outcome
    },
    [getAccessToken, signOut]
  )
  return { status, call }
}

function Shell({ t, children }: { t: AdminMessages; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 bg-page px-4 py-10">
      <BrandLogo label={t.brand} />
      {children}
    </main>
  )
}

/** `/admin/shops`: the review list. */
export function AdminShopList() {
  const t = useAdminMessages()
  const { status, call } = useAdminApi()
  const [filter, setFilter] = useState<Filter>("PENDING")
  const [outcome, setOutcome] = useState<AdminOutcome<AdminShopListResponse> | null>(null)

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<AdminShopListResponse>(`/admin/shops?${filterQuery(filter)}`).then((result) => {
      if (!cancelled) setOutcome(result)
    })
    return () => {
      cancelled = true
    }
  }, [status, filter, call])

  return (
    <Shell t={t}>
      <Card className="w-full max-w-3xl rounded-3xl p-6">
        <CardHeader>
          <CardTitle className="type-headline-small">{t.listTitle}</CardTitle>
          <CardDescription>{t.listSubtitle}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t.listTitle}>
            {FILTERS.map((candidate) => (
              <Chip
                key={candidate}
                pressed={candidate === filter}
                onPressedChange={() => {
                  if (candidate === filter) return
                  setOutcome(null)
                  setFilter(candidate)
                }}
              >
                {t.filters[candidate]}
              </Chip>
            ))}
          </div>
          {outcome === null ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
          {outcome !== null && outcome.state !== "ok" ? <FormMessage tone="error">{errorText(outcome.state, t)}</FormMessage> : null}
          {outcome?.state === "ok" && outcome.data.shops.length === 0 ? <FormMessage tone="info">{t.empty}</FormMessage> : null}
          {outcome?.state === "ok" ? (
            <ul className="flex flex-col divide-y divide-border">
              {outcome.data.shops.map((shop) => (
                <li key={shop.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex flex-col gap-1">
                    <p className="type-title-small">{shop.shopName}</p>
                    <p className="type-body-small text-muted-foreground">{`${shop.city} · ${formatDateTime(shop.updatedAt)}`}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{t.status[shop.status]}</Badge>
                    {shop.hasOpenChangeRequest ? <Badge variant="warning">{t.openChangeRequest}</Badge> : null}
                    <Link className="type-label-large underline-offset-4 hover:underline" href={`/admin/shops/${shop.id}`}>
                      {t.open}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </Shell>
  )
}

function TextArea({ label, hint, error, value, onChange }: { label: string; hint?: string; error?: string | undefined; value: string; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="type-label-large">
        {label}
      </label>
      {hint ? <p className="type-body-small text-muted-foreground">{hint}</p> : null}
      <textarea
        id={id}
        rows={3}
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-input bg-surface px-4 py-3 type-body-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive"
      />
      {error ? <p className="type-body-small text-error-text">{error}</p> : null}
    </div>
  )
}

/** One decision form: exactly one reason of the right kind, plus an optional internal note. */
function DecisionForm({
  t,
  label,
  reasonKind,
  build,
  submit,
}: {
  t: AdminMessages
  label: string
  reasonKind: "applicantReason" | "internalReason"
  build: (reason: string, note: string) => DecisionFormResult
  submit: (body: unknown) => Promise<AdminOutcome<unknown>>
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [errors, setErrors] = useState<Partial<Record<"reason" | "internalNote", string>>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const result = build(reason, note)
    if (!result.ok) {
      return setErrors({
        reason: result.errors.reason && t.errors[result.errors.reason],
        internalNote: result.errors.internalNote && t.errors[result.errors.internalNote],
      })
    }
    setErrors({})
    setPending(true)
    try {
      const outcome = await submit(result.body)
      setNotice(outcome.state === "ok" ? null : errorText(outcome.state, t))
    } finally {
      setPending(false)
    }
  }

  if (!open) {
    return (
      <Button variant={reasonKind === "applicantReason" ? "destructive" : "outline"} onClick={() => setOpen(true)}>
        {label}
      </Button>
    )
  }
  return (
    <form className="flex flex-col gap-3 rounded-2xl border border-border p-4" onSubmit={onSubmit} noValidate aria-label={label}>
      <p className="type-title-small">{label}</p>
      <TextArea
        label={reasonKind === "applicantReason" ? t.applicantReason : t.internalReason}
        hint={reasonKind === "applicantReason" ? t.applicantReasonHint : t.internalReasonHint}
        value={reason}
        onChange={setReason}
        error={errors.reason}
      />
      <TextArea label={t.internalNote} hint={t.internalReasonHint} value={note} onChange={setNote} error={errors.internalNote} />
      {notice ? <FormMessage tone="error">{notice}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t.sending : t.confirm}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t.cancel}
        </Button>
      </div>
    </form>
  )
}

/** `/admin/shops/[shopId]`: details, decisions, change-request review, and full history. */
export function AdminShopDetail({ shopId }: { shopId: string }) {
  const t = useAdminMessages()
  const { status, call } = useAdminApi()
  const [outcome, setOutcome] = useState<AdminOutcome<AdminShopDetailResponse> | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setOutcome(await call<AdminShopDetailResponse>(`/admin/shops/${encodeURIComponent(shopId)}`))
  }, [call, shopId])

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<AdminShopDetailResponse>(`/admin/shops/${encodeURIComponent(shopId)}`).then((result) => {
      if (!cancelled) setOutcome(result)
    })
    return () => {
      cancelled = true
    }
  }, [status, call, shopId])

  const post = useCallback(
    async (path: string, body: unknown): Promise<AdminOutcome<unknown>> => {
      const result = await call<unknown>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      if (result.state === "ok") setNotice(t.decided)
      if (result.state === "ok" || result.state === "conflict") await load()
      return result
    },
    [call, load, t.decided]
  )

  if (outcome === null) {
    return (
      <Shell t={t}>
        <FormMessage tone="info">{t.loading}</FormMessage>
      </Shell>
    )
  }
  if (outcome.state !== "ok") {
    return (
      <Shell t={t}>
        <FormMessage tone="error">{errorText(outcome.state, t)}</FormMessage>
        <TextLink href="/admin/shops">{t.backToList}</TextLink>
      </Shell>
    )
  }

  const { shop, statusEvents, fieldChanges, changeRequests } = outcome.data
  const openRequest = changeRequests.find((request) => request.status === "PENDING")
  const decisions = availableDecisions(shop.status)
  const fieldRows: [string, string | null][] = [
    [t.fields.shopName, shop.shopName],
    [t.fields.description, shop.description],
    [t.fields.contactPhone, shop.contactPhone],
    [t.fields.whatsappPhone, shop.whatsappPhone],
    [t.fields.city, shop.city],
    [t.fields.address, shop.address],
  ]

  return (
    <Shell t={t}>
      <Card className="w-full max-w-3xl rounded-3xl p-6">
        <CardHeader>
          <CardTitle className="type-headline-small">{shop.shopName}</CardTitle>
          <CardDescription>{`${t.owner} : ${shop.ownerUserId}`}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {shop.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- verified media URL
              <img src={shop.logoUrl} alt={t.fields.logoUrl} className="size-16 rounded-2xl border border-border object-cover" />
            ) : null}
            <Badge variant="outline">{t.status[shop.status]}</Badge>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
            {fieldRows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="type-label-large text-muted-foreground">{label}</dt>
                <dd className="type-body-medium whitespace-pre-line">{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card className="w-full max-w-3xl rounded-3xl p-6">
        <CardHeader>
          <CardTitle className="type-title-large">{t.decisionsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
          {decisions.length === 0 ? <FormMessage tone="info">{t.noDecision}</FormMessage> : null}
          {decisions.map((action: ShopDecisionAction) => (
            <DecisionForm
              key={`${action}-${shop.status}`}
              t={t}
              label={t.actions[action]}
              reasonKind={reasonFieldFor(action)}
              build={(reason, note) => buildDecision(action, reason, note)}
              submit={(body) => post(`/admin/shops/${shop.id}/${action}`, body)}
            />
          ))}
        </CardContent>
      </Card>

      {openRequest ? (
        <Card className="w-full max-w-3xl rounded-3xl p-6">
          <CardHeader>
            <CardTitle className="type-title-large">{t.changeRequestTitle}</CardTitle>
            <CardDescription>{formatDateTime(openRequest.submittedAt)}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {openRequest.proposedShopName !== null ? (
              <p className="type-body-medium">{`${t.fields.shopName} : ${shop.shopName} → ${openRequest.proposedShopName}`}</p>
            ) : null}
            {openRequest.proposedCity !== null ? (
              <p className="type-body-medium">{`${t.fields.city} : ${shop.city} → ${openRequest.proposedCity}`}</p>
            ) : null}
            {(["approve", "reject"] as const).map((action) => (
              <DecisionForm
                key={`${openRequest.id}-${action}`}
                t={t}
                label={action === "approve" ? t.approveChange : t.rejectChange}
                reasonKind="internalReason"
                build={(reason, note) => buildDecision("change-request", reason, note)}
                submit={(body) => post(`/admin/shops/${shop.id}/change-requests/${openRequest.id}/${action}`, body)}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="w-full max-w-3xl rounded-3xl p-6">
        <CardHeader>
          <CardTitle className="type-title-large">{t.historyTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <p className="type-title-small">{t.statusEvents}</p>
            <ol className="flex flex-col gap-2">
              {statusEvents.map((event) => (
                <li key={event.id} className="rounded-2xl bg-muted p-3 type-body-small">
                  <p className="type-label-large">
                    {`${event.fromStatus ? t.status[event.fromStatus] : "—"} → ${t.status[event.toStatus]} · ${
                      event.decisionType ? t.decisionType[event.decisionType] : t.ownerAction
                    }`}
                  </p>
                  <p className="text-muted-foreground">{`${formatDateTime(event.createdAt)} · ${t.by} ${event.actorUserId}`}</p>
                  {event.applicantReason ? <p className="whitespace-pre-line">{`${t.applicantReason} : ${event.applicantReason}`}</p> : null}
                  {event.internalReason ? <p className="whitespace-pre-line">{`${t.internalReason} : ${event.internalReason}`}</p> : null}
                  {event.internalNote ? <p className="whitespace-pre-line">{`${t.internalNote} : ${event.internalNote}`}</p> : null}
                </li>
              ))}
            </ol>
          </section>
          {fieldChanges.length > 0 ? (
            <section className="flex flex-col gap-2">
              <p className="type-title-small">{t.fieldChanges}</p>
              <ol className="flex flex-col gap-2">
                {fieldChanges.map((change) => (
                  <li key={change.id} className="rounded-2xl bg-muted p-3 type-body-small">
                    <p className="type-label-large">{`${t.fields[change.field]} · ${t.source[change.source]}`}</p>
                    <p className="break-all">{`${change.oldValue ?? "—"} → ${change.newValue ?? "—"}`}</p>
                    <p className="text-muted-foreground">{`${formatDateTime(change.createdAt)} · ${t.by} ${change.actorUserId}`}</p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {changeRequests.length > 0 ? (
            <section className="flex flex-col gap-2">
              <p className="type-title-small">{t.changeRequests}</p>
              <ol className="flex flex-col gap-2">
                {changeRequests.map((request) => (
                  <li key={request.id} className="rounded-2xl bg-muted p-3 type-body-small">
                    <p className="type-label-large">{`${t.changeStatus[request.status]} · ${formatDateTime(request.submittedAt)}`}</p>
                    {request.proposedShopName !== null ? <p>{`${t.fields.shopName} : ${request.proposedShopName}`}</p> : null}
                    {request.proposedCity !== null ? <p>{`${t.fields.city} : ${request.proposedCity}`}</p> : null}
                    {request.decidedAt ? (
                      <p className="text-muted-foreground">{`${formatDateTime(request.decidedAt)} · ${t.by} ${request.decidedByUserId ?? ""}`}</p>
                    ) : null}
                    {request.internalReason ? <p className="whitespace-pre-line">{`${t.internalReason} : ${request.internalReason}`}</p> : null}
                    {request.internalNote ? <p className="whitespace-pre-line">{`${t.internalNote} : ${request.internalNote}`}</p> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </CardContent>
      </Card>
      <TextLink href="/admin/shops">{t.backToList}</TextLink>
    </Shell>
  )
}
