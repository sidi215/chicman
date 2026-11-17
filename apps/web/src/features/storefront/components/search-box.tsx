"use client"

import { CATALOG_SEARCH_MAX_LENGTH, normalizeSearchText } from "@chicman/shared"
import { LoaderCircle, Search, X } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useId, useState, useTransition, type FormEvent } from "react"

import { Input } from "@/components/ui/input"
import { localizedPath, withoutLocale } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"

import { changeSearch, filtersFromParams, listingHref, NO_FILTERS, SEARCH_DEBOUNCE_MS } from "../catalog-query"
import { useStorefrontMessages } from "../messages"

/**
 * Product search (spec 18). On the listing, typing updates the results after
 * a short pause and keeps the current filters; elsewhere, submitting opens the
 * listing with the search. The URL stays the single state, so the back
 * button and shared links work. Reads the URL: render inside a Suspense
 * boundary.
 */
export function SearchBox() {
  const t = useStorefrontMessages()
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const inputId = useId()
  const [pending, startTransition] = useTransition()

  const onListing = withoutLocale(pathname) === "/products"
  const current = onListing ? filtersFromParams(params) : NO_FILTERS
  const currentHref = listingHref(current)
  const [text, setText] = useState(current.search ?? "")

  // Follow the URL when it changes from outside the box (back button, a
  // "clear search" link), but not while it only catches up with the typing.
  const [seen, setSeen] = useState(current.search)
  if (seen !== current.search) {
    setSeen(current.search)
    if (normalizeSearchText(text) !== (current.search ?? "")) setText(current.search ?? "")
  }

  const go = (href: string, replace: boolean) =>
    startTransition(() => {
      const target = localizedPath(locale, href)
      if (replace) router.replace(target, { scroll: false })
      else router.push(target)
    })

  useEffect(() => {
    if (!onListing) return
    const next = changeSearch(current, text)
    if (next === null || listingHref(next) === currentHref) return
    // Each keystroke replaces the pending update, so only the pause sends one.
    const timer = setTimeout(() => go(listingHref(next), true), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `current` is described by `currentHref`; `go` uses only stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, onListing, currentHref])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = changeSearch(current, text)
    if (next === null) return
    go(listingHref(next), onListing)
  }

  function clear() {
    setText("")
    if (onListing && current.search !== null) {
      const next = changeSearch(current, "")
      if (next !== null) go(listingHref(next), true)
    }
  }

  return (
    <form role="search" onSubmit={submit} className="relative w-full sm:max-w-md" aria-busy={pending}>
      <label htmlFor={inputId} className="sr-only">
        {t.searchLabel}
      </label>
      <span className="pointer-events-none absolute inset-y-0 start-4 flex items-center text-muted-foreground">
        {pending ? <LoaderCircle aria-hidden className="size-icon-inline animate-spin" /> : <Search aria-hidden className="size-icon-inline" />}
      </span>
      <Input
        id={inputId}
        type="search"
        dir="auto"
        enterKeyHint="search"
        autoComplete="off"
        maxLength={CATALOG_SEARCH_MAX_LENGTH}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t.searchPlaceholder}
        className="h-control-sm ps-11 pe-11 [&::-webkit-search-cancel-button]:hidden"
      />
      {text !== "" ? (
        <button
          type="button"
          onClick={clear}
          aria-label={t.searchClear}
          className="absolute inset-y-0 end-2 my-auto flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X aria-hidden className="size-icon-inline" />
        </button>
      ) : null}
    </form>
  )
}
