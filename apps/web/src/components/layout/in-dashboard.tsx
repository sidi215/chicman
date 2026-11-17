"use client"

import { createContext, useContext, type ReactNode } from "react"

const InDashboardContext = createContext(false)

/**
 * Marks pages rendered inside a dashboard shell, which already shows the
 * brand, language, and theme. Standalone pages (the same components outside a
 * shell) keep their own brand logo.
 */
export function InDashboard({ children }: { children: ReactNode }) {
  return <InDashboardContext.Provider value>{children}</InDashboardContext.Provider>
}

export function useInDashboard(): boolean {
  return useContext(InDashboardContext)
}
