import { eventRoles } from "@/modules/access/permissions";
import { roleDetails } from "@/modules/access/role-display";
import type { HelpDestination, HelpGuide } from "@/modules/help/types";

/**
 * The guide registry (#1077). Each guide describes how the app works today and
 * points to the real working pages. `docs/HELP-AND-LEARNING.md` says how to add
 * or change one. Wording rules: plain, short sentences; the exact on-screen
 * labels; synthetic examples only; no person's name and no event name.
 */

/** The pages guides depend on, by id, so a menu or route change is found here and not by searching prose. */
export const helpDestinations: Record<string, HelpDestination> = {
  "system-home": { id: "system-home", label: "System management", path: "/admin", scope: "System" },
  "event-dashboard": { id: "event-dashboard", label: "Dashboard", path: "/overview", scope: "Event", permission: "VIEW_EVENT" },
  "create-event": { id: "create-event", label: "Create event", path: "/event-setup", scope: "System" },
  "copy-event": { id: "copy-event", label: "Copy from a past event", path: "/event-setup/copy", scope: "System" },
  "event-templates": { id: "event-templates", label: "Event templates", path: "/admin/event-templates", scope: "System" },
  "event-settings": { id: "event-settings", label: "Event settings", path: "/more/event-settings", scope: "Event", permission: "CONFIGURE_EVENT" },
  "event-team": { id: "event-team", label: "Team", path: "/staff", scope: "Event", permission: "MANAGE_STAFF" },
  "system-team": { id: "system-team", label: "People & access", path: "/admin/people", scope: "System" },
  "club-applications": { id: "club-applications", label: "New club applications and invites", path: "/admin/clubs/applications", scope: "System" },
  "club-invites": { id: "club-invites", label: "Club invites", path: "/admin/clubs/invites", scope: "System" },
  "registration-forms": { id: "registration-forms", label: "Registration forms", path: "/registration-builder", scope: "Event", permission: "MANAGE_FORMS" },
  "information-forms": { id: "information-forms", label: "Information forms", path: "/information-forms", scope: "Event", permission: "MANAGE_FORMS" },
  "form-templates": { id: "form-templates", label: "Form templates", path: "/admin/form-templates", scope: "System" },
  "club-forms": { id: "club-forms", label: "Club forms", path: "/admin/club-forms", scope: "System" },
  "event-imports": { id: "event-imports", label: "Imports", path: "/imports", scope: "Event", permission: "MANAGE_IMPORTS" },
  "club-import": { id: "club-import", label: "Import clubs", path: "/admin/clubs/import", scope: "System" },
  "event-emails": { id: "event-emails", label: "Emails", path: "/communications", scope: "Event", permission: "MANAGE_COMMUNICATIONS" },
  "system-email": { id: "system-email", label: "Email (central sender and paused events)", path: "/admin/email", scope: "System" },
  "system-readiness": { id: "system-readiness", label: "System readiness", path: "/admin/readiness", scope: "System" },
};

const roleLines = eventRoles.map((role) => `${roleDetails[role].label}: ${roleDetails[role].description}`);

