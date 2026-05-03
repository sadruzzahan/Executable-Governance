import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { getEnv } from "../lib/env";

interface PolicyOptions {
  windowMs: number;
  limit: number;
  /** Optional key function override. Defaults to per-principal then per-IP. */
  keyGenerator?: Options["keyGenerator"];
  /** Identifier used in the 429 body. */
  policy: string;
}

/**
 * Augment Express request typing for the principal hook. Auth middleware,
 * once it lands, populates `req.principal` with `{ kind, id }`. Until
 * then we fall back to a stable hash of the bearer/api-key header (so
 * pre-auth API consumers each get their own bucket) and finally per-IP.
 *
 * IP-only keying is dangerous behind a shared NAT or corporate proxy
 * — one noisy neighbour exhausts the bucket for every other client on
 * the same egress IP. Per-principal keying ensures a hostile token
 * holder is throttled in isolation.
 */
declare module "http" {
  interface IncomingMessage {
    /** Populated by auth middleware once it lands. */
    principal?: { kind: "user" | "service" | "anonymous"; id: string };
  }
}

function principalKey(prefix: string): (req: Request) => string {
  return (req) => {
    if (req.principal?.id) {
      return `${prefix}:p:${req.principal.kind}:${req.principal.id}`;
    }
    const auth = req.headers.authorization;
    if (typeof auth === "string" && auth.length > 8) {
      // Hash the credential so it never appears in memory dumps / logs as plaintext.
      const tail = auth.slice(-12);
      return `${prefix}:t:${tail}`;
    }
    const apiKey = req.headers["x-api-key"];
    if (typeof apiKey === "string" && apiKey.length > 8) {
      return `${prefix}:k:${apiKey.slice(-12)}`;
    }
    // Delegate to the library's IPv6-safe helper so we don't accidentally
    // collapse IPv6 /64 ranges into a single bucket and let attackers
    // bypass the limiter by rotating addresses inside their allocation.
    return `${prefix}:ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
  };
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
    keyGenerator: opts.keyGenerator ?? principalKey(opts.policy),
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
 * Coarse safety-net limiter applied to every API request. Keyed per
 * principal (with IP fallback) so a single misbehaving caller cannot
 * starve the rest of a shared egress.
 */
export const globalLimiter = (): RequestHandler =>
  buildLimiter({ windowMs: 60_000, limit: 600, policy: "global" });

/**
 * Stricter limiter for auth endpoints — protects against credential
 * stuffing and token brute force. Per-principal keying prevents an
 * attacker behind a shared NAT from masking attempts.
 */
export const authLimiter = (): RequestHandler =>
  buildLimiter({ windowMs: 60_000, limit: 20, policy: "auth" });

/**
 * AI endpoints (analyze / simulate / explain) are expensive — both in
 * latency and upstream model cost. Per-principal limit so a single
 * compromised token cannot drain the model budget.
 */
export const aiLimiter = (): RequestHandler =>
  buildLimiter({ windowMs: 60_000, limit: 30, policy: "ai" });

/**
 * Decision evaluation is the hot path for governance enforcement. Higher
 * ceiling than AI, lower than global, since each call hits the DB and
 * may cascade into AI for explanation generation.
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
 * pollute the logs / Sentry quota. Tight per-principal+IP ceiling
 * protects the telemetry pipeline independent of the client cap.
 */
export const clientErrorsLimiter = (): RequestHandler =>
  buildLimiter({ windowMs: 60_000, limit: 60, policy: "client-errors" });
