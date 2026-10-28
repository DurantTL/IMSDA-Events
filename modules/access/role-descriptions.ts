import type { EventRole } from "@/modules/access/permissions";

/**
 * The one place role wording lives (#1278). Every page that names a role or
 * explains it reads from here: People & access, the person page and invite
 * dialog, the event Staff page, the club Team and directors pages, the role
 * switcher and Help. Wording only: what a role may actually do is decided by
 * `rolePermissions`, `clubCapabilities` and the access checks, never by this file.
 *
 * Each role has a plain name, one sentence, and the longer can / can't list
 * shown behind a "Details" disclosure.
 */
export type RoleText = {
  name: string;
  /** One plain sentence. */
  summary: string;
  can: readonly string[];
  cannot: readonly string[];
};

/** Roles that span the whole system rather than one event or club. */
export type SystemRoleKey = "SYSTEM_ADMIN" | "CLUBS_ADMIN" | "AREA_COORDINATOR" | "EVENTS_ADMIN";

export const systemRoleText: Record<SystemRoleKey, RoleText> = {
  SYSTEM_ADMIN: {
    name: "System administrator",
    summary: "Runs the whole system: every event, every club, and who has access.",
    can: [
      "Work on every event and every club.",
      "Give and remove every role, including system administrator.",
      "Give the health information and finalize invoices extras to one person at a time.",
      "Finalize invoices on any event.",
    ],
    cannot: ["Remove the last system administrator."],
  },
  CLUBS_ADMIN: {
    name: "Clubs Administrator",
    summary: "Looks after every club, but not events, churches or system settings.",
    can: [
      "See club reports, points, forms and new club applications for every club.",
      "See club rosters, including birth dates.",
      "Open club health records, giving a reason that is recorded.",
      "Run club imports, invites and transfers, and keep the club catalogs.",
      "Give club roles and make someone an Area Coordinator.",
    ],
    cannot: [
      "Work on events.",
      "Change churches, the conference, settings or accounts.",
    ],
  },
  AREA_COORDINATOR: {
    name: "Area Coordinator",
    summary: "Sees every club, view only.",
    can: ["Look at every club, after a second sign-in step.", "See members' ages."],
    cannot: ["Change anything.", "See full birth dates."],
  },
  EVENTS_ADMIN: {
    name: "Events Administrator",
    summary: "An Event administrator on one or more events, who sees only those events.",
    can: ["Run the events they are an Event administrator on."],
    cannot: ["See other events.", "See club records or club events."],
  },
};

export const eventRoleText: Record<EventRole, RoleText> = {
  EVENT_ADMIN: {
    name: "Event administrator",
    summary: "Runs the event: settings, registrations, money, messages, check-in and staff.",
    can: [
      "Change the event's settings and forms.",
      "Manage registrations, payments, refunds and check-in.",
      "Post updates and see reports.",
      "Add and remove the event's staff.",
    ],
    cannot: [
      "See health information, unless also given that extra.",
      "Finalize invoices, unless also given that extra.",
    ],
  },
  REGISTRATION_MANAGER: {
    name: "Registration manager",
    summary: "Looks after people, registrations and forms for the event.",
    can: ["Add and change registrations.", "Edit the event's forms.", "See people's contact details and reports."],
    cannot: ["Take payments or give refunds.", "Change the event's settings or staff."],
  },
  FINANCE_MANAGER: {
    name: "Finance manager",
    summary: "Looks after payments, refunds and balances for the event.",
    can: ["Record payments and give refunds.", "Prepare invoice drafts.", "See balances, people's contact details and reports."],
    cannot: ["Finalize invoices, unless also given that extra.", "Change registrations, settings or staff."],
  },
  COMMUNICATIONS_MANAGER: {
    name: "Communications manager",
    summary: "Writes and posts updates to the event's feed for attendees.",
    can: ["Draft and publish event-feed updates."],
    cannot: ["See registrations, people or payments."],
  },
  CHECK_IN_STAFF: {
    name: "Check-in staff",
    summary: "Finds people as they arrive and checks them in.",
    can: ["Search for arriving people.", "Check people in and undo a check-in."],
    cannot: ["Change registrations or payments."],
  },
  READ_ONLY_STAFF: {
    name: "Read-only staff",
    summary: "Can look around the event's workspace but cannot change anything.",
    can: ["View the event's workspace."],
    cannot: ["Change anything."],
  },
  KITCHEN_STAFF: {
    name: "Kitchen staff",
    summary: "Enters the kitchen's meal counts and nothing else.",
    can: ["Enter prepared, wasted, donated and transferred meal counts."],
    cannot: ["See registrations or people."],
  },
};

/** Access given one person at a time on one event. No role includes these. */
export type EventExtraKey = "VIEW_HEALTH_INFORMATION" | "FINALIZE_INVOICES";

export const eventExtraText: Record<EventExtraKey, RoleText> = {
  VIEW_HEALTH_INFORMATION: {
    name: "Health information",
    summary: "Lets one person see allergies, emergency contacts and medical needs for the event's club attendees.",
    can: ["See allergies as entered, emergency contacts and the medical-need flag."],
    cannot: ["Come with any role, Event administrator included: a system administrator gives it to one person at a time."],
  },
  FINALIZE_INVOICES: {
    name: "Finalize invoices",
    summary: "Lets one person finalize invoices, which gives each its number and commits the conference to the amount.",
    can: ["Finalize the event's invoice drafts."],
    cannot: ["Come with any role, Event administrator and Finance manager included: a system administrator gives it to one person at a time."],
  },
};

export type ClubRoleKey = "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER";

export const clubRoleText: Record<ClubRoleKey, RoleText> = {
  DIRECTOR: {
    name: "Director",
    summary: "Runs the club: roster, events, team and club profile.",
    can: [
      "Keep the roster, including birth dates and guardian contacts.",
      "Register the club for events.",
      "Give and remove the Registrar and Reporter roles.",
      "Edit the club profile.",
      "Submit the club's Monthly Records.",
    ],
    cannot: [],
  },
  DEPUTY: {
    name: "Deputy",
    summary: "Has the same access as the director.",
    can: [
      "Keep the roster, including birth dates and guardian contacts.",
      "Register the club for events.",
      "Give and remove the Registrar and Reporter roles.",
      "Edit the club profile.",
      "Submit the club's Monthly Records.",
    ],
    cannot: [],
  },
  REGISTRAR: {
    name: "Registrar",
    summary: "Keeps the roster and registers the club for events.",
    can: ["Keep the roster.", "Register the club for events."],
    cannot: [
      "See full birth dates (they see ages).",
      "See guardian contacts.",
      "Change the club's team or profile.",
      "Submit Monthly Records.",
    ],
  },
  REPORTER: {
    name: "Reporter",
    summary: "Submits the club's Monthly Records.",
    can: ["Submit the club's Monthly Records."],
    cannot: ["See the roster.", "Register the club for events."],
  },
};
