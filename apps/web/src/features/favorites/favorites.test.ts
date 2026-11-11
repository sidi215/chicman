import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { FavoriteItem, FavoriteList } from "@chicman/shared"

import {
  addFavoriteRequest,
  canOpenFavorite,
  createRequestQueue,
  favoriteIds,
  favoritesBadge,
  interpretFavoriteResult,
  removeFavoriteRequest,
  type FavoriteFailure,
} from "./favorites-logic"
import { FAVORITE_MESSAGES } from "./messages"

const item = (overrides: Partial<FavoriteItem> = {}): FavoriteItem => ({
  productId: "p1",
  addedAt: "2026-11-10T10:00:00.000Z",
  name: "Melhfa",
  imageUrl: "https://media.test/p1.png",
  state: "AVAILABLE",
  product: {
    id: "p1",
    name: "Melhfa",
    category: "CLOTHING",
    brand: null,
    price: "1500.00",
    available: true,
    mainImageUrl: "https://media.test/p1.png",
    shop: { id: "s1", name: "Boutique" },
  },
  ...overrides,
})

describe("favorite requests", () => {
  it("puts the product in the path and sends no body, so no owner or price can be sent", () => {
    assert.deepEqual(addFavoriteRequest("p1"), { path: "/customers/me/favorites/p1", init: { method: "PUT" } })
    assert.deepEqual(removeFavoriteRequest("p1"), { path: "/customers/me/favorites/p1", init: { method: "DELETE" } })
  })

  it("encodes the product ID", () => {
    assert.equal(addFavoriteRequest("a/b").path, "/customers/me/favorites/a%2Fb")
  })
})

describe("interpretFavoriteResult", () => {
  it("classifies sessions, outages, and refusals", () => {
    const list: FavoriteList = { items: [item()] }
    assert.deepEqual(interpretFavoriteResult({ kind: "ok", status: 200, data: list }), { state: "ok", list })
    assert.deepEqual(interpretFavoriteResult({ kind: "unauthorized" }), { state: "signed-out" })
    assert.deepEqual(interpretFavoriteResult({ kind: "forbidden", code: "ACCOUNT_NOT_BOOTSTRAPPED" }), { state: "not-bootstrapped" })
    for (const result of [{ kind: "network-error" }, { kind: "auth-unavailable" }, { kind: "error", status: 503, code: "SERVICE_UNAVAILABLE" }] as const) {
      assert.deepEqual(interpretFavoriteResult(result), { state: "failed", failure: "unavailable" })
    }
    assert.deepEqual(interpretFavoriteResult({ kind: "error", status: 429, code: "RATE_LIMITED" }), { state: "failed", failure: "rate-limited" })
    assert.deepEqual(interpretFavoriteResult({ kind: "error", status: 404, code: "PRODUCT_NOT_FOUND" }), { state: "failed", failure: "product-not-found" })
    assert.deepEqual(interpretFavoriteResult({ kind: "error", status: 409, code: "FAVORITE_LIMIT_REACHED" }), { state: "failed", failure: "limit-reached" })
    assert.deepEqual(interpretFavoriteResult({ kind: "error", status: 500, code: "INTERNAL_ERROR" }), { state: "failed", failure: "error" })
    assert.deepEqual(interpretFavoriteResult({ kind: "error", status: 400, code: null }), { state: "failed", failure: "error" })
  })
})

describe("favorite rules", () => {
  it("collects the product IDs for the hearts", () => {
    const ids = favoriteIds({ items: [item(), item({ productId: "p2" })] })
    assert.equal(ids.has("p1"), true)
    assert.equal(ids.has("p2"), true)
    assert.equal(ids.has("p3"), false)
  })

  it("counts each saved product once, for the header badge", () => {
    // The API never sends a product twice; the set would still count it once.
    assert.equal(favoriteIds({ items: [item(), item(), item({ productId: "p2" })] }).size, 2)
    assert.equal(favoriteIds({ items: [] }).size, 0)
  })

  it("caps the badge so it fits", () => {
    assert.equal(favoritesBadge(1), "1")
    assert.equal(favoritesBadge(99), "99")
    assert.equal(favoritesBadge(100), "99+")
  })

  it("links only to products that are still public", () => {
    assert.equal(canOpenFavorite(item()), true)
    assert.equal(canOpenFavorite(item({ state: "SOLD_OUT" })), true)
    assert.equal(canOpenFavorite(item({ state: "UNAVAILABLE", product: null, imageUrl: null })), false)
  })
})

describe("favorite messages", () => {
  const failures: FavoriteFailure[] = ["product-not-found", "limit-reached", "rate-limited", "unavailable", "error"]

  it("has every text in French and Arabic", () => {
    const keys = (value: object) => Object.keys(value).sort()
    assert.deepEqual(keys(FAVORITE_MESSAGES.ar), keys(FAVORITE_MESSAGES.fr))
    for (const locale of ["fr", "ar"] as const) {
      for (const failure of failures) assert.ok(FAVORITE_MESSAGES[locale].failures[failure].length > 0, `${locale} ${failure}`)
      for (const [key, text] of Object.entries(FAVORITE_MESSAGES[locale])) {
        if (typeof text === "string") assert.ok(text.length > 0, `${locale} ${key}`)
      }
    }
  })

  it("names the product in the heart's label, in both languages", () => {
    for (const locale of ["fr", "ar"] as const) {
      const t = FAVORITE_MESSAGES[locale]
      for (const label of [t.add, t.remove, t.guestAdd]) assert.ok(label.includes("{name}"), `${locale}: ${label}`)
      assert.ok(t.linkWithCount.includes("{count}"), `${locale}: ${t.linkWithCount}`)
    }
  })
})

describe("createRequestQueue", () => {
  /** A request whose answer the test releases by hand. */
  function held<T>() {
    let release!: (value: T) => void
    const answer = new Promise<T>((resolve) => (release = resolve))
    return { answer, release }
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

  it("never lets an earlier answer delivered late replace a newer list", async () => {
    const { run } = createRequestQueue()
    const sent: string[] = []
    let shown: string[] = []
    const first = held<string[]>()
    const second = held<string[]>()

    // Two adds: the server would answer the second one first if both were in flight.
    const a = run(() => (sent.push("PUT p1"), first.answer)).then((list) => (shown = list))
    const b = run(() => (sent.push("PUT p2"), second.answer)).then((list) => (shown = list))
    second.release(["p1", "p2"])
    await tick()
    assert.deepEqual(sent, ["PUT p1"], "the second request waits for the first answer")
    assert.deepEqual(shown, [])

    first.release(["p1"])
    await a
    await tick()
    assert.deepEqual(sent, ["PUT p1", "PUT p2"])
    await b
    assert.deepEqual(shown, ["p1", "p2"], "the newest list is the one left on screen")
  })

  it("keeps going after a failed request", async () => {
    const { run } = createRequestQueue()
    await assert.rejects(run(() => Promise.reject(new Error("network"))))
    assert.equal(await run(() => Promise.resolve("next")), "next")
  })
})
