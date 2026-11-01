import type { HelpGuide } from "@/modules/help/types";

/**
 * Staff guides the "not set up" help links to (#1435): finishing an event's setup, getting check-in and badges ready, and
 * scheduling emails. Same wording rules as `guides.ts`: plain short sentences, exact on-screen labels, synthetic only, no
 * person's name and no event name. They live here only to keep `guides.ts` short.
 */
const OWNER = "Communication office";
const REVIEWED = "2026-11-01";

export const eventSetupGuides: readonly HelpGuide[] = [
  {
    id: "finish-event-setup",
    title: "Finish setting up an event",
    summary: "Clear what the publish checklist and the setup pages say is missing: basics, attendee types, cancellation policy, meals, lodging and reports.",
    workspace: "Event",
    audience: { kind: "event-permission", permission: "CONFIGURE_EVENT" },
    needs: ["Access to Event settings for the event.", "Some items need other access. The guide says which, and who to ask."],
    changes: ["Each step saves its own page. Nothing is published until you publish the event."],
    steps: [
      "Open Event settings and read Publish readiness. Items under Required before publishing must be done. Items under Recommended do not block publishing.",
      "For the name, web address, dates, location, support contact and billing mode, fill in the field the row names and choose Save event settings.",
      "Open Attendee setup and add at least one attendee type, such as Adult or Youth. Prices and who gets each email depend on it.",
      "If Cancellation policy set is open, open Cancellation policy and save the first version. Without one, attendees cannot ask to cancel online. This needs finance access; if you do not have it, ask the event's finance manager.",
      "The central email sender is saved by a system administrator. If that row is open, ask a system administrator.",
      "Open Meals to add meal services, and Lodging to choose a property. If Lodging lists no properties, ask a system administrator to load them.",
      "Reports show nothing until registrations come in. A section that says no fields are configured needs a question of that kind on the registration form, in Registration forms.",
    ],
    verify: ["The readiness panel shows the row as done.", "Each page you opened lists what you added."],
    next: "Publish the registration form, then publish the event.",
    destinationIds: ["event-settings", "attendee-configuration", "cancellation-policy", "event-meals", "event-lodging", "event-reports", "registration-forms"],
    relatedDocs: [],
    keywords: ["setup", "set up", "not set up", "missing", "publish checklist", "attendee types", "cancellation policy", "meals", "lodging", "reports empty", "no data", "getting started", "central sender"],
    owner: OWNER,
    lastReviewed: REVIEWED,
  },
  {
    id: "prepare-check-in-and-badges",
    title: "Get check-in and badges ready",
    summary: "Know why check-in or badges show nothing, and what to do so people appear.",
    workspace: "Event",
    audience: { kind: "event-permission", permission: "MANAGE_CHECK_IN" },
    needs: ["Check-in access for the event."],
    changes: ["Nothing. These pages only read registrations."],
    steps: [
      "Open Check-in. The arrival list fills from registrations that are submitted or confirmed.",
      "If it says there are no expected attendees, nobody has registered yet. Registrations appear after people submit the public form, so check that the registration form and the event are published.",
      "Open Badges to print name badges. A badge is made for each active submitted or confirmed attendee, so the page is empty until there are some.",
      "Passes work the same way and appear once the event uses them.",
      "To publish a form or an event, ask an event administrator. Check-in staff cannot.",
    ],
    verify: ["Check-in lists the arrivals you expect.", "Badges shows a sheet to print."],
    next: "Print the badges before the event starts.",
    destinationIds: ["event-check-in", "event-badges", "registration-forms", "event-settings"],
    relatedDocs: [],
    keywords: ["check-in", "check in", "badges", "passes", "arrivals", "no expected attendees", "print", "station", "empty"],
    owner: OWNER,
    lastReviewed: REVIEWED,
  },
  {
    id: "schedule-event-emails",
    title: "Schedule event emails and check delivery",
    summary: "Add a scheduled email, and know what to do when real email is not turned on.",
    workspace: "Event",
    audience: { kind: "event-permission", permission: "MANAGE_COMMUNICATIONS" },
    needs: ["Email access for the event."],
    changes: ["A scheduled email sends at its time once you approve it. You can pause or cancel it before it starts."],
    steps: [
      "Open Emails and choose the scheduled emails area.",
      "Choose to add a schedule, pick the message and the time, and save it.",
      "Approve it. An email that is not approved does not send.",
      "If Delivery readiness says Real email is locked, the email provider is not set up. Event staff cannot fix this: ask a system administrator, and see the Resolve an email problem guide.",
      "The central sender address is also saved by a system administrator.",
    ],
    verify: ["The schedule shows as approved with its send time.", "Delivery readiness says the provider is configured."],
    next: "Check the outbox after the first send.",
    destinationIds: ["event-emails", "system-email"],
    relatedDocs: [],
    keywords: ["email", "emails", "schedule", "scheduled", "communications", "announcement", "provider", "not configured", "real email locked", "sender"],
    owner: OWNER,
    lastReviewed: REVIEWED,
  },
];
