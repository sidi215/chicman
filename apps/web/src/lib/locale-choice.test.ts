import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { clearLocaleSynced, isLocaleSynced, markLocaleSynced } from "./locale-choice"

function memoryStore() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

describe("language sync marker", () => {
  it("applies per user: another account in the same tab syncs again", () => {
    const store = memoryStore()
    assert.equal(isLocaleSynced("alice", store), false)
    markLocaleSynced("alice", store)
    assert.equal(isLocaleSynced("alice", store), true)
    assert.equal(isLocaleSynced("bob", store), false)
  })

  it("is cleared at sign-out", () => {
    const store = memoryStore()
    markLocaleSynced("alice", store)
    clearLocaleSynced(store)
    assert.equal(isLocaleSynced("alice", store), false)
  })

  it("survives storage that refuses access", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
      removeItem: () => {
        throw new Error("blocked")
      },
    }
    assert.equal(isLocaleSynced("alice", broken), false)
    markLocaleSynced("alice", broken)
    clearLocaleSynced(broken)
    assert.equal(isLocaleSynced("alice", null), false)
  })
})
