import { sortParamNames } from "@/lib/list-sort";

/**
 * The address of the same list at another page (#1458): every param of the current address kept (filters, sort), the
 * list's page param set, and page 1 left out. `prefix` names a second table's own page param (`issuedPage`).
 */
export function searchPageHref(pathname: string, search: Record<string, string | string[] | undefined>, page: number, options: { prefix?: string; hash?: string } = {}): string {
  const params = new URLSearchParams();
  const name = sortParamNames(options.prefix).page;
  for (const [key, value] of Object.entries(search)) {
    if (key === name) continue;
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) for (const entry of value) params.append(key, entry);
  }
  if (page > 1) params.set(name, String(page));
  const text = params.toString();
  return `${pathname}${text ? `?${text}` : ""}${options.hash ?? ""}`;
}
