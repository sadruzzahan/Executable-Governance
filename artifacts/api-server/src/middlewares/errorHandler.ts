import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError, type ZodIssue } from "zod";
import { logger } from "../lib/logger";
import { captureException } from "../lib/errorTracking";

/**
 * Consistent error envelope returned by every failure mode in the API.
 *
 * { error: string, message: string, requestId: string, fields?: [...] }
 */

export interface ApiErrorBody {
  error: string;
  message: string;
  requestId?: string;
  fields?: Array<{ path: string; message: string; code?: string }>;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function zodToFields(err: ZodError): ApiErrorBody["fields"] {
  return err.issues.map((i: ZodIssue) => ({
    path: i.path.join("."),
    message: i.message,
    code: i.code,
  }));
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: "not_found",
    message: `No route for ${req.method} ${req.path}`,
    requestId: req.requestId,
  } satisfies ApiErrorBody);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Don't double-respond if headers are already sent (e.g. SSE streams).
  if (res.headersSent) {
    logger.error(
      { err, requestId: req.requestId },
      "Error after headers sent — connection terminated",
    );
    res.end();
    return;
  }

  // CORS rejections from the cors() middleware surface as plain errors.
  if (err instanceof Error && err.message.startsWith("Origin not allowed:")) {
    res.status(403).json({
      error: "cors_rejected",
      message: err.message,
      requestId: req.requestId,
    } satisfies ApiErrorBody);
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "validation_failed",
      message: "Request validation failed",
      requestId: req.requestId,
      fields: zodToFields(err),
    } satisfies ApiErrorBody);
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.code,
      message: err.message,
      requestId: req.requestId,
    } satisfies ApiErrorBody);
    return;
  }

  // Express's built-in JSON body parser errors carry a numeric .status.
  const status =
    typeof (err as { status?: unknown })?.status === "number"
      ? (err as { status: number }).status
      : 500;

  if (status >= 500) {
    logger.error(
      { err, requestId: req.requestId, route: `${req.method} ${req.path}` },
      "Unhandled error",
    );
    captureException(err, { requestId: req.requestId, route: `${req.method} ${req.path}` });
  } else {
    logger.warn(
      { err, requestId: req.requestId, route: `${req.method} ${req.path}` },
      "Client error",
    );
  }

  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Internal server error";

  res.status(status).json({
    error: status >= 500 ? "internal_error" : "bad_request",
    // Don't leak stack traces in 5xx — keep a short, generic message.
    message: status >= 500 ? "An unexpected error occurred." : message,
    requestId: req.requestId,
  } satisfies ApiErrorBody);
};
