/**
 * Have I Been Pwned k-anonymity password lookup.
 *
 * Sends only the first 5 hex chars of SHA-1(password) over the wire; the
 * API returns every full-hash suffix in that bucket along with a count.
 * We compare locally so the plaintext password never leaves the server.
 *
 * The check is fail-open: a 5xx, timeout, or network error yields
 * `{ pwned: false, count: 0 }` so the lookup cannot become a soft DoS
 * on signups/password changes. The structured log line still surfaces
 * the failure so ops can spot a sustained outage.
 */
import { createHash } from "node:crypto";
import { logger } from "./logger";

const ENDPOINT = "https://api.pwnedpasswords.com/range";
const TIMEOUT_MS = 1500;

export interface HibpResult {
  pwned: boolean;
  count: number;
}

export async function checkPasswordPwned(password: string): Promise<HibpResult> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "executable-governance/1.0" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "HIBP lookup non-OK; failing open");
      return { pwned: false, count: 0 };
    }
    const body = await res.text();
    for (const line of body.split("\n")) {
      const [hashSuffix, countStr] = line.trim().split(":");
      if (hashSuffix === suffix) {
        const count = Number(countStr ?? "0") || 0;
        if (count > 0) return { pwned: true, count };
      }
    }
    return { pwned: false, count: 0 };
  } catch (err) {
    logger.warn({ err }, "HIBP lookup failed; failing open");
    return { pwned: false, count: 0 };
  } finally {
    clearTimeout(timer);
  }
}
