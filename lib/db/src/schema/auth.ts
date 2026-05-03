import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

/**
 * Argon2id password hashes. One-to-one with users; rows only exist for
 * users who have set a password (invited users without an initial
 * password go through the password-reset flow).
 */
export const userPasswordsTable = pgTable("user_passwords", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  hash: text("hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Server-side session records. The browser receives an opaque random
 * token; the table stores its sha256 so a database leak does not yield
 * usable session credentials.
 */
export const userSessionsTable = pgTable(
  "user_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    deviceLabel: text("device_label"),
    mfaPassed: boolean("mfa_passed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex("user_sessions_token_hash_idx").on(t.tokenHash),
    userIdIdx: index("user_sessions_user_id_idx").on(t.userId),
  }),
);

/**
 * Single-use, time-bound tokens used by the forgot-password and email
 * verification flows. Token plaintext is never persisted: the table
 * stores a sha256 of the token; the email link carries the plaintext.
 */
export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex("password_reset_tokens_token_hash_idx").on(t.tokenHash),
  }),
);

/**
 * Email-verification tokens cover both initial signup verification and
 * email-change verification. When `pendingEmail` is set the row is an
 * email-change confirmation: consuming the token swaps users.email to
 * pendingEmail. When null the row simply marks the current address as
 * verified.
 */
export const emailVerificationTokensTable = pgTable(
  "email_verification_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    pendingEmail: text("pending_email"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex("email_verification_tokens_token_hash_idx").on(
      t.tokenHash,
    ),
  }),
);

/**
 * One MFA secret per user. `enabledAt` is null while enrollment is
 * pending verification of the first OTP; once verified the user must
 * present the second factor at every login. The secret is stored
 * encrypted at rest using a server-held key (see lib/totp.ts).
 */
export const mfaSecretsTable = pgTable("mfa_secrets", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  secretEnc: text("secret_enc").notNull(),
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * MFA recovery codes. Eight rows per user, each storing a sha256 of the
 * plaintext code. The plaintext is shown to the user exactly once on
 * generation; consuming a code marks the row used.
 */
export const mfaRecoveryCodesTable = pgTable(
  "mfa_recovery_codes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdIdx: index("mfa_recovery_codes_user_id_idx").on(t.userId),
  }),
);

/**
 * Outbound email log. Real transactional email is a downstream task —
 * for now every send is persisted here so flows are traceable end-to-end
 * (and so an admin can copy the link in dev).
 */
export const emailOutboxTable = pgTable("email_outbox", {
  id: serial("id").primaryKey(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  kind: text("kind").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserPassword = typeof userPasswordsTable.$inferSelect;
export type UserSession = typeof userSessionsTable.$inferSelect;
export type MfaSecret = typeof mfaSecretsTable.$inferSelect;
export type MfaRecoveryCode = typeof mfaRecoveryCodesTable.$inferSelect;
export type EmailOutbox = typeof emailOutboxTable.$inferSelect;

// Re-export so other code can reference organizationsTable for FK chains.
export { organizationsTable };
