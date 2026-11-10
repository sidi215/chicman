"use client"

import { DELIVERY_FAILURE_REASONS, type DeliveryFailureReason, type SellerDelivery, type SellerDeliveryRecord } from "@chicman/shared"
import { Truck } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { FormMessage } from "@/features/auth/components/form-field"
import { formatDateTime } from "@/lib/date-time"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import type { OrderMessages } from "../messages"
import { deliveredBody, deliveryActionPath, failBody, needsReload, type DeliveryAction } from "../order-logic"
import type { GuardedOutcome } from "./order-shared"

type Step = "delivered" | "fail" | "close" | null

export interface DeliveryPanelProps {
  shopOrderId: string
  record: SellerDeliveryRecord
  /** The amount "delivered, cash received" confirms (spec 13). */
  amountDue: string
  t: OrderMessages
  call: <T>(path: string, method?: string, body?: unknown) => Promise<GuardedOutcome<T>>
  /** After a change, or a refusal that made the shown state stale: the parent reads it again. */
  onChanged: (notice: { tone: "info" | "error"; text: string }) => void
}

/** The attempts, oldest first. History is never rewritten (D5). */
function AttemptList({ record, t }: { record: SellerDeliveryRecord; t: OrderMessages }) {
  const locale = useLocale()
  if (record.attempts.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <p className="type-label-large">{t.attemptsTitle}</p>
      <ol className="flex flex-col gap-1">
        {record.attempts.map((attempt) => (
          <li key={attempt.number} className="type-body-small">
            {t.attemptLine.replace("{number}", String(attempt.number)).replace("{date}", formatDateTime(attempt.dispatchedAt, locale))}
            {" — "}
            {attempt.outcome === null
              ? t.attemptInProgress
              : attempt.outcome === "DELIVERED"
                ? t.attemptDelivered.replace("{date}", formatDateTime(attempt.outcomeAt ?? attempt.dispatchedAt, locale))
                : t.attemptFailed
                    .replace("{date}", formatDateTime(attempt.outcomeAt ?? attempt.dispatchedAt, locale))
                    .replace("{reason}", attempt.failureReason === null ? "" : t.deliveryFailureReasons[attempt.failureReason])}
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * The seller's delivery actions (spec 12, web only: O1). The API decides which
 * are available (`record.actions`), including the narrower set of a suspended
 * shop (D8); the final actions ask for a confirmation first.
 */
export function DeliveryPanel({ shopOrderId, record, amountDue, t, call, onChanged }: DeliveryPanelProps) {
  const locale = useLocale()
  const [step, setStep] = useState<Step>(null)
  const [reason, setReason] = useState<DeliveryFailureReason | null>(null)
  const [missingReason, setMissingReason] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { actions } = record
  const amount = formatMru(amountDue, locale)

  async function act(action: DeliveryAction, body: object, success: string) {
    setPending(true)
    setError(null)
    const outcome = await call<SellerDelivery>(deliveryActionPath(shopOrderId, action), "POST", body)
    setPending(false)
    if (outcome.state === "stale" || outcome.state === "signed-out") return
    if (outcome.state === "ok") {
      setStep(null)
      setReason(null)
      onChanged({ tone: "info", text: success })
      return
    }
    const text = t.failures[outcome.failure]
    if (needsReload(outcome.failure)) {
      setStep(null)
      onChanged({ tone: "error", text })
    } else {
      setError(text)
    }
  }

  const openFailure = record.status === "FAILED" && record.closedAt === null

  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
      <h2 className="flex items-center gap-2 type-title-medium">
        <Truck aria-hidden className="size-icon-action shrink-0 text-muted-foreground" />
        {t.deliveryTitle}
      </h2>
      <p className="type-body-medium">{record.closedAt === null ? t.deliveryStatus[record.status] : t.closedUndeliverable}</p>
      <AttemptList record={record} t={t} />
      {openFailure && record.autoCloseAt !== null ? (
        <p className="type-body-small text-warning-text">{t.autoCloseAt.replace("{date}", formatDateTime(record.autoCloseAt, locale))}</p>
      ) : null}
      {error === null ? null : <FormMessage tone="error">{error}</FormMessage>}

      {step === null && (actions.ready || actions.dispatch || actions.delivered || actions.fail || actions.close) ? (
        <div className="flex flex-wrap gap-2">
          {actions.delivered ? (
            <Button disabled={pending} onClick={() => setStep("delivered")}>
              {t.markDelivered}
            </Button>
          ) : null}
          {actions.fail ? (
            <Button variant="outline" disabled={pending} onClick={() => setStep("fail")}>
              {t.markFailed}
            </Button>
          ) : null}
          {actions.dispatch ? (
            <Button disabled={pending} onClick={() => void act("dispatch", {}, t.dispatched)}>
              {pending ? t.sending : openFailure ? t.retryDelivery : t.dispatch}
            </Button>
          ) : null}
          {actions.ready ? (
            <Button variant="outline" disabled={pending} title={t.markReadyHint} onClick={() => void act("ready", {}, t.readyDone)}>
              {t.markReady}
            </Button>
          ) : null}
          {actions.close ? (
            <Button variant="outline" disabled={pending} onClick={() => setStep("close")}>
              {t.closeDelivery}
            </Button>
          ) : null}
        </div>
      ) : null}
      {step === null && actions.ready ? <p className="type-body-small text-muted-foreground">{t.markReadyHint}</p> : null}
      {step === null && openFailure && actions.dispatch ? <p className="type-body-small text-muted-foreground">{t.retryByPhone}</p> : null}

      {step === "delivered" && actions.delivered ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/50 p-4">
          <p className="type-title-small">{t.deliveredTitle}</p>
          <p className="type-body-medium">{t.deliveredHint.replace("{amount}", amount)}</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => void act("delivered", deliveredBody(amountDue), t.deliveredDone)}>
              {pending ? t.sending : t.confirmDelivered}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setStep(null)}>
              {t.back}
            </Button>
          </div>
        </div>
      ) : null}

      {step === "fail" && actions.fail ? (
        <form
          noValidate
          className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/50 p-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (reason === null) return setMissingReason(true)
            void act("fail", failBody(reason), t.failedDone)
          }}
        >
          <p className="type-title-small">{t.failTitle}</p>
          <p className="type-body-small text-muted-foreground">{t.failHint}</p>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 type-label-large">{t.reasonLabel}</legend>
            <div className="flex flex-wrap gap-2">
              {DELIVERY_FAILURE_REASONS.map((value) => (
                <Chip
                  key={value}
                  pressed={reason === value}
                  onPressedChange={() => {
                    setReason(value)
                    setMissingReason(false)
                  }}
                >
                  {t.deliveryFailureReasons[value]}
                </Chip>
              ))}
            </div>
            {missingReason ? <p className="type-body-small text-error-text">{t.chooseReason}</p> : null}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? t.sending : t.submitFail}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setStep(null)}>
              {t.back}
            </Button>
          </div>
        </form>
      ) : null}

      {step === "close" && actions.close ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/50 p-4">
          <p className="type-title-small">{t.closeTitle}</p>
          <p className="type-body-small text-muted-foreground">{t.closeHint}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" disabled={pending} onClick={() => void act("close", {}, t.closedDone)}>
              {pending ? t.sending : t.confirmClose}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setStep(null)}>
              {t.back}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
