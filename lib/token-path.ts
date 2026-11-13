import { tokenRoutePrefixes } from "@/lib/token-routes";

/**
 * The path a log line carries, with the private token segment replaced before it can reach a log. The token routes come
 * from the one shared list (`lib/token-routes.ts`), so a new private link route is redacted as soon as it is listed there.
 * The older names below also stay redacted under `/api/public/` and without it, as before.
 *
 * Kept free of request-context imports so the instrumentation hook can use it.
 */
const LEGACY_TOKEN_PATH = /^(\/(?:api\/public\/)?(?:club-forms|manage|unsubscribe|staff-invite|staff-invitations|health-records)\/)[^/]+/;

export function redactTokenPath(pathname: string) {
  const legacy = pathname.replace(LEGACY_TOKEN_PATH, "$1[redacted]");
  if (legacy !== pathname) return legacy;
  const segments = pathname.split("/");
  // segments[0] is the empty string before the leading slash.
  if (segments[0] !== "") return pathname;
  const prefix = tokenRoutePrefixes.find((candidate) => segments.length > candidate.length + 1
    && candidate.every((part, index) => segments[index + 1] === part)
    && segments[candidate.length + 1] !== "");
  if (!prefix) return pathname;
  segments[prefix.length + 1] = "[redacted]";
  return segments.join("/");
}
