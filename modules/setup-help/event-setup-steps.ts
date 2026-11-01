import type { EventPermission } from "@/modules/access/permissions";
import { askSystemAdmin, howTo, type RoleSetupEntry } from "./role-setup";

/**
 * Every Event-workspace state that can read "not set up", "missing", "blocked" or "empty" for an event admin or other
 * event staff, with the Set up link, How-to steps or who to ask (#1435, round B; rules H3 and H4). The one place the
 * event steps live. A Set up link to another page is given only when the viewer's permission opens it (`can`), so no one is
 * sent to a page that refuses them; otherwise the entry is steps plus who to ask. Same-page anchors need no permission.
 */
export const EVENT_SETUP_IDS = [
  "readiness-basics",
  "readiness-location",
  "readiness-support",
  "readiness-club-billing",
  "readiness-public-info",
  "readiness-central-sender",
  "email-provider-locked",
  "announcements-none",
  "scheduled-emails-none",
  "cancellation-policy-none",
  "meals-no-services",
  "lodging-no-properties",
  "check-in-no-arrivals",
  "badges-none",
  "passes-none",
  "reports-no-attendees",
  "reports-no-fields",
  "square-unavailable",
  "club-invites-none",
  "club-invites-email",
] as const;
export type EventSetupId = (typeof EVENT_SETUP_IDS)[number];

export type EventSetupContext = {
  eventId?: string | null;
  /** Whether the viewer holds an event permission. Absent means unknown, so no cross-page link is offered. */
  can?: (permission: EventPermission) => boolean;
  /** A system administrator can open the System pages. */
  systemAdmin?: boolean;
};

const ASK_EVENT_ADMIN = "If you cannot open it, ask an event administrator.";
const query = (eventId: string | null | undefined) => (eventId ? `?event=${encodeURIComponent(eventId)}` : "");

