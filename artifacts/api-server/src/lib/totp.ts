/**
 * TOTP enrollment, verification, and recovery-code helpers.
 *
 * The shared secret is encrypted with AES-256-GCM at rest using a key
 * derived from MFA_SECRET_KEY (or DATABASE_URL as a deterministic
 * fallback in dev — production deployments must set MFA_SECRET_KEY).
 * That ensures a snapshot of the database alone is not enough to
 * impersonate a user's second factor.
 *
 * Built on otplib v13's functional API (`generateSecret`, `generateURI`,
 * `verify`). The verifier accepts a ±1 step (≈30 s) drift window so a
 * user whose clock is slightly off doesn't get locked out, while still
 * staying tight enough to be useful as a second factor.
 */
import { generateSecret, generateURI, verify as otpVerify } from "otplib";
import QRCode from "qrcode";
import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from "node:crypto";
import { getEnv } from "./env";

const ISSUER = "Executable Governance";
const STEP_TOLERANCE = 1;

function masterKey(): Buffer {
  const env = getEnv();
  // MFA_SECRET_KEY is required in production. Falling back to DATABASE_URL
  // is only acceptable in dev/test where we want zero-config bring-up;
  // in production DATABASE_URL is widely visible (logs, process listings,
  // ops tooling) and would weaken the encryption-at-rest of TOTP secrets.
  const explicit = process.env.MFA_SECRET_KEY;
  if (!explicit) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "MFA_SECRET_KEY is required in production to encrypt TOTP secrets at rest.",
      );
    }
  }
  const seed = explicit ?? env.DATABASE_URL;
  return scryptSync(seed, "eg-mfa-salt-v1", 32);
}

export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(encoded: string): string {
  const [ivB, tagB, ctB] = encoded.split(".");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]);
  return pt.toString("utf8");
}

export interface EnrollmentArtifacts {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

export async function startEnrollment(email: string): Promise<EnrollmentArtifacts> {
  const secret = generateSecret();
  const otpauthUrl = generateURI({ issuer: ISSUER, label: email, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { secret, otpauthUrl, qrDataUrl };
}

export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  // otplib's verify accepts ±N steps via `epochTolerance` (in seconds).
  const result = await otpVerify({
    secret,
    token: cleaned,
    epochTolerance: STEP_TOLERANCE * 30,
  });
  return result.valid === true;
}

/** Generate 8 fresh recovery codes. Returned plaintext is shown to the
 * user once; the caller persists sha256(code) for verification. */
export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}
