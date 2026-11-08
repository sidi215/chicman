"use client"

import { useEffect, useMemo, useState } from "react"

import { publicApiRequest } from "@/lib/api-client"

import { interpretCatalogResult, type CatalogFailure } from "./catalog-query"

export type CatalogView<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "failed"; failure: CatalogFailure }

/**
 * Loads public API paths together, so a page reports one state. The view
 * follows the paths: a result that belongs to earlier paths is never shown.
 */
export function useCatalogRequests<T>(paths: readonly string[]): { view: CatalogView<T[]>; retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  // Paths are URL-encoded, so a line break cannot occur inside one.
  const key = `${attempt}\n${paths.join("\n")}`
  const [settled, setSettled] = useState<{ key: string; view: CatalogView<T[]> } | null>(null)

  useEffect(() => {
    let cancelled = false
    const requests = key.split("\n").slice(1)
    void Promise.all(requests.map((path) => publicApiRequest<T>(path).then(interpretCatalogResult))).then((outcomes) => {
      if (cancelled) return
      const data: T[] = []
      for (const outcome of outcomes) {
        if (outcome.state !== "ok") {
          setSettled({ key, view: { state: "failed", failure: outcome.state } })
          return
        }
        data.push(outcome.data)
      }
      setSettled({ key, view: { state: "ready", data } })
    })
    return () => {
      cancelled = true
    }
  }, [key])

  return { view: settled?.key === key ? settled.view : { state: "loading" }, retry: () => setAttempt((count) => count + 1) }
}

/** Loads one public API path. */
export function useCatalogRequest<T>(path: string): { view: CatalogView<T>; retry: () => void } {
  const paths = useMemo(() => [path], [path])
  const { view, retry } = useCatalogRequests<T>(paths)
  if (view.state !== "ready") return { view, retry }
  const [data] = view.data
  return { view: data === undefined ? { state: "failed", failure: "error" } : { state: "ready", data }, retry }
}
