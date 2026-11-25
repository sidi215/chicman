"use client"

import { useLayoutEffect, useSyncExternalStore } from "react"

import { headCleanupScript } from "@/lib/head-cleanup"
import { THEME_INIT_FLAG, themeInitScript } from "@/lib/theme"

const subscribe = () => () => {}

/**
 * Applies the theme before first paint with an inline script. React renders it
 * for the server and while hydrating, where the browser runs it from the HTML.
 *
 * Next answers a 404 with an empty document that the browser fills in. There,
 * React would create a <script> it never runs, and warns about it, so the
 * script is added directly instead.
 *
 * The server-rendered script also removes host-injected nodes from <head>
 * before hydration (`headCleanupScript`); the 404 document is rendered on the
 * client, so it has nothing to clean.
 */
export function ThemeInit() {
  const fromHtml = useSyncExternalStore(subscribe, () => false, () => true)

  useLayoutEffect(() => {
    if (THEME_INIT_FLAG in window) return
    const script = document.createElement("script")
    script.text = themeInitScript
    document.head.append(script)
  }, [])

  return fromHtml ? <script dangerouslySetInnerHTML={{ __html: `${headCleanupScript}\n${themeInitScript}` }} /> : null
}
