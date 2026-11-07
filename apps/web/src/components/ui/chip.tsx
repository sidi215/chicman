import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cn } from "@/lib/utils"

/**
 * Filter chip (rounded-full). Pressed = active chip token (black pill),
 * unpressed = inactive chip token (muted).
 */
function Chip({ className, ...props }: TogglePrimitive.Props) {
  return (
    <TogglePrimitive
      data-slot="chip"
      className={cn(
        "inline-flex h-control-sm shrink-0 items-center justify-center gap-1.5 rounded-full bg-chip-inactive px-4 type-label-large whitespace-nowrap text-chip-inactive-foreground transition-colors outline-none select-none hover:bg-[color-mix(in_oklch,var(--accent-chip-inactive),var(--foreground)_6%)] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-pressed:bg-chip-active data-pressed:text-chip-active-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-icon-inline",
        className
      )}
      {...props}
    />
  )
}

export { Chip }
