"use client"

import type { AccountProfileResponse, RegistrableAccountType, RegistrationIntentResponse } from "@chicman/shared"
import { useRouter } from "next/navigation"
import { useEffect, useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { useSaveProfileLocale } from "@/features/profile/use-locale-sync"
import { ShopFields } from "@/features/shop/components/shop-dashboard"
import { useShopMessages } from "@/features/shop/messages"
import { buildShopCreate, emptyShopForm, type ShopFieldErrors, type ShopFormValues } from "@/features/shop/shop-form"
import { apiRequest } from "@/lib/api-client"
import { useLocale } from "@/lib/locale-provider"

import { ACCOUNT_SETUP_PATH, afterSetupHref, interpretSetupResult, OWN_INTENT_PATH, recordRegistrationIntent } from "../account"
import { useAccountMessages, type AccountMessages } from "../account-messages"
import { useAccount } from "../account-provider"
import { useAuth } from "../auth-provider"
import { useAuthMessages } from "../use-auth-messages"
import { validatePhone, type FieldErrors } from "../validation"
import { AuthShell } from "./auth-shell"
import { FormField, FormMessage } from "./form-field"

type Intent = { state: "loading" } | { state: "known"; type: RegistrableAccountType } | { state: "none" } | { state: "failed" }

/**
 * `/account/setup` (AT-1, section 5): after email confirmation, the account of
 * the type the person chose at registration. The type comes from the
 * server-side registration intent; without one, the person chooses here and
 * the choice is recorded the same way. A buyer gives the phone; a seller the
 * phone and the shop application (spec 06), created with the account.
 */
export function AccountSetup() {
  const t = useAccountMessages()
  const { session, getAccessToken, signOut } = useAuth()
  const [intent, setIntent] = useState<Intent>({ state: "loading" })
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const token = await getAccessToken()
      if (token === null) return void (await signOut())
      const result = await apiRequest<RegistrationIntentResponse>(OWN_INTENT_PATH, token)
      if (cancelled) return
      if (result.kind === "ok") setIntent(result.data.accountType === null ? { state: "none" } : { state: "known", type: result.data.accountType })
      else if (result.kind === "unauthorized") void signOut()
      else setIntent({ state: "failed" })
    })()
    return () => {
      cancelled = true
    }
  }, [getAccessToken, signOut, reloads])

  async function choose(type: RegistrableAccountType) {
    const userId = session?.user.id
    if (userId === undefined) return
    setIntent({ state: "loading" })
    const outcome = await recordRegistrationIntent(userId, type)
    // A conflict means another choice was recorded first (another tab): read it back.
    if (outcome === "recorded") setIntent({ state: "known", type })
    else setReloads((count) => count + 1)
  }

  if (intent.state === "loading") {
    return (
      <AuthShell brand={t.brand} title={t.loading}>
        <FormMessage tone="info">{t.loading}</FormMessage>
      </AuthShell>
    )
  }
  if (intent.state === "failed") {
    return (
      <AuthShell brand={t.brand} title={t.unavailable}>
        <Button variant="outline" onClick={() => setReloads((count) => count + 1)}>
          {t.retry}
        </Button>
      </AuthShell>
    )
  }
  if (intent.state === "none") {
    return (
      <AuthShell brand={t.brand} title={t.chooseTitle} description={t.chooseBody}>
        <div className="flex flex-col gap-3">
          {(["BUYER", "SELLER"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => void choose(type)}
              className="flex flex-col items-start gap-1 rounded-2xl border border-border bg-surface p-4 text-start outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="type-title-small">{type === "BUYER" ? t.chooseBuyer : t.chooseSeller}</span>
              <span className="type-body-small text-muted-foreground">{type === "BUYER" ? t.chooseBuyerHint : t.chooseSellerHint}</span>
            </button>
          ))}
        </div>
      </AuthShell>
    )
  }
  return <SetupForm type={intent.type} t={t} onIntentMissing={() => setReloads((count) => count + 1)} />
}

