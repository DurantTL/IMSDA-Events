/**
 * Every automatic email that goes to staff or club leaders (#1016), and where
 * each one is sent from. This is the single source for the System management
 * Notifications page and for the switch each send site checks, so an alert
 * cannot be sent without being listed, or listed without a switch.
 *
 * Not here on purpose: emails to attendees about their own registration, and
 * sends a person starts by pressing send (deadline reminders, team advancement
 * notices, invoices).
 *
 * No `server-only` import: the page, its client component and the tests all
 * read this list.
 */
export const notificationKeys = [
  "NEW_REGISTRATION_STAFF_COPY",
  "GROUP_REGISTRATION_APPROVAL_DIGEST",
  "STAFF_INVITATION_APPROVAL_DIGEST",
  "NEW_CLUB_APPLICATION",
  "SIGN_IN_LOCKOUT_OFFICE_COPY",
  "EVENT_MODULE_REQUESTED",
  "TEAM_APPROVAL_REQUESTED",
  "LOCATION_WAITLIST_DIGEST",
  "MEMBER_TRANSFER_STARTED",
  "MEMBER_TRANSFER_COMPLETED",
  "CLUB_FORM_SUBMITTED",
] as const;

export type NotificationKey = (typeof notificationKeys)[number];

/** The platform settings that hold an address an alert is sent to. */
export type PlatformAddressField = "supportContact" | "securityAlertEmail" | "newClubApplicationEmail";

/** Where the people who receive an alert are chosen. */
export type NotificationRecipientSource =
  /** One platform address, edited on the Notifications page itself. */
  | { kind: "platform-address"; field: PlatformAddressField }
  /** A list kept per event, on that event's Communications page. */
  | { kind: "event-list" }
  /** Worked out from people's roles; there is no list to edit. */
  | { kind: "roles" };

export type NotificationDefinition = {
  key: NotificationKey;
  name: string;
  /** One line: when it is sent. */
  when: string;
  /** Who receives it, in plain words. */
  recipients: string;
  source: NotificationRecipientSource;
  /** For `roles`, why there is nothing to edit; for the others, a short pointer. */
  sourceNote: string;
  /** The module file that sends it, for the tests and the next person to read. */
  sentFrom: string;
  /**
   * The files that read its switch. Each reads it BEFORE its transaction opens and passes the answer down to
   * `sentFrom`, which is why these are not always the same file. Empty until the alert is built.
   */
  switchReadIn: readonly string[];
  /** False until the alert is built; it has a switch ready but nothing sends it yet. */
  built: boolean;
  /** Turning it off needs a warning and an in-page confirmation first. */
  confirmBeforeOff?: { title: string; message: string };
};

