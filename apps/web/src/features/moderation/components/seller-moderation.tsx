"use client"

import type { ProductModerationStatus, SellerProductDetail, SellerProductModerationResponse } from "@chicman/shared"
import { ShieldAlert } from "lucide-react"
import { useEffect, useState, type ComponentProps, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FormMessage } from "@/features/auth/components/form-field"
import { useProductApi } from "@/features/products/components/product-shared"
import type { ProductFailure, ProductOutcome } from "@/features/products/product-form"
import { SectionCard, TextAreaField } from "@/features/shop/components/shop-dashboard"
import { formatDateTime } from "@/lib/date-time"
import { useLocale } from "@/lib/locale-provider"

import { fillText, useModerationMessages, type ModerationMessages } from "../messages"
import { buildResubmit, sellerModerationPath, sellerModerationRules, sellerResubmitPath } from "../moderation"

export const MODERATION_VARIANT: Record<ProductModerationStatus, ComponentProps<typeof Badge>["variant"]> = {
  CLEAR: "outline",
  RESTRICTED: "destructive",
  IN_REVIEW: "warning",
  REMOVED: "secondary",
}

/** The moderation badge of a seller product (nothing while `CLEAR`). */
export function ModerationBadge({ status }: { status: ProductModerationStatus }) {
  const t = useModerationMessages()
  if (status === "CLEAR") return null
  return <Badge variant={MODERATION_VARIANT[status]}>{t.status[status]}</Badge>
}

function resubmitFailure(state: ProductFailure, t: ModerationMessages): string {
  switch (state) {
    case "moderation-conflict":
    case "status-conflict":
    case "archived":
    case "under-review":
    case "removed":
      return t.seller.failures.conflict
    case "invalid":
      return t.seller.failures.invalid
    case "forbidden":
      return t.seller.failures.forbidden
    case "not-found":
      return t.seller.failures["not-found"]
    case "rate-limited":
      return t.seller.failures["rate-limited"]
    case "unavailable":
      return t.seller.failures.unavailable
    default:
      return t.seller.failures.error
  }
}

/**
 * The seller's moderation panel on a product (spec 19, section 6): the state,
 * the reason and Chicman's message, "Soumettre pour révision" while
 * restricted, and the history of every round. Never a report, a reporter, an
 * internal reason, or an administrator (the API never sends them).
 */
export function SellerModerationPanel({ product, onChanged }: { product: SellerProductDetail; onChanged: () => Promise<void> }) {
  const t = useModerationMessages()
  const locale = useLocale()
  const { status, call } = useProductApi()
  const [history, setHistory] = useState<SellerProductModerationResponse | null>(null)
  const [note, setNote] = useState("")
  const [noteError, setNoteError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null)
  const [pending, setPending] = useState(false)
  const rules = sellerModerationRules(product)
  const moderation = product.moderation

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<SellerProductModerationResponse>(sellerModerationPath(product.id)).then((outcome) => {
      if (!cancelled && outcome.state === "ok") setHistory(outcome.data)
    })
    return () => {
      cancelled = true
    }
    // Reload the history whenever the moderation state changes.
  }, [status, call, product.id, moderation.status, moderation.updatedAt])

  async function resubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const built = buildResubmit(note)
    if (!built.ok) return setNoteError(t.seller.failures.invalid)
    setNoteError(undefined)
    setPending(true)
    setNotice(null)
    const outcome: ProductOutcome<SellerProductModerationResponse> = await call(sellerResubmitPath(product.id), "POST", built.body)
    setPending(false)
    if (outcome.state === "ok") {
      setNote("")
      setHistory(outcome.data)
      setNotice({ tone: "info", text: t.seller.resubmitted })
      await onChanged()
    } else {
      setNotice({ tone: "error", text: resubmitFailure(outcome.state, t) })
      if (outcome.state === "moderation-conflict" || outcome.state === "removed" || outcome.state === "under-review") await onChanged()
    }
  }

  const entries = history?.history ?? []
  if (!rules.moderated && entries.length === 0) return null

  return (
    <SectionCard title={rules.moderated && moderation.status !== "CLEAR" ? t.seller.bannerTitle[moderation.status] : t.seller.historyTitle}>
      {rules.moderated && moderation.status !== "CLEAR" ? (
        <div role="status" className="flex flex-col gap-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="flex items-center gap-2 type-title-small">
            <ShieldAlert aria-hidden className="size-icon-action shrink-0" />
            <ModerationBadge status={moderation.status} />
          </p>
          <p className="type-body-medium">{t.seller.bannerBody[moderation.status]}</p>
          {moderation.reasonCode === null ? null : (
            <p className="type-label-large">{fillText(t.seller.reason, { reason: t.sellerReasons[moderation.reasonCode] })}</p>
          )}
          {moderation.message === null ? null : (
            <div className="flex flex-col gap-1">
              <p className="type-label-large text-muted-foreground">{t.seller.message}</p>
              <p dir="auto" className="type-body-medium break-words whitespace-pre-wrap">
                {moderation.message}
              </p>
            </div>
          )}
        </div>
      ) : null}

      {moderation.status === "RESTRICTED" ? (
        <form className="flex flex-col gap-3" onSubmit={(event) => void resubmit(event)} noValidate aria-label={t.seller.resubmitTitle}>
          <TextAreaField
            label={t.seller.resubmitNote}
            rows={3}
            dir="auto"
            maxLength={2000}
            value={note}
            error={noteError}
            onChange={(event) => setNote(event.target.value)}
          />
          <p className="type-body-small text-muted-foreground">{t.seller.resubmitNoteHint}</p>
          {product.status === "ARCHIVED" ? <FormMessage tone="info">{t.seller.resubmitArchived}</FormMessage> : null}
          {product.status !== "ARCHIVED" && product.images.length === 0 ? <FormMessage tone="info">{t.seller.resubmitNeedsImage}</FormMessage> : null}
          {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
          <Button type="submit" className="self-start" disabled={pending || !rules.canResubmit}>
            {pending ? t.seller.resubmitting : t.seller.resubmit}
          </Button>
        </form>
      ) : notice ? (
        <FormMessage tone={notice.tone}>{notice.text}</FormMessage>
      ) : null}

      <div className="flex flex-col gap-2">
        {rules.moderated ? <h3 className="type-title-small">{t.seller.historyTitle}</h3> : null}
        {history === null ? <p className="type-body-small text-muted-foreground">{t.seller.historyLoading}</p> : null}
        {history !== null && entries.length === 0 ? <p className="type-body-small text-muted-foreground">{t.seller.historyEmpty}</p> : null}
        <ol className="flex flex-col gap-2">
          {entries
            .slice()
            .reverse()
            .map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5 rounded-2xl bg-muted p-3 type-body-small">
                <p className="type-label-large">{`${t.seller.actions[entry.action]} · ${t.seller.actor[entry.actor]}`}</p>
                <p className="text-muted-foreground">{formatDateTime(entry.createdAt, locale)}</p>
                {entry.reasonCode === null ? null : <p>{fillText(t.seller.reason, { reason: t.sellerReasons[entry.reasonCode] })}</p>}
                {entry.message === null ? null : (
                  <p dir="auto" className="break-words whitespace-pre-wrap">
                    {entry.message}
                  </p>
                )}
                {entry.note === null ? null : (
                  <p dir="auto" className="break-words whitespace-pre-wrap">
                    {fillText(t.seller.yourNote, { note: entry.note })}
                  </p>
                )}
              </li>
            ))}
        </ol>
      </div>
    </SectionCard>
  )
}
