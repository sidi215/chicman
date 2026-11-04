# Code Standards

## General
- Write clean, readable, and maintainable code.
- Keep functions and components small and focused.
- Follow a consistent naming and formatting convention.
- Avoid code duplication.
- Separate responsibilities between the frontend, backend, and database.
- Use environment variables for configuration and sensitive information.
- Handle errors clearly and consistently.

## TypeScript
- Use TypeScript for the Next.js web application and Node.js backend.
- Enable strict type checking.
- Avoid using `any`; define proper types and interfaces.
- Use clear and consistent naming for variables, functions, and types.
- Validate external data before using it.
- Keep shared types and API contracts consistent.

## Framework
- **Next.js:** Use the App Router and reusable components. Keep business logic outside UI components.
- **Flutter:** Use a feature-based structure and reusable widgets. Follow Material 3 with the project's customized design system.
- **Node.js + Express:** Organize the backend into modules. Keep controllers focused on handling requests and services responsible for business logic.
- Use Riverpod for Flutter state management.
- Use Prisma as the ORM for database operations.

## Styling
- Follow the project's design system across web and mobile.
- Use shared design tokens for colors, typography, spacing, and border radius.
- Use Tailwind CSS and shadcn/ui for the web application.
- Use Flutter themes and Material 3 components for the mobile application.
- Avoid hardcoded colors and inconsistent styles.
- Support responsive layouts and both French (LTR) and Arabic (RTL) interfaces.

## API Routes
- Use REST API conventions.
- Prefix API routes with `/api/v1`.
- Keep route handlers simple and move business logic into services.
- Validate request parameters, query strings, and request bodies.
- Use consistent response formats and HTTP status codes.
- Verify Supabase authentication tokens on protected routes.
- Check user roles and resource ownership before allowing access.
- Handle errors through centralized error middleware.

## Data and Storage
- Use PostgreSQL as the primary database.
- Use Prisma for database access and migrations.
- Use Supabase Auth for user authentication.
- Use S3-compatible storage for product images and uploaded files.
- Use Redis for caching and background jobs.
- Use Meilisearch for product search.
- Store money using appropriate decimal types, never floating-point values.
- Store timestamps in UTC.
- Keep PostgreSQL as the main source of truth.

## File Organization
- Organize the project by application and feature.
- Keep shared code in dedicated packages.
- Separate UI components, business logic, data access, and configuration.

```text
project/
├── apps/
│   ├── web/                 # Next.js application
│   ├── mobile/              # Flutter application
│   └── api/                 # Node.js + Express backend
│
├── packages/
│   |── shared/              # Shared types and utilities
│
├── infrastructure/          # Docker and deployment configuration
│
└── docs/                    # Project documentation
```

- Keep each application's files organized by feature and responsibility.
