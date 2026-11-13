import type { DestinationSearchContext } from "@/components/destination-search-model";
import { staffPageTitles } from "@/components/staff-navigation";
import { alwaysOnModuleKeys, disabledModuleCardKeys } from "@/modules/event-modules/catalog";
import { closeoutPermissions } from "@/components/issued-assets-views-model";
import type { EventPermission } from "@/modules/access/permissions";

/**
 * Pages with no menu entry that staff search still lists (#1661, parts 1 and 2). Each is a `reached` row in
 * `components/route-mapping.ts`; `tests/reached-destinations-1661.test.ts` keeps the two lists in step.
 *
 * A page is listed only when the viewer passes the same check the page makes on the server. That is the page's own rule,
 * not its parent's, including any extra condition (the event's audience, club oversight, system administrator). An Event page
 * also needs a selected event; a System page does not. A condition the search context cannot express is left out, not guessed. Nothing here grants access: each page keeps its own check.
 * Every word is written in code; no event or attendee data is read.
 */
export type ReachedDestination = {
  route: string;
  label: string;
  description: string;
  /** The menu group the page lives under, shown before the label and searchable. */
  parent: string;
  /** The parent as a system administrator sees it, when the menu names it differently. */
  systemAdminParent?: string;
  keywords: readonly string[];
  /** Event pages need a selected event; System pages are built without one. */
  scope: "Event" | "System";
  /** Event pages: the permissions the page's own server check accepts (any one opens it). */
  permissions: readonly EventPermission[];
  /** Event pages: club oversight of the event also opens the page ("or"), or is the only way in ("only"). */
  oversight?: "or" | "only";
  /** Event pages: the event's audience the page needs (the page says "Not available" on the other). */
  audience?: "GENERAL" | "CLUB";
  /** Hidden when the Honors Weekend module is off for the event, like the Honors card. */
  honorsModule?: true;
  /** System pages: a system administrator only, or a system administrator or an active Clubs Administrator. */
  systemAccess?: "systemAdmin" | "clubsAdmin";
};

const payments = staffPageTitles.payments;
const emails = staffPageTitles.emails;
const checkIn = staffPageTitles.checkIn;
const honors = staffPageTitles.honors;
const registrations = staffPageTitles.registrations;
const meals = staffPageTitles.meals;
const clubsOfEvent = "Clubs and churches";
const clubsOfEventForAdmin = "This event's clubs";
const clubsAndChurches = "Clubs and churches";
const systemHome = "System administration";

