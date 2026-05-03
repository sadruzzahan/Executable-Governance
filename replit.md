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

## Account Lifecycle (Task #9)

- **Schema**: `user_passwords` (bcryptjs cost 12 hash), `user_sessions` (sha256-hashed tokens, ip, ua, deviceLabel, lastSeenAt, expiresAt, revokedAt, mfaPassed), `password_reset_tokens`, `email_verification_tokens` (with optional `pendingEmail`), `mfa_secrets` (AES-256-GCM-encrypted via `MFA_SECRET_KEY` or DATABASE_URL fallback), `mfa_recovery_codes`, `email_outbox` (dev sink). `users` gained `avatarUrl`, `timezone`, `locale`, `emailVerifiedAt`. `organizations` gained `requireMfa`.
- **Crypto helpers** (`api-server/src/lib`): `passwords.ts` (bcryptjs — argon2 was swapped out due to native build approval prompt), `hibp.ts` (k-anonymity, 1.5s fail-open timeout), `totp.ts` (otplib v13 functional API, ±1 step tolerance), `tokens.ts` (32-byte random + sha256 storage), `sessions.ts` (eg_session HttpOnly cookie, sliding 30-day TTL), `email.ts` (DB outbox transport).
- **Auth substrate**: cookie-session via `eg_session` (HttpOnly, SameSite=Lax, Secure-only-in-prod). Both eg_session and csrf_token cookies use `res.appendHeader` so the login response can set both at once. CSRF is double-submit; SPA `customFetch` auto-injects the `X-CSRF-Token` header from the cookie on unsafe methods. `authLimiter` mounted on `/api/auth/{login,forgot-password,reset-password,verify-email}`.
- **Routes** (`api-server/src/routes`): `auth.ts` (login w/ TOTP+recovery, logout, me, forgot/reset password, verify-email), `account.ts` (profile PATCH, email-change request, password change w/ HIBP, soft-delete), `mfa.ts` (status, enroll-start/verify, disable, recovery-codes regenerate), `sessions.ts` (list/revoke/revoke-others), `orgSecurity.ts` (admin-only `requireMfa` toggle).
- **Account deletion**: soft-delete only — `name='(deletion pending)'`, `emailVerifiedAt=null`, all sessions revoked. Hard delete deferred to a real GDPR pipeline because audit-critical decisions/rule_versions reference `users` non-nullably.
- **Frontend**: `src/lib/auth.ts` thin react-query wrapper (auth/account endpoints aren't in the orval client to avoid spec churn during stabilization). `App.tsx` wraps everything in `Authed` (redirect to `/login` when unauthed; redirect away from `/login` when authed). Pages: `LoginPage` (with MFA + recovery flow), `ResetPasswordPage`, `VerifyEmailPage`, `SettingsPage` (tabbed: account / password / security / sessions / danger). `AppLayout` gained user menu (avatar+name+role dropdown → settings/logout) and inline `VerifyEmailBanner`.
- **Drift from plan**: T7 (object storage avatars) deferred — avatar is a URL field for now; signed-upload route to come once a broader file-upload pattern lands. OpenAPI spec for the new auth/account/mfa/sessions endpoints is intentionally not in `openapi.yaml` yet — the surface uses a hand-written `lib/auth.ts` client to avoid intrusive codegen churn before Task #11 (signup/onboarding) further reshapes the surface.

## Production Hardening (Task #8)

- **Boot-time env validation** (`api-server/src/lib/env.ts`): Zod-validated env at process start; required secrets fail fast with no silent defaults. `getEnv()` is lazy (validates on first read) so middleware factories invoked during ESM import-hoisting still see a populated env.
- **Middleware chain** (`api-server/src/app.ts`, in order): `requestId` → `securityHeaders` (helmet, strict CSP, HSTS in prod, X-Frame DENY) → `corsConfig` (env-driven allow-list, locked by default; `REPLIT_DEV_DOMAIN` auto-allowed in dev) → body parsers → `csrfProtection` (double-submit cookie; no-op until session cookie lands) → `globalLimiter` (600/min) → per-route limiters → routes → `notFoundHandler` → `errorHandler`.
- **Rate limits**: global 600/min, AI 30/min on `/api/rules/:id/{analyze,simulate}`, decision 120/min on `/api/decisions/evaluate`, client-errors 60/min, auth/webhook stubs ready. All emit `Retry-After` and a `{error:"rate_limited", policy, retryAfter}` envelope. `RATE_LIMIT_DISABLED=1` bypasses for tests.
- **Validation envelope**: every Zod failure across all 7 route files goes through `send400(res, req, zodError)` → `{error:"validation_failed", message, requestId, fields:[{path,message,code}]}`.
- **Centralized error handler** (`middlewares/errorHandler.ts`): handles `ZodError`, `HttpError`, CORS rejection (403), and unknown 5xx with stack hidden in prod. Every response carries the request id.
- **Error tracking** (`lib/errorTracking.ts`): `captureException` / `captureMessage` always emit a structured pino line; if `SENTRY_DSN` is set AND `@sentry/node` is installed (optional dep, dynamic import), the SDK is initialized at boot and events are also forwarded to Sentry. Missing SDK degrades gracefully to log-only with a single warning.
- **Frontend error reporting** (`executable-governance/src/lib/errorReporter.ts`, wired in `main.tsx`): `window.error` + `unhandledrejection` POST to `/api/client-errors` with a per-session cap of 50; backend has its own 60/min/IP cap.
- **Structured logging** (`lib/logger.ts`): pino with extended redact list (auth headers, tokens, passwords, common PII keys) and base bindings (service, env, version).
- **Process safety nets** (`src/index.ts`): `uncaughtException` + `unhandledRejection` handlers route through `captureException`, with deliberate exit on hard crashes; SIGTERM/SIGINT graceful shutdown.
- **Dependency posture**: `pnpm.overrides` in root `package.json` patches transitive vulns (lodash, path-to-regexp, picomatch, brace-expansion, esbuild, postcss, yaml). Audit: 0 critical / 0 high / 0 moderate.

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
