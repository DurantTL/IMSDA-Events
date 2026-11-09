import { safeGetItem, safeSetItem } from "@/lib/safe-storage";

/**
 * A tiny browser-side list of the last few error ids (#1715). The only thing ever kept is the Next.js error digest, the id
 * that matches the server log. It is checked against a strict pattern, so an error message, name or stack (which can hold a
 * name or an email) is never stored, even by mistake. The Forms help popup reads it for "Include technical details".
 * It lives in sessionStorage so it survives moving from the error page to a form in the same tab, and falls back to memory
 * when storage is blocked.
 */
export const RECENT_ERROR_ID_MAX = 5;
export const ERROR_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const STORAGE_KEY = "imsda-recent-error-ids";
let memoryIds: string[] = [];

const isErrorId = (value: unknown): value is string => typeof value === "string" && ERROR_ID_PATTERN.test(value);

/** Keeps only valid ids, first occurrence of each, at most the limit. */
function cleanIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const value of values) {
    if (isErrorId(value) && !out.includes(value)) out.push(value);
    if (out.length >= RECENT_ERROR_ID_MAX) break;
  }
  return out;
}

/** The recent ids, newest first. Never throws; corrupt or foreign storage content is ignored entry by entry. */
export function readRecentErrorIds(): string[] {
  const raw = safeGetItem("session", STORAGE_KEY);
  if (raw !== null) {
    try {
      return cleanIds(JSON.parse(raw));
    } catch {
      return cleanIds(memoryIds);
    }
  }
  return cleanIds(memoryIds);
}

/** Records an error digest. Anything that is not a plain id (including undefined) is ignored: never the message, name or stack. */
export function recordErrorId(digest: unknown): void {
  if (!isErrorId(digest)) return;
  const next = cleanIds([digest, ...readRecentErrorIds()]);
  memoryIds = next;
  safeSetItem("session", STORAGE_KEY, JSON.stringify(next));
}

/** For tests. */
export function resetRecentErrorIdsMemory(): void {
  memoryIds = [];
}
