"use client"

import {
  PRODUCT_MODERATION_REASONS,
  PRODUCT_MODERATION_STATUSES,
  type AdminModerationCaseDetail,
  type AdminModerationCaseListResponse,
  type AdminModerationCaseSummary,
  type AdminModerationEvent,
  type AdminProductContent,
  type AdminProductDetail,
  type AdminProductListResponse,
  type AdminShopOrderListItem,
  type AdminShopOrderListResponse,
  type ModerationCaseCounts,
  type ModerationContentSnapshot,
  type ProductModerationReason,
  type ProductModerationStatus,
} from "@chicman/shared"
import { ImageIcon } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { Input } from "@/components/ui/input"
import { adminOrderHref, adminShopHref, pageCount } from "@/features/admin/admin-dashboard"
import type { AdminOutcome } from "@/features/admin/admin-shops"
import { AdminPage, Pagination, postJson, TextArea, useAdminApi } from "@/features/admin/components/admin-shared"
import { useAdminMessages } from "@/features/admin/messages"
import { FormMessage } from "@/features/auth/components/form-field"
import { TextLink } from "@/features/auth/components/text-link"
import { useProductMessages } from "@/features/products/messages"
import { formatDateTime } from "@/lib/date-time"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import { fillText, useModerationMessages, type ModerationMessages } from "../messages"
import {
  adminCaseHref,
  adminCaseListPath,
  adminCasePath,
  adminDismissPath,
  adminProductActionPath,
  adminProductHref,
  adminProductListPath,
  adminProductOrdersPath,
  adminProductPath,
  availableModerationActions,
  buildDismiss,
  buildRestore,
  buildSanction,
  CASE_QUEUE_FILTERS,
  OPEN_ORDER_STATUSES,
  type AdminProductAction,
  type CaseQueueFilter,
  type ModerationField,
  type ModerationFieldError,
} from "../moderation"
import { MODERATION_VARIANT } from "./seller-moderation"

type Outcome<T> = AdminOutcome<T>

function failureText(state: Outcome<unknown>["state"], t: ModerationMessages): string {
  switch (state) {
    case "forbidden":
    case "own-shop":
    case "not-found":
    case "conflict":
    case "invalid":
    case "unavailable":
    case "signed-out":
      return t.admin.failures[state]
    default:
      return t.admin.failures.error
  }
}

function ModerationStatusBadge({ status }: { status: ProductModerationStatus }) {
  const t = useModerationMessages()
  return <Badge variant={MODERATION_VARIANT[status]}>{t.status[status]}</Badge>
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex w-full max-w-3xl flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
      <h2 className="type-title-large">{title}</h2>
      {children}
    </section>
  )
}

/** An identifier (user, product): kept left-to-right in Arabic. */
const Id = ({ value }: { value: string }) => (
  <span dir="ltr" className="break-all">
    {value}
  </span>
)

function Thumb({ url }: { url: string | null }) {
  if (url === null) {
    return (
      <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <ImageIcon aria-hidden className="size-icon-action" />
      </span>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element -- verified media URL, served as-is
  return <img src={url} alt="" className="size-16 shrink-0 rounded-2xl object-cover" />
}

/** Loads one admin resource; `reload` reads it again after an action. */
function useAdminResource<T>(path: string | null) {
  const { status, call } = useAdminApi()
  const [outcome, setOutcome] = useState<Outcome<T> | null>(null)
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    if (status !== "signed-in" || path === null) return
    let cancelled = false
    void call<T>(path).then((result) => {
      if (!cancelled && result.state !== "stale") setOutcome(result)
    })
    return () => {
      cancelled = true
    }
  }, [status, call, path, reloads])
  const reload = useCallback(() => setReloads((count) => count + 1), [])
  return { outcome, setOutcome, reload, call }
}

// ---------------------------------------------------------------------------
// Product list (`/admin/products`)
// ---------------------------------------------------------------------------

