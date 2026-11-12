/**
 * The staff applications queue's views (#1589): Waiting (the default), Decided and Private links, kept in the address as
 * `?status=`, plus `?application=<id>` for one application on its own. No server-only code, so pages and components share it.
 */

export const APPLICATION_VIEWS = ["waiting", "decided", "links"] as const;
export type ApplicationView = (typeof APPLICATION_VIEWS)[number];

export const APPLICATIONS_PATH = "/admin/clubs/applications";

export const APPLICATION_VIEW_LABELS: Record<ApplicationView, string> = {
  waiting: "Waiting",
  decided: "Decided",
  links: "Private links",
};

function firstValue(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first : undefined;
}

/** The view a `?status=` names. Anything else is Waiting. */
export function parseApplicationView(value: unknown): ApplicationView {
  const text = firstValue(value)?.trim().toLowerCase();
  return APPLICATION_VIEWS.find((view) => view === text) ?? "waiting";
}

/** The application a `?application=` names, or null when the address has none (an empty value counts as none). */
export function parseApplicationId(value: unknown): string | null {
  const text = firstValue(value)?.trim();
  return text ? text : null;
}

/** The address of a view. Waiting is the default and stays out of the address. */
export function applicationsHref(view: ApplicationView): string {
  return view === "waiting" ? APPLICATIONS_PATH : `${APPLICATIONS_PATH}?status=${view}`;
}

/** The address of one application on its own. The back link comes from the application's status, so the address needs no view. */
export function applicationHref(applicationId: string): string {
  return `${APPLICATIONS_PATH}?application=${encodeURIComponent(applicationId)}`;
}

/** The view an application belongs to: waiting while undecided, decided after. */
export function viewOfApplication(status: string): "waiting" | "decided" {
  return status === "PENDING" ? "waiting" : "decided";
}
