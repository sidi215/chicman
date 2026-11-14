"use client"

import type { AdminShopDetailResponse, AdminShopListResponse } from "@chicman/shared"
import Link from "next/link"
import { useCallback, useEffect, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Chip } from "@/components/ui/chip"
import { Input } from "@/components/ui/input"
import { FormMessage } from "@/features/auth/components/form-field"
import { TextLink } from "@/features/auth/components/text-link"
import { formatDateTime } from "@/features/shop/messages"
import { useLocale } from "@/lib/locale-provider"

import { ADMIN_SHOP_FILTERS, adminShopHref, adminShopListPath, adminShopOrdersHref, pageCount, type AdminShopFilter } from "../admin-dashboard"
import { availableDecisions, buildDecision, reasonFieldFor, type AdminOutcome, type ShopDecisionAction } from "../admin-shops"
import { useAdminMessages } from "../messages"
import { AdminPage as Shell, errorText, Pagination, postJson, ReasonForm, useAdminApi } from "./admin-shared"

/** `/admin/shops`: the review queue (oldest change first), by status, searchable by name or city, paginated. */
export function AdminShopList() {
  const locale = useLocale()
  const t = useAdminMessages()
  const { status, call } = useAdminApi()
  const [filter, setFilter] = useState<AdminShopFilter>("PENDING")
  const [draft, setDraft] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [outcome, setOutcome] = useState<AdminOutcome<AdminShopListResponse> | null>(null)

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<AdminShopListResponse>(adminShopListPath(filter, search, page)).then((result) => {
      if (!cancelled && result.state !== "stale") setOutcome(result)
    })
    return () => {
      cancelled = true
      setOutcome(null)
    }
  }, [status, filter, search, page, call])

  const choose = (next: AdminShopFilter) => {
    setFilter(next)
    setPage(1)
  }
  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSearch(draft)
    setPage(1)
  }

  return (
    <Shell>
      <Card className="w-full max-w-3xl rounded-3xl p-6">
        <CardHeader>
          <CardTitle className="type-headline-small">{t.listTitle}</CardTitle>
          <CardDescription>{t.listSubtitle}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form role="search" className="flex flex-wrap gap-2" onSubmit={onSearch}>
            <Input
              type="search"
              aria-label={t.searchShops}
              placeholder={t.searchShops}
              value={draft}
              maxLength={100}
              onChange={(event) => setDraft(event.target.value)}
              className="min-w-0 flex-1 basis-48"
            />
            <Button type="submit" variant="outline">
              {t.search}
            </Button>
          </form>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t.listTitle}>
            {ADMIN_SHOP_FILTERS.map((candidate) => (
              <Chip key={candidate} pressed={candidate === filter} onPressedChange={() => candidate !== filter && choose(candidate)}>
                {t.filters[candidate]}
              </Chip>
            ))}
          </div>
          {outcome === null ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
          {outcome !== null && outcome.state !== "ok" ? <FormMessage tone="error">{errorText(outcome.state, t)}</FormMessage> : null}
          {outcome?.state === "ok" && outcome.data.shops.length === 0 ? <FormMessage tone="info">{t.empty}</FormMessage> : null}
          {outcome?.state === "ok" && outcome.data.total > 0 ? (
            <p className="type-body-small text-muted-foreground">{t.resultCount.replace("{count}", String(outcome.data.total))}</p>
          ) : null}
          {outcome?.state === "ok" ? (
            <ul className="flex flex-col divide-y divide-border">
              {outcome.data.shops.map((shop) => (
                <li key={shop.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p dir="auto" className="type-title-small break-words">
                      {shop.shopName}
                    </p>
                    <p className="type-body-small text-muted-foreground">
                      <span dir="auto">{shop.city}</span>
                      {` · ${formatDateTime(shop.updatedAt, locale)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{t.status[shop.status]}</Badge>
                    {shop.hasOpenChangeRequest ? <Badge variant="warning">{t.openChangeRequest}</Badge> : null}
                    <Link className="type-label-large underline-offset-4 hover:underline" href={adminShopHref(shop.id)}>
                      {t.open}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {outcome?.state === "ok" ? <Pagination page={page} pages={pageCount(outcome.data.total, outcome.data.pageSize)} onPage={setPage} t={t} /> : null}
        </CardContent>
      </Card>
    </Shell>
  )
}

/** `/admin/shops/[shopId]`: details, decisions, change-request review, and full history. */
export function AdminShopDetail({ shopId }: { shopId: string }) {
  const locale = useLocale()
  const t = useAdminMessages()
  const { status, call } = useAdminApi()
  const [outcome, setOutcome] = useState<AdminOutcome<AdminShopDetailResponse> | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await call<AdminShopDetailResponse>(`/admin/shops/${encodeURIComponent(shopId)}`)
    if (result.state !== "stale") setOutcome(result)
  }, [call, shopId])

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<AdminShopDetailResponse>(`/admin/shops/${encodeURIComponent(shopId)}`).then((result) => {
      if (!cancelled && result.state !== "stale") setOutcome(result)
    })
    return () => {
      cancelled = true
    }
  }, [status, call, shopId])

  const post = useCallback(
    async (path: string, body: unknown) => {
      const result = await call<unknown>(path, postJson(body))
      if (result.state === "ok") setNotice(t.decided)
      if (result.state === "ok" || result.state === "conflict") await load()
      return result
    },
    [call, load, t.decided]
  )

  if (outcome === null) {
    return (
      <Shell>
        <FormMessage tone="info">{t.loading}</FormMessage>
      </Shell>
    )
  }
  if (outcome.state !== "ok") {
    return (
      <Shell>
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
    <Shell>
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
          <TextLink href={adminShopOrdersHref(shop.id)}>{t.shopOrdersLink}</TextLink>
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
            <ReasonForm
              key={`${action}-${shop.status}`}
              t={t}
              label={t.actions[action]}
              reasonLabel={reasonFieldFor(action) === "applicantReason" ? t.applicantReason : t.internalReason}
              reasonHint={reasonFieldFor(action) === "applicantReason" ? t.applicantReasonHint : t.internalReasonHint}
              destructive={action === "reject"}
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
            <CardDescription>{formatDateTime(openRequest.submittedAt, locale)}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {openRequest.proposedShopName !== null ? (
              <p className="type-body-medium">{`${t.fields.shopName} : ${shop.shopName} → ${openRequest.proposedShopName}`}</p>
            ) : null}
            {openRequest.proposedCity !== null ? (
              <p className="type-body-medium">{`${t.fields.city} : ${shop.city} → ${openRequest.proposedCity}`}</p>
            ) : null}
            {(["approve", "reject"] as const).map((action) => (
              <ReasonForm
                key={`${openRequest.id}-${action}`}
                t={t}
                label={action === "approve" ? t.approveChange : t.rejectChange}
                reasonLabel={t.internalReason}
                reasonHint={t.internalReasonHint}
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
                  <p className="text-muted-foreground">{`${formatDateTime(event.createdAt, locale)} · ${t.by} ${event.actorUserId}`}</p>
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
                    <p className="text-muted-foreground">{`${formatDateTime(change.createdAt, locale)} · ${t.by} ${change.actorUserId}`}</p>
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
                    <p className="type-label-large">{`${t.changeStatus[request.status]} · ${formatDateTime(request.submittedAt, locale)}`}</p>
                    {request.proposedShopName !== null ? <p>{`${t.fields.shopName} : ${request.proposedShopName}`}</p> : null}
                    {request.proposedCity !== null ? <p>{`${t.fields.city} : ${request.proposedCity}`}</p> : null}
                    {request.decidedAt ? (
                      <p className="text-muted-foreground">{`${formatDateTime(request.decidedAt, locale)} · ${t.by} ${request.decidedByUserId ?? ""}`}</p>
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
