import { AsyncLocalStorage } from "node:async_hooks";
import { requestCorrelationId, setLogRequestFieldSource } from "@/lib/logger";
import { runWithRequestScopedSet } from "@/lib/request-scoped-set";
import { redactTokenPath } from "@/lib/token-path";
import { withNoStore } from "@/lib/live-list-response";
import { classifyPausableArea } from "@/modules/system-admin/area-pause-model";
import { archivedWriteTarget } from "@/modules/events/archived-read-only";

/**
 * One correlation ID per request, reachable from anywhere inside it.
 *
 * Structured logging landed with an ID minted per log call, which meant two
 * lines from the same request could not be tied together. Threading a parameter
 * through every handler, service, and repository was the alternative to this;
 * an async-context store is the same result without changing thirty signatures.
 *
 * `AuditLog.correlationId` already exists for domain events. This is the same
 * idea for the request itself, and the two use the same header, so one
 * registration can be followed from the proxy log to the audit entry.
 */

export type RequestContext = {
  correlationId: string;
  method?: string;
  path?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

// Every log line written inside a request carries the request's identity,
// without each of the ~30 route-level error helpers having to pass it.
setLogRequestFieldSource(() => {
  const context = storage.getStore();
  if (!context) return undefined;
  return {
    correlationId: context.correlationId,
    ...(context.method ? { method: context.method } : {}),
    ...(context.path ? { path: context.path } : {}),
  };
});

export function runWithRequestContext<T>(context: RequestContext, run: () => T): T {
  return storage.run(context, () => runWithRequestScopedSet(run));
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export const CORRELATION_HEADER = "x-correlation-id";

/**
 * Wraps a route handler so everything it calls shares one correlation ID, and
 * so the response carries that ID back. Echoing it is what lets someone
 * reporting a failed registration quote a value that appears in the logs.
 */
export function withRequestContext<Arguments extends unknown[]>(
  handler: (request: Request, ...rest: Arguments) => Promise<Response>,
) {
  return async function handleWithContext(
    request: Request,
    ...rest: Arguments
  ): Promise<Response> {
    const url = safePath(request.url);
    const context: RequestContext = {
      // Reuses a proxy-supplied ID when there is one, so a single request keeps
      // one identity across hops. The inbound value is bounded and constrained
      // by requestCorrelationId, because it is attacker-controlled.
      correlationId: requestCorrelationId(request),
      method: request.method,
      path: url,
    };

    const response = await runWithRequestContext(context, async () => {
      const path = rawPath(request.url);
      // A paused area refuses the change before the handler runs (#1518). Only a request that matches an area reads the switch.
      // Loaded on demand so every other route (and anything that imports this file) never pulls in the database client.
      if (classifyPausableArea(request.method, path)) {
        const { refuseIfAreaPaused } = await import("@/modules/system-admin/area-pause");
        const paused = await refuseIfAreaPaused(request);
        if (paused) return paused;
      }
      // A write to an archived event is refused before the handler runs (#159). Only event write paths load the guard.
      const archivedTarget = archivedWriteTarget(request.method, path);
      if (archivedTarget) {
        const { refuseArchivedWriteFor } = await import("@/modules/events/archived-read-only-guard");
        const archived = await refuseArchivedWriteFor(archivedTarget);
        if (archived) return archived;
      }
      return handler(request, ...rest);
    });
    // Response headers are immutable once set on some responses, so failing to
    // attach the header must never turn a successful response into an error.
    try {
      // Every API response is current data: never stored (rule P2, #1445), unless the handler chose its own header.
      withNoStore(response);
      response.headers.set(CORRELATION_HEADER, context.correlationId);
      return response;
    } catch {
      return response;
    }
  };
}

export { redactTokenPath } from "@/lib/token-path";

/** The unredacted path, only to decide which area a request belongs to. Never logged. */
function rawPath(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function safePath(url: string) {
  try {
    return redactTokenPath(new URL(url).pathname);
  } catch {
    return undefined;
  }
}
