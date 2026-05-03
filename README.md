# Executable Governance

**Executable Governance** is a governance-as-code / compliance workstation: officers author rules in natural language, version policies and rules, evaluate decisions against them with an audit trail, and use AI-assisted rule analysis and simulation. Initial vertical is expense policy management.

## Stack

| Layer | Technology |
|--------|------------|
| Monorepo | pnpm workspaces |
| Runtime | Node.js 24 |
| Language | TypeScript 5.9 |
| API | Express 5 (bundled with esbuild) |
| Database | PostgreSQL, Drizzle ORM, drizzle-kit |
| Validation / API contract | Zod, OpenAPI 3.1 (`lib/api-spec/openapi.yaml`), Orval codegen |
| Frontend | React 19, Vite 7, Tailwind CSS 4, wouter, TanStack Query, Radix UI, Recharts |
| AI | OpenAI-compatible HTTP API (`@workspace/integrations-openai-ai-server`) |
| Auth | Cookie sessions (`eg_session`), CSRF double-submit, MFA (TOTP + recovery), bcrypt password hashing |

## Repository structure

```
├── artifacts/
│   ├── api-server/          # Express API (listens on PORT, `/api/*`)
│   ├── executable-governance/  # Main SPA (Vite; needs PORT + BASE_PATH)
│   └── mockup-sandbox/     # Component / UI preview (Vite)
├── lib/
│   ├── db/                  # Drizzle schema, migrations push
│   ├── api-spec/            # openapi.yaml + Orval config
│   ├── api-zod/             # Generated Zod from OpenAPI
│   ├── api-client-react/    # Generated React Query hooks + customFetch w/ CSRF
│   └── integrations-openai-ai-*   # OpenAI client (server + React audio helpers)
├── scripts/                 # Workspace scripts
├── replit.md                # Detailed domain, auth, and feature notes
├── package.json             # Root workspace scripts (pnpm only)
└── pnpm-workspace.yaml
```

## Prerequisites

- **Node.js** 24
- **pnpm** (the root `preinstall` script rejects npm/yarn)
- **PostgreSQL** reachable via `DATABASE_URL`

## Environment variables

### API server (`artifacts/api-server`)

Validated at boot in `artifacts/api-server/src/lib/env.ts`. Required unless noted optional.

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | yes | TCP port for the API (e.g. `8080`) |
| `DATABASE_URL` | yes | `postgres://` or `postgresql://` connection string |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | yes | API key for the OpenAI-compatible endpoint |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | yes | Base URL for that endpoint |
| `NODE_ENV` | no | `development` \| `production` \| `test` (default `development`) |
| `CORS_ALLOWED_ORIGINS` | no | Comma-separated origins; in non-production, `https://${REPLIT_DEV_DOMAIN}` may be auto-added |
| `RATE_LIMIT_DISABLED` | no | Set `1` to disable rate limits (tests only) |
| `SENTRY_DSN` | no | Forward errors to Sentry if `@sentry/node` is available |
| `RELEASE` | no | Release/build id for error tracking |
| `LOG_LEVEL` | no | pino level (default `info`) |
| `MFA_SECRET_KEY` | prod recommended | Encrypts TOTP secrets at rest; dev may derive from `DATABASE_URL` |
| `APP_BASE_URL` | no | Public app URL for links in outbound email; falls back to Replit dev domain in dev |
| `REPLIT_DEV_DOMAIN` | no | Used for CORS and default `APP_BASE_URL` in development |

`lib/db` also requires `DATABASE_URL` for `drizzle-kit push`.

### Frontend (`artifacts/executable-governance`)

Vite fails fast without:

| Variable | Description |
|----------|-------------|
| `PORT` | Dev/preview server port |
| `BASE_PATH` | Vite `base` (e.g. `/` or a subpath) |

Optional:

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Standard Node env |
| `REPL_ID` | When set with non-production `NODE_ENV`, enables Replit Vite plugins |
| `VITE_RELEASE` | Passed to client error reporter (`executable-governance/src/lib/errorReporter.ts`) |

The SPA calls `/api/...` on the **same origin** as the page (cookies + CSRF). Replit’s application router is set up for that; for split local ports you need a reverse proxy or equivalent single origin.

## Setup

```bash
pnpm install
pnpm run typecheck
```

Apply the database schema (development):

```bash
pnpm --filter @workspace/db run push
```

Regenerate API clients after OpenAPI changes:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Run commands

**API (after setting env vars):**

```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

The `dev` script uses a Unix-style `export`; on Windows use a shell that supports it, or set `NODE_ENV=development` and run `build` then `start` manually.

**Frontend:**

```bash
# Example (adjust PORT/BASE_PATH to match your deployment)
set PORT=5173
set BASE_PATH=/
pnpm --filter @workspace/executable-governance run dev
```

**Workspace-wide:**

- `pnpm run typecheck` — libraries + artifacts + scripts
- `pnpm run build` — typecheck, then `build` in all packages that define it

**Mockup sandbox:**

```bash
pnpm --filter @workspace/mockup-sandbox run dev
```

## Features (summary)

- **Organizations, policies, rules** — CRUD, publish/archive, versioned rules with compile-on-publish for condition evaluation
- **Decision engine** — `POST /api/decisions/evaluate` persists immutable audit rows; list/detail endpoints for the log
- **Playground** — Interactive scenario evaluation in the SPA (`/playground`)
- **Analytics dashboard** — Summary metrics, decision volume, top rules, coverage gaps, rule health (`/api/analytics/*`)
- **AI** — Streaming rule analysis and scenario simulation (`/api/rules/:id/analyze`, `/simulate`)
- **Accounts** — Login, MFA, sessions, password reset, email verification, settings (see `replit.md` for routes and drift vs OpenAPI)

## HTTP API

- **Contract:** `lib/api-spec/openapi.yaml` — base path in spec: `/api` (tags: health, organizations, policies, rules, decisions, users, analytics).
- **Additional routes** (session auth, account, MFA, client errors, etc.) are implemented in `artifacts/api-server/src/routes` but are **not** all present in `openapi.yaml`; the SPA uses handwritten `src/lib/auth.ts` for those surfaces.

Health check: `GET /api/healthz`.

---

*For task-level implementation detail (auth crypto, rate limits, dashboard panels), see `replit.md`.*
