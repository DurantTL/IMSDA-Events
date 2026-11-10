import type { RowView } from "@/components/staff-tab-row-model";

export type IssuedAssetsViewKey = "inventory" | "closeout";

type Permission = "MANAGE_CHECK_IN" | "MANAGE_FINANCE" | "CONFIGURE_EVENT" | "VIEW_REPORTS";

/** The permissions each issued item page admits, the same checks the pages make (the pages and their APIs still check on the server). */
export const closeoutPermissions: readonly Permission[] = ["MANAGE_CHECK_IN", "MANAGE_FINANCE", "CONFIGURE_EVENT", "VIEW_REPORTS"];
export const inventoryPermissions: readonly Permission[] = ["CONFIGURE_EVENT"];

const specs: ReadonlyArray<{ key: IssuedAssetsViewKey; label: string; path: string; anyOf: readonly Permission[] }> = [
  { key: "inventory", label: "Inventory", path: "/more/issued-assets", anyOf: inventoryPermissions },
  { key: "closeout", label: "Closeout", path: "/more/issued-assets/closeout", anyOf: closeoutPermissions },
];

/**
 * The issued item pages a viewer can open (#1581), in order: Inventory (event administrators) and Closeout (check-in staff,
 * finance, event administrators, report viewers). The issue and return desk lives under the Check-in tab, so it is a
 * header link on both pages (for MANAGE_CHECK_IN), not a view. Every link keeps ?event; `current` marks the page shown.
 */
export function issuedAssetsViews(eventId: string, permissions: readonly string[], current?: IssuedAssetsViewKey): RowView[] {
  return specs
    .filter((spec) => spec.anyOf.some((permission) => permissions.includes(permission)))
    .map((spec) => ({
      key: spec.key,
      label: spec.label,
      href: `${spec.path}?event=${encodeURIComponent(eventId)}`,
      ...(spec.key === current ? { current: true } : {}),
    }));
}

/** The issue and return desk (/check-in/assets) is for MANAGE_CHECK_IN, as the desk page checks. */
export const canOpenIssueDesk = (permissions: readonly string[]) => permissions.includes("MANAGE_CHECK_IN");

export const issueDeskHref = (eventId: string) => `/check-in/assets?event=${encodeURIComponent(eventId)}`;
