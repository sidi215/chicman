"use client"

import { Toggle } from "@base-ui/react/toggle"
import { ToggleGroup } from "@base-ui/react/toggle-group"
import { LOCALES, type CustomerProfile, type CustomerProfileResponse, type Locale } from "@chicman/shared"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState, type FormEvent } from "react"

import { BrandLogo } from "@/components/brand/brand-logo"
import { ThemeSelector } from "@/components/theme/theme-selector"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/features/auth/auth-provider"
import { FormField, FormMessage } from "@/features/auth/components/form-field"
import { TextLink } from "@/features/auth/components/text-link"
import { apiRequest } from "@/lib/api-client"

import { useProfileMessages, type ProfileMessages } from "../messages"
import {
  buildProfileUpdate,
  hasChanges,
  interpretProfileResult,
  profileFormValues,
  type ProfileFieldErrors,
  type ProfileFormValues,
  type ProfileOutcome,
} from "../profile-form"

type Notice = { tone: "info" | "error"; text: string } | null
type LoadState = "loading" | "ready" | "unavailable" | "error"

/**
 * Customer profile settings (spec 04): `fullName`, `preferredLocale`, and the
 * unverified contact `phone` through `PATCH /customers/me`, plus the
 * device-local theme selector (never sent to the API).
 */
export function ProfileSettings() {
  const t = useProfileMessages()
  const router = useRouter()
  const { status, getAccessToken, signOut } = useAuth()
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [profile, setProfile] = useState<CustomerProfile | null>(null)
  const [values, setValues] = useState<ProfileFormValues | null>(null)
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({})
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (status === "signed-out" || status === "not-configured") router.replace("/login")
  }, [status, router])

  const fetchProfile = useCallback(async (): Promise<ProfileOutcome> => {
    const token = await getAccessToken()
    if (!token) return { state: "signed-out" }
    return interpretProfileResult(await apiRequest<CustomerProfileResponse>("/customers/me", token))
  }, [getAccessToken])

  const applyLoad = useCallback(
    (outcome: ProfileOutcome) => {
      switch (outcome.state) {
        case "ok":
          setProfile(outcome.account.profile)
          setValues(profileFormValues(outcome.account.profile))
          return setLoadState("ready")
        case "not-bootstrapped":
          // Account setup (phone) happens on the account screen first.
          return router.replace("/account")
        case "signed-out":
          return void signOut()
        case "unavailable":
          return setLoadState("unavailable")
        default:
          return setLoadState("error")
      }
    },
    [signOut, router]
  )

  const load = useCallback(() => fetchProfile().then(applyLoad), [fetchProfile, applyLoad])

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void fetchProfile().then((outcome) => {
      if (!cancelled) applyLoad(outcome)
    })
    return () => {
      cancelled = true
    }
  }, [status, fetchProfile, applyLoad])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !profile || !values) return
    setNotice(null)
    const result = buildProfileUpdate(values, profile)
    if (!result.ok) return setFieldErrors(result.errors)
    setFieldErrors({})
    if (!hasChanges(result.changes)) return setNotice({ tone: "info", text: t.noChanges })
    setPending(true)
    try {
      const token = await getAccessToken()
      if (!token) return void (await signOut())
      const outcome = interpretProfileResult(
        await apiRequest<CustomerProfileResponse>("/customers/me", token, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(result.changes),
        })
      )
      switch (outcome.state) {
        case "ok":
          setProfile(outcome.account.profile)
          setValues(profileFormValues(outcome.account.profile))
          return setNotice({ tone: "info", text: t.saved })
        case "invalid-phone":
          return setFieldErrors({ phone: "invalidPhone" })
        case "invalid":
          return setNotice({ tone: "error", text: t.invalid })
        case "not-bootstrapped":
          return router.replace("/account")
        case "signed-out":
          return void (await signOut())
        case "unavailable":
          return setNotice({ tone: "error", text: t.unavailable })
        case "rate-limited":
          return setNotice({ tone: "error", text: t.rateLimited })
        case "error":
          return setNotice({ tone: "error", text: t.generic })
      }
    } finally {
      setPending(false)
    }
  }

  const update = (patch: Partial<ProfileFormValues>) => setValues((current) => (current ? { ...current, ...patch } : current))

  return (
    <main className="flex flex-1 flex-col items-center gap-6 bg-page px-4 py-10">
      <BrandLogo label={t.brand} />
      <Card className="w-full max-w-md rounded-3xl p-6">
        <CardHeader>
          <CardTitle className="type-headline-small">{t.title}</CardTitle>
          <CardDescription>{t.subtitle}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {status !== "signed-in" || loadState === "loading" ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
          {status === "signed-in" && (loadState === "unavailable" || loadState === "error") ? (
            <>
              <FormMessage tone="error">{loadState === "unavailable" ? t.unavailable : t.generic}</FormMessage>
              <Button
                variant="outline"
                onClick={() => {
                  setLoadState("loading")
                  void load()
                }}
              >
                {t.retry}
              </Button>
            </>
          ) : null}
          {loadState === "ready" && values ? (
            <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-label={t.personalSection}>
              <p className="type-title-medium">{t.personalSection}</p>
              <FormField
                label={t.fullName}
                autoComplete="name"
                maxLength={200}
                placeholder={t.fullNamePlaceholder}
                value={values.fullName}
                onChange={(e) => update({ fullName: e.target.value })}
                error={fieldErrors.fullName && t.errors[fieldErrors.fullName]}
              />
              <LocaleChoice t={t} value={values.preferredLocale} onChange={(preferredLocale) => update({ preferredLocale })} />
              <FormField
                label={t.phone}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                placeholder={t.phonePlaceholder}
                value={values.phone}
                onChange={(e) => update({ phone: e.target.value })}
                error={fieldErrors.phone && t.errors[fieldErrors.phone]}
              />
              <p className="type-body-small text-muted-foreground">{t.phoneHint}</p>
              {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
              <Button type="submit" disabled={pending}>
                {pending ? t.saving : t.save}
              </Button>
            </form>
          ) : null}
          <section className="flex flex-col gap-2 border-t border-border pt-4" aria-labelledby="appearance-title">
            <p id="appearance-title" className="type-title-medium">
              {t.appearanceSection}
            </p>
            <ThemeSelector className="self-start" />
            <p className="type-body-small text-muted-foreground">{t.appearanceHint}</p>
          </section>
          <TextLink href="/account">{t.backToAccount}</TextLink>
        </CardContent>
      </Card>
    </main>
  )
}

/** Segmented French / Arabic choice for `preferredLocale`. */
function LocaleChoice({ t, value, onChange }: { t: ProfileMessages; value: Locale; onChange: (locale: Locale) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id="preferred-locale-label" className="type-label-large">
        {t.preferredLocale}
      </span>
      <ToggleGroup
        aria-labelledby="preferred-locale-label"
        value={[value]}
        onValueChange={(next) => {
          const locale = LOCALES.find((candidate) => candidate === next[0])
          if (locale) onChange(locale)
        }}
        className="inline-flex h-control-sm items-center gap-1 self-start rounded-full bg-muted p-1"
      >
        {LOCALES.map((locale) => (
          <Toggle
            key={locale}
            value={locale}
            lang={locale}
            className="inline-flex h-full items-center rounded-full px-4 type-label-medium text-muted-foreground transition-colors outline-none select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-pressed:bg-surface data-pressed:text-foreground data-pressed:shadow-sm"
          >
            {t.locales[locale]}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  )
}
