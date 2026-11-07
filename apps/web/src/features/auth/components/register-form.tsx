"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"

import { useAuth } from "../auth-provider"
import type { AuthErrorKey } from "../messages"
import { captchaBlocks, useCaptcha } from "../turnstile"
import { useAuthMessages } from "../use-auth-messages"
import { validateRegistration, type FieldErrors } from "../validation"
import { AuthShell } from "./auth-shell"
import { FormField, FormMessage } from "./form-field"
import { TextLink } from "./text-link"

/**
 * Sign-up: email and password only (spec 03). The phone number is collected
 * later, at account setup, after the email is confirmed.
 */
export function RegisterForm() {
  const router = useRouter()
  const { status, service } = useAuth()
  const [sentTo, setSentTo] = useState<string | null>(null)

  useEffect(() => {
    if (status === "signed-in") router.replace("/account")
  }, [status, router])

  if (sentTo !== null) return <CheckEmail email={sentTo} onChangeEmail={() => setSentTo(null)} />
  return <SignUpDetails onSent={setSentTo} serviceReady={service !== null} />
}

function SignUpDetails({ onSent, serviceReady }: { onSent: (email: string) => void; serviceReady: boolean }) {
  const t = useAuthMessages()
  const { status, service } = useAuth()
  const captcha = useCaptcha("signup", { label: t.captchaLabel, loading: t.captchaLoading, failed: t.errors.captchaFailed, retry: t.retry })
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<"email" | "password" | "confirmPassword">>({})
  const [formError, setFormError] = useState<AuthErrorKey | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    const result = validateRegistration({ email, password, confirmPassword })
    if (!result.ok) {
      setFieldErrors(result.errors)
      return
    }
    setFieldErrors({})
    if (!service || !serviceReady) return setFormError("notConfigured")
    if (captchaBlocks(captcha)) return setFormError("captchaRequired")
    setPending(true)
    const outcome = await service.register(result.value.email, result.value.password, captcha.token)
    setPending(false)
    captcha.reset()
    if (outcome.ok) onSent(result.value.email)
    else setFormError(outcome.error)
  }

  return (
    <AuthShell brand={t.brand} title={t.registerTitle} description={t.registerSubtitle}>
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
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password && t.errors[fieldErrors.password]}
        />
        <FormField
          label={t.confirmPassword}
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={fieldErrors.confirmPassword && t.errors[fieldErrors.confirmPassword]}
        />
        {captcha.widget}
        {formError ? <FormMessage tone="error">{t.errors[formError]}</FormMessage> : null}
        <Button type="submit" disabled={pending || status === "loading"}>
          {pending ? t.loading : t.submitRegister}
        </Button>
      </form>
      <p className="type-body-medium text-muted-foreground">
        {t.haveAccount} <TextLink href="/login">{t.toLogin}</TextLink>
      </p>
    </AuthShell>
  )
}

/** Same message whether or not the email is registered (no account enumeration). */
function CheckEmail({ email, onChangeEmail }: { email: string; onChangeEmail: () => void }) {
  const t = useAuthMessages()
  const { service } = useAuth()
  const captcha = useCaptcha("resend", { label: t.captchaLabel, loading: t.captchaLoading, failed: t.errors.captchaFailed, retry: t.retry })
  const [formError, setFormError] = useState<AuthErrorKey | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onResend() {
    setFormError(null)
    setInfo(null)
    if (!service) return setFormError("notConfigured")
    if (captchaBlocks(captcha)) return setFormError("captchaRequired")
    setPending(true)
    const outcome = await service.resendConfirmation(email, captcha.token)
    setPending(false)
    captcha.reset()
    if (outcome.ok) setInfo(t.confirmationResent)
    else setFormError(outcome.error)
  }

  return (
    <AuthShell brand={t.brand} title={t.checkEmailTitle} description={t.checkEmailBody(email)}>
      {captcha.widget}
      {formError ? <FormMessage tone="error">{t.errors[formError]}</FormMessage> : null}
      {info ? <FormMessage tone="info">{info}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={pending} onClick={onResend}>
          {pending ? t.loading : t.resendConfirmation}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onChangeEmail}>
          {t.changeEmail}
        </Button>
      </div>
      <TextLink href="/login">{t.toLogin}</TextLink>
    </AuthShell>
  )
}
