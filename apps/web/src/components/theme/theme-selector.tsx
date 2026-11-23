"use client"

import { Toggle } from "@base-ui/react/toggle"
import { ToggleGroup } from "@base-ui/react/toggle-group"
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react"
import type { Locale } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"
import { THEME_PREFERENCES, isThemePreference, type ThemePreference } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { useThemePreference } from "./use-theme-preference"

const ICONS: Record<ThemePreference, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
}

const LABELS: Record<Locale, Record<ThemePreference, string> & { group: string }> = {
  fr: { group: "Thème", system: "Système", light: "Clair", dark: "Sombre" },
  ar: { group: "المظهر", system: "النظام", light: "فاتح", dark: "داكن" },
}

/** Segmented System / Light / Dark selector; the choice is saved on the device. */
export function ThemeSelector({ className }: { className?: string }) {
  const [preference, setPreference] = useThemePreference()
  const labels = LABELS[useLocale()]

  return (
    <ToggleGroup
      aria-label={labels.group}
      value={[preference]}
      onValueChange={(value) => {
        const next: unknown = value[0]
        if (isThemePreference(next)) setPreference(next)
      }}
      // Never wider than its container; below `sm` the options are tighter, so
      // all three labels fit at 320 px, even beside a desktop scrollbar.
      className={cn("inline-flex h-control-sm max-w-full items-center gap-1 rounded-full bg-muted p-1", className)}
    >
      {THEME_PREFERENCES.map((option) => {
        const Icon = ICONS[option]
        return (
          <Toggle
            key={option}
            value={option}
            className="inline-flex h-full min-w-0 items-center gap-1 rounded-full px-2.5 type-label-medium whitespace-nowrap sm:gap-1.5 sm:px-3 text-muted-foreground transition-colors outline-none select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-pressed:bg-surface data-pressed:text-foreground data-pressed:shadow-sm"
          >
            <Icon className="size-icon-inline" aria-hidden />
            {labels[option]}
          </Toggle>
        )
      })}
    </ToggleGroup>
  )
}
