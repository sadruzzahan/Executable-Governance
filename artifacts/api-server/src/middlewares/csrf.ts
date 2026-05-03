import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";

const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "x-csrf-token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Returns true when the request carries the project's session cookie.
 * Until cookie auth lands the function returns false for every request,
 * which makes the CSRF middleware a transparent no-op while preserving
 * the wiring that will activate automatically once sessions arrive.
 */
function hasSessionCookie(req: Request): boolean {
  const cookieHeader = req.header("cookie");
  if (!cookieHeader) return false;
  return /(?:^|;\s*)(session|sid|connect\.sid)=/.test(cookieHeader);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Double-submit CSRF token middleware.
 *
 * Strategy:
 * - On any request that doesn't already carry a `csrf_token` cookie, mint
 *   one and set it (httpOnly: false so the SPA can read and echo it).
 * - For state-changing requests (POST/PATCH/PUT/DELETE) on cookie-authed
 *   sessions, require the `X-CSRF-Token` header to match the cookie value.
 * - Bearer-token (Authorization header) requests are exempt — there is no
 *   ambient credential a browser could attach automatically.
 */
export function csrfProtection(): RequestHandler {
  return (req, res, next) => {
    const cookieHeader = req.header("cookie") ?? "";
    const cookieMatch = cookieHeader.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    let token = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;

    if (!token) {
      token = randomBytes(32).toString("hex");
      res.setHeader(
        "Set-Cookie",
        `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=Strict; Secure; Max-Age=3600`,
      );
    }

    if (SAFE_METHODS.has(req.method)) return next();

    // No cookie session → no ambient credential → no CSRF risk for this request.
    if (!hasSessionCookie(req)) return next();

    const supplied = req.header(CSRF_HEADER);
    if (!supplied || !safeEqual(supplied, token)) {
      res.status(403).json({
        error: "csrf_failed",
        message: "Missing or invalid CSRF token. Submit the value of the csrf_token cookie in the X-CSRF-Token header.",
        requestId: req.requestId,
      });
      return;
    }
    next();
  };
}
