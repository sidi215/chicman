import type { ReactNode } from "react"

import { AdminShell } from "@/features/admin/components/admin-shell"

/** The administrator area (AT-1, start of spec 17). Always renders its pages; each page gates itself. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>
}
