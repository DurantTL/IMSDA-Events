/**
 * The pages the visual check (#1774) opens, in one list. Each one is shown at every width in `visualWidths`, signed in as
 * `role`, and compared with the saved picture in tests/visual/baselines/<width>/<name>.png (docs/VISUAL-CHECK.md).
 *
 * To add a page, add one entry here and run `npm run test:visual -- --update`. A page that shows anything random (a QR
 * code, a token, a generated code) lists the selectors to paint over in `mask`, with a comment saying why.
 * Every page must really show its content: `expectText` (and a general check that the page is not a sign-in,
 * a 404 or an error) fails the run when it does not.
 */

/** The moment every part of the run believes it is: the server, the seed, the script and the browser. */
export const VISUAL_FIXED_NOW = "2026-09-10T15:00:00Z";

export const visualWidths = [1280, 390] as const;

/** Synthetic fixture ids (scripts/support/visual-fixture.ts). */
export const visualFixtureIds = {
  club: "visualcheck_club_elm",
  church: "visualcheck_church_elm",
  reportMonth: "2026-08",
  eventId: "evt_wr26",
  eventSlug: "womens-retreat-2026",
  formSlug: "womens-retreat-registration",
} as const;

export type VisualRole = "visitor" | "attendee" | "director" | "area" | "event-admin" | "system-admin";
export const visualRoles: readonly VisualRole[] = ["visitor", "attendee", "director", "area", "event-admin", "system-admin"];

export type VisualPage = {
  /** File-safe name: lower case letters, digits and dashes. It names the baseline picture. */
  name: string;
  /** The area of the site, used by the page-list test to make sure every area is covered. */
  area: "public" | "registration" | "attendee" | "club" | "area-coordinator" | "staff" | "admin-hubs" | "system";
  path: string;
  role: VisualRole;
  /** Selectors painted over before the picture is taken, for anything random. */
  mask?: string[];
  /** Text the page must show, so a sign-in page, a 404 or an error never passes as the page. */
  expectText?: RegExp;
};

const { club, eventId, eventSlug, formSlug, reportMonth } = visualFixtureIds;
const withEvent = (route: string) => `${route}${route.includes("?") ? "&" : "?"}event=${eventId}`;
const clubPath = (suffix: string) => `/account/clubs/${club}${suffix}`;

export const visualPages: VisualPage[] = [
  // Public, signed out.
  { name: "public-home", area: "public", path: "/", role: "visitor" },
  { name: "public-calendar", area: "public", path: "/calendar", role: "visitor" },
  { name: "public-calendar-list", area: "public", path: "/calendar?view=list", role: "visitor" },
  { name: "public-events", area: "public", path: "/events", role: "visitor", expectText: /Women.s Retreat 2026/ },
  { name: "public-event-page", area: "public", path: `/events/${eventSlug}`, role: "visitor", expectText: /Women.s Retreat 2026/ },
  { name: "public-clubs", area: "public", path: "/clubs", role: "visitor" },
  // Registration step: the form of the seeded event (the fixture publishes it). The start link only redirects to the event page.
  { name: "register-form", area: "registration", path: `/register/${eventSlug}/${formSlug}`, role: "visitor", expectText: /Women.s Retreat/ },
  // Attendee account.
  { name: "attendee-overview", area: "attendee", path: "/account", role: "attendee", expectText: /Casey Visualcheck/ },
  { name: "attendee-registrations", area: "attendee", path: "/account/registrations", role: "attendee", expectText: /Women.s Retreat 2026/ },
  { name: "attendee-profile", area: "attendee", path: "/account/profile", role: "attendee", expectText: /Casey/ },
  // Club portal, as the club's director.
  { name: "club-account-overview", area: "club", path: "/account", role: "director", expectText: /Elm Ridge/ },
  { name: "club-home", area: "club", path: clubPath(""), role: "director", expectText: /Elm Ridge/ },
  { name: "club-roster", area: "club", path: clubPath("/roster"), role: "director", expectText: /Roster/ },
  { name: "club-forms", area: "club", path: clubPath("/forms"), role: "director", expectText: /Elm Ridge/ },
  { name: "club-monthly-records", area: "club", path: clubPath("/records"), role: "director", expectText: /Monthly Records/ },
  { name: "club-monthly-report", area: "club", path: clubPath(`/records?month=${reportMonth}`), role: "director", expectText: /Monthly Records|Monthly Report/ },
  { name: "club-events", area: "club", path: clubPath("/events"), role: "director", expectText: /Elm Ridge/ },
  { name: "club-info", area: "club", path: clubPath("/club-info"), role: "director", expectText: /Elm Ridge/ },
  // Area Coordinator.
  { name: "area-overview", area: "area-coordinator", path: "/account/area-clubs/overview", role: "area", expectText: /Elm Ridge|Overview/ },
  { name: "area-clubs", area: "area-coordinator", path: "/account/area-clubs/clubs", role: "area", expectText: /Elm Ridge/ },
  { name: "area-events", area: "area-coordinator", path: "/account/area-clubs/events", role: "area", expectText: /Club events/ },
  { name: "area-reports", area: "area-coordinator", path: "/account/area-clubs/reports", role: "area", expectText: /Elm Ridge|Report/ },
  // Staff, as the event administrator, inside the seeded Women's Retreat.
  { name: "staff-home", area: "staff", path: withEvent("/home"), role: "event-admin" },
  { name: "staff-coming-up", area: "staff", path: withEvent("/home/coming-up"), role: "event-admin" },
  { name: "staff-event-home", area: "staff", path: withEvent("/overview"), role: "event-admin", expectText: /Women.s Retreat 2026/ },
  { name: "staff-registrations", area: "staff", path: withEvent("/people"), role: "event-admin", expectText: /Registrations|Registrants|People/ },
  { name: "staff-check-in", area: "staff", path: withEvent("/check-in"), role: "event-admin", expectText: /Check-in/ },
  { name: "staff-money", area: "staff", path: withEvent("/finance"), role: "event-admin", expectText: /Money|Payments/ },
  { name: "staff-communications", area: "staff", path: withEvent("/communications"), role: "event-admin" },
  { name: "staff-reports", area: "staff", path: withEvent("/more/reports"), role: "event-admin", expectText: /Reports/ },
  { name: "staff-event-setup", area: "staff", path: withEvent("/more"), role: "event-admin", expectText: /Event setup/ },
  { name: "staff-event-settings", area: "staff", path: withEvent("/more/event-settings"), role: "event-admin" },
  // Admin hubs, as the system administrator.
  { name: "admin-hub-events", area: "admin-hubs", path: withEvent("/admin/hubs/events"), role: "system-admin" },
  { name: "admin-hub-clubs", area: "admin-hubs", path: withEvent("/admin/hubs/clubs"), role: "system-admin" },
  { name: "admin-hub-people", area: "admin-hubs", path: withEvent("/admin/hubs/people"), role: "system-admin" },
  { name: "admin-hub-forms", area: "admin-hubs", path: withEvent("/admin/hubs/forms"), role: "system-admin" },
  { name: "admin-hub-catalogs", area: "admin-hubs", path: withEvent("/admin/hubs/catalogs"), role: "system-admin" },
  // Two System pages.
  { name: "system-administration", area: "system", path: withEvent("/admin"), role: "system-admin" },
  { name: "system-settings", area: "system", path: withEvent("/admin/settings"), role: "system-admin" },
];
