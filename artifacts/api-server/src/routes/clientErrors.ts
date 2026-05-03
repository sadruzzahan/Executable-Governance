import { Router, type IRouter } from "express";
import { z } from "zod";
import { captureException } from "../lib/errorTracking";
import { send400 } from "../lib/validation";

const router: IRouter = Router();

const ClientErrorBody = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(20_000).optional(),
  url: z.string().max(2000).optional(),
  userAgent: z.string().max(500).optional(),
  release: z.string().max(100).optional(),
  /** Browser-side request id this error was associated with, if any. */
  requestId: z.string().max(128).optional(),
  /** Source: "window" | "promise" | "boundary" | "manual". */
  source: z.enum(["window", "promise", "boundary", "manual"]).optional(),
});

router.post("/client-errors", (req, res) => {
  const parsed = ClientErrorBody.safeParse(req.body);
  if (!parsed.success) {
    send400(res, req, parsed.error);
    return;
  }
  const { message, stack, url, userAgent, release, source } = parsed.data;
  // Convert to a real Error so the structured sink renders a stack.
  const err = new Error(message);
  if (stack) err.stack = stack;
  captureException(err, {
    requestId: req.requestId,
    route: "client",
    tags: {
      source: source ?? "unknown",
      release: release ?? "unknown",
    },
    extra: { url, userAgent, clientRequestId: parsed.data.requestId },
  });
  res.status(202).json({ accepted: true, requestId: req.requestId });
});

export default router;
