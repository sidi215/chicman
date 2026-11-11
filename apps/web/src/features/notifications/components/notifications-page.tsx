"use client"

import type { NotificationItem } from "@chicman/shared"
import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { useAuth } from "@/features/auth/auth-provider"
import { FormMessage } from "@/features/auth/components/form-field"
import { formatDateTime } from "@/lib/date-time"
import { useLocale } from "@/lib/locale-provider"
import { cn } from "@/lib/utils"

import { useNotificationMessages, type NotificationMessages } from "../messages"
import {
  appendPage,
  describeNotification,
  markReadPath,
  notificationHref,
  notificationListPath,
  READ_ALL_PATH,
  withAllRead,
  withRead,
  type NotificationFailure,
  type NotificationList,
} from "../notifications-logic"
import { useNotifications } from "../notifications-provider"

type View =
  | { kind: "loading" }
  | { kind: "needs-setup" }
  | { kind: "failed"; failure: NotificationFailure }
  | { kind: "ready"; list: NotificationList; loadingMore: boolean }

const POST: RequestInit = { method: "POST" }

function NotificationRow({ item, onRead, t }: { item: NotificationItem; onRead: (item: NotificationItem) => void; t: NotificationMessages }) {
  const locale = useLocale()
  const text = describeNotification(item, locale)
  const href = notificationHref(item)
  const unread = item.readAt === null
  return (
    <li className={cn("flex flex-col gap-2 py-4 first:pt-0 last:pb-0")} data-testid={`notification-${item.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        {unread ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" /> : null}
        <p className={cn("type-title-small", unread ? "" : "text-muted-foreground")}>{text.title}</p>
        {unread ? <Badge variant="outline">{t.unread}</Badge> : null}
      </div>
      {text.body === "" ? null : (
        // Shop names and references are seller content: their direction follows the text.
        <p dir="auto" className="type-body-medium">
          {text.body}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="type-body-small text-muted-foreground">{formatDateTime(item.createdAt, locale)}</p>
        <div className="flex flex-wrap gap-2">
          {unread ? (
            <Button variant="ghost" size="sm" onClick={() => onRead(item)}>
              {t.markRead}
            </Button>
          ) : null}
          {href === null ? null : (
            // The resource's own page checks access again; the notification grants nothing.
            <Link href={href} onClick={() => (unread ? onRead(item) : undefined)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t.open}
            </Link>
          )}
        </div>
      </div>
    </li>
  )
}

/**
 * The notification center (spec 15): the signed-in user's notifications, newest
 * first, page by page, with read state. Mounted in the storefront and the
 * seller area; both list the same notifications of the user. The admin area
 * has none (spec 15, O6.1).
 */
export function NotificationsPage() {
  const t = useNotificationMessages()
  const { status } = useAuth()
  const { call, refresh } = useNotifications()
  const [view, setView] = useState<View>({ kind: "loading" })
  const [failure, setFailure] = useState<NotificationFailure | null>(null)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<NotificationList>(notificationListPath(null)).then((outcome) => {
      if (cancelled || outcome.state === "stale" || outcome.state === "signed-out") return
      if (outcome.state === "ok") setView({ kind: "ready", list: outcome.data, loadingMore: false })
      else if (outcome.state === "not-bootstrapped") setView({ kind: "needs-setup" })
      else setView({ kind: "failed", failure: outcome.state === "failed" ? outcome.failure : "error" })
    })
    return () => {
      cancelled = true
      // Never show one account's notifications to the next.
      setView({ kind: "loading" })
      setFailure(null)
    }
  }, [status, call, reloads])

  const loadMore = useCallback(async () => {
    if (view.kind !== "ready" || view.list.nextCursor === null) return
    const current = view.list
    setView({ kind: "ready", list: current, loadingMore: true })
    const outcome = await call<NotificationList>(notificationListPath(current.nextCursor))
    if (outcome.state === "stale") return
    if (outcome.state === "ok") {
      setView({ kind: "ready", list: appendPage(current, outcome.data), loadingMore: false })
      return
    }
    setView({ kind: "ready", list: current, loadingMore: false })
    setFailure(outcome.state === "failed" ? outcome.failure : "error")
  }, [view, call])

  const markRead = useCallback(
    async (item: NotificationItem) => {
      setFailure(null)
      const outcome = await call<void>(markReadPath(item.id), POST)
      if (outcome.state === "stale") return
      // `not-found`: it is gone for this user; nothing to mark.
      if (outcome.state === "ok" || outcome.state === "not-found") {
        const at = new Date().toISOString()
        setView((current) => (current.kind === "ready" ? { ...current, list: withRead(current.list, item.id, at) } : current))
        void refresh()
        return
      }
      if (outcome.state === "failed") setFailure(outcome.failure)
    },
    [call, refresh]
  )

  const markAllRead = useCallback(async () => {
    setFailure(null)
    const outcome = await call<void>(READ_ALL_PATH, POST)
    if (outcome.state === "stale") return
    if (outcome.state === "ok") {
      const at = new Date().toISOString()
      setView((current) => (current.kind === "ready" ? { ...current, list: withAllRead(current.list, at) } : current))
      void refresh()
      return
    }
    setFailure(outcome.state === "failed" ? outcome.failure : "error")
  }, [call, refresh])

  const hasUnread = view.kind === "ready" && view.list.items.some(({ readAt }) => readAt === null)

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-page-gutter py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="type-headline-large">{t.title}</h1>
          <p className="type-body-medium text-muted-foreground">{t.subtitle}</p>
        </div>
        {hasUnread ? (
          <Button variant="outline" size="sm" onClick={() => void markAllRead()}>
            {t.markAllRead}
          </Button>
        ) : null}
      </div>
      {status === "signed-out" || status === "not-configured" ? (
        <div className="flex flex-col items-start gap-3">
          <p className="type-title-medium">{t.guestTitle}</p>
          <Link href="/login" className={buttonVariants()}>
            {t.login}
          </Link>
        </div>
      ) : null}
      {status === "signed-in" || status === "loading" ? (
        <>
          {view.kind === "loading" ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
          {view.kind === "needs-setup" ? (
            <div className="flex flex-col items-start gap-3">
              <p className="type-body-medium">{t.setupBody}</p>
              <Link href="/account" className={buttonVariants()}>
                {t.setupAction}
              </Link>
            </div>
          ) : null}
          {view.kind === "failed" ? (
            <div className="flex flex-col items-start gap-3">
              <FormMessage tone="error">{t.failures[view.failure]}</FormMessage>
              <Button variant="outline" onClick={() => setReloads((count) => count + 1)}>
                {t.retry}
              </Button>
            </div>
          ) : null}
          {failure === null ? null : <FormMessage tone="error">{t.failures[failure]}</FormMessage>}
          {view.kind === "ready" && view.list.items.length === 0 ? <p className="type-body-medium text-muted-foreground">{t.empty}</p> : null}
          {view.kind === "ready" && view.list.items.length > 0 ? (
            <section aria-label={t.title} className="rounded-3xl border border-border bg-surface p-4 sm:p-6">
              <ul className="flex flex-col divide-y divide-border">
                {view.list.items.map((item) => (
                  <NotificationRow key={item.id} item={item} onRead={(target) => void markRead(target)} t={t} />
                ))}
              </ul>
            </section>
          ) : null}
          {view.kind === "ready" && view.list.nextCursor !== null ? (
            <Button variant="outline" className="self-center" disabled={view.loadingMore} onClick={() => void loadMore()}>
              {t.loadMore}
            </Button>
          ) : null}
        </>
      ) : null}
    </main>
  )
}
