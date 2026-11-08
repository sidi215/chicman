"use client"

import type { SellerProductDetail } from "@chicman/shared"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"

import { BrandLogo } from "@/components/brand/brand-logo"
import { Button } from "@/components/ui/button"
import { FormField, FormMessage } from "@/features/auth/components/form-field"
import { TextLink } from "@/features/auth/components/text-link"
import { SectionCard } from "@/features/shop/components/shop-dashboard"

import { useProductMessages } from "../messages"
import { buildProductCreate, emptyProductForm, type ProductFieldErrors, type ProductFormValues } from "../product-form"
import { ProductFields, useProductApi, type Notice } from "./product-shared"

/** Creates a draft, then continues on its page (images, variants, publication). */
export function ProductCreate() {
  const t = useProductMessages()
  const router = useRouter()
  const { call } = useProductApi()
  const [values, setValues] = useState<ProductFormValues>(emptyProductForm)
  const [stock, setStock] = useState("0")
  const [errors, setErrors] = useState<ProductFieldErrors & { stock?: "invalid" }>({})
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setNotice(null)
    const built = buildProductCreate(values, stock)
    if (!built.ok) {
      setErrors(built.errors)
      return
    }
    setErrors({})
    setPending(true)
    const outcome = await call<SellerProductDetail>("/sellers/me/products", "POST", built.body)
    setPending(false)
    if (outcome.state === "ok") {
      // Next keeps this page's state for back navigation: the next visit starts empty.
      setValues(emptyProductForm())
      setStock("0")
      router.push(`/seller/products/${outcome.data.id}`)
      return
    }
    setNotice({ tone: "error", text: t.failures[outcome.state] })
  }

  return (
    <main className="flex flex-1 flex-col items-center gap-6 bg-page px-4 py-10">
      <BrandLogo label={t.brand} />
      <SectionCard title={t.newTitle} description={t.newSubtitle}>
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
          <ProductFields t={t} values={values} errors={errors} onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))} />
          <FormField
            label={t.initialStock}
            value={stock}
            error={errors.stock ? t.stockInvalid : undefined}
            inputMode="numeric"
            dir="ltr"
            onChange={(e) => setStock(e.target.value)}
          />
          {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
          <Button type="submit" disabled={pending}>
            {pending ? t.creating : t.create}
          </Button>
        </form>
      </SectionCard>
      <TextLink href="/seller/products">{t.backToList}</TextLink>
    </main>
  )
}
