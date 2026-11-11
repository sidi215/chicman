"use client"

import { Bell } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { useAuth } from "@/features/auth/auth-provider"

import { useNotificationMessages } from "../messages"
import { unreadBadge } from "../notifications-logic"
import { useNotifications } from "../notifications-provider"

/**
 * The bell, with the number of unread notifications. Shown to signed-in users
 * only: guests have no notifications. `href` is the notification center of the
 * area it sits in (storefront or seller).
 */
export function NotificationsLink({ href }: { href: string }) {
  const t = useNotificationMessages()
  const { status } = useAuth()
  const { unread } = useNotifications()
  if (status !== "signed-in") return null
  return (
    <Link
      href={href}
      aria-label={unread > 0 ? t.linkWithCount.replace("{count}", String(unread)) : t.link}
      className={buttonVariants({ variant: "outline", size: "icon-sm", className: "relative" })}
    >
      <Bell aria-hidden className="size-icon-action" />
      {unread > 0 ? (
        <span
          aria-hidden
          data-testid="notifications-count"
          // The cart badge's exact classes (`CartLink`), so the header counters look and sit the same.
          className="absolute -end-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 type-label-medium text-primary-foreground"
        >
          {unreadBadge(unread)}
        </span>
      ) : null}
    </Link>
  )
}
