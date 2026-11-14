"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/features/auth/auth-provider"
import { FormMessage } from "@/features/auth/components/form-field"
import { apiRequest } from "@/lib/api-client"

import { interpretAdminResult, type AdminOutcome, type DecisionErrorKey } from "../admin-shops"
import type { AdminMessages } from "../messages"

/** What a failed call is about: the texts for "not found", "conflict", and "own shop" differ. */
export type AdminSubject = "shop" | "order"

export function errorText(state: AdminOutcome<unknown>["state"], t: AdminMessages, subject: AdminSubject = "shop"): string {
  switch (state) {
    case "forbidden":
      return t.forbidden
    case "own-shop":
      return subject === "order" ? t.ownShopOrder : t.ownShop
    case "not-found":
      return subject === "order" ? t.orderNotFound : t.notFound
    case "conflict":
      return subject === "order" ? t.orderConflict : t.conflict
    case "invalid":
      return t.invalid
    case "unavailable":
      return t.unavailable
    default:
      return t.generic
  }
}

/** An answer that arrived after the account changed: dropped, never shown. */
export type GuardedAdminOutcome<T> = AdminOutcome<T> | { state: "stale" }

/**
 * Calls an admin endpoint with the session token. The API enforces the
 * Administrator account type and every rule; guests go to the login page. An
 * answer to a request made for a previous session is dropped.
 */
export function useAdminApi() {
  const router = useRouter()
  const { status, getAccessToken, signOut } = useAuth()
  const session = useRef(0)
  useEffect(() => {
    if (status === "signed-out" || status === "not-configured") router.replace("/login")
    return () => {
      session.current += 1
    }
  }, [status, router])
  const call = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<GuardedAdminOutcome<T>> => {
      const started = session.current
      const token = await getAccessToken()
      if (!token) return { state: "signed-out" }
      const result = await apiRequest<T>(path, token, init)
      if (started !== session.current) return { state: "stale" }
      const outcome = interpretAdminResult(result)
      if (outcome.state === "signed-out") void signOut()
      return outcome
    },
    [getAccessToken, signOut]
  )
  return { status, call }
}

export const postJson = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

/** The page column of the admin area. */
export function AdminPage({ children }: { children: ReactNode }) {
  return <main className="flex flex-1 flex-col items-center gap-6 bg-page pb-6">{children}</main>
}

export function TextArea({ label, hint, error, value, onChange }: { label: string; hint?: string; error?: string | undefined; value: string; onChange: (value: string) => void }) {
  const id = useId()
  const hintId = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="type-label-large">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="type-body-small text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        rows={3}
        dir="auto"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-input bg-surface px-4 py-3 type-body-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive"
      />
      {error ? <p className="type-body-small text-error-text">{error}</p> : null}
    </div>
  )
}

export type ReasonFormResult = { ok: true; body: unknown } | { ok: false; errors: Partial<Record<"reason" | "internalNote", DecisionErrorKey>> }

/**
 * One administrative form: a required reason of the given kind, an optional
 * internal note when `withNote`, checked with the API's schema before
 * sending. Opens from a button; closes after a success.
 */
export function ReasonForm({
  t,
  label,
  reasonLabel,
  reasonHint,
  withNote = true,
  destructive = false,
  subject = "shop",
  build,
  submit,
}: {
  t: AdminMessages
  label: string
  reasonLabel: string
  reasonHint: string
  withNote?: boolean
  destructive?: boolean
  subject?: AdminSubject
  build: (reason: string, note: string) => ReasonFormResult
  submit: (body: unknown) => Promise<GuardedAdminOutcome<unknown>>
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
    const result = build(reason, withNote ? note : "")
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
      if (outcome.state === "stale") return
      if (outcome.state === "ok") {
        setNotice(null)
        setReason("")
        setNote("")
        setOpen(false)
      } else {
        setNotice(errorText(outcome.state, t, subject))
      }
    } finally {
      setPending(false)
    }
  }

  if (!open) {
    return (
      <Button variant={destructive ? "destructive" : "outline"} onClick={() => setOpen(true)}>
        {label}
      </Button>
    )
  }
  return (
    <form className="flex flex-col gap-3 rounded-2xl border border-border p-4" onSubmit={onSubmit} noValidate aria-label={label}>
      <p className="type-title-small">{label}</p>
      <TextArea label={reasonLabel} hint={reasonHint} value={reason} onChange={setReason} error={errors.reason} />
      {withNote ? <TextArea label={t.internalNote} hint={t.internalReasonHint} value={note} onChange={setNote} error={errors.internalNote} /> : null}
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

export function Pagination({ page, pages, onPage, t }: { page: number; pages: number; onPage: (page: number) => void; t: AdminMessages }) {
  if (pages <= 1) return null
  return (
    <nav className="flex items-center justify-between gap-3">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t.previousPage}
      </Button>
      <span className="type-body-small text-muted-foreground">{t.pageOf.replace("{page}", String(page)).replace("{pages}", String(pages))}</span>
      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t.nextPage}
      </Button>
    </nav>
  )
}