export const notificationCatalog: readonly NotificationDefinition[] = [
  {
    key: "NEW_REGISTRATION_STAFF_COPY",
    name: "New public registration",
    when: "When someone finishes a public registration, a staff copy goes out with their confirmation.",
    recipients: "The addresses in the event's staff notification list.",
    source: { kind: "event-list" },
    sourceNote: "Set on each event's Communications page.",
    sentFrom: "modules/communications/messaging-repository.ts",
    switchReadIn: ["modules/forms/public-repository.ts"],
    built: true,
  },
  {
    key: "GROUP_REGISTRATION_APPROVAL_DIGEST",
    name: "Group or team registration waiting for approval",
    when: "When a group or team registers through a general link and needs approval. One digest per event per 15 minutes.",
    recipients: "The addresses in the event's staff notification list.",
    source: { kind: "event-list" },
    sourceNote: "Set on each event's Communications page.",
    sentFrom: "modules/general-link-registrations/repository.ts",
    switchReadIn: ["modules/general-link-registrations/repository.ts"],
    built: true,
  },
  {
    key: "STAFF_INVITATION_APPROVAL_DIGEST",
    name: "Staff-invitation registration waiting for approval",
    when: "When someone registers through a personal staff invitation link and needs approval. Sent as a digest.",
    recipients: "The addresses in the event's staff notification list.",
    source: { kind: "event-list" },
    sourceNote: "Set on each event's Communications page.",
    sentFrom: "modules/staff-invitations/repository.ts",
    switchReadIn: ["modules/staff-invitations/repository.ts"],
    built: true,
  },
  {
    key: "NEW_CLUB_APPLICATION",
    name: "New club application submitted",
    when: "When someone applies to start a new club. The notice has the club, church and director name, never contact details.",
    recipients: "The new club application address.",
    source: { kind: "platform-address", field: "newClubApplicationEmail" },
    sourceNote: "Edited on this page. Blank means no notice; applications still wait in the queue.",
    sentFrom: "modules/club-applications/email.ts",
    switchReadIn: ["modules/club-applications/repository.ts"],
    built: true,
  },
  {
    key: "SIGN_IN_LOCKOUT_OFFICE_COPY",
    name: "Sign-in lockout",
    when: "When a sign-in locks after too many wrong passwords or codes, the office gets a short alert. The account holder's own email is not affected by this switch.",
    recipients: "The security alert address.",
    source: { kind: "platform-address", field: "securityAlertEmail" },
    sourceNote: "Edited on this page. Blank means only the account holder is told.",
    sentFrom: "modules/communications/lockout-email.ts",
    switchReadIn: ["modules/communications/lockout-email.ts"],
    built: true,
    confirmBeforeOff: {
      title: "Turn off sign-in lockout alerts?",
      message: "You won't be told when accounts are locked. Repeated failed sign-ins could go unnoticed. The account holder still gets their own email.",
    },
  },
  {
    key: "EVENT_MODULE_REQUESTED",
    name: "Event feature requested",
    when: "When an event admin asks for a feature (module) to be turned on for their event.",
    recipients: "The support contact address.",
    source: { kind: "platform-address", field: "supportContact" },
    sourceNote: "Edited on this page. This address is also shown as the platform support contact.",
    sentFrom: "modules/event-modules/request-email.ts",
    switchReadIn: ["modules/event-modules/requests.ts"],
    built: true,
  },
  {
    key: "TEAM_APPROVAL_REQUESTED",
    name: "Team approval requested",
    when: "When a team registers a member who needs permission (for example Pathfinder Bible Experience, age 18 and over).",
    recipients: "The location's Area Coordinator; if there is none, the event's admins and registration managers.",
    source: { kind: "roles" },
    sourceNote: "Chosen by role: the Area Coordinator assigned to the location, otherwise the event's staff who manage registrations.",
    sentFrom: "modules/club-teams/permission-repository.ts",
    switchReadIn: [
      "modules/forms/public-repository.ts",
      "modules/registrations/operations-repository.ts",
      "modules/registrations/amendments-repository.ts",
      "modules/attendee-accounts/registrations-repository.ts",
      "modules/public-access/repository.ts",
      "modules/club-transfers/repository.ts",
    ],
    built: true,
  },
  {
    key: "LOCATION_WAITLIST_DIGEST",
    name: "Location waitlist digest",
    when: "Once a day, when a location's waitlist changed.",
    recipients: "The location's Area Coordinators and the event's admins.",
    source: { kind: "roles" },
    sourceNote: "Chosen by role: Area Coordinators and event admins.",
    sentFrom: "modules/event-locations/waitlist-digest.ts",
    switchReadIn: ["modules/event-locations/waitlist-digest.ts"],
    built: true,
  },
  {
    key: "MEMBER_TRANSFER_STARTED",
    name: "Member transfer started",
    when: "When a club asks to transfer a member from another club.",
    recipients: "The sending club's director and deputy.",
    source: { kind: "roles" },
    sourceNote: "Chosen by role: the sending club's director and deputy.",
    sentFrom: "modules/club-transfers/repository.ts",
    switchReadIn: ["modules/club-transfers/repository.ts"],
    built: true,
  },
  {
    key: "MEMBER_TRANSFER_COMPLETED",
    name: "Member transfer completed",
    when: "When a member transfer is finished.",
    recipients: "Both clubs' leaders, and the member or guardian when an email is on file.",
    source: { kind: "roles" },
    sourceNote: "Chosen by role: both clubs' leaders. It is one notice that also goes to the member or guardian, so turning it off skips theirs too.",
    sentFrom: "modules/club-transfers/repository.ts",
    switchReadIn: ["modules/club-transfers/repository.ts"],
    built: true,
  },
  {
    key: "CLUB_FORM_SUBMITTED",
    name: "Club form submitted",
    when: "When a club submits an event form. Not sent yet: its recipients are being built as a separate change, and the switch is ready for it.",
    recipients: "To be set per form.",
    source: { kind: "roles" },
    sourceNote: "Coming soon: recipients will be set for each form.",
    sentFrom: "not built yet",
    switchReadIn: [],
    built: false,
  },
];

const catalogByKey = new Map<string, NotificationDefinition>(notificationCatalog.map((entry) => [entry.key, entry]));

export function isNotificationKey(value: unknown): value is NotificationKey {
  return typeof value === "string" && catalogByKey.has(value);
}

export function getNotificationDefinition(key: NotificationKey): NotificationDefinition {
  return catalogByKey.get(key) as NotificationDefinition;
}
