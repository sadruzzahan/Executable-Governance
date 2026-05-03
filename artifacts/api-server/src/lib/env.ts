/**
 * Boot-time environment validation.
 *
 * Every env var the application reads is declared here exactly once.
 * Required values fail fast at startup with a clear error — never
 * silently fall back to a default. Optional values are surfaced as typed
 * accessors with explicit defaults documented inline.
 *
 * Application code MUST read configuration through `getEnv()` and never
 * touch `process.env` directly. This keeps secret access auditable and
 * makes it trivial to swap the source of truth (a secret manager,
 * Doppler, etc.) by editing one file.
 */

interface EnvSpec {
  name: string;
  required: boolean;
  /** Validator returning the parsed value, or throwing with a clear reason. */
  parse?: (raw: string) => unknown;
  description: string;
}

const SPECS: EnvSpec[] = [
  {
    name: "NODE_ENV",
    required: false,
    description: "Runtime environment (development | production | test).",
  },
  {
    name: "PORT",
    required: true,
    parse: (raw) => {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || n > 65535) {
        throw new Error("must be an integer 1–65535");
      }
      return n;
    },
    description: "TCP port the API listens on.",
  },
  {
    name: "DATABASE_URL",
    required: true,
    parse: (raw) => {
      if (!/^postgres(ql)?:\/\//i.test(raw)) {
        throw new Error("must be a postgres:// URL");
      }
      return raw;
    },
    description: "Postgres connection string.",
  },
  {
    name: "AI_INTEGRATIONS_OPENAI_API_KEY",
    required: true,
    description: "OpenAI proxy API key (Replit AI Integrations).",
  },
  {
    name: "AI_INTEGRATIONS_OPENAI_BASE_URL",
    required: true,
    parse: (raw) => {
      try {
        new URL(raw);
        return raw;
      } catch {
        throw new Error("must be a valid URL");
      }
    },
    description: "OpenAI proxy base URL.",
  },
  // Optional but documented:
  {
    name: "CORS_ALLOWED_ORIGINS",
    required: false,
    description:
      "Comma-separated origin allow-list. Defaults to REPLIT_DEV_DOMAIN in dev, empty in prod (lock down).",
  },
  {
    name: "RATE_LIMIT_DISABLED",
    required: false,
    description: "Set to '1' to disable rate limiting (test only).",
  },
  {
    name: "SENTRY_DSN",
    required: false,
    description: "If set, errors are forwarded to Sentry.",
  },
  {
    name: "RELEASE",
    required: false,
    description: "Build/release identifier surfaced to error tracker.",
  },
  {
    name: "LOG_LEVEL",
    required: false,
    description: "pino log level. Default 'info'.",
  },
  {
    name: "MFA_SECRET_KEY",
    required: false,
    description:
      "Server key used to encrypt TOTP secrets at rest. Required in production; falls back to a key derived from DATABASE_URL in dev.",
  },
  {
    name: "APP_BASE_URL",
    required: false,
    description:
      "Absolute base URL of the public app (used to build links inside outbound emails). Defaults to https://${REPLIT_DEV_DOMAIN} in dev.",
  },
  {
    name: "REPLIT_DEV_DOMAIN",
    required: false,
    description:
      "Replit-provided dev preview domain. Auto-allowed in CORS allow-list when running in dev.",
  },
];

export interface ValidatedEnv {
  NODE_ENV: "development" | "production" | "test";
  PORT: number;
  DATABASE_URL: string;
  AI_INTEGRATIONS_OPENAI_API_KEY: string;
  AI_INTEGRATIONS_OPENAI_BASE_URL: string;
  CORS_ALLOWED_ORIGINS: string[];
  RATE_LIMIT_DISABLED: boolean;
  SENTRY_DSN: string | null;
  RELEASE: string | null;
  LOG_LEVEL: string;
  REPLIT_DEV_DOMAIN: string | null;
}

let cached: ValidatedEnv | null = null;

export function validateEnv(): ValidatedEnv {
  if (cached) return cached;

  const errors: string[] = [];
  const values: Record<string, unknown> = {};

  for (const spec of SPECS) {
    const raw = process.env[spec.name];
    if (raw === undefined || raw === "") {
      if (spec.required) {
        errors.push(`  - ${spec.name}: required (${spec.description})`);
      }
      continue;
    }
    if (spec.parse) {
      try {
        values[spec.name] = spec.parse(raw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`  - ${spec.name}: ${msg}`);
      }
    } else {
      values[spec.name] = raw;
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors.join("\n")}\n\n` +
        `Refer to artifacts/api-server/src/lib/env.ts for the complete list of required and optional variables.`,
    );
  }

  const nodeEnv = (values.NODE_ENV as string | undefined) ?? "development";
  if (!["development", "production", "test"].includes(nodeEnv)) {
    throw new Error(
      `NODE_ENV must be one of development|production|test, got "${nodeEnv}"`,
    );
  }

  const corsRaw = values.CORS_ALLOWED_ORIGINS as string | undefined;
  const corsList = corsRaw
    ? corsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const replitDev = (values.REPLIT_DEV_DOMAIN as string | undefined) ?? null;

  // In dev, automatically allow the Replit preview domain unless explicitly overridden.
  if (corsList.length === 0 && nodeEnv !== "production" && replitDev) {
    corsList.push(`https://${replitDev}`);
  }

  cached = {
    NODE_ENV: nodeEnv as ValidatedEnv["NODE_ENV"],
    PORT: values.PORT as number,
    DATABASE_URL: values.DATABASE_URL as string,
    AI_INTEGRATIONS_OPENAI_API_KEY: values.AI_INTEGRATIONS_OPENAI_API_KEY as string,
    AI_INTEGRATIONS_OPENAI_BASE_URL: values.AI_INTEGRATIONS_OPENAI_BASE_URL as string,
    CORS_ALLOWED_ORIGINS: corsList,
    RATE_LIMIT_DISABLED: values.RATE_LIMIT_DISABLED === "1",
    SENTRY_DSN: (values.SENTRY_DSN as string | undefined) ?? null,
    RELEASE: (values.RELEASE as string | undefined) ?? null,
    LOG_LEVEL: (values.LOG_LEVEL as string | undefined) ?? "info",
    REPLIT_DEV_DOMAIN: replitDev,
  };
  return cached;
}

export function getEnv(): ValidatedEnv {
  // Validate-on-first-read: ESM hoists imports, so module-top-level uses of
  // getEnv() (e.g. middleware factories invoked while app.ts is being
  // imported) may run before index.ts gets a chance to call validateEnv()
  // explicitly. Lazy initialization keeps the fail-fast semantics without
  // depending on a particular import order.
  return cached ?? validateEnv();
}
