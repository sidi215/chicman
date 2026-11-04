# 01 — Design System

## Goal

Establish the foundational visual system for the marketplace, ensuring a consistent design across the Next.js web application and Flutter mobile application.

## Design & Architecture Decisions

- Follow the visual guidelines defined in `ui-context.md`.
- Use a light-first theme with optional dark mode.
- Support French LTR and Arabic RTL layouts.
- Maintain consistent colors, typography, spacing, and component styles across platforms.
- Web uses Tailwind CSS and shadcn/ui.
- Mobile uses customized Flutter Material 3.
- Each platform implements its own native components.

## Implementation Details

**Web files:**
- `apps/web/src/app/globals.css`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/components/ui/`

**Mobile files:**
- `apps/mobile/lib/core/theme/app_theme.dart`
- `apps/mobile/lib/core/theme/app_colors.dart`
- `apps/mobile/lib/core/theme/app_typography.dart`

**Do not touch:**
- Business logic.
- Authentication.
- Database configuration.
- Feature-specific screens.

## Verification Checklist

- [ ] Web application uses the defined design system.
- [ ] Flutter application uses the same visual guidelines.
- [ ] Light and dark themes work.
- [ ] French and Arabic layouts are supported.
- [ ] No inconsistent hardcoded design values are introduced.
- [ ] Both applications build successfully.