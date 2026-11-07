import type { Metadata } from "next";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { AuthProvider } from "@/features/auth/auth-provider";
import { DEFAULT_LOCALE, LOCALE_DIRECTION } from "@/lib/locale";
import { themeInitScript } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { fontVariables } from "./fonts.generated";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chicman",
  description: "La marketplace de la mode en Mauritanie.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const locale = DEFAULT_LOCALE;
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
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <DirectionProvider direction={direction}>
          <AuthProvider>{children}</AuthProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