export const reachedDestinations: readonly ReachedDestination[] = [
  { route: "/finance/invoices", label: staffPageTitles.invoices, description: "Draft, review and send what churches and groups are billed after the event.", parent: payments, keywords: ["billing", "bill churches"], scope: "Event", permissions: ["MANAGE_FINANCE"] },
  { route: "/finance/invoices/statements", label: "Statements", description: "One statement per church with a final invoice for this event.", parent: payments, keywords: ["church statement", "account statement"], scope: "Event", permissions: ["MANAGE_FINANCE"] },
  { route: "/finance/church-owed", label: staffPageTitles.churchOwed, description: "What each church owes, its promo code report and sponsored lodging changes.", parent: payments, keywords: ["balance due", "unpaid", "church balance"], scope: "Event", permissions: ["MANAGE_FINANCE"] },
  { route: "/finance/billing-responsibility", label: staffPageTitles.billingResponsibility, description: "Who each registration is billed to, and the ones that still need an answer.", parent: payments, keywords: ["who pays", "billed to"], scope: "Event", permissions: ["MANAGE_FINANCE"] },
  { route: "/finance/scholarship-fund", label: staffPageTitles.scholarshipFund, description: "Money given for scholarships, what has been awarded, and what is left.", parent: payments, keywords: ["scholarship", "awards", "donations"], scope: "Event", permissions: ["MANAGE_FINANCE"] },
  { route: "/finance/money-report", label: staffPageTitles.eventMoneyReport, description: "What was charged, discounted, paid and refunded for this event, what is still owed, and a CSV download.", parent: payments, keywords: ["money report", "event totals", "charges and payments", "outstanding balance"], scope: "Event", permissions: ["MANAGE_FINANCE", "VIEW_REPORTS"] },
  { route: "/finance/closeout", label: staffPageTitles.eventCloseout, description: "The checks to settle before an event is closed, the finance sign-off that closes it, and the sign-off history.", parent: payments, keywords: ["closeout", "close event", "sign off", "treasurer sign-off", "reopen event", "financial reconciliation"], scope: "Event", permissions: ["MANAGE_FINANCE", "FINALIZE_INVOICES", "VIEW_REPORTS"] },
  { route: "/finance/square-payments", label: staffPageTitles.squarePayments, description: "Square payments that no registration has claimed yet, ready to match by hand.", parent: payments, keywords: ["square payments", "unmatched", "unclaimed payments"], scope: "Event", permissions: ["MANAGE_FINANCE"] },
  { route: "/finance/attendance-reconciliation", label: staffPageTitles.attendanceReconciliation, description: "Who attended and what each church is billed for, before invoices go out.", parent: payments, keywords: ["attended", "billed attendance"], scope: "Event", permissions: ["MANAGE_FINANCE"] },
  { route: "/finance/cancellation-policy", label: staffPageTitles.cancellationPolicy, description: "The refund rules this event follows when someone cancels.", parent: payments, keywords: ["cancellation rules", "cancellation policy", "refund rules"], scope: "Event", permissions: ["MANAGE_FINANCE"] },
  { route: "/finance/cancellation-requests", label: "Refunds", description: "Requests from registrants to cancel, waiting for a decision.", parent: payments, keywords: ["cancellation requests", "cancel registration"], scope: "Event", permissions: ["MANAGE_FINANCE"] },
  { route: "/more/ledger-health", label: staffPageTitles.ledgerCheck, description: "Compares each registration's total with the ledger. It only reads.", parent: payments, keywords: ["ledger check", "ledger health", "totals mismatch"], scope: "Event", permissions: ["MANAGE_FINANCE"] },
  { route: "/communications/scheduled", label: staffPageTitles.scheduledEmails, description: "Emails waiting to go out at a set time.", parent: emails, keywords: ["scheduled messages", "send later", "queued"], scope: "Event", permissions: ["MANAGE_COMMUNICATIONS"] },
  { route: "/check-in/badges", label: "Printable name badges", description: "Print name badges for this event's attendees.", parent: checkIn, keywords: ["name badges", "badge", "print badges", "lanyard"], scope: "Event", permissions: ["MANAGE_CHECK_IN"] },
  { route: "/check-in/passes", label: "Printable attendee passes", description: "Print passes for this event's attendees.", parent: checkIn, keywords: ["attendee passes", "pass", "qr", "ticket"], scope: "Event", permissions: ["MANAGE_CHECK_IN"] },
  { route: "/check-in/assets", label: "Issue keys and items", description: "Hand out and take back keys and other items.", parent: checkIn, keywords: ["keys", "assets", "issued items", "lend"], scope: "Event", permissions: ["MANAGE_CHECK_IN"] },
  { route: "/more/honors/schedule", label: staffPageTitles.honorsSchedule, description: "Arrange the Honors Weekend classes into rooms and sessions.", parent: honors, keywords: ["honors schedule board", "honor classes", "rooms", "sessions"], scope: "Event", permissions: ["CONFIGURE_EVENT"], honorsModule: true },
  { route: "/more/honors/instructors", label: staffPageTitles.honorsInstructors, description: "The people teaching the Honors Weekend classes.", parent: honors, keywords: ["honors instructors", "honor teachers", "teaching"], scope: "Event", permissions: ["CONFIGURE_EVENT"], honorsModule: true },
  { route: "/more/honors/rosters", label: staffPageTitles.honorsRosters, description: "Who is signed up for each Honors Weekend class.", parent: honors, keywords: ["honors rosters", "honor class lists", "signed up"], scope: "Event", permissions: ["VIEW_REPORTS"], honorsModule: true },

  // Registrations (#1661 part 2). The staff invitation pages are for an event open to everyone.
  { route: "/people/directory-review", label: "Directory review", description: "Clubs and churches people typed in because they were not in the directory.", parent: registrations, keywords: ["not in directory", "typed in church", "unlisted club"], scope: "Event", permissions: ["MANAGE_REGISTRATION"] },
  { route: "/people/duplicates", label: "Duplicate finder", description: "People and registrations that look like the same person entered more than once.", parent: registrations, keywords: ["possible duplicates", "duplicate registrations", "same person", "find duplicates"], scope: "Event", permissions: ["VIEW_SENSITIVE_DATA"] },
  { route: "/people/pending-teams", label: "Teams waiting for a club", description: "Teams that registered through the general link and need a club confirmed.", parent: registrations, keywords: ["pending teams", "attach a club", "general link teams"], scope: "Event", permissions: ["MANAGE_REGISTRATION"] },
  { route: "/people/responsible-adults", label: "Responsible adults", description: "Minors with no adult on record, an unknown age, or two adults claiming one child.", parent: registrations, keywords: ["guardian", "minors", "children", "unaccompanied"], scope: "Event", permissions: ["VIEW_SENSITIVE_DATA"] },
  { route: "/people/staff-invitations", label: "Staff, pastor and volunteer invitations", description: "Personal links for staff, pastors and volunteers: import, send and revoke.", parent: registrations, keywords: ["staff invitations", "pastor links", "volunteer links", "personal links"], scope: "Event", permissions: ["MANAGE_REGISTRATION"], audience: "GENERAL" },
  { route: "/people/staff-invitations/approvals", label: "Staff registrations waiting for approval", description: "Staff, pastor and volunteer registrations waiting for the office to approve or decline.", parent: registrations, keywords: ["staff approvals", "approve staff", "pending staff"], scope: "Event", permissions: ["MANAGE_REGISTRATION"], audience: "GENERAL" },
  // Meals and the kitchen: the views of the Meals area.
  { route: "/more/kitchen-report", label: staffPageTitles.kitchenReport, description: "Meal counts for the kitchen and the dietary needs behind them, to print or download.", parent: meals, keywords: ["kitchen", "meal counts", "dietary needs", "food counts"], scope: "Event", permissions: ["VIEW_REPORTS"] },
  { route: "/more/kitchen-report/closeout", label: staffPageTitles.mealCloseout, description: "Meal charges, credits, conference billing and walk-up orders beside what was ordered, served and prepared.", parent: meals, keywords: ["meal billing", "meal reconciliation", "walk-up orders"], scope: "Event", permissions: ["MANAGE_FINANCE"] },
  { route: "/more/kitchen-report/scanner-import", label: staffPageTitles.scannerResults, description: "Bring the cafe scanner's results back to see how many meals were served.", parent: meals, keywords: ["scanner import", "meals served", "cafe scanner"], scope: "Event", permissions: ["VIEW_REPORTS"] },
  { route: "/more/issued-assets/closeout", label: "Issued asset closeout", description: "What is still out, lost, charged or held for issued keys and items.", parent: staffPageTitles.issuedAssets, keywords: ["keys outstanding", "lost keys", "asset closeout", "return keys"], scope: "Event", permissions: closeoutPermissions },
  // Club event pages: only for a club event. Report access or event-manager oversight opens the reports; oversight alone the records.
  { route: "/more/clubs/reports", label: staffPageTitles.clubMonthlyReports, description: "Submitted Monthly Records for the clubs at this event, view only.", parent: clubsOfEvent, systemAdminParent: clubsOfEventForAdmin, keywords: ["monthly records", "records to review", "club records"], scope: "Event", permissions: [], oversight: "only", audience: "CLUB" },
  { route: "/more/team-results", label: staffPageTitles.teamResults, description: "Team results and permissions for this club event.", parent: clubsOfEvent, systemAdminParent: clubsOfEventForAdmin, keywords: ["teams", "team scores", "team permissions", "results"], scope: "Event", permissions: ["VIEW_REPORTS"], oversight: "or", audience: "CLUB" },
  { route: "/more/reports/clubs", label: staffPageTitles.clubReports, description: "Camping, duties and activities, spiritual milestones and special roles from each club's registration.", parent: staffPageTitles.printouts, keywords: ["club reports", "camping", "duties", "milestones"], scope: "Event", permissions: ["VIEW_REPORTS"], oversight: "or", audience: "CLUB" },
  // System pages: no event needed.
  { route: "/admin/organizations/import", label: "Import organizations", description: "Upload the eAdventist organizations export, review what it would add, update or flag, then save.", parent: clubsAndChurches, keywords: ["import churches", "eadventist", "upload csv", "bulk churches"], scope: "System", permissions: [], systemAccess: "systemAdmin" },
  { route: "/admin/organizations/directory", label: "Organization directory", description: "Churches, companies and groups that are active appear in registration form church lists; active schools appear in school lists.", parent: clubsAndChurches, keywords: ["church list", "school list", "organizations", "active churches"], scope: "System", permissions: [], systemAccess: "systemAdmin" },
  { route: "/admin/organizations/map-locations", label: "Find map locations", description: "Looks up map points for imported churches so their clubs appear on the public club map.", parent: clubsAndChurches, keywords: ["club map", "church locations", "geocode"], scope: "System", permissions: [], systemAccess: "systemAdmin" },
  { route: "/admin/problem-reports", label: "Problem reports", description: "Problems people sent from the Forms help popup, with the technical details they allowed; mark each resolved.", parent: systemHome, keywords: ["forms help", "reported problems", "bug reports"], scope: "System", permissions: [], systemAccess: "systemAdmin" },
  { route: "/admin/feature-requests", label: "Event module requests", description: "Approve or decline the event features that staff asked for.", parent: systemHome, keywords: ["feature requests", "module requests", "approve feature"], scope: "System", permissions: [], systemAccess: "systemAdmin" },
  { route: "/admin/club-supplies/conference-orders", label: "Conference club orders", description: "Patches and pins clubs ordered from the conference, billed to their churches.", parent: "Club supply catalog", keywords: ["patch orders", "pin orders", "supply orders"], scope: "System", permissions: [], systemAccess: "clubsAdmin" },
];

