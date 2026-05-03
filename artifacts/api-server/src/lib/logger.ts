import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Structured JSON logger.
 *
 * Redaction list covers every place a credential, token, cookie, or PII
 * field is likely to appear in a request or response so they never hit
 * the log pipeline. Add new entries here whenever a new auth header or
 * sensitive field is introduced.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    service: "api-server",
    env: process.env.NODE_ENV ?? "development",
  },
  redact: {
    paths: [
      // Request headers
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-csrf-token']",
      "req.headers['x-api-key']",
      "req.headers['proxy-authorization']",
      // Response headers
      "res.headers['set-cookie']",
      // Common credential fields anywhere in the payload
      "*.password",
      "*.passwordHash",
      "*.password_hash",
      "*.secret",
      "*.token",
      "*.accessToken",
      "*.access_token",
      "*.refreshToken",
      "*.refresh_token",
      "*.apiKey",
      "*.api_key",
      "*.privateKey",
      "*.private_key",
      "*.sessionId",
      "*.session_id",
      // PII commonly tunnelled in decision context
      "*.ssn",
      "*.taxId",
      "*.tax_id",
      "*.creditCard",
      "*.credit_card",
    ],
    censor: "[REDACTED]",
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
