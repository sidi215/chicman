"use client"

import type { ProductVariantView, SellerProductDetail } from "@chicman/shared"
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react"
import { useCallback, useEffect, useId, useState, type FormEvent } from "react"

import { BrandLogo } from "@/components/brand/brand-logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FormField, FormMessage } from "@/features/auth/components/form-field"
import { TextLink } from "@/features/auth/components/text-link"
import { formatDateTime } from "@/features/shop/messages"
import { SectionCard } from "@/features/shop/components/shop-dashboard"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"
import { cn } from "@/lib/utils"

import { uploadProductImage } from "../image-upload"
import { useProductMessages, type ProductMessages } from "../messages"
import {
  buildProductUpdate,
  buildVariantCreate,
  buildVariantUpdate,
  mergeProductFormValues,
  moveImage,
  parseStockInput,
  productActions,
  productFormValues,
  type ProductFailure,
  type ProductFieldErrors,
  type ProductFormValues,
  type ProductOutcome,
} from "../product-form"
import { ProductFields, STATUS_VARIANT, useProductApi, type Notice } from "./product-shared"

type View = { state: "loading" } | { state: "ready"; product: SellerProductDetail } | { state: "failed"; failure: ProductFailure }
type Mutate = (path: string, method: string, body?: unknown) => Promise<ProductOutcome<SellerProductDetail>>

/** Failures after which the screen may be out of date. */
const RELOAD_AFTER: readonly ProductFailure[] = ["status-conflict", "archived", "stock-conflict", "stock-managed-by-variants", "last-image"]

