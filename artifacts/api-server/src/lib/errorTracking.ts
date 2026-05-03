/**
 * Error tracking sink — Sentry-equivalent.
 *
 * The application code only depends on `captureException()` /
 * `captureMessage()` here; the actual transport is determined at boot
 * based on configuration:
 *
 * - If `SENTRY_DSN` is configured AND `@sentry/node` is installed, the
 *   Sentry SDK is initialized at boot and every capture call is forwarded
 *   to it. This is the production path.
 * - If `SENTRY_DSN` is configured but the SDK is not installed, a clear
 *   warning is logged and the structured-log sink is used as a fallback
 *   so no errors are silently dropped.
 * - If `SENTRY_DSN` is not configured, structured pino lines are emitted
 *   with the full error context (request id, route, user/org id when
 *   bound). That log line is the substrate any production log pipeline
 *   (Datadog, Loggly, CloudWatch, Sentry's server-side ingester) can
 *   consume.
 *
 * This indirection means swapping in any tracker (Sentry, Bugsnag,
 * Honeybadger, Rollbar) is a single-file change with zero churn in route
 * handlers.
 */

import { getEnv } from "./env";
import { logger } from "./logger";

export interface ErrorContext {
  requestId?: string;
  route?: string;
  userId?: string | number;
  organizationId?: string | number;
  /** Free-form structured tags attached to the event. */
  tags?: Record<string, string | number | boolean>;
  /** Free-form structured extras (large payloads, request body fragments). */
  extra?: Record<string, unknown>;
}

interface SentryLike {
  init(opts: Record<string, unknown>): void;
  captureException(err: unknown, context?: Record<string, unknown>): void;
  captureMessage(
    message: string,
    context?: Record<string, unknown>,
  ): void;
}

let initialized = false;
let sentry: SentryLike | null = null;

export async function initErrorTracking(release?: string): Promise<void> {
  if (initialized) return;
  initialized = true;
  const env = getEnv();
  if (!env.SENTRY_DSN) {
    logger.info(
      "Error tracking: structured-log sink (no SENTRY_DSN configured).",
    );
    return;
  }
  try {
    // Dynamic import so the @sentry/node dependency is optional. When the
    // package is installed at deploy time, this call resolves and we wire
    // the SDK in. When it isn't, we degrade gracefully to log-only.
    // The @sentry/node package is intentionally optional; it isn't
    // declared as a dep so dev installs stay slim. The cast + variable
    // indirection keeps the dynamic import opaque to the TS module
    // resolver — at runtime it succeeds when the SDK is present and
    // returns null otherwise.
    const sentryPkg = "@sentry/node";
    const mod = (await import(/* @vite-ignore */ sentryPkg).catch(
      () => null,
    )) as SentryLike | null;
    if (!mod || typeof mod.init !== "function") {
      logger.warn(
        { release },
        "Error tracking: SENTRY_DSN configured but @sentry/node is not installed — falling back to structured-log sink. Run `pnpm add @sentry/node` in artifacts/api-server to enable SDK transport.",
      );
      return;
    }
    mod.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      release: release ?? process.env.RELEASE,
      tracesSampleRate: 0,
    });
    sentry = mod;
    logger.info(
      { release, env: env.NODE_ENV },
      "Error tracking: Sentry SDK initialized.",
    );
  } catch (err) {
    logger.error(
      { err },
      "Error tracking: failed to initialize Sentry — falling back to structured-log sink.",
    );
  }
}

function buildSentryContext(ctx: ErrorContext): Record<string, unknown> {
  const tags: Record<string, string | number | boolean> = { ...(ctx.tags ?? {}) };
  if (ctx.route) tags.route = ctx.route;
  if (ctx.requestId) tags.request_id = ctx.requestId;
  return {
    tags,
    extra: ctx.extra ?? {},
    user:
      ctx.userId != null || ctx.organizationId != null
        ? { id: ctx.userId, organizationId: ctx.organizationId }
        : undefined,
  };
}

export function captureException(err: unknown, ctx: ErrorContext = {}): void {
  // Always emit a structured log line so the local console + log pipeline
  // record the event regardless of whether the SDK is wired in.
  logger.error(
    {
      err,
      requestId: ctx.requestId,
      route: ctx.route,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      tags: ctx.tags,
      extra: ctx.extra,
      sentry: sentry !== null,
    },
    "captured_exception",
  );
  if (sentry) {
    try {
      sentry.captureException(err, buildSentryContext(ctx));
    } catch {
      /* never let the tracker break the request */
    }
  }
}

export function captureMessage(
  message: string,
  level: "info" | "warning" | "error",
  ctx: ErrorContext = {},
): void {
  const payload = {
    requestId: ctx.requestId,
    route: ctx.route,
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    tags: ctx.tags,
    extra: ctx.extra,
    sentry: sentry !== null,
  };
  if (level === "error") logger.error(payload, message);
  else if (level === "warning") logger.warn(payload, message);
  else logger.info(payload, message);
  if (sentry) {
    try {
      sentry.captureMessage(message, { ...buildSentryContext(ctx), level });
    } catch {
      /* never let the tracker break the request */
    }
  }
}