export function eventSetupFor(id: EventSetupId, ctx: EventSetupContext = {}): RoleSetupEntry {
  const staff = "staff" as const;
  const link = (permission: EventPermission, path: string, label: string) =>
    ctx.eventId && ctx.can?.(permission) ? { href: `${path}${query(ctx.eventId)}`, label } : null;
  switch (id) {
    case "readiness-basics":
      return { setup: { href: "#event-settings-block-basics", label: "Fill in the event basics" }, guideId: "finish-event-setup", guideScope: staff };
    case "readiness-location":
      return { setup: { href: "#event-field-location", label: "Go to Location" }, guideId: "finish-event-setup", guideScope: staff };
    case "readiness-support":
      return { setup: { href: "#event-field-support-contact", label: "Go to Registration support contact" }, guideId: "finish-event-setup", guideScope: staff };
    case "readiness-club-billing":
      return { setup: { href: "#event-field-billing-mode", label: "Go to Billing mode" }, guideId: "finish-event-setup", guideScope: staff };
    case "readiness-public-info":
      return {
        setup: howTo(["Open the IMSDA.org information page field in event settings.", "Type a full web address that starts with http:// or https://, or clear the field.", "Choose Save event settings."], "The row shows done. This never blocks publishing."),
        guideId: "finish-event-setup",
        guideScope: staff,
      };
    case "readiness-central-sender":
      return {
        setup: howTo(["The central email sender is a platform setting, so it is saved in System management under Email.", "Ask a system administrator to save the sender address.", "Confirmation and reminder emails wait until it is saved."], "Central email sender saved shows done."),
        whoToAsk: askSystemAdmin("save the central email sender"),
        guideId: "resolve-email-problem",
        guideScope: staff,
      };
    case "email-provider-locked":
      return {
        setup: ctx.systemAdmin
          ? { href: "/admin/email", label: "Open email settings" }
          : howTo(["Real email is off until the email provider is set up for the whole platform.", "Ask a system administrator to open the System report and set up the email provider.", "Until then, messages are captured for preview and nothing is sent."], "Delivery readiness says the provider is configured."),
        whoToAsk: ctx.systemAdmin ? undefined : askSystemAdmin("set up the email provider"),
        guideId: "schedule-event-emails",
        guideScope: staff,
      };
    case "announcements-none":
      return { setup: howTo(["Choose to create a draft announcement.", "Write the title and message, and save the draft.", "Publish it when it is ready. It then shows in the attendee event feed."], "The announcement is listed."), guideId: "schedule-event-emails", guideScope: staff };
    case "scheduled-emails-none":
      return { setup: howTo(["Choose to add a schedule.", "Pick the message and the time, and save.", "Approve it. An email that is not approved does not send."], "The schedule is listed as approved."), guideId: "schedule-event-emails", guideScope: staff };
    case "cancellation-policy-none": {
      return {
        setup: howTo(["Fill in the first rule in the form below: how much is refunded and by when.", "Choose Save to keep the first version.", "Attendees can then ask to cancel online."], "Cancellation policy set shows done on Event settings."),
        whoToAsk: "Cancellation rules are saved by finance access. If you cannot save, ask the event's finance manager or an event administrator.",
        guideId: "finish-event-setup",
        guideScope: staff,
      };
    }
    case "meals-no-services":
      return { setup: howTo(["Use the form below this line to add a meal service: a name, a day and a time.", "Add one for each meal you will serve.", "Attendees can then order meals on the registration form."], "Each meal service is listed."), whoToAsk: ASK_EVENT_ADMIN, guideId: "finish-event-setup", guideScope: staff };
    case "lodging-no-properties":
      return {
        setup: howTo(["Lodging properties are loaded for the whole platform, not per event.", "Ask a system administrator to load the lodging properties.", "Then choose the property for this event here."], "The property list is not empty and you can choose Use this property."),
        whoToAsk: askSystemAdmin("load the lodging properties"),
        guideId: "finish-event-setup",
        guideScope: staff,
      };
    case "check-in-no-arrivals": {
      const settings = link("CONFIGURE_EVENT", "/more/event-settings", "Open publishing");
      return {
        setup: settings ?? howTo(["Check that the registration form and the event are published.", "People appear here once they submit the public form.", "Share the registration link with attendees."], "Expected attendees are listed."),
        whoToAsk: settings ? undefined : "Publishing is done by an event administrator. Ask them.",
        guideId: "prepare-check-in-and-badges",
        guideScope: staff,
      };
    }
    case "badges-none":
    case "passes-none":
      return {
        setup: howTo(["Badges and passes are made for each active submitted or confirmed attendee.", "They appear here automatically once people register.", "If you expected some, check Registrations and that the event is published."], "A sheet is ready to print."),
        whoToAsk: "Only an event administrator can publish. Ask them if registration is not open.",
        guideId: "prepare-check-in-and-badges",
        guideScope: staff,
      };
    case "reports-no-attendees":
      return { setup: howTo(["Reports fill in from registrations, so they are empty until people register.", "Check that the registration form and the event are published."], "The report lists attendees."), whoToAsk: ASK_EVENT_ADMIN, guideId: "finish-event-setup", guideScope: staff };
    case "reports-no-fields":
      return {
        setup: ctx.eventId && ctx.can?.("MANAGE_FORMS")
          ? { href: `/registration-builder${query(ctx.eventId)}`, label: "Open the registration form" }
          : howTo(["This section counts answers to one kind of question.", "Add that kind of question to the registration form in Registration forms.", "It fills in as people answer."], "The section shows counts."),
        whoToAsk: ctx.eventId && ctx.can?.("MANAGE_FORMS") ? undefined : "Registration forms are edited by someone with form access. Ask an event administrator.",
        guideId: "finish-event-setup",
        guideScope: staff,
      };
    case "square-unavailable":
      return {
        setup: howTo(["Square could not be reached from this server, so payments taken elsewhere cannot be matched yet.", "Try again in a few minutes.", "If it keeps failing, ask a system administrator to check the Square settings in the System report."], "Outstanding Square payments are listed."),
        whoToAsk: askSystemAdmin("check the Square connection"),
        guideId: "understand-system-readiness",
        guideScope: staff,
      };
    case "club-invites-none":
      return { setup: { href: "/admin/clubs/import", label: "Import clubs" }, guideId: "review-new-club-application", guideScope: staff };
    case "club-invites-email":
      return {
        setup: ctx.systemAdmin
          ? { href: "/admin/system-report", label: "Open the System report" }
          : howTo(["Invites are emailed, and account email is a platform setting.", "Ask a system administrator to set up account email in the System report.", "Come back and send the invites."], "Invites can be sent."),
        whoToAsk: ctx.systemAdmin ? undefined : askSystemAdmin("set up account email"),
        guideId: "resolve-email-problem",
        guideScope: staff,
      };
  }
}
