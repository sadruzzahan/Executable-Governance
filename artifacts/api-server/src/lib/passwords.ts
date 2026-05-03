/**
 * Password hashing + strength scoring.
 *
 * Uses bcryptjs (pure-JS bcrypt) so the api-server stays portable across
 * environments that lack a C++ toolchain. Cost factor 12 is in line with
 * 2024 OWASP guidance and tunable here when hardware moves on.
 */
import bcrypt from "bcryptjs";

const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export interface StrengthResult {
  /** Score 0–4 (0 = unusable, 4 = strong). */
  score: 0 | 1 | 2 | 3 | 4;
  /** Bullet-list of human-readable improvement hints. */
  warnings: string[];
}

const COMMON = new Set([
  "password",
  "password1",
  "password123",
  "qwerty",
  "letmein",
  "admin",
  "welcome",
  "iloveyou",
  "monkey",
  "dragon",
  "abc123",
  "12345678",
  "123456789",
  "qwerty123",
]);

/**
 * Cheap, dependency-free strength estimator. Authoritative breach
 * checking lives in `hibp.ts`; this exists for instant client feedback
 * and as a hard floor (score 0/1 is rejected on the server).
 */
export function strengthScore(password: string): StrengthResult {
  const warnings: string[] = [];
  if (!password) return { score: 0, warnings: ["Password is empty"] };

  const length = password.length;
  const lower = /[a-z]/.test(password);
  const upper = /[A-Z]/.test(password);
  const digit = /[0-9]/.test(password);
  const symbol = /[^A-Za-z0-9]/.test(password);
  const classes = [lower, upper, digit, symbol].filter(Boolean).length;

  if (length < 12) warnings.push("Use at least 12 characters");
  if (classes < 3) warnings.push("Mix upper/lower case, digits and symbols");
  if (COMMON.has(password.toLowerCase())) warnings.push("Avoid common passwords");
  if (/(.)\1{3,}/.test(password)) warnings.push("Avoid long repeating sequences");

  let score: 0 | 1 | 2 | 3 | 4 = 0;
  if (length >= 8) score = 1;
  if (length >= 12 && classes >= 2) score = 2;
  if (length >= 14 && classes >= 3) score = 3;
  if (length >= 16 && classes >= 3 && warnings.length === 0) score = 4;
  if (COMMON.has(password.toLowerCase())) score = 0;

  return { score, warnings };
}
