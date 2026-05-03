import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import clientErrorsRouter from "./routes/clientErrors";
import { logger } from "./lib/logger";
import { requestId } from "./middlewares/requestId";
import { securityHeaders } from "./middlewares/securityHeaders";
import { corsConfig } from "./middlewares/corsConfig";
import {
  globalLimiter,
  aiLimiter,
  decisionLimiter,
  clientErrorsLimiter,
  authLimiter,
} from "./middlewares/rateLimit";
import { csrfProtection } from "./middlewares/csrf";
import { sessionAuth } from "./middlewares/auth";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";

const app: Express = express();

// Trust the platform proxy so per-IP rate limits and request logging see
// the real client address rather than the loopback proxy.
app.set("trust proxy", 1);

// 1. Request id (must be first so every other layer can correlate).
app.use(requestId());

// 2. Security headers.
app.use(securityHeaders());

// 3. CORS allow-list (handles preflight before any auth/parsing).
app.use(corsConfig());

// 4. Structured request logging — child binding per request carries the
// request id and (when bound) the principal.
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.requestId ?? "",
    customProps: (req) => ({
      requestId: req.requestId,
      // user/org bindings will populate once auth lands
      userId: (req as unknown as { userId?: string }).userId,
      organizationId: (req as unknown as { organizationId?: string }).organizationId,
    }),
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// 5. Body parsers with explicit limits so a single huge POST can't
// exhaust the heap.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// 6. Session-cookie authentication. Runs before CSRF so requireAuth
// downstream sees a populated req.user; CSRF then enforces double-submit
// only when a session cookie is present.
app.use(sessionAuth());

// 7. CSRF — activates whenever the eg_session cookie is present.
app.use(csrfProtection());

// 8. Global per-IP rate limit as a coarse safety net.
app.use(globalLimiter());

// 9. Per-route limiters layered on top of the global one.
app.use("/api/auth/login", authLimiter());
app.use("/api/auth/forgot-password", authLimiter());
app.use("/api/auth/reset-password", authLimiter());
app.use("/api/auth/verify-email", authLimiter());
app.use("/api/decisions/evaluate", decisionLimiter());
app.use("/api/rules/:id/analyze", aiLimiter());
app.use("/api/rules/:id/simulate", aiLimiter());
app.use("/api/client-errors", clientErrorsLimiter());

// 9. Application routes.
app.use("/api", router);
app.use("/api", clientErrorsRouter);

// 10. 404 + centralized error handler — must be the last middleware so
// every preceding layer can `next(err)` into them.
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