/** Seller view of one product: details, editing, images, stock, variants, publication. */
export function ProductDetailScreen({ productId }: { productId: string }) {
  const t = useProductMessages()
  const { status, call, getAccessToken } = useProductApi()
  const [view, setView] = useState<View>({ state: "loading" })
  const path = `/sellers/me/products/${encodeURIComponent(productId)}`

  const load = useCallback(async () => {
    const outcome = await call<SellerProductDetail>(path)
    setView(outcome.state === "ok" ? { state: "ready", product: outcome.data } : { state: "failed", failure: outcome.state })
  }, [call, path])

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<SellerProductDetail>(path).then((outcome) => {
      if (cancelled) return
      setView(outcome.state === "ok" ? { state: "ready", product: outcome.data } : { state: "failed", failure: outcome.state })
    })
    return () => {
      cancelled = true
    }
  }, [status, call, path])

  const mutate: Mutate = useCallback(
    async (subPath, method, body) => {
      const outcome = await call<SellerProductDetail>(`${path}${subPath}`, method, body)
      if (outcome.state === "ok") setView({ state: "ready", product: outcome.data })
      else if (RELOAD_AFTER.includes(outcome.state)) await load()
      return outcome
    },
    [call, load, path]
  )

  return (
    <main className="flex flex-1 flex-col items-center gap-6 bg-page px-4 py-10">
      <BrandLogo label={t.brand} />
      {view.state === "loading" || status !== "signed-in" ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
      {view.state === "failed" ? (
        <Card className="w-full max-w-xl rounded-3xl p-6">
          <CardContent className="flex flex-col gap-4">
            <FormMessage tone="error">{t.failures[view.failure]}</FormMessage>
            {view.failure === "unavailable" || view.failure === "error" ? (
              <Button
                variant="outline"
                onClick={() => {
                  setView({ state: "loading" })
                  void load()
                }}
              >
                {t.retry}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {view.state === "ready" ? (
        <>
          <Summary t={t} product={view.product} mutate={mutate} />
          {view.product.status === "ARCHIVED" ? <ArchivedImages t={t} product={view.product} /> : (
            <>
              <EditForm t={t} product={view.product} mutate={mutate} />
              <ImagesSection
                t={t}
                product={view.product}
                mutate={mutate}
                upload={async (file) => {
                  const outcome = await uploadProductImage(productId, file, { getAccessToken })
                  if (outcome.state === "ok") setView({ state: "ready", product: outcome.product })
                  return outcome
                }}
              />
              {view.product.variantCount === 0 ? <ProductStockSection t={t} product={view.product} mutate={mutate} /> : null}
              <VariantsSection t={t} product={view.product} mutate={mutate} />
            </>
          )}
          {view.product.status === "ARCHIVED" && view.product.variants.length > 0 ? <ArchivedVariants t={t} variants={view.product.variants} /> : null}
        </>
      ) : null}
      <TextLink href="/seller/products">{t.backToList}</TextLink>
    </main>
  )
}

function Summary({ t, product, mutate }: { t: ProductMessages; product: SellerProductDetail; mutate: Mutate }) {
  const locale = useLocale()
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const actions = productActions(product)

  async function act(subPath: "/publish" | "/archive" | "/restore", success: string) {
    if (pending) return
    setPending(true)
    setNotice(null)
    const outcome = await mutate(subPath, "POST")
    setPending(false)
    setConfirming(false)
    setNotice(outcome.state === "ok" ? { tone: "info", text: success } : { tone: "error", text: t.failures[outcome.state] })
  }

  return (
    <SectionCard title={product.name} description={t.statusHelp[product.status]}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[product.status]}>{t.status[product.status]}</Badge>
        <Badge variant={product.available ? "outline" : "destructive"}>{product.available ? t.available : t.unavailable}</Badge>
        <Badge variant="outline">{t.categories[product.category]}</Badge>
      </div>
      <p className="type-title-medium">{formatMru(product.price, locale)}</p>
      {product.brand ? <p className="type-body-medium text-muted-foreground">{product.brand}</p> : null}
      <p className="type-body-medium whitespace-pre-line">{product.description}</p>
      <dl className="flex flex-col gap-1 type-body-small text-muted-foreground">
        <div className="flex flex-wrap gap-1">
          <dt>{t.stockLabel} :</dt>
          <dd>{product.stock}</dd>
          {product.variantCount > 0 ? <dd>· {t.variantCount.replace("{count}", String(product.variantCount))}</dd> : null}
        </div>
        <div className="flex flex-wrap gap-1">
          <dt>{t.createdOn}</dt>
          <dd>{formatDateTime(product.createdAt, locale)}</dd>
        </div>
        {actions.showPublishedAt && product.publishedAt ? (
          <div className="flex flex-wrap gap-1">
            <dt>{t.publishedOn}</dt>
            <dd>{formatDateTime(product.publishedAt, locale)}</dd>
          </div>
        ) : null}
        {product.archivedAt ? (
          <div className="flex flex-wrap gap-1">
            <dt>{t.archivedOn}</dt>
            <dd>{formatDateTime(product.archivedAt, locale)}</dd>
          </div>
        ) : null}
      </dl>
      {actions.needsImageToPublish ? <p className="type-body-medium text-warning-text">{t.publishHint}</p> : null}
      {actions.showZeroStockPublishNote ? <FormMessage tone="info">{t.publishZeroStockNote}</FormMessage> : null}
      {actions.showOutOfStockNote ? <p className="type-body-medium text-warning-text">{t.outOfStockNote}</p> : null}
      {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
      {actions.canRestore ? (
        <div className="flex flex-col gap-2">
          <p className="type-body-small text-muted-foreground">{t.restoreHint}</p>
          <Button className="self-start" disabled={pending} onClick={() => void act("/restore", t.restored)}>
            {t.restore}
          </Button>
        </div>
      ) : confirming ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-muted p-4">
          <p className="type-body-medium">{t.confirmArchive}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" disabled={pending} onClick={() => void act("/archive", t.archivedDone)}>
              {t.confirmArchiveAction}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
              {t.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {product.status === "DRAFT" ? (
            <Button disabled={pending || !actions.canPublish} onClick={() => void act("/publish", t.published)}>
              {t.publish}
            </Button>
          ) : null}
          <Button variant="outline" disabled={pending} onClick={() => setConfirming(true)}>
            {t.archive}
          </Button>
        </div>
      )}
    </SectionCard>
  )
}

function EditForm({ t, product, mutate }: { t: ProductMessages; product: SellerProductDetail; mutate: Mutate }) {
  const [values, setValues] = useState<ProductFormValues>(() => productFormValues(product))
  const [synced, setSynced] = useState(product)
  const [errors, setErrors] = useState<ProductFieldErrors>({})
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState(false)

  // A refreshed product updates untouched fields; unsaved edits stay.
  if (product !== synced) {
    setSynced(product)
    setValues((current) => mergeProductFormValues(current, productFormValues(synced), productFormValues(product)))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setNotice(null)
    const built = buildProductUpdate(values, product)
    if (!built.ok) {
      setErrors(built.errors)
      return
    }
    setErrors({})
    if (Object.keys(built.body).length === 0) {
      setNotice({ tone: "info", text: t.noChanges })
      return
    }
    setPending(true)
    const outcome = await mutate("", "PATCH", built.body)
    setPending(false)
    setNotice(outcome.state === "ok" ? { tone: "info", text: t.saved } : { tone: "error", text: t.failures[outcome.state] })
  }

  return (
    <SectionCard title={t.editTitle}>
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
        <ProductFields t={t} values={values} errors={errors} onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))} />
        {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
        <Button type="submit" disabled={pending}>
          {pending ? t.saving : t.save}
        </Button>
      </form>
    </SectionCard>
  )
}

type UploadResult = Awaited<ReturnType<typeof uploadProductImage>>

function uploadNotice(outcome: UploadResult, t: ProductMessages): string {
  switch (outcome.state) {
    case "rejected":
      return t.imageErrors[outcome.code]
    case "unsupported-type":
    case "too-large":
    case "expired":
    case "limit-reached":
      return t.imageErrors[outcome.state]
    case "ok":
      return t.imageSaved
    default:
      return t.failures[outcome.state]
  }
}

function ImagesSection({
  t,
  product,
  mutate,
  upload,
}: {
  t: ProductMessages
  product: SellerProductDetail
  mutate: Mutate
  upload: (file: File) => Promise<UploadResult>
}) {
  const inputId = useId()
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState(false)
  const ids = product.images.map((image) => image.id)

  async function onFiles(files: readonly File[]) {
    if (files.length === 0 || pending) return
    setPending(true)
    setNotice({ tone: "info", text: t.uploading })
    let result: Notice = null
    // One at a time; the first failure stops and names its reason.
    for (const file of files) {
      const outcome = await upload(file)
      result = { tone: outcome.state === "ok" ? "info" : "error", text: uploadNotice(outcome, t) }
      if (outcome.state !== "ok") break
    }
    setNotice(result)
    setPending(false)
  }

  async function change(run: () => Promise<ProductOutcome<SellerProductDetail>>, success: string | null) {
    if (pending) return
    setPending(true)
    setNotice(null)
    const outcome = await run()
    setPending(false)
    if (outcome.state !== "ok") setNotice({ tone: "error", text: t.failures[outcome.state] })
    else if (success !== null) setNotice({ tone: "info", text: success })
  }

  return (
    <SectionCard title={t.imagesTitle} description={t.imagesHint}>
      {product.images.length === 0 ? <p className="type-body-medium text-muted-foreground">{t.imagesEmpty}</p> : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {product.images.map((image, index) => {
          const earlier = moveImage(ids, image.id, -1)
          const later = moveImage(ids, image.id, 1)
          return (
            <li key={image.id} className="flex flex-col gap-2 rounded-2xl border border-border p-2">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- verified media URL, served as-is */}
                <img src={image.url} alt={t.imageAlt.replace("{position}", String(index + 1))} className="aspect-3/4 w-full rounded-xl object-cover" />
                {index === 0 ? <Badge className="absolute start-2 top-2">{t.mainImage}</Badge> : null}
              </div>
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.moveEarlier}
                  disabled={pending || earlier === null}
                  onClick={() => earlier && void change(() => mutate("/images/order", "PUT", { imageIds: earlier }), null)}
                >
                  <ChevronLeft aria-hidden className="rtl:rotate-180" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.removeImage}
                  disabled={pending}
                  onClick={() => void change(() => mutate(`/images/${image.id}`, "DELETE"), t.imageRemoved)}
                >
                  <Trash2 aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.moveLater}
                  disabled={pending || later === null}
                  onClick={() => later && void change(() => mutate("/images/order", "PUT", { imageIds: later }), null)}
                >
                  <ChevronRight aria-hidden className="rtl:rotate-180" />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      <div>
        <label
          htmlFor={inputId}
          className={cn(
            "inline-flex h-control cursor-pointer items-center rounded-full border border-border px-5 type-label-large hover:bg-muted",
            pending && "pointer-events-none opacity-50"
          )}
        >
          {t.addImages}
        </label>
        <input
          id={inputId}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={pending}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ""
            void onFiles(files)
          }}
        />
      </div>
      {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
    </SectionCard>
  )
}

/** One stock quantity. It is sent with the value on screen, so a stale screen cannot overwrite a newer one. */
function StockEditor({ t, stock, label, onSave }: { t: ProductMessages; stock: number; label: string; onSave: (body: { stock: number; expectedStock: number }) => Promise<ProductOutcome<SellerProductDetail>> }) {
  const [value, setValue] = useState(String(stock))
  const [synced, setSynced] = useState(stock)
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState(false)

  if (stock !== synced) {
    setSynced(stock)
    setValue(String(stock))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const next = parseStockInput(value)
    if (next === null) {
      setNotice({ tone: "error", text: t.stockInvalid })
      return
    }
    if (next === stock) {
      setNotice({ tone: "info", text: t.noChanges })
      return
    }
    setPending(true)
    setNotice(null)
    const outcome = await onSave({ stock: next, expectedStock: stock })
    setPending(false)
    setNotice(outcome.state === "ok" ? { tone: "info", text: t.stockSaved } : { tone: "error", text: t.failures[outcome.state] })
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={(event) => void submit(event)} noValidate>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <FormField label={label} value={value} inputMode="numeric" dir="ltr" onChange={(e) => setValue(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? t.saving : t.save}
        </Button>
      </div>
      {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
    </form>
  )
}

function ProductStockSection({ t, product, mutate }: { t: ProductMessages; product: SellerProductDetail; mutate: Mutate }) {
  return (
    <SectionCard title={t.stockTitle} description={t.stockHint}>
      <StockEditor t={t} stock={product.stock} label={t.stockQuantity} onSave={(body) => mutate("/stock", "PUT", body)} />
    </SectionCard>
  )
}

function VariantRow({ t, variant, mutate, onRemoved }: { t: ProductMessages; variant: ProductVariantView; mutate: Mutate; onRemoved: () => void }) {
  const [size, setSize] = useState(variant.size ?? "")
  const [color, setColor] = useState(variant.color ?? "")
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const built = buildVariantUpdate({ size, color }, variant)
    if (!built.ok) {
      setNotice({ tone: "error", text: t.variantErrors[built.errors] })
      return
    }
    if (Object.keys(built.body).length === 0) {
      setNotice({ tone: "info", text: t.noChanges })
      return
    }
    setPending(true)
    setNotice(null)
    const outcome = await mutate(`/variants/${variant.id}`, "PATCH", built.body)
    setPending(false)
    setNotice(outcome.state === "ok" ? { tone: "info", text: t.variantSaved } : { tone: "error", text: t.failures[outcome.state] })
  }

  async function remove() {
    if (pending) return
    setPending(true)
    setNotice(null)
    const outcome = await mutate(`/variants/${variant.id}`, "DELETE")
    if (outcome.state === "ok") {
      onRemoved()
      return
    }
    setPending(false)
    setConfirming(false)
    setNotice({ tone: "error", text: t.failures[outcome.state] })
  }

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      {variant.available ? null : <Badge variant="destructive">{t.unavailable}</Badge>}
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t.size} value={size} placeholder={t.sizePlaceholder} onChange={(e) => setSize(e.target.value)} />
          <FormField label={t.color} value={color} placeholder={t.colorPlaceholder} onChange={(e) => setColor(e.target.value)} />
        </div>
        {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {t.save}
          </Button>
          {confirming ? (
            <>
              <span className="self-center type-body-small">{t.confirmRemoveVariant}</span>
              <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => void remove()}>
                {t.confirmRemove}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
                {t.cancel}
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(true)}>
              {t.removeVariant}
            </Button>
          )}
        </div>
      </form>
      <StockEditor t={t} stock={variant.stock} label={t.stockQuantity} onSave={(body) => mutate(`/variants/${variant.id}/stock`, "PUT", body)} />
    </li>
  )
}

