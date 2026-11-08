import { NextResponse, type NextRequest } from "next/server"

import { isMissingProduct, productToCheck } from "@/features/storefront/product-check"
import { customerAddressHeaders } from "@/lib/customer-address"
import { LOCALE_COOKIE, localeCookieOptions, routeLocale } from "@/lib/locale"

/**
 * Maps public URLs to the `/[locale]/…` routes (rules in `routeLocale`). A
 * product page's shell is sent before the product is read, so a missing product
 * is detected here, while the response can still be a real 404.
 */
export async function proxy(request: NextRequest) {
  const route = routeLocale(request.nextUrl.pathname, request.cookies.get(LOCALE_COOKIE)?.value)
  const url = request.nextUrl.clone()
  if (route.kind === "redirect") {
    url.pathname = route.pathname
    const response = NextResponse.redirect(url, route.permanent ? 308 : 307)
    if (route.cookie !== undefined) {
      response.cookies.set(LOCALE_COOKIE, route.cookie, localeCookieOptions(url.protocol === "https:"))
    }
    return response
  }

  const internalPath = route.kind === "rewrite" ? route.pathname : request.nextUrl.pathname
  const product = productToCheck(internalPath, request.headers.get("sec-fetch-dest"))
  if (product !== null) {
    const missing = await isMissingProduct(product.productId, {
      baseUrl: process.env.API_INTERNAL_URL,
      headers: customerAddressHeaders(process.env, request.headers.get("x-forwarded-for")),
    })
    if (missing) {
      url.pathname = `/${product.locale}/missing-product`
      return NextResponse.rewrite(url)
    }
  }

  if (route.kind === "next") return NextResponse.next()
  url.pathname = route.pathname
  return NextResponse.rewrite(url)
}

export const config = {
  // Framework files and public files (anything with an extension) are not pages.
  matcher: ["/((?!_next/|.*\\.[^/]+$).*)"],
}
