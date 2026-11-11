"use client"

import { NotificationsLink } from "./notifications-link"

/**
 * The seller area's top bar: the bell with the unread count, opening the
 * seller notification center. Each page keeps its own heading. The admin area
 * has no bell: there is no administrator audience (spec 15, O6.1).
 */
export function NotificationsAreaBar({ href }: { href: string }) {
  return (
    <div className="flex w-full justify-end bg-page px-page-gutter pt-4">
      <NotificationsLink href={href} />
    </div>
  )
}
