# 02 — Project Setup

## Goal

Establish the monorepo structure and configure the web, mobile, backend, and infrastructure foundations for independent development.

## Design & Architecture Decisions

- Use a monorepo structure.
- Keep applications inside `apps/`.
- Keep reusable TypeScript definitions inside `packages/shared/`.
- Store infrastructure configuration inside `infrastructure/`.
- Store project documentation inside `context/`.
- Follow the structure defined in `architecture.md`.

## Implementation Details

**Project structure:**

```text
fashion-marketplace/
├── apps/
│   ├── api/
│   ├── web/
│   └── mobile/
├── packages/
│   └── shared/
├── infrastructure/
├── context/
├── README.md
└── .gitignore
```

**Files to configure:**
- Root `README.md`
- Root `.gitignore`
- Backend `package.json` and `tsconfig.json`
- Web `package.json` and `tsconfig.json`
- Mobile `pubspec.yaml`
- Infrastructure Docker Compose configuration

**Do not touch:**
- Feature-specific business logic.
- Authentication implementation.
- Product and order functionality.
- Existing context specifications.

## Verification Checklist

- [ ] Expected directory structure exists.
- [ ] Backend dependencies install successfully.
- [ ] Web dependencies install successfully.
- [ ] Flutter dependencies resolve successfully.
- [ ] Docker Compose configuration is valid.
- [ ] Git ignores environment files and generated files.
- [ ] Each application can be started independently.