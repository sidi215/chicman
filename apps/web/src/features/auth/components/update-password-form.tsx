"use client"

import { useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"

import { useAuth } from "../auth-provider"
import type { AuthErrorKey } from "../messages"
import { useAuthMessages } from "../use-auth-messages"
import { validateNewPassword, type FieldErrors } from "../validation"
import { AuthShell } from "./auth-shell"
import { FormField, FormMessage } from "./form-field"
import { TextLink } from "./text-link"

/** "Set a new password", reached from a verified recovery link (recovery session). */
export function UpdatePasswordForm() {
  const t = useAuthMessages()
  const { status, service } = useAuth()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<"password" | "confirmPassword">>({})
  const [formError, setFormError] = useState<AuthErrorKey | null>(null)
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    const result = validateNewPassword({ password, confirmPassword })
    if (!result.ok) {
      setFieldErrors(result.errors)
      return
    }
    setFieldErrors({})
    if (!service) return setFormError("notConfigured")
    setPending(true)
    const outcome = await service.updatePassword(result.value)
    setPending(false)
    if (outcome.ok) setDone(true)
    else setFormError(outcome.error)
  }

  if (status === "loading") {
    return (
      <AuthShell brand={t.brand} title={t.newPasswordTitle}>
        <FormMessage tone="info">{t.loading}</FormMessage>
      </AuthShell>
    )
  }
  if (status !== "signed-in") {
    return (
      <AuthShell brand={t.brand} title={t.newPasswordTitle}>
        <FormMessage tone="error">{t.newPasswordNoSession}</FormMessage>
        <TextLink href="/forgot-password">{t.toForgot}</TextLink>
      </AuthShell>
    )
  }
  if (done) {
    return (
      <AuthShell brand={t.brand} title={t.newPasswordTitle}>
        <FormMessage tone="info">{t.passwordUpdated}</FormMessage>
        <TextLink href="/account">{t.accountTitle}</TextLink>
      </AuthShell>
    )
  }
  return (
    <AuthShell brand={t.brand} title={t.newPasswordTitle} description={t.newPasswordSubtitle}>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <FormField
          label={t.newPassword}
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
        {formError ? <FormMessage tone="error">{t.errors[formError]}</FormMessage> : null}
        <Button type="submit" disabled={pending}>
          {pending ? t.loading : t.submitNewPassword}
        </Button>
      </form>
    </AuthShell>
  )
}
