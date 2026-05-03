import rateLimit, { type Options } from "express-rate-limit";
import type { RequestHandler } from "express";
import { getEnv } from "../lib/env";

interface PolicyOptions {
  windowMs: number;
  limit: number;
  /** Optional key function override (default: per-IP). */
  keyGenerator?: Options["keyGenerator"];
  /** Identifier used in the 429 body. */
  policy: string;
}

function buildLimiter(opts: PolicyOptions): RequestHandler {
  const env = getEnv();
  if (env.RATE_LIMIT_DISABLED) {
    // No-op middleware for test runs.
    return (_req, _res, next) => next();
  }

  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: opts.keyGenerator,
    handler: (req, res, _next, options) => {
      const retryAfter = Math.ceil(options.windowMs / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "rate_limited",
        message: `Too many requests. Try again in ${retryAfter}s.`,
        policy: opts.policy,
        requestId: req.requestId,
      });
    },
  });
}

/**
 * Per-IP global limiter applied to every API request as a coarse safety net.
 */
export const globalLimiter = (): RequestHandler =>
  buildLimiter({ windowMs: 60_000, limit: 600, policy: "global" });

/**
 * Stricter per-IP limiter for auth endpoints — protects against credential
 * stuffing / token brute force. Mount on /auth/* once auth lands.
 */
export const authLimiter = (): RequestHandler =>
  buildLimiter({ windowMs: 60_000, limit: 20, policy: "auth" });

/**
 * AI endpoints (analyze / simulate / explain) are expensive — both in
 * latency and upstream model cost. Tight per-IP limit.
 */
export const aiLimiter = (): RequestHandler =>
  buildLimiter({ windowMs: 60_000, limit: 30, policy: "ai" });

/**
 * Decision evaluation is the hot path for governance enforcement. Higher
 * ceiling than AI, lower than global, since each call hits the DB and may
 * cascade into AI for explanation generation.
 */
export const decisionLimiter = (): RequestHandler =>
  buildLimiter({ windowMs: 60_000, limit: 120, policy: "decision" });

/**
 * Outbound webhook receivers are intentionally generous on burst but
 * windowed — keeps a misconfigured upstream from drowning us. Mount once
 * webhook routes land.
 */
export const webhookLimiter = (): RequestHandler =>
  buildLimiter({ windowMs: 60_000, limit: 240, policy: "webhook" });

/**
 * Frontend error reporting endpoint. Browser-side caps the volume too,
 * but a misbehaving (or hostile) client could still bombard the sink and
 * pollute the logs / Sentry quota. Tight per-IP ceiling protects the
 * telemetry pipeline independent of the client cap.
 */
export const clientErrorsLimiter = (): RequestHandler =>
  buildLimiter({ windowMs: 60_000, limit: 60, policy: "client-errors" });