type ReachedContext = Pick<DestinationSearchContext, "isSystemAdmin" | "selectedEventId" | "permissions" | "clubOversight" | "clubEvent" | "hiddenCardKeys" | "clubsAdmin">;

/**
 * The entries this viewer may open: an Event page needs a selected event and passes the page's own check; a System page
 * needs no event. Each entry comes back with the parent this viewer's menu shows.
 */
export function visibleReachedDestinations(context: ReachedContext): ReachedDestination[] {
  const permissions = new Set(context.permissions);
  // A missing module state is fail-closed, as for the More cards.
  const hidden = context.hiddenCardKeys ?? disabledModuleCardKeys(new Set(alwaysOnModuleKeys));
  const opens = (entry: ReachedDestination): boolean => {
    if (entry.scope === "System") return context.isSystemAdmin || (entry.systemAccess === "clubsAdmin" && Boolean(context.clubsAdmin));
    if (!context.selectedEventId) return false;
    if (entry.audience === "GENERAL" && context.clubEvent) return false;
    if (entry.audience === "CLUB" && !context.clubEvent) return false;
    if (entry.honorsModule && hidden.has("honors")) return false;
    // Oversight is for a club event only, whatever the flag says.
    const oversight = entry.oversight !== undefined && context.clubOversight && context.clubEvent;
    if (entry.oversight === "only") return oversight;
    return entry.permissions.some((permission) => permissions.has(permission)) || oversight;
  };
  return reachedDestinations.filter(opens).map((entry) => (entry.systemAdminParent && context.isSystemAdmin ? { ...entry, parent: entry.systemAdminParent } : entry));
}
