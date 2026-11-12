/**
 * The way back to the All forms hub (#1571). A form's Edit and Responses links carry `returnTo=<the hub's address>`, and each
 * target page shows "Back to All forms" only when that value is valid. `returnTo` is untrusted input: the path goes through
 * `safeReturnTo` and must be exactly `/admin/forms`, and the query is REBUILT from a short list of known parameters with
 * shape checks, so nothing else (a host, a nested `returnTo`, a script) rides along. It grants no access to any page.
 */
import { safeReturnTo } from "@/lib/return-to";
import { parseFormsHubOwner, type FormsHubFilters } from "@/modules/forms-hub/rows";

export const FORMS_HUB_PATH = "/admin/forms";
export const FORMS_HUB_BACK_LABEL = "Back to All forms";
export const FORMS_HUB_SORT_COLUMNS = ["form", "kind", "event", "status", "responses", "last"] as const;

const BASE = "https://events.example.test";
type Rule = (value: string) => boolean;
const oneOf = (...allowed: string[]): Rule => (value) => allowed.includes(value);

const allowedParams: Record<string, Rule> = {
  kind: oneOf("CLUB", "GENERAL", "EVENT"),
  status: oneOf("OPEN", "NOT_OPEN", "CLOSED"),
  owner: (value) => parseFormsHubOwner(value) !== null,
  q: (value) => value.length > 0 && value.length <= 100 && !/[\x00-\x1f\x7f]/.test(value),
  sort: oneOf(...FORMS_HUB_SORT_COLUMNS),
  dir: oneOf("asc", "desc"),
  page: (value) => /^[1-9]\d{0,3}$/.test(value),
};

function rebuild(source: { get(name: string): string | null }): string {
  const out = new URLSearchParams();
  for (const [name, ok] of Object.entries(allowedParams)) {
    const value = source.get(name);
    if (value !== null && ok(value)) out.set(name, value);
  }
  const text = out.toString();
  return text ? `${FORMS_HUB_PATH}?${text}` : FORMS_HUB_PATH;
}

/** The hub address for the current filters, sort and page, in the same rebuilt form `parseFormsHubReturn` returns. */
export function formsHubAddress(state: Partial<FormsHubFilters> & { sort?: string | null; dir?: string | null; page?: number }): string {
  const out = new URLSearchParams();
  if (state.kind) out.set("kind", state.kind);
  if (state.status) out.set("status", state.status);
  if (state.owner) out.set("owner", state.owner);
  if (state.q) out.set("q", state.q);
  if (state.sort) { out.set("sort", state.sort); out.set("dir", state.dir === "desc" ? "desc" : "asc"); }
  if (state.page && state.page > 1) out.set("page", String(state.page));
  return rebuild(out);
}

/** `href` with `returnTo=<hub address>` added (with `&` when `href` already has a query). */
export function withFormsHubReturn(href: string, hubAddress: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(hubAddress)}`;
}

/** The back link for a valid `returnTo`, with its address rebuilt from allowed parameters, or null (the page keeps its own back link). */
export function parseFormsHubReturn(value: string | string[] | null | undefined): { href: string; label: string } | null {
  if (typeof value !== "string" || value.length === 0) return null;
  // Only the path part goes through `safeReturnTo`; the query is rebuilt below, so a search such as "a//b" does not lose the way back.
  const queryAt = value.indexOf("?");
  const pathPart = queryAt === -1 ? value : value.slice(0, queryAt);
  if (pathPart !== FORMS_HUB_PATH || safeReturnTo(pathPart, "") !== pathPart) return null;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || url.pathname !== FORMS_HUB_PATH || url.hash) return null;
  return { href: rebuild(url.searchParams), label: FORMS_HUB_BACK_LABEL };
}
