import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Pill-shaped button (rounded-full). `default` is the high-contrast black pill
 * used for primary CTAs. Heights come from the `control` size tokens.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-icon-action",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-secondary",
        outline:
          "border-border bg-surface text-foreground hover:bg-muted aria-expanded:bg-muted",
        highlight:
          "bg-highlight text-highlight-foreground hover:bg-[color-mix(in_oklch,var(--accent-highlight),var(--foreground)_8%)]",
        ghost:
          "text-foreground hover:bg-muted aria-expanded:bg-muted",
        destructive:
          "bg-destructive/10 text-error-text hover:bg-destructive/20 focus-visible:ring-destructive/20",
        link: "rounded-none type-label-large text-foreground underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-7 gap-1 px-3 type-label-medium [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-control-sm gap-1.5 px-4 type-label-large [&_svg:not([class*='size-'])]:size-icon-inline",
        default:
          "h-control gap-2 px-5 type-label-large has-data-[icon=inline-end]:pe-4 has-data-[icon=inline-start]:ps-4",
        lg: "h-control-lg gap-2 px-6 type-title-medium has-data-[icon=inline-end]:pe-5 has-data-[icon=inline-start]:ps-5",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-control-sm [&_svg:not([class*='size-'])]:size-icon-inline",
        icon: "size-control",
        "icon-lg": "size-control-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
