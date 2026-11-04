# AI Workflow Rules

## Approach

Build the Mauritania Fashion Marketplace incrementally using a spec-driven workflow.

Context files define what to build, how to build it, and the current project state. Always follow the project documentation and agreed requirements. Do not invent product behavior or make architectural decisions without updating the relevant context files.

Implement one feature at a time, following the defined architecture and code standards.

## Scoping Rules

- Work on one feature unit at a time.
- Prefer small, verifiable increments over large speculative changes.
- Do not combine unrelated system boundaries in a single implementation step.
- Keep web, mobile, and backend changes focused on the feature being implemented.
- Avoid unnecessary changes outside the requested scope.

## When to Split Work

Split an implementation step if it combines:

- UI changes and backend or background-job changes.
- Multiple unrelated API routes or business features.
- Changes across unrelated applications or system boundaries.
- Behavior that is not clearly defined in the context files.

If a change cannot be verified end to end quickly, the scope is too broad — split it.

## Handling Missing Requirements

- Do not invent product behavior not defined in the context files.
- If a requirement is ambiguous, resolve it in the relevant context file before implementing.
- If a requirement is missing, add it as an open question in `progress-tracker.md` before continuing.
- Ask for clarification when a decision affects business rules, user experience, or system architecture.

## Protected Files

Do not modify the following unless explicitly instructed:

- `components/ui/*` — shared UI library components.
- Third-party library internals or dependencies.
- Environment files containing local or production secrets.
- Existing database migrations that have already been applied.

## Keeping Docs in Sync

Update the relevant context file whenever implementation changes:

- System architecture or boundaries.
- Storage model decisions.
- Code conventions or standards.
- Feature scope.
- Business rules or user workflows.

## Before Moving to the Next Unit

1. The current unit works end to end within its defined scope.
2. No invariant defined in `architecture-context.md` was violated.
3. `progress-tracker.md` reflects the completed work.
4. Relevant build and validation checks pass.
5. No unrelated changes or unresolved implementation issues remain.
