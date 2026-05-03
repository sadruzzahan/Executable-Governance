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

## Dashboard + Governance Analytics (Task #4)

- **Enhanced summary** (`GET /api/analytics/summary`): Now also returns `decisionsLast30d`, `approvalRate` (0–100), `exceptionRate` (0–100) — computed over decisions in the last 30 days.
- **Decision Volume** (`GET /api/analytics/decision-volume`): Daily decision counts by outcome (approved/denied/escalated/needs_review) for the last 30 days.
- **Top Triggered Rules** (`GET /api/analytics/top-rules`): Top 5 rules by eval/fire count over the last 30 days (uses `jsonb_array_elements` on `rulesAppliedJson`), with per-decision-outcome split.
- **Coverage Gaps** (`GET /api/analytics/coverage-gaps`): Published policies with fewer than 3 published rules, or with ≥3 `needs_review` decisions in the last 7 days.
- **Rule Health** (`GET /api/analytics/rule-health`): Published rules ranked by unresolved ambiguities + edge cases (queried via `jsonb_array_elements` on `resolvedAmbiguities`/`resolvedEdgeCases`).
- **DashboardPage** rebuilt: 5 stat cards (decisions/30d, approval %, exception %, active rules, draft policies) with count-up animation; stacked Recharts bar chart for decision volume; Top Triggered Rules panel; Recent Decisions feed (links to /decisions/:id); Coverage Gaps panel; Rule Health table. All panels auto-refresh every 60 seconds via `refetchInterval: 60_000`.

## Decision Runtime + Audit Trail (Task #3)

- **Decision evaluation** (`POST /api/decisions/evaluate`): Submits a query (actor, action, context, policy, scenario) against all published rules for a policy. Rules are evaluated in priority order; conditions are compiled from `compiledConditions` (if stored) or `structuredRepresentation` (runtime fallback). On no match, falls back to `needs_review`. AI generates a plain-English explanation. Every evaluation is persisted to the `decisions` table (immutable audit log).
- **Audit log** (`GET /api/decisions`, `GET /api/decisions/:id`): Paginated, filterable (policyId, outcome, actor) decision history. Detail endpoint returns full reasoning chain: rules applied, match status per rule, context, explanation.
- **Playground** (`/playground`): Interactive form to submit a scenario — select policy, enter actor/action/context JSON, describe scenario, see live decision + AI explanation + rules applied.
- **Decisions page** (`/decisions`): Paginated audit log table with policy / outcome / actor filters, clickable rows link to detail.
- **Decision detail** (`/decisions/:id`): Full reasoning card — outcome badge, request metadata, query context key-value, AI explanation, rules applied table.
- **Compile-on-publish hook**: `compileRuleConditions()` runs when a rule is published, storing conditions in `compiledConditions` JSONB on the rule for fast evaluation.
- **DB tables added**: `decisions` (id, organizationId, policyId, actor, action, outcome, confidence, context, rulesApplied, reason, explanation, scenario, createdAt). `compiledConditions` JSONB column added to `rules`.

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
