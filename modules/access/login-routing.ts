import { safeReturnTo } from "@/lib/return-to";
import { requestTargetPrefixes } from "@/modules/access/request-target";

export type LoginRoutingEvent = { id: string };

export type LoginRoutingInput = {
  /** Whether the signed-in account is a system administrator. */
  isSystemAdmin: boolean;
  /**
   * The staff account's active event memberships. Ignored when
   * `isSystemAdmin` is true.
   */
  events: readonly LoginRoutingEvent[];
  /**
   * The event remembered from a previous visit (the `imsda-last-event`
   * cookie), if any. Only used when it is still one of `events`.
   */
  lastEventId?: string | null;
  /**
   * An unvalidated `next`/`returnTo` value carried by the login request, if
   * any — for example a deep link that bounced to `/login`. Validated here
   * with `safeReturnTo` before it can override role routing.
   */
  returnTo?: string | null;
};

export const SYSTEM_ADMIN_PATH = "/admin";
export const NO_EVENTS_PATH = "/no-access";
export const EVENT_PICKER_PATH = "/select-event";
/** Where a signed-in attendee or club leader (no staff session) is sent from a staff page, so they are told it is not theirs. */
export const NO_STAFF_ACCESS_PATH = "/no-access?from=attendee";
/**
 * Where sign-in lands when role routing itself fails after the session is
 * already issued — the pre-#108 destination, whose workspace layout picks an
 * event on its own.
 */
export const DEFAULT_POST_LOGIN_DESTINATION = "/overview";

/**
 * Decides where a signed-in staff account lands after `/login` (#108 queue
 * 1: unified login entry and role-aware dashboard routing).
 *
 * Pure and side-effect-free — no cookies, no database, no Next.js request
 * APIs — so the decision itself is unit-testable on its own. Callers gather
 * `events` and `lastEventId` (see `modules/events/repository.ts` and
 * `modules/events/last-used-event.ts`) and pass them in.
 *
 * Order of decisions:
 * 1. A validated `returnTo` target always wins — it is what brought the
 *    person to `/login` in the first place, and applies regardless of role.
 * 2. A system administrator always goes to the System Command Center.
 * 3. No active event membership: the safe no-access page, never an error.
 * 4. Exactly one active event: straight to that event's workspace, the same
 *    `?event=` URL the event switcher uses.
 * 5. Several: the remembered event, if it is still one of the account's
 *    active events; otherwise the event picker.
 */
export function resolveLoginDestination(input: LoginRoutingInput): string {
  const returnTo = safeReturnTo(input.returnTo ?? undefined, "");
  if (returnTo) return returnTo;

  if (input.isSystemAdmin) return SYSTEM_ADMIN_PATH;

  const { events, lastEventId } = input;
  if (events.length === 0) return NO_EVENTS_PATH;
  if (events.length === 1) return eventWorkspacePath(events[0].id);

  const lastEvent = lastEventId
    ? events.find((event) => event.id === lastEventId)
    : undefined;
  if (lastEvent) return eventWorkspacePath(lastEvent.id);

  return EVENT_PICKER_PATH;
}

export const STAFF_LOGIN_PATH = "/login";
/** Role-routing destinations that are never a sign-in return target. */
const NON_RETURNABLE_PATHS = [NO_EVENTS_PATH, EVENT_PICKER_PATH] as const;
/**
 * Request header `proxy.ts` sets to the visited path plus query, so server
 * components (which cannot see the request URL) can build a `?next=` deep
 * link. Never trusted as-is: `staffLoginPathFor` validates it.
 */
export const REQUEST_TARGET_HEADER = "x-imsda-request-target";

/**
 * The staff sign-in URL that returns to `target` afterwards (#108). `target`
 * must pass `safeReturnTo` (single-slash relative path, no scheme, no
 * backslash, no API route); anything else, including a missing value,
 * yields a plain `/login`, so arbitrary input is never reflected.
 */
export function staffLoginPathFor(target: string | null | undefined): string {
  const safe = safeReturnTo(target, "");
  if (!safe) return STAFF_LOGIN_PATH;
  // Never bounce back into the sign-in flow itself, and never carry a
  // role-routing destination: on a shared device the next person to sign in
  // would land on the previous person's "no access" or picker page.
  const pathname = safe.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  if (
    pathname === STAFF_LOGIN_PATH ||
    pathname.startsWith(`${STAFF_LOGIN_PATH}/`) ||
    (NON_RETURNABLE_PATHS as readonly string[]).includes(pathname)
  ) {
    return STAFF_LOGIN_PATH;
  }
  return `${STAFF_LOGIN_PATH}?next=${encodeURIComponent(safe)}`;
}

/**
 * `target` when it is a page the staff sign-in would carry (`staffLoginPathFor` accepts it), otherwise "". Never a
 * sign-in or role-routing page, never an unsafe value.
 */
export function staffReturnTarget(target: string | null | undefined): string {
  if (staffLoginPathFor(target) === STAFF_LOGIN_PATH) return "";
  const safe = safeReturnTo(target, "");
  // The one-sign-in page is a sign-in screen too: never a place to come back to.
  const pathname = safe.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  return pathname === "/sign-in" || pathname.startsWith("/sign-in/") ? "" : safe;
}

/** `/no-access?from=attendee`, carrying the requested staff page as `&next=` only when the staff sign-in would carry it. */
export function noStaffAccessPathFor(target: string | null | undefined): string {
  const safe = staffReturnTarget(target);
  return safe ? `${NO_STAFF_ACCESS_PATH}&next=${encodeURIComponent(safe)}` : NO_STAFF_ACCESS_PATH;
}

/**
 * Whether `target` is a staff-side page the staff sign-in could return to: a staff pathname from the request-target
 * list (never the attendee `/account` or `/profile` areas) that `staffReturnTarget` accepts.
 */
export function isStaffSideTarget(target: string | null | undefined): boolean {
  const safe = staffReturnTarget(target);
  if (!safe) return false;
  const pathname = safe.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  if (pathname === "/archived-events") return true;
  return requestTargetPrefixes
    .filter((prefix) => prefix !== "/account" && prefix !== "/profile")
    .some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** `/select-event` is the role-aware staff landing the header link used to carry: old links count as staff intent. */
export function isStaffLandingTarget(target: string | null | undefined): boolean {
  return typeof target === "string" && target.split(/[?#]/, 1)[0].replace(/\/+$/, "") === EVENT_PICKER_PATH;
}

/** Query parameter that says "I want the staff sign-in" without naming a page; it is never a return target. */
export const STAFF_INTENT_PARAM = "staff";

/**
 * The staff sign-in link on the attendee "no access" page: back to the requested page when there is one, otherwise
 * `/login?staff=1` so the one-sign-in form still shows for someone holding an attendee session.
 */
export function staffSignInLinkFor(target: string | null | undefined): string {
  const path = staffLoginPathFor(target);
  return path === STAFF_LOGIN_PATH ? `${STAFF_LOGIN_PATH}?${STAFF_INTENT_PARAM}=1` : path;
}

function eventWorkspacePath(eventId: string): string {
  return `/overview?event=${encodeURIComponent(eventId)}`;
}
