/**
 * What identifies the customer to the API, when this server calls it for them.
 * Without it, every customer would share this server's address and its rate
 * limit. The API accepts the address only with the shared key. Behind `hops`
 * proxies, the customer's address is that many entries from the right: entries
 * further left are client input.
 */
export function customerAddressHeaders(env: Record<string, string | undefined>, forwardedFor: string | null): Record<string, string> {
  const key = env["CATALOG_INTERNAL_KEY"]
  if (!key || forwardedFor === null) return {}
  const addresses = forwardedFor.split(",").map((address) => address.trim())
  const hops = Number(env["TRUST_PROXY_HOPS"] ?? "1")
  const address = addresses[addresses.length - (Number.isInteger(hops) && hops >= 1 ? hops : 1)]
  return address ? { "x-chicman-internal-key": key, "x-chicman-client-address": address } : {}
}
