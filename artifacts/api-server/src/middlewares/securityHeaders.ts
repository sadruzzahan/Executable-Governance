import helmet from "helmet";
import type { RequestHandler } from "express";
import { getEnv } from "../lib/env";

/**
 * Sane production defaults for security headers.
 *
 * CSP rationale:
 * - The API never serves HTML. The SPA is served from a separate origin
 *   (the Vite dev server in development, a CDN/static host in prod). To
 *   keep this hardening close to the API surface we still set a strict CSP
 *   that disallows arbitrary script execution against the API itself
 *   (defense-in-depth against any error/HTML response that might be
 *   reflected). The SPA host is responsible for its own page-level CSP.
 * - HSTS is enabled in production only (would break local http://).
 * - X-Frame-Options: DENY — the API must never be framed.
 * - Referrer-Policy: no-referrer — API URLs may contain query params we
 *   don't want leaked.
 * - Permissions-Policy: disables camera/microphone/geolocation by default.
 */
export function securityHeaders(): RequestHandler {
  const env = getEnv();
  const isProd = env.NODE_ENV === "production";

  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        scriptSrc: ["'none'"],
        styleSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-site" },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "no-referrer" },
    strictTransportSecurity: isProd
      ? { maxAge: 63072000, includeSubDomains: true, preload: true }
      : false,
    xFrameOptions: { action: "deny" },
    xContentTypeOptions: true,
    xPermittedCrossDomainPolicies: { permittedPolicies: "none" },
    xDnsPrefetchControl: { allow: false },
  });
}