export const helpGuides: readonly HelpGuide[] = [
  {
    id: "choose-workspace",
    title: "Choose System or Event workspace",
    summary: "Know whether a task belongs to the whole organization or to one event, and how to tell where you are.",
    workspace: "Event",
    audience: { kind: "everyone" },
    needs: ["Any staff sign-in. You do not need extra access to follow along."],
    changes: ["Nothing. This guide is reading only."],
    steps: [
      "The Event workspace is for one event: its registrations, payments, emails, forms, check-in, staff and reports. The event picker at the top of the sidebar says which event you are in.",
      "System administration is for the whole organization: creating events, the club and church directory, shared forms and templates, accounts, email and platform settings. Only system administrators have it.",
      "The header under the page title shows the kind of page you are on, System or Event, and names the event. System administrators also get a Back to System link while they are in an event.",
      "You only see the pages your role allows. If a page you expect is missing, you may not have that permission for this event.",
      "Use Find a page or task in the sidebar to jump straight to a page you are allowed to open.",
    ],
    verify: ["The label in the header matches the kind of work you meant to do, and the event name is the one you expect."],
    next: "Read the glossary for the words used here, or pick the guide for your task.",
    destinationIds: ["event-dashboard", "system-home"],
    relatedDocs: ["docs/STAFF-EVENT-WORKFLOW.md", "docs/NAVIGATION.md"],
    keywords: ["scope", "workspace", "where am i", "system", "event", "menu", "sidebar", "getting started", "first day", "lost"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
  },
  {
    id: "create-or-copy-event",
    title: "Create or copy an event",
    summary: "Start a new event as a private draft, from a template, from scratch, or from a past event.",
    workspace: "System",
    audience: { kind: "system" },
    needs: [
      "The Create event page in System management.",
      "The event's name, web address and dates. A copy asks for these again; they are never carried over.",
    ],
    changes: [
      "Creates one new event that starts as a private draft. Nothing is public and nobody can register yet.",
      "A copy brings over settings and forms only, as an unpublished draft. Registrations, attendees and payments are not copied.",
    ],
    steps: [
      "Open Create event. You can Start from a template, Start blank, or Copy from a past event.",
      "To start from a template, pick one in the list. The new event begins with that template's forms and settings. Blank event and Blank club event are starters too.",
      "To start blank, fill in the event details by hand.",
      "To copy, choose the event under Copy from, then preview what would be copied. Turn off anything you do not want.",
      "On a copy, enter the new name, web address and dates. Review any dates, capacities and limits it lists, and the Private links to review. Links that point at the old event are removed from the copy.",
      "Choose Create draft event on a copy, and you land on a results page with Open the new event. On a template or blank start, you land on the event's settings with a short list of next steps.",
    ],
    verify: [
      "The new event shows in the event picker and is not public.",
      "For a copy, the results list shows how much of each part was copied and what was skipped.",
    ],
    next: "Complete Event settings, then build and publish the registration form.",
    destinationIds: ["create-event", "copy-event", "event-templates", "event-settings"],
    relatedDocs: ["docs/STAFF-EVENT-WORKFLOW.md", "docs/EVENT-FEATURES.md", "docs/EVENT-ARCHIVE.md"],
    keywords: ["new event", "start event", "duplicate", "clone", "last year", "rollover", "template", "draft", "blank"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
    screenshot: { src: "/help/create-event-example.webp", width: 800, height: 744, alt: "The Create an event draft page with the Event basics step and the Publish readiness list, using sample data.", capturedFor: "2026-10-27" },
  },
  {
    id: "invite-staff",
    title: "Invite staff to an event",
    summary: "Give a person staff access to one event. This is different from a club director grant or an attendee registration.",
    workspace: "Event",
    audience: { kind: "event-permission", permission: "MANAGE_STAFF" },
    needs: [
      "The Team page for the event (in More the card is called Staff). If you cannot open it, you do not manage staff for this event.",
      "The person's display name and email address.",
    ],
    changes: [
      "Adds a staff account to this one event with the role you pick.",
      "A person with no staff account yet gets a one-time link to choose their own password. A person who already has one just has this event added, with no email. Other events are not changed.",
    ],
    steps: [
      "A staff invitation gives a person a role in the staff workspace for one event. That is what this guide does.",
      "A club director grant is different. Directors get access to a club, not to an event's staff pages, and it is given by an administrator, or by the club's own director or deputy.",
      "An attendee registration is different too. People register on the public pages, and registering never gives staff access. Staff and volunteers can also be invited to register free through a personal link. That is a registration, not staff access.",
      "Check the event name at the top of the page, then open Team and choose Add staff.",
      "Enter the display name and email address, and pick an Event role. New people start as Read-only staff. The Choose the right staff role guide helps you pick.",
      "Choose Add staff.",
    ],
    verify: [
      "The person appears in the Team list with their role.",
      "For a new account, a message says an activation email was sent. If this site has no account email set up, it shows a one-time activation link once, for you to pass on yourself. The link works for seven days, and the person can use Forgot password for another.",
      "For a person who already has an account, there is no email. They see the event the next time they sign in.",
    ],
    next: "Ask the person to sign in. Later, open their row to change the role or choose Remove access to this event.",
    destinationIds: ["event-team", "system-team", "club-invites"],
    relatedDocs: [],
    keywords: ["invite", "add staff", "volunteer", "access", "team", "new person", "account", "activation", "director", "attendee", "registration link"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
  },
  {
    id: "choose-staff-role",
    title: "Choose the right staff role",
    summary: "Pick the smallest event role that lets a person do their job.",
    workspace: "Event",
    audience: { kind: "event-permission", permission: "MANAGE_STAFF" },
    needs: [
      "The Team page for the event.",
      "A clear idea of what the person will do, such as check people in or enter meal counts.",
    ],
    changes: ["Changes which pages one person can open for this one event. It does not change other events."],
    steps: [
      "Open Team and scroll to Role boundaries. Each role lists what it can do.",
      ...roleLines,
      "Pick the smallest role that covers the work. Read-only staff can look at the event workspace and change nothing.",
      "Some access is not a role. Health information access and the permission to finalize invoices are given one person at a time by a system administrator, and no role carries them.",
      "Clubs Administrator and system administrator are not event roles. You never need either one to follow this guide.",
      "To change a role, open the person's row, choose a new Event role, then Save access.",
    ],
    verify: [
      "The person's row shows the new role.",
      "Ask them to open the next page. Their menu then lists only the pages the role allows.",
    ],
    next: "If they still cannot do a task, check which page it uses and which role covers it, instead of choosing a bigger role.",
    destinationIds: ["event-team"],
    relatedDocs: [],
    keywords: ["role", "roles", "permission", "permissions", "who can", "access", "event administrator", "finance manager", "check-in staff", "kitchen"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
  },
  {
    id: "publish-registration-form",
    title: "Publish a registration form",
    summary: "Build, test and publish the form people use to register, and know which other kinds of form there are.",
    workspace: "Event",
    audience: { kind: "event-permission", permission: "MANAGE_FORMS" },
    needs: [
      "The Registration forms page for the event.",
      "The attendee types, questions and prices the event needs.",
    ],
    changes: [
      "Creates or edits this event's registration form and, when you publish, makes that version live.",
      "Publishing the form does not publish the event. The event is published separately on Event settings.",
    ],
    steps: [
      "Open Registration forms and check the event name.",
      "Start with Blank form, or New from template. A form template is a starting point; a form made from it keeps the definition it was created with.",
      "Build the form: attendee types, questions, pricing and availability rules.",
      "Run at least one test submission. Only the first published version of a form needs one. Later versions can publish without a new test.",
      "Publish the form. This is what creates its public link.",
      "Open Event settings and check the publish-readiness panel. It lists what the event still needs, including a published, tested registration form. The registration window decides when people can actually submit.",
      "Registration forms are not the only kind of form. A club form is something clubs fill in for events. An information form gathers answers only, with no registration or payment. A Monthly Record is a club's monthly report, filled in by its director. Form templates and the question library are shared starting points kept by system administrators.",
    ],
    verify: [
      "The form shows as published and its public link exists.",
      "The readiness panel on Event settings counts the registration form as met.",
    ],
    next: "Finish the rest of the readiness list on Event settings, then publish the event.",
    destinationIds: ["registration-forms", "information-forms", "event-settings", "form-templates", "club-forms"],
    relatedDocs: ["docs/STAFF-EVENT-WORKFLOW.md", "docs/FORM-TEMPLATES.md", "docs/FORM-VISIBILITY-RULES.md"],
    keywords: ["form", "forms", "registration form", "publish", "builder", "test submission", "template", "club form", "information form", "monthly record", "question library", "survey"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
  },
  {
    id: "import-with-preview",
    title: "Import with preview",
    summary: "Load a file safely: preview every change first, then commit only when it looks right.",
    workspace: "Event",
    audience: { kind: "event-permission", permission: "MANAGE_IMPORTS" },
    needs: [
      "The Imports page for the event.",
      "The file (a CSV for event imports), kept on your computer only. Do not email it, post it in chat or paste it into an issue.",
    ],
    changes: [
      "Nothing during the preview. Committing adds or updates registrations and attendees for this event.",
    ],
    steps: [
      "Open Imports and check the event name.",
      "Under Choose a source snapshot, pick the standard flat CSV, or the exports it names together. Preview the file.",
      "Read the Reconciliation totals so you know what the event holds now.",
      "Under Exactly what will change, open any row to compare Current with From CSV. Filter by Creates, Updates, Unchanged or Issues.",
      "Fix the file and preview again if there are errors. Commit stays off while there are any.",
      "When it looks right, commit. A dialog asks Commit this staging import? You can choose Review again instead.",
      "Club imports take the old website's JSON export, not a CSV, but work the same way: nothing is created until you press Import. They have their own runbook, and so do health record imports.",
    ],
    verify: [
      "The run shows in Run history.",
      "The Reconciliation totals now match what you expected.",
    ],
    next: "Delete the file from your computer when you are done.",
    destinationIds: ["event-imports", "club-import"],
    relatedDocs: ["docs/CLUB-IMPORT-RUNBOOK.md", "docs/HEALTH-RECORD-IMPORT-RUNBOOK.md"],
    keywords: ["import", "csv", "upload", "preview", "commit", "spreadsheet", "snapshot", "reconcile", "club import", "registrations file"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
    screenshot: { src: "/help/imports-example.webp", width: 800, height: 787, alt: "The Imports page with the Choose a source snapshot step and the Preview import button, using sample data.", capturedFor: "2026-10-27" },
  },
  {
    id: "resolve-email-problem",
    title: "Resolve an email problem",
    summary: "Find out why an email did not arrive: the message, the event's email setting, or the central sender.",
    workspace: "Event",
    audience: { kind: "event-permission", permission: "MANAGE_COMMUNICATIONS" },
    needs: [
      "The Emails page for the event.",
      "The address the message was meant for. A system administrator looks after the central sender.",
    ],
    changes: [
      "Nothing, while you only look. A resend or a pause change is a separate, deliberate step.",
    ],
    steps: [
      "Open Emails and find the message in the delivery log. Its status tells you most of the story: pending, processing, captured, sent, failed, suppressed or cancelled. Pending and processing mean it is still queued.",
      "Captured means the email was kept here and not sent. An event that is paused, or a site with no email provider set up, only captures email.",
      "Failed usually means a problem with the address. Check it on the registration. A suppressed address gets no email, confirmations included, until a system administrator re-enables it on Email. A registrant's confirmation message can be resent from its details once it is no longer pending or processing.",
      "Every event sends from one central sender address, and an event cannot change it. If the sender is not set, emails wait and go out once it is saved. They are not lost.",
      "A system administrator manages this on Email: Delivery & sender holds the central sender, Events with email paused lists paused events, and Is email getting through? shows the provider, delivery reports and recent problems. Staff alerts are on the same page.",
      "If you are not a system administrator, tell one which event and roughly when. Do not send addresses or message text in chat.",
    ],
    verify: [
      "The message's status changes to Sent, or you know which of the causes above applies.",
      "A paused event shows under Events with email paused until it is resumed.",
    ],
    next: "If it is still stuck, give the system administrator the event and the time, and let them check email health.",
    destinationIds: ["event-emails", "system-email"],
    relatedDocs: ["docs/PHASE-0-EMAIL-MATRIX.md", "docs/DEADLINE-REMINDERS.md", "docs/FORM-NOTIFICATIONS.md"],
    keywords: ["email", "mail", "not received", "bounce", "bounced", "failed", "paused", "sender", "spam", "delivery", "message", "staff alerts", "resend"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
  },
  {
    id: "understand-system-readiness",
    title: "Understand System readiness",
    summary: "Read the readiness page correctly: it records evidence, it does not approve or switch anything on.",
    workspace: "System",
    audience: { kind: "system" },
    needs: ["The System readiness page in System management."],
    changes: [
      "Nothing, while you read. Ticking an item records that a person did the work, with who and when.",
    ],
    steps: [
      "The page keeps four things apart. Live health is measured now and lives on the System home. Implemented behavior is what the app already does. Human evidence is what a person ticked. Remaining setup is what is still unchecked.",
      "Under Checked automatically, each row shows a status. A check that could not be read says so. It is never counted as done.",
      "Under the groups of manual items, a tick records that a person did the work as of that date. It does not re-check anything and does not perform the action.",
      "Reload the page to check again.",
      "What is still to do lists the items that need attention, could not be checked, or are not ticked yet.",
    ],
    verify: [
      "You can say, for any item, whether it was measured by the app or ticked by a person.",
      "Nothing on this page counts as approval, a go-live decision or a permission grant.",
    ],
    next: "Open the System health panel on the System home for live readings, and use the production readiness documents for the rest.",
    destinationIds: ["system-readiness", "system-home", "system-email"],
    relatedDocs: ["docs/PRODUCTION-READINESS-PROGRESS.md", "docs/PRODUCTION-READINESS-REVIEW.md"],
    keywords: ["readiness", "ready", "checklist", "go live", "launch", "health", "evidence", "tick", "sign-off", "production"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
  },
  {
    id: "review-new-club-application",
    title: "Review a new club application",
    summary: "Read an application to start a new club, check the flags, then approve or decline it.",
    workspace: "System",
    audience: { kind: "system" },
    needs: [
      "The New club applications and invites page in System management.",
      "The application waiting under Waiting for a decision.",
    ],
    changes: [
      "Nothing while you read. Approve creates the club under its sponsoring church or company and emails the director the club director invite. It can't be undone from the page.",
      "Decline emails the applicant. The reason is optional, and the applicant is emailed it.",
    ],
    steps: [
      "Open New club applications and invites. Applications wait under Waiting for a decision. Decided ones are under Recently decided.",
      "Read the card: the club, its sponsoring church, the director's details, the typed signatures, any note and any attachment.",
      "Check the flags under the club name. Sterling Volunteers is a flag to review, not a block. Possible duplicate lines, and a director email that differs from the invited address, are there to be checked, not decided for you.",
      "If the applicant typed a church that is not in the directory, you must choose a Sponsoring church or company from the directory before you can approve.",
      "To decline, choose Decline, add an optional reason, then choose Decline application. To approve, choose Approve, read what it says it will do, then choose Approve and send invite.",
      "You can also email a prospective director a private link with Send a private link. It opens the same form, works once, and creates nothing until you approve the application.",
    ],
    verify: [
      "The card moves out of Waiting for a decision and shows Approved or Declined, with when it was decided.",
      "An approved card shows an Open the new club link.",
    ],
    next: "The director accepts the club invite from the email and lands in the new club. If account email is not set up, the invite waits on the Club invites page.",
    destinationIds: ["club-applications", "club-invites", "system-email"],
    relatedDocs: ["docs/NEW-CLUB-APPLICATIONS.md"],
    keywords: ["new club", "application", "applications", "approve", "decline", "start a club", "club invite", "private link", "sterling", "sponsoring church"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
  },
  {
    id: "inspect-system-health",
    title: "Inspect System health",
    summary: "Read the live System health panel: what was measured, when, and what could not be read.",
    workspace: "System",
    audience: { kind: "system" },
    needs: ["The System management home. System health is a panel on it."],
    changes: ["Nothing. This guide is reading only."],
    steps: [
      "Open System management and find System health. It shows only what was measured. A reading that could not be made is shown as unavailable, never as healthy or zero.",
      "Each signal has three lines: Checked says what was looked at, Result says what was found, and When says when it was observed.",
      "The signals are Email sweep, Email queue, Open alerts and Email delivery problems.",
      "Read the word beside each name. Stale means the evidence is old and does not show whether the job is running now. Partial means some of what the signal needs could not be read, so a number may be a floor. Unavailable means no reading was made. Never reported means nothing has ever reported.",
      "Reload the page to take a new reading.",
      "Full health report opens Email, where the delivery details are.",
    ],
    verify: [
      "For each signal you can say what it checked, when it was observed, and whether that reading is current, stale, partial or unavailable.",
      "You do not read an unavailable signal as healthy.",
    ],
    next: "For an email problem, follow Resolve an email problem. System readiness holds the go-live sign-offs and the setup still to do. Those are not health readings.",
    destinationIds: ["system-home", "system-email", "system-readiness"],
    relatedDocs: ["docs/PRODUCTION-READINESS-PROGRESS.md"],
    keywords: ["health", "system health", "monitor", "email sweep", "queue", "alerts", "stale", "unavailable", "measured", "status"],
    owner: "Communication office",
    lastReviewed: "2026-10-27",
  },
];

export function findGuide(id: string): HelpGuide | undefined {
  return helpGuides.find((guide) => guide.id === id);
}

export const helpDocsBaseUrl = "https://github.com/DurantTL/IMSDA-Events/blob/main/";

/** A repository doc as a GitHub link. */
export function docUrl(path: string): string {
  return `${helpDocsBaseUrl}${path}`;
}

/** The text of a doc link: the file name without the folder or extension. */
export function docLabel(path: string): string {
  return path.replace(/^docs\//, "").replace(/\.md$/, "");
}
