import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * Returns `{ token, hash }`. The plaintext `token` is sent to the user
 * (e.g. via email link); only the `hash` is stored in the database.
 * Lookups are by hash — never the plaintext — so a database leak does
 * not yield usable tokens.
 */
export function mintToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  const hash = hashToken(token);
  return { token, hash };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time string equality. Both inputs must be hex/base64. */
export function safeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
