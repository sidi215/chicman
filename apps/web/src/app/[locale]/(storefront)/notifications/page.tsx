import { permanentRedirect } from "next/navigation"

/** Notifications moved into the buyer dashboard; old links and bookmarks still arrive. */
export default function NotificationsRedirect() {
  permanentRedirect("/account/notifications")
}
