import type { Request, Response } from "express";
import type { ZodError } from "zod";

/**
 * Write a consistent 400 response for a Zod validation failure.
 *
 * Envelope:
 *   {
 *     "error": "validation_failed",
 *     "message": "Request validation failed",
 *     "requestId": "<uuid>",
 *     "fields": [{ "path": "name", "message": "Required", "code": "invalid_type" }]
 *   }
 */
export function send400(res: Response, req: Request, err: ZodError): void {
  res.status(400).json({
    error: "validation_failed",
    message: "Request validation failed",
    requestId: req.requestId,
    fields: err.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
      code: i.code,
    })),
  });
}
