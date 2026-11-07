import { cn } from "@/lib/utils"

/**
 * The Chicman wordmark (brand logo). Drawn as a CSS mask filled with the
 * current text colour, so it follows the theme (black in light mode, light in
 * dark mode). Height and asset come from the design tokens
 * (`h-brand-wordmark`, `h-brand-wordmark-lg`, `--brand-wordmark-url`,
 * `--brand-wordmark-aspect`). Size it with `size`, not a height class..
 */
export function BrandLogo({
  label,
  size = "default",
  className,
}: {
  label: string
  /** `default`: headers and auth screens; `lg`: landing surfaces. */
  size?: "default" | "lg"
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "inline-block shrink-0 bg-current text-foreground forced-colors:bg-[CanvasText]",
        size === "lg" ? "h-brand-wordmark-lg" : "h-brand-wordmark",
        "[aspect-ratio:var(--brand-wordmark-aspect)]",
        "[mask:var(--brand-wordmark-url)_center/contain_no-repeat] [-webkit-mask:var(--brand-wordmark-url)_center/contain_no-repeat]",
        className
      )}
    />
  )
}
