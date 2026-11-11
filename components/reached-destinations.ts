import type { DestinationSearchContext } from "@/components/destination-search-model";
import { staffPageTitles } from "@/components/staff-navigation";
import { alwaysOnModuleKeys, disabledModuleCardKeys } from "@/modules/event-modules/catalog";
import type { EventPermission } from "@/modules/access/permissions";

/**
 * Event pages with no menu entry that staff search still lists (#1661, part 1). Each is a `reached` row in
 * `components/route-mapping.ts`; `tests/reached-destinations-1661.test.ts` keeps the two lists in step.
 *
 * A page is listed only when the viewer passes the same check the page makes on the server, and only when an event is
 * selected. That is the page's own rule, not its parent's. Nothing here grants access: each page keeps its own check.
 * Every word is written in code; no event or attendee data is read.
 */
export type ReachedDestination = {
  route: string;
  label: string;
  description: string;
  /** The menu group the page lives under, shown before the label and searchable. */
  parent: string;
  keywords: readonly string[];
  /** The permission the page's own server check needs. */
  permission: EventPermission;
  /** Hidden when the Honors Weekend module is off for the event, like the Honors card. */
  honorsModule?: true;
};

const payments = staffPageTitles.payments;
const emails = staffPageTitles.emails;
const checkIn = staffPageTitles.checkIn;
const honors = staffPageTitles.honors;

export const reachedDestinations: readonly ReachedDestination[] = [
  { route: "/finance/invoices", label: "Invoices", description: "Draft, review and send what churches and groups are billed after the event.", parent: payments, keywords: ["billing", "bill churches"], permission: "MANAGE_FINANCE" },
  { route: "/finance/invoices/statements", label: "Statements", description: "One statement per church with a final invoice for this event.", parent: payments, keywords: ["church statement", "account statement"], permission: "MANAGE_FINANCE" },
  { route: "/finance/church-owed", label: "Owed by churches", description: "What each church owes, its promo code report and sponsored lodging changes.", parent: payments, keywords: ["balance due", "unpaid", "church balance"], permission: "MANAGE_FINANCE" },
  { route: "/finance/billing-responsibility", label: "Billing responsibility", description: "Who each registration is billed to, and the ones that still need an answer.", parent: payments, keywords: ["who pays", "billed to"], permission: "MANAGE_FINANCE" },
  { route: "/finance/scholarship-fund", label: "Scholarship fund", description: "Money given for scholarships, what has been awarded, and what is left.", parent: payments, keywords: ["scholarship", "awards", "donations"], permission: "MANAGE_FINANCE" },
  { route: "/finance/square-payments", label: "Unmatched Square payments", description: "Square payments that no registration has claimed yet, ready to match by hand.", parent: payments, keywords: ["square payments", "unclaimed payments"], permission: "MANAGE_FINANCE" },
  { route: "/finance/attendance-reconciliation", label: "Attendance reconciliation", description: "Who attended and what each church is billed for, before invoices go out.", parent: payments, keywords: ["attended", "billed attendance"], permission: "MANAGE_FINANCE" },
  { route: "/finance/cancellation-policy", label: "Cancellation rules", description: "The refund rules this event follows when someone cancels.", parent: payments, keywords: ["cancellation policy", "refund rules"], permission: "MANAGE_FINANCE" },
  { route: "/finance/cancellation-requests", label: "Cancellation requests", description: "Requests from registrants to cancel, waiting for a decision.", parent: payments, keywords: ["refunds", "cancel registration"], permission: "MANAGE_FINANCE" },
  { route: "/more/ledger-health", label: "Ledger check", description: "Compares each registration's total with the ledger. It only reads.", parent: payments, keywords: ["ledger health", "totals mismatch"], permission: "MANAGE_FINANCE" },
  { route: "/communications/scheduled", label: "Scheduled emails", description: "Emails waiting to go out at a set time.", parent: emails, keywords: ["scheduled messages", "send later", "queued"], permission: "MANAGE_COMMUNICATIONS" },
  { route: "/check-in/badges", label: "Name badges", description: "Print name badges for this event's attendees.", parent: checkIn, keywords: ["badge", "print badges", "lanyard"], permission: "MANAGE_CHECK_IN" },
  { route: "/check-in/passes", label: "Attendee passes", description: "Passes attendees show at the door or at activities.", parent: checkIn, keywords: ["pass", "qr", "ticket"], permission: "MANAGE_CHECK_IN" },
  { route: "/check-in/assets", label: "Issue keys and items", description: "Hand out and take back keys and other items.", parent: checkIn, keywords: ["keys", "assets", "issued items", "lend"], permission: "MANAGE_CHECK_IN" },
  { route: "/more/honors/schedule", label: "Honors schedule board", description: "Arrange the Honors Weekend classes into rooms and sessions.", parent: honors, keywords: ["honor classes", "rooms", "sessions"], permission: "CONFIGURE_EVENT", honorsModule: true },
  { route: "/more/honors/instructors", label: "Honors instructors", description: "The people teaching the Honors Weekend classes.", parent: honors, keywords: ["honor teachers", "teaching"], permission: "CONFIGURE_EVENT", honorsModule: true },
  { route: "/more/honors/rosters", label: "Honors rosters", description: "Who is signed up for each Honors Weekend class.", parent: honors, keywords: ["honor class lists", "signed up"], permission: "VIEW_REPORTS", honorsModule: true },
];

/** The entries this viewer may open for the selected event: none without an event, none their permissions do not allow. */
export function visibleReachedDestinations(context: Pick<DestinationSearchContext, "selectedEventId" | "permissions" | "hiddenCardKeys">): ReachedDestination[] {
  if (!context.selectedEventId) return [];
  const permissions = new Set(context.permissions);
  // A missing module state is fail-closed, as for the More cards.
  const hidden = context.hiddenCardKeys ?? disabledModuleCardKeys(new Set(alwaysOnModuleKeys));
  return reachedDestinations.filter((entry) => permissions.has(entry.permission) && !(entry.honorsModule && hidden.has("honors")));
}
