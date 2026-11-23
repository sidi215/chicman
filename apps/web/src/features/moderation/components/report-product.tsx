"use client"

import { PRODUCT_REPORT_REASONS, type ProductReportReason } from "@chicman/shared"
import { Flag } from "lucide-react"
import Link from "next/link"
import { useId, useRef, useState, type FormEvent } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { useAccount } from "@/features/auth/account-provider"
import { useAuth } from "@/features/auth/auth-provider"
import { FormMessage } from "@/features/auth/components/form-field"
import { apiRequest } from "@/lib/api-client"
import { cn } from "@/lib/utils"

import { useModerationMessages } from "../messages"
import { buildReport, interpretReportResult, REPORT_DETAILS_MAX, REPORT_PATH, type ReportFormError, type ReportOutcome } from "../moderation"

const triggerClasses = cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start text-muted-foreground")

/**
 * "Signaler" on a public product page (spec 19, section 4). Buyers only
 * (PD-1): guests are sent to sign in, and Sellers and Administrators, who
 * browse read only (AT-1, Q6), do not see it. The buyer sees only "Signalement
 * envoyé", never an outcome (PD-4). A native modal dialog: focus stays inside,
 * Escape closes it, and focus returns to the button.
 */
export function ReportProductButton({ productId, name }: { productId: string; name: string }) {
  const t = useModerationMessages()
  const { account } = useAccount()
  const { getAccessToken } = useAuth()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const detailsId = useId()
  const hintId = useId()
  const [reason, setReason] = useState<ProductReportReason | null>(null)
  const [details, setDetails] = useState("")
  const [error, setError] = useState<ReportFormError | null>(null)
  const [outcome, setOutcome] = useState<ReportOutcome | null>(null)
  const [pending, setPending] = useState(false)

  if (account.state === "active" && account.accountType !== "BUYER") return null
  if (account.state === "guest" || account.state === "needs-setup") {
    return (
      <Link href={account.state === "guest" ? "/login" : "/account"} className={triggerClasses} title={t.report.signInPrompt}>
        <Flag aria-hidden className="size-icon-inline" />
        {t.report.action}
      </Link>
    )
  }

  const open = () => {
    setOutcome(null)
    setError(null)
    dialog.current?.showModal()
  }
  const close = () => dialog.current?.close()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const built = buildReport(productId, reason, details)
    if (!built.ok) return setError(built.error)
    setError(null)
    setPending(true)
    const token = await getAccessToken()
    const result = token
      ? interpretReportResult(
          await apiRequest(REPORT_PATH, token, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(built.body) })
        )
      : "sign-in"
    setPending(false)
    setOutcome(result)
    if (result === "sent") {
      setReason(null)
      setDetails("")
    }
  }

  const detailsRequired = reason === "OTHER"
  const detailsError = error === "detailsRequired" || error === "detailsLength" || error === "detailsInvalid" ? t.report.errors[error] : null

  return (
    <>
      <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={open} disabled={account.state !== "active"}>
        <Flag aria-hidden className="size-icon-inline" />
        {t.report.action}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/40"
        onClick={(event) => {
          // A click on the backdrop (outside the content) closes it.
          if (event.target === event.currentTarget) close()
        }}
      >
        <div className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto p-5 sm:p-6">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="type-title-large">
              {t.report.title}
            </h2>
            <p dir="auto" className="type-body-medium break-words text-muted-foreground">
              {name}
            </p>
          </div>
          {outcome === "sent" ? (
            <div role="status" className="flex flex-col gap-3">
              <p className="type-title-medium">{t.report.sent}</p>
              <p className="type-body-medium">{t.report.sentBody}</p>
              <Button className="self-start" onClick={close}>
                {t.report.close}
              </Button>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
              <p className="type-body-medium">{t.report.intro}</p>
              <fieldset className="flex flex-col gap-2" aria-invalid={error === "reasonRequired" ? true : undefined}>
                <legend className="mb-1 type-label-large">{t.report.reasonLabel}</legend>
                {PRODUCT_REPORT_REASONS.map((value) => (
                  <label key={value} className="flex min-h-control-sm items-center gap-3 rounded-2xl px-2 type-body-medium hover:bg-muted">
                    <input type="radio" name="report-reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="size-4 shrink-0" />
                    <span>{t.reportReasons[value]}</span>
                  </label>
                ))}
                {error === "reasonRequired" ? <p className="type-body-small text-error-text">{t.report.errors.reasonRequired}</p> : null}
              </fieldset>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={detailsId} className="type-label-large">
                  {detailsRequired ? t.report.detailsLabelRequired : t.report.detailsLabel}
                </label>
                <textarea
                  id={detailsId}
                  rows={4}
                  dir="auto"
                  maxLength={REPORT_DETAILS_MAX * 2}
                  value={details}
                  required={detailsRequired}
                  aria-invalid={detailsError ? true : undefined}
                  aria-describedby={hintId}
                  onChange={(event) => setDetails(event.target.value)}
                  className="w-full rounded-2xl border border-input bg-surface px-4 py-3 type-body-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive"
                />
                <p id={hintId} className={cn("type-body-small", detailsError ? "text-error-text" : "text-muted-foreground")}>
                  {detailsError ?? t.report.detailsHint}
                </p>
              </div>
              {outcome !== null ? <FormMessage tone="error">{t.report.outcomes[outcome]}</FormMessage> : null}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={pending}>
                  {pending ? t.report.sending : t.report.submit}
                </Button>
                <Button type="button" variant="ghost" onClick={close}>
                  {t.report.close}
                </Button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  )
}
