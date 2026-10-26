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
  "INFORMATION_FORM_SUBMITTED",
  "REGISTRATION_FORM_NOTIFICATIONS",
  "HONOR_INSTRUCTOR_CLASS_EMAILS",
  "HONOR_WATCH_SUMMARIES",
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
  /** A list kept per club form, on that form's settings page; the club forms list is where to choose one. */
  | { kind: "club-form-list" }
  /** A list kept per information form, in that form's Form settings tab (#1222). */
  | { kind: "information-form-list" }
  /** A list kept per registration form, in that form's Notifications panel in the registration form builder (#1081). */
  | { kind: "registration-form-list" }
  /** A list kept per event, on that event's honor classes page (#1099). */
  | { kind: "honor-watch-list" }
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
    switchReadIn: ["modules/forms/public-repository.ts", "modules/registration-pdf/after-commit.ts"],
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
    when: "When a club form is submitted, in the club portal or through a private link. The email names the form, the club, who submitted it and when, and links to the submission. It never carries the answers.",
    recipients: "Set on each club form.",
    source: { kind: "club-form-list" },
    sourceNote: "Set on each club form's settings page, under \"Email these addresses when this form is submitted\". An empty list sends nothing.",
    sentFrom: "modules/club-forms/submission-alert.ts",
    switchReadIn: ["modules/club-forms/links.ts", "modules/club-forms/submissions.ts"],
    built: true,
  },
  {
    key: "INFORMATION_FORM_SUBMITTED",
    name: "Information form response received",
    when: "When someone answers an information form, such as the Adventurer club forms. The email names the form and when, and links to the response. It never carries the answers.",
    recipients: "Set on each information form.",
    source: { kind: "information-form-list" },
    sourceNote: "Set in each information form's Form settings, under \"Email these addresses when a response arrives\". An empty list sends nothing.",
    sentFrom: "modules/information-forms/submission-alert.ts",
    switchReadIn: ["modules/information-forms/responses.ts"],
    built: true,
  },
  {
    key: "REGISTRATION_FORM_NOTIFICATIONS",
    name: "Registration form notifications",
    when: "When someone registers, and again (marked Updated) when a director or staff change the registration. Each notification can go only for one answer, such as a location, and can include only some sections. The email is a short summary with the registration PDF attached.",
    recipients: "Set on each registration form.",
    source: { kind: "registration-form-list" },
    sourceNote: "Set in the registration form builder, in the form's Notifications panel. The event's staff list and the registrant's confirmation are separate and keep their own switch. A form with no notifications sends nothing here.",
    sentFrom: "modules/registration-form-notifications/queue.ts",
    switchReadIn: ["modules/forms/public-repository.ts", "modules/registration-form-notifications/after-commit.ts"],
    built: true,
  },
  {
    key: "HONOR_INSTRUCTOR_CLASS_EMAILS",
    name: "Honor instructor class emails",
    when: "When a youth joins or leaves a class an Honors Weekend instructor teaches: a daily summary (the default) or one email right away, as each instructor chooses. The email names the youth, club and age, never a birth date or an answer.",
    recipients: "The class's instructors who accepted their invite and haven't turned the emails off.",
    source: { kind: "roles" },
    sourceNote: "Each instructor chooses daily, right away or off on their own classes page. Turning this off pauses every instructor's emails: changes are kept and go out, summarized, when it is turned back on (a right-away email older than a day is skipped). The log of who joined or left is deleted once an event's roster has closed, and after 8 days at the latest, so changes made while this was off for longer than that are not reported.",
    sentFrom: "modules/honors/class-change-emails.ts",
    switchReadIn: ["modules/honors/class-change-emails.ts"],
    built: true,
  },
  {
    key: "HONOR_WATCH_SUMMARIES",
    name: "Honor watch summaries",
    when: "Once a day (from about 6:00 AM Central), only on a day something changed: which youth joined or left classes that teach the honors, or are the classes, an event administrator chose to watch. The email names the youth, club and age, never a birth date or an answer.",
    recipients: "The addresses typed into each honor watch on the event's honor classes page.",
    source: { kind: "honor-watch-list" },
    sourceNote: "Set on each event's honor classes page, under Honor watches (up to 20 watches, 10 addresses each). Turning this off pauses every watch: nothing is queued, and the changes of those days are reported in the next summary while they are still in the log. The log of who joined or left is deleted after 8 days at the latest, and once an event's roster has closed, so changes made while this was off for longer than that are not reported.",
    sentFrom: "modules/honors/watch-emails.ts",
    switchReadIn: ["modules/honors/watch-emails.ts"],
    built: true,
  },
];

const catalogByKey = new Map<string, NotificationDefinition>(notificationCatalog.map((entry) => [entry.key, entry]));

export function isNotificationKey(value: unknown): value is NotificationKey {
  return typeof value === "string" && catalogByKey.has(value);
}

export function getNotificationDefinition(key: NotificationKey): NotificationDefinition {
  return catalogByKey.get(key) as NotificationDefinition;
}
