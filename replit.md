# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

This workspace hosts **Executable Governance** — a governance-as-code platform where compliance officers author rules in plain English and the system tracks versioned policies, rules, and audit trails. Initial vertical: expense policy management.

## Artifacts

- `artifacts/api-server` — Express API for organizations/policies/rules/users/analytics (port 8080)
- `artifacts/executable-governance` — React + Vite frontend (compliance workstation UI, deep navy/slate)
- `artifacts/mockup-sandbox` — component preview server

## Domain model (lib/db/src/schema)

- `organizations` → `policies` → `rules` → `rule_versions`
- `users` belong to an organization, role enum: admin/author/reviewer/viewer
- Enums: `policy_status` (draft/published/archived), `rule_status` (draft/published/archived), `rule_outcome` (approved/denied/escalated/needs_review)
- Rule version increments on changes to `naturalLanguageText`, `outcome`, or `structuredRepresentation`; create + version insert run inside a single DB transaction.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
