"use client"

import type { CustomerProfileResponse } from "@chicman/shared"
import { useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { useSaveProfileLocale } from "@/features/profile/use-locale-sync"
import { apiRequest } from "@/lib/api-client"
import { useLocale } from "@/lib/locale-provider"

import { interpretSetupResult } from "../account-setup"
import { useAuth } from "../auth-provider"
import type { AuthErrorKey } from "../messages"
import { useAuthMessages } from "../use-auth-messages"
import { validatePhone, type FieldErrors } from "../validation"
import { FormField, FormMessage } from "./form-field"

/**
 * Account setup after email confirmation (spec 03/04): the required contact
 * phone, then bootstrap. One request in flight; the server is idempotent.
 */
export function AccountSetupForm({ onDone }: { onDone: (account: CustomerProfileResponse) => void }) {
  const t = useAuthMessages()
  const { getAccessToken, signOut } = useAuth()
  const locale = useLocale()
  const saveProfileLocale = useSaveProfileLocale()
  const [phone, setPhone] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<"phone">>({})
  const [formError, setFormError] = useState<AuthErrorKey | "authUnavailable" | "emailNotConfirmed" | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setFormError(null)
    const result = validatePhone(phone)
    if (!result.ok) {
      setFieldErrors(result.errors)
      return
    }
    setFieldErrors({})
    setPending(true)
    try {
      const token = await getAccessToken()
      if (!token) return void (await signOut())
      const outcome = interpretSetupResult(
        await apiRequest<CustomerProfileResponse>("/customers/me", token, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phone: result.value }),
        })
      )
      switch (outcome.state) {
        case "done":
          // A new account starts in the language its owner is using, not the default.
          if (outcome.account.profile.preferredLocale !== locale) await saveProfileLocale(locale)
          return onDone({ ...outcome.account, profile: { ...outcome.account.profile, preferredLocale: locale } })
        case "invalid-phone":
          return setFieldErrors({ phone: "invalidPhone" })
        case "email-not-confirmed":
          return setFormError("emailNotConfirmed")
        case "signed-out":
          return void (await signOut())
        case "unavailable":
          return setFormError("authUnavailable")
        case "rate-limited":
          return setFormError("rateLimited")
        case "error":
          return setFormError("generic")
      }
    } finally {
      setPending(false)
    }
  }

  const errorText =
    formError === null ? null : formError === "authUnavailable" ? t.authUnavailable : t.errors[formError]

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
      <p className="type-title-medium">{t.setupTitle}</p>
      <p className="type-body-medium text-muted-foreground">{t.setupSubtitle}</p>
      <FormField
        label={t.phone}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        dir="ltr"
        placeholder={t.phonePlaceholder}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        error={fieldErrors.phone && t.errors[fieldErrors.phone]}
      />
      <p className="type-body-small text-muted-foreground">{t.setupPhoneHint}</p>
      {errorText ? <FormMessage tone="error">{errorText}</FormMessage> : null}
      <Button type="submit" disabled={pending}>
        {pending ? t.loading : t.submitSetup}
      </Button>
    </form>
  )
}
