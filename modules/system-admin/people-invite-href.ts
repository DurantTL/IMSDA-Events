import { formatGrantParam, type GrantItem } from "@/modules/system-admin/people-directory-model";

/**
 * `/admin/people/<staff|account>/<id>?grant=...` (#1276): the page of a person who already has an account, with the chosen
 * access ready to save. The staff page when staff-side items are deferred and a staff login exists, else the website
 * account's page (a linked pair opens the same person from either id).
 */
export function deferredPersonHref(person: { staffId: string | null; accountId: string | null }, items: readonly GrantItem[]) {
  const staffSide = items.some((item) => item.type === "sa" || item.type === "ca" || item.type === "event");
  const kind = staffSide && person.staffId ? "staff" : person.accountId ? "account" : "staff";
  const id = kind === "staff" ? person.staffId : person.accountId;
  return `/admin/people/${kind}/${encodeURIComponent(id ?? "")}?grant=${encodeURIComponent(formatGrantParam(items))}`;
}
