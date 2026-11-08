"use client"

import type { ProductStatus } from "@chicman/shared"
import { PRODUCT_CATEGORIES } from "@chicman/shared"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, type ComponentProps } from "react"

import { Badge } from "@/components/ui/badge"
import { Chip } from "@/components/ui/chip"
import { useAuth } from "@/features/auth/auth-provider"
import { FormField } from "@/features/auth/components/form-field"
import { TextAreaField } from "@/features/shop/components/shop-dashboard"
import { apiRequest } from "@/lib/api-client"

import type { ProductMessages } from "../messages"
import { interpretProductResult, type ProductFieldErrors, type ProductFormField, type ProductFormValues, type ProductOutcome } from "../product-form"

export type Notice = { tone: "info" | "error"; text: string } | null

export const STATUS_VARIANT: Record<ProductStatus, ComponentProps<typeof Badge>["variant"]> = {
  DRAFT: "warning",
  PUBLISHED: "success",
  ARCHIVED: "secondary",
}

/** Authenticated calls to the product API; a session the API refuses ends here. */
export function useProductApi() {
  const router = useRouter()
  const { status, getAccessToken, signOut } = useAuth()

  useEffect(() => {
    if (status === "signed-out" || status === "not-configured") router.replace("/login")
  }, [status, router])

  const call = useCallback(
    async <T,>(path: string, method = "GET", body?: unknown): Promise<ProductOutcome<T>> => {
      const token = await getAccessToken()
      if (!token) return { state: "signed-out" }
      const outcome = interpretProductResult(
        await apiRequest<T>(path, token, {
          method,
          ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        })
      )
      if (outcome.state === "signed-out") void signOut()
      return outcome
    },
    [getAccessToken, signOut]
  )

  return { status, call, getAccessToken }
}

/** The product form fields, shared by creation and editing. */
export function ProductFields({
  t,
  values,
  errors,
  onChange,
}: {
  t: ProductMessages
  values: ProductFormValues
  errors: ProductFieldErrors
  onChange: (field: ProductFormField, value: string) => void
}) {
  const errorText = (field: ProductFormField) => (errors[field] ? t.fieldErrors[errors[field]] : undefined)
  return (
    <>
      <FormField label={t.fields.name} value={values.name} error={errorText("name")} onChange={(e) => onChange("name", e.target.value)} required />
      <TextAreaField
        label={t.fields.description}
        value={values.description}
        error={errorText("description")}
        onChange={(e) => onChange("description", e.target.value)}
        required
      />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 type-label-large">{t.fields.category}</legend>
        <div className="flex flex-wrap gap-2">
          {PRODUCT_CATEGORIES.map((category) => (
            <Chip key={category} pressed={values.category === category} onPressedChange={() => onChange("category", category)}>
              {t.categories[category]}
            </Chip>
          ))}
        </div>
        {errors.category ? <p className="type-body-small text-error-text">{t.fieldErrors[errors.category]}</p> : null}
      </fieldset>
      <FormField label={t.fields.brand} value={values.brand} error={errorText("brand")} onChange={(e) => onChange("brand", e.target.value)} />
      <FormField
        label={t.fields.price}
        value={values.price}
        error={errorText("price")}
        inputMode="decimal"
        dir="ltr"
        placeholder={t.pricePlaceholder}
        onChange={(e) => onChange("price", e.target.value)}
        required
      />
    </>
  )
}
