import cors from "cors";
import type { RequestHandler } from "express";
import { getEnv } from "../lib/env";
import { logger } from "../lib/logger";

/**
 * Env-driven CORS allow-list. Defaults to LOCKED DOWN in production —
 * if no allow-list is configured, no cross-origin browser requests are
 * accepted.
 *
 * Same-origin requests (no Origin header) are always allowed; that covers
 * curl, healthchecks, and SPA requests that hit the API on the same host.
 */
export function corsConfig(): RequestHandler {
  const env = getEnv();
  const allow = new Set(env.CORS_ALLOWED_ORIGINS);

  if (allow.size === 0 && env.NODE_ENV === "production") {
    logger.warn(
      "CORS allow-list is empty in production — all cross-origin browser requests will be rejected. Set CORS_ALLOWED_ORIGINS to enable specific origins.",
    );
  }

  return cors({
    origin(origin, cb) {
      // No Origin header → not a browser cross-origin request.
      if (!origin) return cb(null, true);
      if (allow.has(origin)) return cb(null, true);
      cb(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-Id",
      "X-CSRF-Token",
    ],
    exposedHeaders: ["X-Request-Id", "Retry-After"],
    maxAge: 600,
  });
}
