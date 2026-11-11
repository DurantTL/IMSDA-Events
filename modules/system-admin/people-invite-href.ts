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

/**
 * `/admin/people/invite-lookup?email=...&grant=...` (#1804): where a Clubs Administrator is sent to give a first club role to
 * an existing website account. Only the family-side items (Area Coordinator, club roles) are carried; the lookup finds the
 * account by this email and shows only what is needed to save them.
 */
export function inviteLookupHref(email: string, items: readonly GrantItem[]) {
  const family = items.filter((item) => item.type === "ac" || item.type === "club");
  const grant = family.length > 0 ? `&grant=${encodeURIComponent(formatGrantParam(family))}` : "";
  return `/admin/people/invite-lookup?email=${encodeURIComponent(email)}${grant}`;
}