/** Inspection: every product of every shop, in every seller status (section 5). */
export function AdminProductList({ initialShopId }: { initialShopId: string | null }) {
  const t = useModerationMessages()
  const productText = useProductMessages()
  const admin = useAdminMessages()
  const locale = useLocale()
  const [shopId, setShopId] = useState<string | null>(initialShopId)
  const [moderationStatus, setModerationStatus] = useState<ProductModerationStatus | null>(null)
  const [draft, setDraft] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const { outcome } = useAdminResource<AdminProductListResponse>(adminProductListPath({ search, shopId, moderationStatus }, page))

  const shopName = outcome?.state === "ok" ? outcome.data.products.find((row) => row.shop.id === shopId)?.shop.name : undefined
  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSearch(draft)
    setPage(1)
  }

  return (
    <AdminPage>
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="type-headline-small">{t.admin.productsTitle}</h1>
          <p className="type-body-medium text-muted-foreground">{t.admin.productsSubtitle}</p>
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={onSearch} role="search">
          <label className="flex min-w-48 flex-1 flex-col gap-1.5">
            <span className="type-label-large">{t.admin.search}</span>
            <Input type="search" dir="auto" maxLength={100} placeholder={t.admin.searchProducts} value={draft} onChange={(event) => setDraft(event.target.value)} />
          </label>
          <Button type="submit">{t.admin.apply}</Button>
        </form>
        <div role="group" aria-label={t.admin.filterLabel} className="flex flex-wrap gap-2">
          <Chip
            pressed={moderationStatus === null}
            onPressedChange={() => {
              setModerationStatus(null)
              setPage(1)
            }}
          >
            {t.admin.filterAll}
          </Chip>
          {PRODUCT_MODERATION_STATUSES.map((value) => (
            <Chip
              key={value}
              pressed={moderationStatus === value}
              onPressedChange={() => {
                setModerationStatus(value)
                setPage(1)
              }}
            >
              {t.status[value]}
            </Chip>
          ))}
        </div>
        {shopId !== null ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              <span dir="auto">{fillText(t.admin.shopFilter, { shop: shopName ?? admin.shopFilterUnknown })}</span>
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => setShopId(null)}>
              {t.admin.allShops}
            </Button>
          </div>
        ) : null}

        {outcome === null ? <FormMessage tone="info">{t.admin.loading}</FormMessage> : null}
        {outcome !== null && outcome.state !== "ok" ? <FormMessage tone="error">{failureText(outcome.state, t)}</FormMessage> : null}
        {outcome?.state === "ok" && outcome.data.products.length === 0 ? <FormMessage tone="info">{t.admin.empty}</FormMessage> : null}
        {outcome?.state === "ok" && outcome.data.total > 0 ? (
          <p className="type-body-small text-muted-foreground">{fillText(t.admin.resultCount, { count: String(outcome.data.total) })}</p>
        ) : null}
        {outcome?.state === "ok" ? (
          <ul className="flex flex-col gap-3">
            {outcome.data.products.map((row) => (
              <li key={row.id}>
                <Link
                  href={adminProductHref(row.id)}
                  aria-label={`${t.admin.openProduct} : ${row.name}`}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <Thumb url={row.mainImageUrl} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span dir="auto" className="truncate type-title-small">
                      {row.name}
                    </span>
                    <span dir="auto" className="truncate type-body-small text-muted-foreground">
                      {row.shop.name} · {formatMru(row.price, locale)}
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <Badge variant="outline">{productText.status[row.status]}</Badge>
                      <ModerationStatusBadge status={row.moderationStatus} />
                      {row.shop.status === "APPROVED" ? null : <Badge variant="secondary">{admin.status[row.shop.status]}</Badge>}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {outcome?.state === "ok" ? (
          <Pagination page={page} pages={pageCount(outcome.data.total, outcome.data.pageSize)} onPage={setPage} t={admin} />
        ) : null}
      </div>
    </AdminPage>
  )
}

// ---------------------------------------------------------------------------
// Shared pieces of the product and case pages
// ---------------------------------------------------------------------------

function ContentView({ content, stock }: { content: AdminProductContent; stock: number }) {
  const t = useModerationMessages()
  const productText = useProductMessages()
  const locale = useLocale()
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
        <Row label={t.admin.price} value={formatMru(content.price, locale)} />
        <Row label={t.admin.category} value={productText.categories[content.category]} />
        {content.brand === null ? null : <Row label={t.admin.brand} value={<span dir="auto">{content.brand}</span>} />}
        <Row label={t.admin.stock} value={String(stock)} />
        <Row label={t.admin.description} value={<span dir="auto" className="whitespace-pre-wrap">{content.description}</span>} />
      </dl>
      <h3 className="type-title-small">{t.admin.images}</h3>
      {content.images.length === 0 ? (
        <p className="type-body-small text-muted-foreground">{t.admin.noImages}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {content.images.map((image) => (
            <li key={image.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- verified media URL, served as-is */}
              <img src={image.url} alt="" className="aspect-3/4 w-full rounded-xl object-cover" />
            </li>
          ))}
        </ul>
      )}
      <h3 className="type-title-small">{t.admin.variants}</h3>
      {content.variants.length === 0 ? (
        <p className="type-body-small text-muted-foreground">{t.admin.noVariants}</p>
      ) : (
        <ul className="flex flex-col gap-1 type-body-small">
          {content.variants.map((variant) => (
            <li key={variant.id} className="flex flex-wrap justify-between gap-2">
              <span dir="auto">{[variant.size, variant.color].filter((value) => value !== null).join(" · ")}</span>
              <span className="text-muted-foreground">{`${t.admin.stock} : ${variant.stock}`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SnapshotView({ snapshot }: { snapshot: ModerationContentSnapshot }) {
  const t = useModerationMessages()
  const productText = useProductMessages()
  const locale = useLocale()
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
      <Row label={t.admin.productLink} value={<span dir="auto">{snapshot.name}</span>} />
      <Row label={t.admin.price} value={formatMru(snapshot.price, locale)} />
      <Row label={t.admin.category} value={productText.categories[snapshot.category]} />
      {snapshot.brand === null ? null : <Row label={t.admin.brand} value={<span dir="auto">{snapshot.brand}</span>} />}
      <Row label={t.admin.description} value={<span dir="auto" className="whitespace-pre-wrap">{snapshot.description}</span>} />
      <Row label={t.admin.images} value={String(snapshot.imageKeys.length)} />
      <Row
        label={t.admin.variants}
        value={snapshot.variants.length === 0 ? "—" : snapshot.variants.map((v) => [v.size, v.color].filter((x) => x !== null).join(" · ")).join(", ")}
      />
    </dl>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="contents">
      <dt className="type-label-large text-muted-foreground">{label}</dt>
      <dd className="type-body-medium break-words">{value}</dd>
    </div>
  )
}

function countsText(counts: ModerationCaseCounts, t: ModerationMessages): string {
  return fillText(t.admin.priorCounts, {
    total: String(counts.total),
    dismissed: String(counts.dismissed),
    restored: String(counts.restored),
    removed: String(counts.removed),
  })
}

/** Every event, oldest first, with every internal field (administrators only). */
function EventList({ events }: { events: readonly AdminModerationEvent[] }) {
  const t = useModerationMessages()
  const locale = useLocale()
  if (events.length === 0) return <p className="type-body-small text-muted-foreground">{t.admin.noHistory}</p>
  return (
    <ol className="flex flex-col gap-2">
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-0.5 rounded-2xl bg-muted p-3 type-body-small">
          <p className="type-label-large">
            {t.admin.eventActions[event.action]}
            {event.fromStatus !== null && event.toStatus !== null && event.fromStatus !== event.toStatus
              ? ` · ${t.status[event.fromStatus]} → ${t.status[event.toStatus]}`
              : null}
          </p>
          <p className="text-muted-foreground">
            {formatDateTime(event.createdAt, locale)} · {t.admin.actors[event.actorType]} {t.admin.by} <Id value={event.actorUserId} />
          </p>
          {event.sellerReasonCode === null ? null : <p>{`${t.admin.sellerReason} : ${t.sellerReasons[event.sellerReasonCode]}`}</p>}
          {event.sellerMessage === null ? null : (
            <p dir="auto" className="break-words whitespace-pre-wrap">{`${t.admin.sellerMessage} : ${event.sellerMessage}`}</p>
          )}
          {event.sellerNote === null ? null : (
            <p dir="auto" className="break-words whitespace-pre-wrap">
              {fillText(t.admin.sellerNote, { note: event.sellerNote })}
            </p>
          )}
          {event.internalReason === null ? null : (
            <p dir="auto" className="break-words whitespace-pre-wrap">{`${t.admin.internalReason} : ${event.internalReason}`}</p>
          )}
          {event.internalNote === null ? null : (
            <p dir="auto" className="break-words whitespace-pre-wrap">{`${t.admin.internalNote} : ${event.internalNote}`}</p>
          )}
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// Action forms (section 3.2)
// ---------------------------------------------------------------------------

function ReasonSelect({ value, onChange, error }: { value: ProductModerationReason | null; onChange: (value: ProductModerationReason) => void; error?: string | undefined }) {
  const t = useModerationMessages()
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="type-label-large">
        {t.admin.sellerReason}
      </label>
      <select
        id={id}
        value={value ?? ""}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value as ProductModerationReason)}
        className="h-control w-full min-w-0 rounded-full border border-input bg-surface px-4 type-body-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive"
      >
        <option value="" disabled>
          {t.admin.chooseReason}
        </option>
        {PRODUCT_MODERATION_REASONS.map((reason) => (
          <option key={reason} value={reason}>
            {t.sellerReasons[reason]}
          </option>
        ))}
      </select>
      {error ? <p className="type-body-small text-error-text">{error}</p> : null}
    </div>
  )
}

type Submit = (path: string, body: unknown) => Promise<Outcome<unknown>["state"] | "stale">

/**
 * One moderation action form. Restrict, request correction, and remove take a
 * seller reason, a seller message, and an internal reason; restore takes an
 * internal reason and an optional seller message; dismiss an internal reason.
 * Every form takes an optional internal note. Removal names the product and
 * needs an explicit confirmation (section 5).
 */
function ActionForm({
  kind,
  productName,
  expectedStatus,
  path,
  submit,
}: {
  kind: AdminProductAction | "dismiss"
  productName: string
  /** The state shown on the page: the API refuses the action if it changed meanwhile. */
  expectedStatus: ProductModerationStatus
  path: string
  submit: Submit
}) {
  const t = useModerationMessages()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ProductModerationReason | null>(null)
  const [message, setMessage] = useState("")
  const [internalReason, setInternalReason] = useState("")
  const [note, setNote] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<ModerationField, ModerationFieldError>>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const label = kind === "dismiss" ? t.admin.dismiss : t.admin.actions[kind]
  const sanction = kind === "restrict" || kind === "request-correction" || kind === "remove"
  const destructive = kind === "remove"

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || (destructive && !confirmed)) return
    const built = sanction
      ? buildSanction(expectedStatus, reason, message, internalReason, note)
      : kind === "restore"
        ? buildRestore(expectedStatus, internalReason, message, note)
        : buildDismiss(internalReason, note)
    if (!built.ok) return setErrors(built.errors)
    setErrors({})
    setPending(true)
    const state = await submit(path, built.body)
    setPending(false)
    if (state === "stale") return
    if (state === "ok") {
      setOpen(false)
      setReason(null)
      setMessage("")
      setInternalReason("")
      setNote("")
      setConfirmed(false)
      setNotice(null)
    } else {
      setNotice(failureText(state, t))
    }
  }

  const fieldError = (field: ModerationField) => (errors[field] === undefined ? undefined : t.admin.fieldErrors[errors[field]])

  if (!open) {
    return (
      <Button variant={destructive ? "destructive" : kind === "restore" ? "default" : "outline"} onClick={() => setOpen(true)}>
        {label}
      </Button>
    )
  }
  return (
    <form className="flex w-full flex-col gap-3 rounded-2xl border border-border p-4" onSubmit={(event) => void onSubmit(event)} noValidate aria-label={label}>
      <p className="type-title-small">{label}</p>
      {destructive ? (
        <p role="alert" dir="auto" className="type-body-medium text-error-text">
          {fillText(t.admin.removeConfirm, { name: productName })}
        </p>
      ) : null}
      {sanction ? <ReasonSelect value={reason} onChange={setReason} error={fieldError("sellerReasonCode")} /> : null}
      {kind === "dismiss" ? null : (
        <TextArea
          label={sanction ? t.admin.sellerMessage : t.admin.sellerMessageOptional}
          hint={t.admin.sellerMessageHint}
          value={message}
          onChange={setMessage}
          error={fieldError("sellerMessage")}
        />
      )}
      <TextArea label={t.admin.internalReason} hint={t.admin.internalReasonHint} value={internalReason} onChange={setInternalReason} error={fieldError("internalReason")} />
      <TextArea label={t.admin.internalNote} hint={t.admin.internalNoteHint} value={note} onChange={setNote} error={fieldError("internalNote")} />
      {destructive ? (
        <label className="flex items-start gap-2 type-body-medium">
          <input type="checkbox" className="mt-1 size-4 shrink-0" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span dir="auto">{fillText(t.admin.removeConfirmLabel, { name: productName })}</span>
        </label>
      ) : null}
      {notice ? <FormMessage tone="error">{notice}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending || (destructive && !confirmed)}>
          {pending ? t.admin.sending : t.admin.confirm}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t.admin.cancel}
        </Button>
      </div>
    </form>
  )
}

/** The actions the state allows; none on the administrator's own shop or once removed. */
function ProductActions({ product, submit, extra }: { product: AdminProductDetail; submit: Submit; extra?: ReactNode }) {
  const t = useModerationMessages()
  const actions = availableModerationActions(product.moderationStatus)
  return (
    <Section title={t.admin.actionsTitle}>
      {product.selfAdministered ? (
        <FormMessage tone="info">{t.admin.ownShop}</FormMessage>
      ) : actions.length === 0 && extra === undefined ? (
        <p className="type-body-medium text-muted-foreground">{t.admin.noActions}</p>
      ) : (
        <div className="flex flex-col items-start gap-2">
          {extra}
          {actions.map((action) => (
            <ActionForm key={action} kind={action} productName={product.content.name} expectedStatus={product.moderationStatus} path={adminProductActionPath(product.id, action)} submit={submit} />
          ))}
        </div>
      )}
    </Section>
  )
}

function ProductHeader({ product }: { product: AdminProductDetail }) {
  const t = useModerationMessages()
  const admin = useAdminMessages()
  const productText = useProductMessages()
  const locale = useLocale()
  return (
    <div className="flex w-full max-w-3xl flex-col gap-2">
      <h1 dir="auto" className="type-headline-small break-words">
        {product.content.name}
      </h1>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{`${t.admin.productStatus} : ${productText.status[product.status]}`}</Badge>
        <ModerationStatusBadge status={product.moderationStatus} />
        {product.moderationUpdatedAt === null ? null : <span className="type-body-small text-muted-foreground">{formatDateTime(product.moderationUpdatedAt, locale)}</span>}
      </div>
      <p className="type-body-medium">
        {`${t.admin.shop} : `}
        <Link href={adminShopHref(product.shop.id)} className="underline" dir="auto">
          {product.shop.name}
        </Link>
        {` · ${t.admin.shopStatus} : ${admin.status[product.shop.status]}`}
      </p>
    </div>
  )
}

/** A submit that reloads the page's resource after an answer (also after a conflict: the state changed). */
function useSubmit(call: ReturnType<typeof useAdminApi>["call"], reload: () => void): Submit {
  return useCallback(
    async (path, body) => {
      const result = await call<unknown>(path, postJson(body))
      if (result.state === "stale") return "stale"
      if (result.state === "ok" || result.state === "conflict") reload()
      return result.state
    },
    [call, reload]
  )
}

// ---------------------------------------------------------------------------
// Product page (`/admin/products/[productId]`)
// ---------------------------------------------------------------------------

export function AdminProductScreen({ productId }: { productId: string }) {
  const t = useModerationMessages()
  const { outcome, reload, call } = useAdminResource<AdminProductDetail>(adminProductPath(productId))
  const submit = useSubmit(call, reload)

  return (
    <AdminPage>
      {outcome === null ? <FormMessage tone="info">{t.admin.loading}</FormMessage> : null}
      {outcome !== null && outcome.state !== "ok" ? (
        <div className="flex w-full max-w-3xl flex-col gap-3">
          <FormMessage tone="error">{failureText(outcome.state, t)}</FormMessage>
          <Button variant="outline" className="self-start" onClick={reload}>
            {t.admin.retry}
          </Button>
        </div>
      ) : null}
      {outcome?.state === "ok" ? (
        <>
          <ProductHeader product={outcome.data} />
          {outcome.data.openCase === null ? null : (
            <div className="flex w-full max-w-3xl flex-wrap items-center gap-2">
              <Badge variant="warning">{`${t.admin.openCaseLink} · ${t.admin.caseStatus[outcome.data.openCase.status]}`}</Badge>
              <TextLink href={adminCaseHref(outcome.data.openCase.id)}>{t.admin.openCase}</TextLink>
            </div>
          )}
          <ProductActions product={outcome.data} submit={submit} />
          <Section title={t.admin.contentTitle}>
            <ContentView content={outcome.data.content} stock={outcome.data.stock} />
          </Section>
          <Section title={t.admin.priorTitle}>
            <p className="type-body-medium">{`${t.admin.priorProduct} : ${countsText(outcome.data.priorCases.product, t)}`}</p>
            <p className="type-body-medium">{`${t.admin.priorShop} : ${countsText(outcome.data.priorCases.shop, t)}`}</p>
          </Section>
          <Section title={t.admin.historyTitle}>
            <EventList events={outcome.data.history} />
          </Section>
        </>
      ) : null}
      <TextLink href="/admin/products">{t.admin.backToProducts}</TextLink>
    </AdminPage>
  )
}

// ---------------------------------------------------------------------------
// Queue (`/admin/moderation`)
// ---------------------------------------------------------------------------

function CaseRow({ row }: { row: AdminModerationCaseSummary }) {
  const t = useModerationMessages()
  const locale = useLocale()
  return (
    <Link
      href={adminCaseHref(row.id)}
      aria-label={`${t.admin.openCase} : ${row.productName}`}
      className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span dir="auto" className="type-title-small break-words">
          {row.productName}
        </span>
        <ModerationStatusBadge status={row.productModerationStatus} />
      </span>
      <span dir="auto" className="type-body-medium break-words">
        {row.shopName}
      </span>
      <span className="flex flex-wrap gap-2">
        <Badge variant="outline">{t.admin.caseStatus[row.status]}</Badge>
        {row.outcome === null ? null : <Badge variant="secondary">{t.admin.caseOutcome[row.outcome]}</Badge>}
        <Badge variant="outline">{t.admin.caseSource[row.source]}</Badge>
        {row.reportCount > 0 ? <Badge variant="outline">{fillText(t.admin.reportCount, { count: String(row.reportCount) })}</Badge> : null}
      </span>
      <span className="type-body-small text-muted-foreground">
        {row.closedAt === null ? fillText(t.admin.openedAt, { date: formatDateTime(row.openedAt, locale) }) : fillText(t.admin.closedAt, { date: formatDateTime(row.closedAt, locale) })}
      </span>
    </Link>
  )
}

/** The queue (section 5): non-closed cases, `IN_REVIEW` first, then oldest first; closed cases can be searched. */
export function AdminModerationQueue() {
  const t = useModerationMessages()
  const admin = useAdminMessages()
  const [filter, setFilter] = useState<CaseQueueFilter>("queue")
  const [draft, setDraft] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const { outcome } = useAdminResource<AdminModerationCaseListResponse>(adminCaseListPath(filter, search, page))

  return (
    <AdminPage>
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="type-headline-small">{t.admin.queueTitle}</h1>
          <p className="type-body-medium text-muted-foreground">{t.admin.queueSubtitle}</p>
        </div>
        <div role="group" aria-label={t.admin.filterLabel} className="flex flex-wrap gap-2">
          {CASE_QUEUE_FILTERS.map((value) => (
            <Chip
              key={value}
              pressed={filter === value}
              onPressedChange={() => {
                setFilter(value)
                setPage(1)
              }}
            >
              {t.admin.queueFilters[value]}
            </Chip>
          ))}
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            setSearch(draft)
            setPage(1)
          }}
        >
          <label className="flex min-w-48 flex-1 flex-col gap-1.5">
            <span className="type-label-large">{t.admin.search}</span>
            <Input type="search" dir="auto" maxLength={100} placeholder={t.admin.searchCases} value={draft} onChange={(event) => setDraft(event.target.value)} />
          </label>
          <Button type="submit">{t.admin.apply}</Button>
        </form>
        {outcome === null ? <FormMessage tone="info">{t.admin.loading}</FormMessage> : null}
        {outcome !== null && outcome.state !== "ok" ? <FormMessage tone="error">{failureText(outcome.state, t)}</FormMessage> : null}
        {outcome?.state === "ok" && outcome.data.cases.length === 0 ? <FormMessage tone="info">{t.admin.emptyQueue}</FormMessage> : null}
        {outcome?.state === "ok" && outcome.data.total > 0 ? (
          <p className="type-body-small text-muted-foreground">{fillText(t.admin.resultCount, { count: String(outcome.data.total) })}</p>
        ) : null}
        {outcome?.state === "ok" ? (
          <ul className="flex flex-col gap-3">
            {outcome.data.cases.map((row) => (
              <li key={row.id}>
                <CaseRow row={row} />
              </li>
            ))}
          </ul>
        ) : null}
        {outcome?.state === "ok" ? <Pagination page={page} pages={pageCount(outcome.data.total, outcome.data.pageSize)} onPage={setPage} t={admin} /> : null}
      </div>
    </AdminPage>
  )
}

// ---------------------------------------------------------------------------
// Case page (`/admin/moderation/[caseId]`)
// ---------------------------------------------------------------------------

/** Open shop orders containing the product, through the existing order list (PD-11: nothing changes them). */
function OpenOrders({ productId }: { productId: string }) {
  const t = useModerationMessages()
  const locale = useLocale()
  const { status, call } = useAdminApi()
  const [rows, setRows] = useState<AdminShopOrderListItem[] | null | "failed">(null)
  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void Promise.all(OPEN_ORDER_STATUSES.map((value) => call<AdminShopOrderListResponse>(adminProductOrdersPath(productId, value)))).then((results) => {
      if (cancelled || results.some((result) => result.state === "stale")) return
      const lists = results.flatMap((result) => (result.state === "ok" ? [result.data.shopOrders] : []))
      setRows(lists.length === results.length ? lists.flat() : "failed")
    })
    return () => {
      cancelled = true
    }
  }, [status, call, productId])
  return (
    <Section title={t.admin.ordersTitle}>
      <p className="type-body-small text-muted-foreground">{t.admin.ordersHint}</p>
      {rows === null ? <FormMessage tone="info">{t.admin.loading}</FormMessage> : null}
      {rows === "failed" ? <FormMessage tone="error">{t.admin.failures.error}</FormMessage> : null}
      {Array.isArray(rows) && rows.length === 0 ? <p className="type-body-medium text-muted-foreground">{t.admin.noOrders}</p> : null}
      {Array.isArray(rows) && rows.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-muted p-3">
              <span className="type-body-medium" dir="ltr">
                {row.orderReference}
              </span>
              <span className="type-body-small text-muted-foreground">{`${formatDateTime(row.createdAt, locale)} · ${formatMru(row.total, locale)}`}</span>
              <TextLink href={adminOrderHref(row.id)}>{t.admin.orderLink}</TextLink>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  )
}

export function AdminCaseScreen({ caseId }: { caseId: string }) {
  const t = useModerationMessages()
  const locale = useLocale()
  const { outcome, reload, call } = useAdminResource<AdminModerationCaseDetail>(adminCasePath(caseId))
  const submit = useSubmit(call, reload)

  const detail = outcome?.state === "ok" ? outcome.data : null
  const snapshot = detail?.snapshot ?? null
  const changed =
    detail !== null &&
    snapshot !== null &&
    (snapshot.name !== detail.product.content.name ||
      snapshot.description !== detail.product.content.description ||
      snapshot.price !== detail.product.content.price ||
      snapshot.category !== detail.product.content.category ||
      snapshot.brand !== detail.product.content.brand)

  return (
    <AdminPage>
      {outcome === null ? <FormMessage tone="info">{t.admin.loading}</FormMessage> : null}
      {outcome !== null && outcome.state !== "ok" ? (
        <div className="flex w-full max-w-3xl flex-col gap-3">
          <FormMessage tone="error">{failureText(outcome.state, t)}</FormMessage>
          <Button variant="outline" className="self-start" onClick={reload}>
            {t.admin.retry}
          </Button>
        </div>
      ) : null}
      {detail !== null ? (
        <>
          <div className="flex w-full max-w-3xl flex-col gap-2">
            <p className="type-label-large text-muted-foreground">{t.admin.caseTitle}</p>
            <ProductHeader product={detail.product} />
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{t.admin.caseStatus[detail.case.status]}</Badge>
              {detail.case.outcome === null ? null : <Badge variant="secondary">{t.admin.caseOutcome[detail.case.outcome]}</Badge>}
              <Badge variant="outline">{t.admin.caseSource[detail.case.source]}</Badge>
              <Badge variant="outline">{fillText(t.admin.reportCount, { count: String(detail.case.reportCount) })}</Badge>
            </div>
            <p className="type-body-small text-muted-foreground">
              {fillText(t.admin.openedAt, { date: formatDateTime(detail.case.openedAt, locale) })}
              {detail.case.closedAt === null ? null : ` · ${fillText(t.admin.closedAt, { date: formatDateTime(detail.case.closedAt, locale) })}`}
            </p>
            <TextLink href={adminProductHref(detail.product.id)}>{t.admin.productLink}</TextLink>
          </div>

          {detail.case.status === "CLOSED" ? null : (
            <ProductActions
              product={detail.product}
              submit={submit}
              extra={detail.case.status === "OPEN" && !detail.product.selfAdministered ? <ActionForm kind="dismiss" productName={detail.product.content.name} expectedStatus={detail.product.moderationStatus} path={adminDismissPath(detail.case.id)} submit={submit} /> : undefined}
            />
          )}

          <div className="grid w-full max-w-3xl grid-cols-1 gap-4 lg:grid-cols-2">
            {snapshot === null ? null : (
              <section className="flex min-w-0 flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
                <h2 className="type-title-large">{t.admin.snapshotTitle}</h2>
                {changed ? <Badge variant="warning">{t.admin.changed}</Badge> : null}
                <SnapshotView snapshot={snapshot} />
              </section>
            )}
            <section className="flex min-w-0 flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
              <h2 className="type-title-large">{t.admin.contentTitle}</h2>
              <ContentView content={detail.product.content} stock={detail.product.stock} />
            </section>
          </div>

          <Section title={t.admin.reportsTitle}>
            {detail.reports.length === 0 ? <p className="type-body-medium text-muted-foreground">{t.admin.noReports}</p> : null}
            <ul className="flex flex-col gap-2">
              {detail.reports.map((report) => (
                <li key={report.id} className="flex flex-col gap-0.5 rounded-2xl bg-muted p-3 type-body-small">
                  <p className="type-label-large">{t.reportReasons[report.reasonCode]}</p>
                  <p className="text-muted-foreground">
                    {formatDateTime(report.createdAt, locale)} · {t.admin.reporter} <Id value={report.reporterUserId} />
                  </p>
                  {report.details === null ? null : (
                    <p dir="auto" className="break-words whitespace-pre-wrap">
                      {report.details}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Section>

          <Section title={t.admin.priorTitle}>
            <p className="type-body-medium">{`${t.admin.priorProduct} : ${countsText(detail.product.priorCases.product, t)}`}</p>
            <p className="type-body-medium">{`${t.admin.priorShop} : ${countsText(detail.product.priorCases.shop, t)}`}</p>
          </Section>

          <OpenOrders productId={detail.product.id} />

          <Section title={t.admin.historyTitle}>
            <EventList events={detail.events} />
          </Section>
        </>
      ) : null}
      <TextLink href="/admin/moderation">{t.admin.backToQueue}</TextLink>
    </AdminPage>
  )
}
