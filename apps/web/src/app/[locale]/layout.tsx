import { DirectionProvider } from "@base-ui/react/direction-provider";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";

import { ThemeInit } from "@/components/theme/theme-init";
import { AuthProvider } from "@/features/auth/auth-provider";
import { LocaleSync } from "@/features/profile/components/locale-sync";
import { siteUrl } from "@/features/storefront/seo";
import { STOREFRONT_MESSAGES } from "@/features/storefront/messages";
import { isLocale, LOCALE_DIRECTION, LOCALES } from "@/lib/locale";
import { LocaleProvider } from "@/lib/locale-provider";
import { cn } from "@/lib/utils";

import { fontVariables } from "../fonts.generated";
import "../globals.css";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await rootLocale();
  const t = isLocale(locale) ? STOREFRONT_MESSAGES[locale] : STOREFRONT_MESSAGES.fr;
  return { metadataBase: new URL(siteUrl()), title: t.brand, description: t.heroTitle };
}

export default async function RootLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await rootLocale();
  // `proxy.ts` only produces known locales; this covers a direct internal request.
  if (!isLocale(locale)) notFound();
  const direction = LOCALE_DIRECTION[locale];

  return (
    // The theme script sets `.dark` on <html> before hydration.
    <html
      lang={locale}
      dir={direction}
      suppressHydrationWarning
      className={cn(fontVariables, "h-full antialiased")}
    >
      <head>
        <ThemeInit />
      </head>
      <body className="flex min-h-full flex-col">
        <LocaleProvider locale={locale}>
          <DirectionProvider direction={direction}>
            <AuthProvider>
              <LocaleSync />
              {children}
            </AuthProvider>
          </DirectionProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
