import { cache } from "react";
import { currentRequestScopedSet } from "@/lib/request-scoped-set";

/**
 * Which event accesses in this request went through the Clubs Administrator role (#1643). The permission lookup records a
 * `{userId, eventId}` pair when it grants a Clubs Administrator the event administrator role on a club event; the audit
 * write marks a row whose pair is recorded, synchronously, with no database query (a query there would need a second pool
 * connection inside the caller's transaction).
 *
 * Where it is kept:
 * - Route handlers wrapped by `withRequestContext` (including `mealRoute`): in a request-scoped set (AsyncLocalStorage,
 *   opened by `runWithRequestContext`), which follows the request through every await, transaction callback and repository.
 * - Server components, within one render: in a React `cache()` set, which React scopes to that render.
 * - Anywhere else (a handler not wrapped by `withRequestContext`, a server action (none exist today; Next runs them outside a
 *   render, so `cache()` returns a new set on every call), a script, a background job): nothing is kept, so a row is written
 *   unmarked. A missing marker therefore does not prove the access came from a real staff membership.
 */
const renderScoped = cache(() => new Set<string>());

function store(): Set<string> {
  return currentRequestScopedSet() ?? renderScoped();
}

const key = (userId: string, eventId: string) => `${userId}:${eventId}`;

export function recordClubsAdministratorAccess(userId: string, eventId: string): void {
  store().add(key(userId, eventId));
}

export function wasClubsAdministratorAccess(userId: string, eventId: string): boolean {
  return store().has(key(userId, eventId));
}
