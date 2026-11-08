"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import { useLocale } from "@/lib/locale-provider"

/**
 * Cloudflare Turnstile (spec 03, Bot Protection). The widget only produces a
 * token; Supabase Auth verifies it on the server. Its success callback grants
 * nothing on the client.
 */

interface TurnstileApi {
  render(
    element: HTMLElement,
    options: {
      sitekey: string
      action?: string
      language?: string
      callback: (token: string) => void
      "expired-callback": () => void
      "error-callback": () => void
      "timeout-callback": () => void
    }
  ): string
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

let scriptPromise: Promise<TurnstileApi> | null = null

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile unavailable")))
    script.onerror = () => {
      scriptPromise = null
      reject(new Error("Turnstile unavailable"))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

/** Public site key. Without it, the widget is not rendered and no token is sent. */
export function getTurnstileSiteKey(): string | null {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  return key && key.length > 0 ? key : null
}

export type CaptchaState = "disabled" | "loading" | "ready" | "solved" | "failed"

export interface Captcha {
  state: CaptchaState
  /** The current single-use token, if solved. */
  token: string | undefined
  /** Discards the token and asks for a new one (after every submit attempt). */
  reset: () => void
  /** The widget container to render in the form (`null` when disabled). */
  widget: ReactNode
}

export interface CaptchaLabels {
  label: string
  loading: string
  failed: string
  retry: string
}

export function useCaptcha(action: "signup" | "login" | "recovery" | "resend", labels: CaptchaLabels): Captcha {
  const locale = useLocale()
  const siteKey = getTurnstileSiteKey()
  const [state, setState] = useState<CaptchaState>(siteKey ? "loading" : "disabled")
  const [token, setToken] = useState<string | undefined>(undefined)
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  // Incremented by "retry" to render a new widget (also reloads a failed script).
  const [attempt, setAttempt] = useState(0)
  const widgetId = useRef<string | null>(null)

  useEffect(() => {
    if (!siteKey || !element) return
    let cancelled = false
    loadTurnstile()
      .then((api) => {
        if (cancelled) return
        widgetId.current = api.render(element, {
          sitekey: siteKey,
          action,
          language: locale,
          callback: (value) => {
            setToken(value)
            setState("solved")
          },
          // Tokens are single-use and expire after 5 minutes.
          "expired-callback": () => {
            setToken(undefined)
            setState("ready")
          },
          "error-callback": () => {
            setToken(undefined)
            setState("failed")
          },
          "timeout-callback": () => {
            setToken(undefined)
            setState("ready")
          },
        })
        setState("ready")
      })
      .catch(() => {
        if (!cancelled) setState("failed")
      })
    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
      widgetId.current = null
    }
  }, [siteKey, element, action, attempt, locale])

  const reset = useCallback(() => {
    setToken(undefined)
    if (widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current)
      setState("ready")
    }
  }, [])

  const retry = useCallback(() => {
    setToken(undefined)
    setState("loading")
    setAttempt((value) => value + 1)
  }, [])

  const widget = siteKey ? (
    <div className="flex flex-col gap-2">
      <div ref={setElement} aria-label={labels.label} className="min-h-[65px]" />
      {state === "loading" ? (
        <p role="status" className="type-body-small text-muted-foreground">
          {labels.loading}
        </p>
      ) : null}
      {state === "failed" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="type-body-small text-error-text">
            {labels.failed}
          </p>
          <button type="button" onClick={retry} className="type-label-large text-foreground underline underline-offset-4">
            {labels.retry}
          </button>
        </div>
      ) : null}
    </div>
  ) : null
  return { state, token, reset, widget }
}

/** Fail closed: with Turnstile enabled, a request needs a token. */
export function captchaBlocks(captcha: Captcha): boolean {
  return captcha.state !== "disabled" && captcha.token === undefined
}
