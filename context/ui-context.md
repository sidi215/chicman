# UI Context

## Theme

Light-first soft modern e-commerce UI with optional dark mode support.

The design language features high-contrast black pill components, soft ambient surface tints, smooth rounded geometry, and a clean, high-density product canvas optimized for mobile-first fashion browsing in Mauritania.

The visual identity must remain consistent across Web (Next.js) and Mobile (Flutter), while respecting each platform's native interaction patterns and components.

The experience should feel modern, elegant, minimal, accessible, and focused on product discovery and shopping.

## Colors

All components must use the defined semantic color tokens. Avoid hardcoded color values in individual components.

| Role | CSS Variable | Value |
|---|---|---|
| Page background | `--bg-base` | `#F4F7FB` |
| Surface | `--bg-surface` | `#FFFFFF` |
| Sub-surface / Muted background | `--bg-muted` | `#F0F2F5` |
| Primary text | `--text-primary` | `#09090B` |
| Muted text | `--text-muted` | `#71717A` |
| Primary accent | `--accent-primary` | `#09090B` |
| Highlight / Promo accent | `--accent-highlight` | `#B9D7FE` |
| Active filter chip | `--accent-chip-active` | `#09090B` |
| Inactive filter chip | `--accent-chip-inactive` | `#F0F2F5` |
| Border | `--border-default` | `#E4E4E7` |
| Error | `--state-error` | `#EF4444` |
| Success | `--state-success` | `#22C55E` |
| Rating star | `--state-warning` | `#F59E0B` |

Flutter must use equivalent centralized color constants matching the web tokens.

Dark mode must have a corresponding semantic color palette while preserving the same design language.

## Typography

| Role | Font | Variable |
|---|---|---|
| UI text | Plus Jakarta Sans / Inter | `--font-sans` |
| Arabic Display | Noto Sans Arabic | `--font-arabic` |
| Code/mono | JetBrains Mono | `--font-mono` |

Use consistent typography hierarchy across web and mobile, with appropriate sizing and line heights for each screen size.

Arabic must use Noto Sans Arabic with full RTL support.

## Border Radius

| Context | Class |
|---|---|
| Inline / small UI (CTAs, Tags, Filters, Floating Nav) | `rounded-full` |
| Inputs / Search Bar | `rounded-full` |
| Cards / Offer Banners | `rounded-2xl` |
| Product Containers & Modals | `rounded-3xl` |

Flutter must reproduce equivalent rounded geometry using centralized `BorderRadius` definitions.

## Component Library

**Web:**
- shadcn/ui customized on top of Tailwind CSS.
- Components live in `components/ui/`.
- Lucide React for icons.
- Use reusable components and consistent design tokens.

**Mobile:**
- Flutter native widgets.
- Material 3 as the foundation, customized to match the marketplace design system.
- Reusable shared widgets for buttons, cards, inputs, filters, product displays, and navigation.
- Centralized theme configuration for colors, typography, spacing, and radius.

Web and mobile must share the same visual language but use platform-native component implementations.

## Layout Patterns

- **Navigation (Web):** Top header with user profile avatar, localized greeting, notification icon, and shopping bag drawer trigger.

- **Navigation (Mobile):** Compact top app bar with profile, notifications, and shopping bag actions.

- **Floating Dock (Mobile):** Fixed bottom navigation bar anchored over the view with rounded pill styling, containing Home, Search, Favorites, and Profile destinations.

- **Search & Filter Bar:** Full-width rounded search input accompanied by a horizontal scrollable row of rounded category filter chips: All, Traditional/Melhfa & Darra, Women, Men, Kids, Accessories.

- **Mobile Search & Filters:** Touch-friendly search, horizontally scrollable categories, and filter/sorting bottom sheets.

- **Hero Offer Section:** Floating soft-blue card (`--accent-highlight`) featuring promo text, CTA button, and featured product cutout asset. Adapt the layout to smaller mobile screens.

- **Product Grid (Web):** Two-column responsive layout on smaller screens, expanding on larger screens.

- **Product Grid (Mobile):** Two-column product layout with optimized spacing and touch-friendly interactions.

- **Product Cards:** 3:4 portrait product images, floating black pill action buttons (Shop), heart icon favorite overlays, store/vendor name, price in Ouguiya (MRU), and star rating indicator.

- **Product Details:** Dedicated product detail experience with large product imagery, product variants, seller information, pricing, and prominent add-to-cart action.

- **Shopping Cart:** Shopping bag drawer on web and a dedicated cart screen on mobile. Support products from multiple sellers.

- **Checkout:** Clear, simplified checkout experience optimized for mobile, including delivery location selection and order confirmation.

- **Modals & Overlays:** Rounded-3xl containers, soft backdrop, clear actions, and mobile bottom-sheet adaptations where appropriate.

- **Responsive Behavior:** Adapt layouts to mobile, tablet, and desktop while maintaining consistent hierarchy and spacing.

- **Localization:** Support French (LTR) and Arabic (RTL), including direction-aware layouts, alignment, spacing, and navigation.

- **Currency:** Consistent MRU (Ouguiya) price formatting across all platforms.

## Icons

Use Lucide icons consistently across both platforms.

**Web:**
- Lucide React.
- Stroke-based outline icons only.
- `h-4 w-4` for inline badges and ratings.
- `h-5 w-5` for action buttons and header actions.
- `h-6 w-6` for navigation items.

**Mobile:**
- Lucide-style stroke-based outline icons.
- Use consistent visual weight and proportions.
- Standard sizes: 16px for inline elements, 20px for actions, and 24px for navigation.
- Interactive touch targets should generally be at least 44–48 logical pixels.
