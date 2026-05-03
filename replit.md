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

## AI Features (Task #2)

- **Rule Analysis** (`POST /api/rules/:id/analyze`): Streams SSE analysis via GPT-5.4. Returns ambiguities, edge cases, and conflicts with existing sibling rules. Frontend `RuleAnalysisPanel` handles streaming, shows three card sections, each with "Accept suggestion" actions that persist to `resolvedAmbiguities`/`resolvedEdgeCases` fields.
- **Scenario Simulation** (`POST /api/rules/:id/simulate`): Runs a hypothetical scenario against a rule and returns decision + reasoning. Frontend `SimulationPanel` shows the decision badge (APPROVED/DENIED/ESCALATED/NEEDS_REVIEW) plus condition breakdown.
- **Publishing gate**: Publish button is disabled if the user has run an analysis and there are unresolved ambiguities or edge cases.
- **RuleDetailPage tabs**: Rule / Analysis / Simulate / History.
- **AI integration**: `@workspace/integrations-openai-ai-server` (Replit-proxied OpenAI, no user API key needed). Env: `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`.
- **DB tables added**: `conversations`, `messages` (from integration template, for future chat history).

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
- **AI**: OpenAI via Replit AI Integrations proxy (gpt-5.4)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
