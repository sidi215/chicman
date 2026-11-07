"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"

import { useAuth } from "../auth-provider"
import type { AuthErrorKey } from "../messages"
import { captchaBlocks, useCaptcha } from "../turnstile"
import { useAuthMessages } from "../use-auth-messages"
import { validateLogin, type FieldErrors } from "../validation"
import { AuthShell } from "./auth-shell"
import { FormField, FormMessage } from "./form-field"
import { TextLink } from "./text-link"

export function LoginForm() {
  const t = useAuthMessages()
  const router = useRouter()
  const { status, service } = useAuth()
  const captcha = useCaptcha("login", { label: t.captchaLabel, loading: t.captchaLoading, failed: t.errors.captchaFailed, retry: t.retry })
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<"email" | "password">>({})
  const [formError, setFormError] = useState<AuthErrorKey | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (status === "signed-in") router.replace("/account")
  }, [status, router])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setInfo(null)
    const result = validateLogin({ email, password })
    if (!result.ok) {
      setFieldErrors(result.errors)
      return
    }
    setFieldErrors({})
    if (!service) return setFormError("notConfigured")
    if (captchaBlocks(captcha)) return setFormError("captchaRequired")
    setPending(true)
    const outcome = await service.signIn(result.value.email, result.value.password, captcha.token)
    setPending(false)
    captcha.reset()
    if (outcome.ok) return // The auth state change redirects to /account.
    setFormError(outcome.error)
    setUnconfirmedEmail(outcome.error === "emailNotConfirmed" ? result.value.email : null)
  }

  async function onResend() {
    if (!service || !unconfirmedEmail) return
    if (captchaBlocks(captcha)) return setFormError("captchaRequired")
    setPending(true)
    const outcome = await service.resendConfirmation(unconfirmedEmail, captcha.token)
    setPending(false)
    captcha.reset()
    if (outcome.ok) {
      setFormError(null)
      setInfo(t.confirmationResent)
    } else {
      setFormError(outcome.error)
    }
  }

  return (
    <AuthShell brand={t.brand} title={t.loginTitle} description={t.loginSubtitle}>
      {status === "not-configured" ? <FormMessage tone="error">{t.errors.notConfigured}</FormMessage> : null}
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
        <FormField
          label={t.password}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password && t.errors[fieldErrors.password]}
        />
        {captcha.widget}
        {formError ? <FormMessage tone="error">{t.errors[formError]}</FormMessage> : null}
        {info ? <FormMessage tone="info">{info}</FormMessage> : null}
        <Button type="submit" disabled={pending || status === "loading"}>
          {pending ? t.loading : t.submitLogin}
        </Button>
        {unconfirmedEmail ? (
          <Button type="button" variant="outline" disabled={pending} onClick={onResend}>
            {t.resendConfirmation}
          </Button>
        ) : null}
      </form>
      <TextLink href="/forgot-password">{t.forgotPassword}</TextLink>
      <p className="type-body-medium text-muted-foreground">
        {t.noAccount} <TextLink href="/register">{t.toRegister}</TextLink>
      </p>
    </AuthShell>
  )
}