type FormError = "invalid" | "typeConflict" | "shopExists" | "unavailable" | "generic" | "emailNotConfirmed" | "rateLimited" | null

function SetupForm({ type, t, onIntentMissing }: { type: RegistrableAccountType; t: AccountMessages; onIntentMissing: () => void }) {
  const authT = useAuthMessages()
  const shopT = useShopMessages()
  const router = useRouter()
  const locale = useLocale()
  const saveProfileLocale = useSaveProfileLocale()
  const { getAccessToken, signOut } = useAuth()
  const { refresh } = useAccount()
  const [phone, setPhone] = useState("")
  const [phoneError, setPhoneError] = useState<FieldErrors<"phone">>({})
  const [shop, setShop] = useState<ShopFormValues>(emptyShopForm)
  const [shopErrors, setShopErrors] = useState<ShopFieldErrors>({})
  const [formError, setFormError] = useState<FormError>(null)
  const [pending, setPending] = useState(false)
  const seller = type === "SELLER"

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setFormError(null)
    const phoneResult = validatePhone(phone)
    const shopResult = seller ? buildShopCreate(shop) : null
    setPhoneError(phoneResult.ok ? {} : phoneResult.errors)
    setShopErrors(shopResult !== null && !shopResult.ok ? shopResult.errors : {})
    if (!phoneResult.ok || (shopResult !== null && !shopResult.ok)) return
    const body = shopResult === null ? { phone: phoneResult.value } : { phone: phoneResult.value, shop: shopResult.body }
    setPending(true)
    try {
      const token = await getAccessToken()
      if (!token) return void (await signOut())
      const outcome = interpretSetupResult(
        await apiRequest<AccountProfileResponse>(ACCOUNT_SETUP_PATH, token, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      )
      switch (outcome.state) {
        case "done": {
          // A new account starts in the language its owner is using, not the default.
          if (outcome.account.profile.preferredLocale !== locale) await saveProfileLocale(locale)
          await refresh()
          return router.replace(afterSetupHref(outcome.account.accountType))
        }
        case "invalid-phone":
          return setPhoneError({ phone: "invalidPhone" })
        case "invalid":
          return setFormError("invalid")
        case "intent-required":
          return onIntentMissing()
        case "type-conflict":
          return setFormError("typeConflict")
        case "shop-exists":
          return setFormError("shopExists")
        case "email-not-confirmed":
          return setFormError("emailNotConfirmed")
        case "signed-out":
          return void (await signOut())
        case "unavailable":
          return setFormError("unavailable")
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
    formError === null
      ? null
      : formError === "emailNotConfirmed" || formError === "rateLimited"
        ? authT.errors[formError]
        : formError === "unavailable"
          ? t.unavailable
          : t[formError]

  return (
    <AuthShell
      brand={t.brand}
      title={seller ? t.sellerSetupTitle : t.buyerSetupTitle}
      description={seller ? t.sellerSetupSubtitle : t.buyerSetupSubtitle}
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <FormField
          label={authT.phone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          placeholder={authT.phonePlaceholder}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={phoneError.phone && authT.errors[phoneError.phone]}
        />
        <p className="type-body-small text-muted-foreground">{seller ? t.personalPhoneHint : authT.setupPhoneHint}</p>
        {seller ? (
          <fieldset className="flex flex-col gap-4">
            <legend className="type-title-medium mb-2">{t.shopSection}</legend>
            <ShopFields
              t={shopT}
              fields={["shopName", "description", "contactPhone", "whatsappPhone", "city", "address"]}
              values={shop}
              errors={shopErrors}
              onChange={(patch) => setShop((current) => ({ ...current, ...patch }))}
            />
          </fieldset>
        ) : null}
        {errorText ? <FormMessage tone="error">{errorText}</FormMessage> : null}
        <Button type="submit" disabled={pending}>
          {pending ? t.submitting : t.submitSetup}
        </Button>
      </form>
    </AuthShell>
  )
}