function VariantsSection({ t, product, mutate }: { t: ProductMessages; product: SellerProductDetail; mutate: Mutate }) {
  const [size, setSize] = useState("")
  const [color, setColor] = useState("")
  const [stock, setStock] = useState("0")
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, setPending] = useState(false)

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const built = buildVariantCreate({ size, color }, stock)
    if (!built.ok) {
      setNotice({ tone: "error", text: t.variantErrors[built.errors] })
      return
    }
    setPending(true)
    setNotice(null)
    const outcome = await mutate("/variants", "POST", built.body)
    setPending(false)
    if (outcome.state === "ok") {
      setSize("")
      setColor("")
      setStock("0")
      setNotice({ tone: "info", text: t.variantAdded })
    } else {
      setNotice({ tone: "error", text: t.failures[outcome.state] })
    }
  }

  return (
    <SectionCard title={t.variantsTitle} description={product.variantCount > 0 ? t.stockVariantsHint : t.variantsHint}>
      {product.variants.length === 0 ? <p className="type-body-medium text-muted-foreground">{t.variantsEmpty}</p> : null}
      <ul className="flex flex-col gap-3">
        {product.variants.map((variant) => (
          <VariantRow key={variant.id} t={t} variant={variant} mutate={mutate} onRemoved={() => setNotice({ tone: "info", text: t.variantRemoved })} />
        ))}
      </ul>
      <form className="flex flex-col gap-3" onSubmit={(event) => void add(event)} noValidate>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t.size} value={size} placeholder={t.sizePlaceholder} onChange={(e) => setSize(e.target.value)} />
          <FormField label={t.color} value={color} placeholder={t.colorPlaceholder} onChange={(e) => setColor(e.target.value)} />
          <FormField label={t.stockQuantity} value={stock} inputMode="numeric" dir="ltr" onChange={(e) => setStock(e.target.value)} />
        </div>
        {product.variantCount === 0 && product.stock > 0 ? <p className="type-body-small text-warning-text">{t.variantsFirstHint}</p> : null}
        {notice ? <FormMessage tone={notice.tone}>{notice.text}</FormMessage> : null}
        <Button type="submit" variant="secondary" disabled={pending}>
          {t.addVariant}
        </Button>
      </form>
    </SectionCard>
  )
}

/** Read-only images of an archived product. */
function ArchivedImages({ t, product }: { t: ProductMessages; product: SellerProductDetail }) {
  if (product.images.length === 0) return null
  return (
    <SectionCard title={t.imagesTitle}>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {product.images.map((image, index) => (
          <li key={image.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- verified media URL, served as-is */}
            <img src={image.url} alt={t.imageAlt.replace("{position}", String(index + 1))} className="aspect-3/4 w-full rounded-xl object-cover" />
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

/** Read-only variants of an archived product. */
function ArchivedVariants({ t, variants }: { t: ProductMessages; variants: readonly ProductVariantView[] }) {
  return (
    <SectionCard title={t.variantsTitle}>
      <ul className="flex flex-col gap-2 type-body-medium">
        {variants.map((variant) => (
          <li key={variant.id} className="flex flex-wrap justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2">
              {[variant.size, variant.color].filter((value) => value !== null).join(" · ")}
              {variant.available ? null : <Badge variant="destructive">{t.unavailable}</Badge>}
            </span>
            <span className="text-muted-foreground">
              {t.stockLabel} : {variant.stock}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}
