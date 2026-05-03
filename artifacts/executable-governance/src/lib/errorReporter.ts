/**
 * Frontend error reporter.
 *
 * Posts unhandled errors and unhandled promise rejections to the API's
 * `/api/client-errors` sink so they end up in the same structured log /
 * Sentry pipeline as backend exceptions. Best-effort only — failures
 * here are swallowed to avoid recursive reporting loops.
 *
 * Source-map / frame symbolication: the API sink already receives the
 * raw stack and a release tag. Production source maps are emitted by
 * the Vite build (`build.sourcemap = true`) and should be uploaded as
 * part of the deploy pipeline so the backend tracker can symbolicate
 * frames on ingest. Adding `@sentry/browser` here later is a drop-in
 * upgrade — replace the window/promise hooks with the SDK's and remove
 * the duplicate POST.
 */

const ENDPOINT = `${import.meta.env.BASE_URL}api/client-errors`;
const MAX_REPORTS_PER_SESSION = 50;

let reportCount = 0;
let installed = false;

interface ReportPayload {
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  release?: string;
  source: "window" | "promise" | "boundary" | "manual";
}

async function send(payload: ReportPayload): Promise<void> {
  if (reportCount >= MAX_REPORTS_PER_SESSION) return;
  reportCount += 1;
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        url: payload.url ?? window.location.href,
        userAgent: payload.userAgent ?? navigator.userAgent,
        release: import.meta.env.VITE_RELEASE ?? "dev",
      }),
      keepalive: true,
    });
  } catch {
    /* swallow — never recurse */
  }
}

export function reportError(err: unknown, source: ReportPayload["source"] = "manual"): void {
  if (err instanceof Error) {
    void send({ message: err.message, stack: err.stack, source });
  } else {
    void send({ message: String(err), source });
  }
}

export function installErrorReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    const err = event.error instanceof Error ? event.error : null;
    void send({
      message: err?.message ?? event.message ?? "Unknown error",
      stack: err?.stack,
      source: "window",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const err = reason instanceof Error ? reason : null;
    void send({
      message: err?.message ?? (typeof reason === "string" ? reason : "Unhandled promise rejection"),
      stack: err?.stack,
      source: "promise",
    });
  });
}
