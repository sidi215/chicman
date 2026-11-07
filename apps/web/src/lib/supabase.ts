import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let client: SupabaseClient | null | undefined

/**
 * Browser Supabase Auth client (singleton). The session is persisted in
 * localStorage and refreshed automatically, so it is restored on reload.
 * Returns `null` when the public Supabase configuration is missing.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  client =
    url && publishableKey
      ? createClient(url, publishableKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        })
      : null
  return client
}
