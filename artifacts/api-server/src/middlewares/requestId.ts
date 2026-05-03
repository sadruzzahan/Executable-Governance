import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const HEADER = "x-request-id";

declare module "http" {
  interface IncomingMessage {
    /** Correlation id assigned by requestId middleware. */
    requestId?: string;
  }
}

/**
 * Assigns a stable request id to every incoming request. Honours an
 * inbound `X-Request-Id` (if it looks like a sane id), otherwise mints a
 * fresh UUID v4. The id is surfaced on the response and on `req.requestId`
 * so downstream handlers, logger child bindings, and the error tracker can
 * correlate work across hops.
 */
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header(HEADER);
    const id =
      incoming && /^[A-Za-z0-9._\-:]{8,128}$/.test(incoming)
        ? incoming
        : randomUUID();
    req.requestId = id;
    res.setHeader(HEADER, id);
    next();
  };
}
