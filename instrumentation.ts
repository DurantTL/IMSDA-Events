import type { Instrumentation } from "next";

/**
 * Runs once when a server instance starts, before it accepts a request.
 *
 * The environment contract is checked here so a missing
 * `ATTENDEE_PASS_SIGNING_SECRET` fails the deploy rather than check-in morning.
 * `next build` also initialises the runtime; a build has no deployment
 * environment to validate, so it is skipped.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { assertServerEnvAtStartup } = await import("@/lib/env");
  assertServerEnvAtStartup();

  // The personal-data key (#1652): start loading it and keep retrying in the background if the vault does not
  // answer. Startup waits only a few seconds for it, so a slow or unreachable vault never fails or hangs a deploy;
  // protected fields stay locked until the key loads.
  const { startDataKeyLoading } = await import("@/lib/data-key/keyring");
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    (async () => startDataKeyLoading())().catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 5_000);
    }),
  ]);
  clearTimeout(timer);
}

/**
 * Catches every server error Next.js sees, including ones no route handler
 * caught, and records it as one structured line with the route that produced
 * it. The error itself goes through the logger's redaction rule rather than
 * being serialised whole.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  const { logError } = await import("@/lib/logger");
  const { redactTokenPath } = await import("@/lib/token-path");
  const correlationId = request.headers["x-correlation-id"];

  logError("Unhandled server error", error, {
    // No query string, and any private link token in the path is hidden.
    path: redactTokenPath(request.path.split(/[?#]/)[0] ?? ""),
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    correlationId: typeof correlationId === "string" ? correlationId : undefined,
  });
};
