/**
 * The pure half of the per-area pause switch (#1518): which areas can be paused, what each one pauses, and which API
 * request belongs to which area. No server-only imports, so tests and client components can use it.
 *
 * What a pause does: a request that would CHANGE something in a paused area is refused with a friendly 503 and nothing
 * is written. Reading never pauses (GET, HEAD and OPTIONS pass), so pages, receipts and exports stay available.
 *
 * Never paused, by design: webhooks, the Square return page, sign-in and account security, every staff route
 * (`/api/admin`, `/api/events`, check-in) and the pause route itself, so an administrator can always turn a pause off.
 */

export const areaPauseKeys = ["EVENTS_REGISTRATION", "PAYMENTS", "CLUB_PORTAL"] as const;
export type AreaPauseKey = (typeof areaPauseKeys)[number];

export type AreaPauseDefinition = {
  key: AreaPauseKey;
  name: string;
  /** One line for the admin page: what pausing it stops. */
  pauses: string;
  /** Shown to a visitor whose request was refused. Short, friendly, and says nothing is lost. */
  message: string;
};

export const areaPauseDefinitions: readonly AreaPauseDefinition[] = [
  {
    key: "EVENTS_REGISTRATION",
    name: "Event registration",
    pauses: "New registrations and changes to an existing one (answers, lodging, cancellation, group details), whether made from the public form, a manage link, an account or a club's event registration. Pages stay readable.",
    message: "Event registration is paused for a few minutes while we fix something. Nothing you entered is lost, so please try again shortly.",
  },
  {
    key: "PAYMENTS",
    name: "Payments",
    pauses: "Starting an online payment, sending a payment link and choosing how to pay. Balances and receipts stay readable.",
    message: "Payments are paused for a few minutes while we fix something. Nothing is charged and nothing you entered is lost, so please try again shortly.",
  },
  {
    key: "CLUB_PORTAL",
    name: "Club portal",
    pauses: "Saving anything else in the club portal (rosters, honors, orders, reports, forms, team), club invites and the public club forms. Club registrations for an event follow Event registration. Pages stay readable.",
    message: "The club portal is paused for a few minutes while we fix something. Nothing you entered is lost, so please try again shortly.",
  },
];

export function isAreaPauseKey(value: unknown): value is AreaPauseKey {
  return typeof value === "string" && (areaPauseKeys as readonly string[]).includes(value);
}

export function getAreaPauseDefinition(area: AreaPauseKey): AreaPauseDefinition {
  const definition = areaPauseDefinitions.find((entry) => entry.key === area);
  if (!definition) throw new Error(`Unknown pause area: ${area}`);
  return definition;
}

/** The `NotificationSetting.key` that holds an area's switch. A row with `enabled = true` means PAUSED; no row means running. */
export const AREA_PAUSE_KEY_PREFIX = "AREA_PAUSE:";

export function areaPauseSettingKey(area: AreaPauseKey): string {
  return `${AREA_PAUSE_KEY_PREFIX}${area}`;
}

export function areaFromSettingKey(settingKey: string): AreaPauseKey | null {
  if (!settingKey.startsWith(AREA_PAUSE_KEY_PREFIX)) return null;
  const area = settingKey.slice(AREA_PAUSE_KEY_PREFIX.length);
  return isAreaPauseKey(area) ? area : null;
}

export const AREA_PAUSE_RETRY_AFTER_SECONDS = 120;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const PAYMENT_LEAVES = new Set(["payment", "payment-link", "payment-choice"]);

/** Paths (after the /api prefix) that belong to the club portal, as prefixes or exact paths. */
const CLUB_PORTAL_PREFIXES = [
  "/api/attendee/clubs/",
  "/api/attendee/area-clubs/",
  "/api/attendee/club-invites/",
  "/api/attendee/area-coordinator-invites/",
  "/api/attendee/honor-instructor/",
  "/api/public/club-forms/",
  "/api/public/club-form-applications/",
] as const;
const CLUB_PORTAL_EXACT = ["/api/public/club-applications"] as const;

/**
 * Club registrations for an event (registration, classes, draft, roster link, waitlist) are event registration, not
 * club-portal work, so the registration switch covers them.
 */
const CLUB_EVENT_REGISTRATION = /^\/api\/attendee\/clubs\/[^/]+\/events\//;

/**
 * Routes that use POST but only read (so a pause must not block them), under the paused club prefixes. Each was
 * checked: the roster export builds a preview or CSV (the audit row it writes records the download), and the
 * birth-dates route shows audited birth dates. Saved export formats (`/roster/export/formats`) WRITE, so they are
 * not listed. `/api/attendee/roster-unlock` is account security and is not under any paused prefix.
 */
const READ_ONLY_POSTS = [
  /^\/api\/attendee\/clubs\/[^/]+\/roster\/export$/,
  /^\/api\/attendee\/clubs\/[^/]+\/roster\/birth-dates$/,
] as const;

/**
 * Which area, if any, a request belongs to. Only requests that change something are ever classified: a read returns
 * null whatever its path. Webhooks, sign-in, account security and every staff route return null too.
 */
export function classifyPausableArea(method: string, pathname: string): AreaPauseKey | null {
  if (READ_METHODS.has(method.toUpperCase())) return null;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  if (READ_ONLY_POSTS.some((pattern) => pattern.test(path))) return null;
  if (CLUB_EVENT_REGISTRATION.test(path)) return "EVENTS_REGISTRATION";
  if (CLUB_PORTAL_EXACT.some((exact) => path === exact)) return "CLUB_PORTAL";
  if (CLUB_PORTAL_PREFIXES.some((prefix) => path.startsWith(prefix))) return "CLUB_PORTAL";

  // /api/public/manage/<token>[/<leaf>...] and /api/attendee/registrations/<id>[/<leaf>...]
  const registration = /^\/api\/(?:public\/manage|attendee\/registrations)\/[^/]+(?:\/([^/]+))?/.exec(path);
  if (registration) {
    return registration[1] && PAYMENT_LEAVES.has(registration[1]) ? "PAYMENTS" : "EVENTS_REGISTRATION";
  }

  if (path.startsWith("/api/public/events/")) return "EVENTS_REGISTRATION";
  return null;
}
