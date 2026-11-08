import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { isLocale, isStorefrontPath, localeCookie, localizedPath, routeLocale, switchedHref, withoutLocale } from "./locale"

describe("locale routing", () => {
  it("serves French storefront URLs without a prefix, for a visitor with no cookie", () => {
    assert.deepEqual(routeLocale("/", undefined), { kind: "rewrite", pathname: "/fr" })
    assert.deepEqual(routeLocale("/products/abc", undefined), { kind: "rewrite", pathname: "/fr/products/abc" })
  })

  it("serves Arabic storefront URLs whatever the cookie says, so crawlers can index them", () => {
    assert.deepEqual(routeLocale("/ar", undefined), { kind: "next" })
    assert.deepEqual(routeLocale("/ar/products/abc", undefined), { kind: "next" })
    assert.deepEqual(routeLocale("/ar/products", "fr"), { kind: "next" })
  })

  it("leads a saved choice of Arabic to the Arabic storefront URL", () => {
    assert.deepEqual(routeLocale("/products/abc", "ar"), { kind: "redirect", pathname: "/ar/products/abc", permanent: false })
    assert.deepEqual(routeLocale("/", "ar"), { kind: "redirect", pathname: "/ar", permanent: false })
  })

  it("keeps one URL for other pages, in the language of the cookie", () => {
    assert.deepEqual(routeLocale("/login", undefined), { kind: "rewrite", pathname: "/fr/login" })
    assert.deepEqual(routeLocale("/login", "ar"), { kind: "rewrite", pathname: "/ar/login" })
    assert.deepEqual(routeLocale("/auth/callback", "ar"), { kind: "rewrite", pathname: "/ar/auth/callback" })
    assert.deepEqual(routeLocale("/seller/products", "ar"), { kind: "rewrite", pathname: "/ar/seller/products" })
  })

  it("never serves a private page under a prefix, where its security headers would not apply", () => {
    assert.deepEqual(routeLocale("/ar/auth/callback", undefined), { kind: "redirect", pathname: "/auth/callback", permanent: false, cookie: "ar" })
    assert.deepEqual(routeLocale("/fr/auth/callback", undefined), { kind: "redirect", pathname: "/auth/callback", permanent: true })
  })

  it("gives French storefront pages one address", () => {
    assert.deepEqual(routeLocale("/fr/products", undefined), { kind: "redirect", pathname: "/products", permanent: true })
    assert.deepEqual(routeLocale("/fr", undefined), { kind: "redirect", pathname: "/", permanent: true })
  })

  it("ignores an unknown cookie or prefix", () => {
    assert.deepEqual(routeLocale("/products", "de"), { kind: "rewrite", pathname: "/fr/products" })
    assert.deepEqual(routeLocale("/products", "constructor"), { kind: "rewrite", pathname: "/fr/products" })
    assert.deepEqual(routeLocale("/de/products", undefined), { kind: "rewrite", pathname: "/fr/de/products" })
    assert.equal(isLocale("__proto__"), false)
  })

  it("does not treat similar paths as locales or storefront pages", () => {
    assert.deepEqual(routeLocale("/article", undefined), { kind: "rewrite", pathname: "/fr/article" })
    assert.equal(isStorefrontPath("/seller/products"), false)
    assert.equal(isStorefrontPath("/productsfoo"), false)
    assert.equal(withoutLocale("/ar/products"), "/products")
    assert.equal(withoutLocale("/ar"), "/")
    assert.equal(withoutLocale("/article"), "/article")
  })

  it("builds links in the page's language", () => {
    assert.equal(localizedPath("fr", "/products?page=2"), "/products?page=2")
    assert.equal(localizedPath("ar", "/products?page=2"), "/ar/products?page=2")
    assert.equal(localizedPath("ar", "/"), "/ar")
  })

  it("keeps the same page and query when switching language", () => {
    assert.equal(switchedHref("/products", "?category=SHOES", "ar"), "/ar/products?category=SHOES")
    assert.equal(switchedHref("/ar/products/abc", "", "fr"), "/products/abc")
    assert.equal(switchedHref("/ar", "", "fr"), "/")
    assert.equal(switchedHref("/", "", "ar"), "/ar")
    assert.equal(switchedHref("/login", "", "ar"), "/login")
    // The value next renders from on the server for a rewritten page.
    assert.equal(switchedHref("/fr/login", "", "ar"), "/login")
    assert.equal(switchedHref("/fr/products", "", "ar"), "/ar/products")
  })

  it("marks the cookie secure only on HTTPS", () => {
    assert.match(localeCookie("ar", false), /^chicman_locale=ar; Path=\/; Max-Age=\d+; SameSite=Lax$/)
    assert.match(localeCookie("ar", true), /; Secure$/)
  })
})
