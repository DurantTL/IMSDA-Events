import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A set that lives for one request (#1643), opened by `runWithRequestContext` in `lib/request-context.ts` and read by
 * `lib/clubs-administrator-access-record.ts`. A file of its own with no imports, so code that only records or reads the
 * set never loads the request context's logging setup.
 */
const storage = new AsyncLocalStorage<Set<string>>();

export function runWithRequestScopedSet<T>(run: () => T): T {
  return storage.run(new Set<string>(), run);
}

export function currentRequestScopedSet(): Set<string> | undefined {
  return storage.getStore();
}
