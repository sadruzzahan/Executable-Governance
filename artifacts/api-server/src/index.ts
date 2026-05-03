// Boot-time env validation: fail fast with a clear, multi-line error
// before importing anything that touches the database, OpenAI client,
// or HTTP server. Side-effect import keeps the validate-then-load order
// explicit and intentional.
import { validateEnv, getEnv } from "./lib/env";
const env = validateEnv();

import app from "./app";
import { logger } from "./lib/logger";
import { initErrorTracking, captureException } from "./lib/errorTracking";

// Fire-and-forget: error tracking init does not block the listen() call.
// Until init resolves, captureException() falls back to structured logging.
void initErrorTracking(getEnv().RELEASE ?? undefined);

// Top-level safety net: never let an unhandled rejection or uncaught
// exception terminate the process silently. Log + capture so the
// production pipeline picks it up; on hard crashes, exit deliberately
// after a brief flush window so the supervisor restarts cleanly.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
  captureException(reason, { tags: { kind: "unhandledRejection" } });
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — shutting down");
  captureException(err, { tags: { kind: "uncaughtException" } });
  setTimeout(() => process.exit(1), 250).unref();
});

const server = app.listen(env.PORT, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, "Server listening");
});

const shutdown = (signal: string) => {
  logger.info({ signal }, "Received shutdown signal");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
