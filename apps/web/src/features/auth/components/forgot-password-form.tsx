"use client"

import { useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"

import { useAuth } from "../auth-provider"
import type { AuthErrorKey } from "../messages"
import { captchaBlocks, useCaptcha } from "../turnstile"
import { useAuthMessages } from "../use-auth-messages"
import { validateEmail, type FieldErrors } from "../validation"
import { AuthShell } from "./auth-shell"
import { FormField, FormMessage } from "./form-field"
import { TextLink } from "./text-link"

/** Password recovery request (spec 03). Same message for every address. */
export function ForgotPasswordForm() {
  const t = useAuthMessages()
  const { status, service } = useAuth()
  const captcha = useCaptcha("recovery", { label: t.captchaLabel, loading: t.captchaLoading, failed: t.errors.captchaFailed, retry: t.retry })
  const [email, setEmail] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<"email">>({})
  const [formError, setFormError] = useState<AuthErrorKey | null>(null)
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    const result = validateEmail(email)
    if (!result.ok) {
      setFieldErrors(result.errors)
      return
    }
    setFieldErrors({})
    if (!service) return setFormError("notConfigured")
    if (captchaBlocks(captcha)) return setFormError("captchaRequired")
    setPending(true)
    const outcome = await service.requestPasswordReset(result.value, captcha.token)
    setPending(false)
    captcha.reset()
    if (outcome.ok) setSent(true)
    else setFormError(outcome.error)
  }

  return (
    <AuthShell brand={t.brand} title={t.forgotTitle} description={sent ? undefined : t.forgotSubtitle}>
      {status === "not-configured" ? <FormMessage tone="error">{t.errors.notConfigured}</FormMessage> : null}
      {sent ? (
        <FormMessage tone="info">{t.forgotSent}</FormMessage>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <FormField
            label={t.email}
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            placeholder={t.emailPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email && t.errors[fieldErrors.email]}
          />
          {captcha.widget}
          {formError ? <FormMessage tone="error">{t.errors[formError]}</FormMessage> : null}
          <Button type="submit" disabled={pending || status === "loading"}>
            {pending ? t.loading : t.submitForgot}
          </Button>
        </form>
      )}
      <TextLink href="/login">{t.toLogin}</TextLink>
    </AuthShell>
  )
}
