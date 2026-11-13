import { describe, expect, it } from "vitest";
import { buildEventTabs, currentEventPlace, eventTabSpecs, maxViewsPerTab, type EventTabsContext } from "@/components/staff-event-tabs";
import { staffPageTitles, navigation, staffSubpageTitle } from "@/components/staff-navigation";
import type { EventPermission } from "@/modules/access/permissions";
import {
  buildMoneyToolsView,
  moneyToolPaths,
  neededMoneyMetrics,
  type MoneyMetricKey,
  type MoneyMetricValues,
  type MoneyToolsViewer,
} from "@/modules/payments/money-tools-model";
import { UNAVAILABLE_STATUS } from "@/modules/system-admin/admin-hubs-model";

const more = { permissions: [] as EventPermission[], clubOversight: false, clubEvent: false, isSystemAdmin: false, clubFormsAccess: false };
const context = (permissions: EventPermission[]): EventTabsContext => ({ permissions, eventId: "evt_1", isSystemAdmin: false, more: { ...more, permissions } });
const finance: MoneyToolsViewer = { permissions: ["MANAGE_FINANCE"] };
const nobody: MoneyToolsViewer = { permissions: ["VIEW_EVENT", "MANAGE_CHECK_IN"] };

const allMetrics = (viewer: MoneyToolsViewer, value: number | null): MoneyMetricValues =>
  Object.fromEntries(neededMoneyMetrics(viewer).map((key) => [key, value]));
const cards = (values: MoneyMetricValues, viewer = finance) => buildMoneyToolsView(viewer, "evt_1", values).groups.flatMap((group) => group.cards);
const statusOf = (title: string, values: MoneyMetricValues) => cards(values).find((card) => card.title === title)?.status ?? null;

describe("Money tab views (#1575)", () => {
  const money = () => buildEventTabs(context(["MANAGE_FINANCE"])).find((tab) => tab.key === "money")!;

  it("lists the five views in order and keeps within the limit", () => {
    expect(money().views.map((view) => view.label)).toEqual(["Payments", "Balances due", "Refunds", "Promo codes", "More money tools"]);
    expect(money().views.length).toBeLessThanOrEqual(maxViewsPerTab);
    expect(eventTabSpecs.find((spec) => spec.key === "money")!.views.length).toBeLessThanOrEqual(maxViewsPerTab);
    expect(money().views.map((view) => view.href)).toEqual([
      "/finance?event=evt_1",
      "/finance?filter=BALANCE&event=evt_1",
      "/finance/cancellation-requests?event=evt_1",
      "/more/promo-codes?event=evt_1",
      "/finance/tools?event=evt_1",
    ]);
  });

  it("gives a viewer without MANAGE_FINANCE no Money tab", () => {
    for (const permissions of [[], ["VIEW_EVENT"], ["VIEW_EVENT", "MANAGE_CHECK_IN", "VIEW_REPORTS"]] as EventPermission[][]) {
      expect(buildEventTabs(context(permissions)).map((tab) => tab.key)).not.toContain("money");
    }
  });

  it("lights the right view for each money page", () => {
    const place = (path: string, query = "") => currentEventPlace(path, new URLSearchParams(query));
    expect(place("/finance")).toEqual({ tab: "money", view: "payments" });
    expect(place("/finance", "filter=BALANCE")).toEqual({ tab: "money", view: "balances" });
    expect(place("/finance/cancellation-requests")).toEqual({ tab: "money", view: "refunds" });
    expect(place("/more/promo-codes")).toEqual({ tab: "money", view: "promo" });
    expect(place("/finance/tools")).toEqual({ tab: "money", view: "more-tools" });
    for (const path of moneyToolPaths) expect(place(path), path).toEqual({ tab: "money", view: "more-tools" });
    expect(place("/finance/invoices/inv_1")).toEqual({ tab: "money", view: "more-tools" });
    expect(place("/finance/invoices/statements/p1")).toEqual({ tab: "money", view: "more-tools" });
  });

  it("registers the new page once, titled and gated like the other finance pages", () => {
    const item = navigation.find((entry) => entry.href === "/finance/tools");
    expect(item?.label).toBe(staffPageTitles.moreMoneyTools);
    expect(item?.requiredPermission).toBe("MANAGE_FINANCE");
    expect(staffSubpageTitle("/finance/tools")).toBe("More money tools");
    // Each money page names itself; the cancellation request queue is the Refunds view.
    expect(staffSubpageTitle("/finance/cancellation-requests")).toBe("Refunds");
    expect(staffSubpageTitle("/finance/church-owed")).toBe(staffPageTitles.churchOwed);
    expect(staffSubpageTitle("/finance/invoices/statements")).toBe(staffPageTitles.invoices);
    expect(staffSubpageTitle("/finance/square-payments")).toBe(staffPageTitles.squarePayments);
    expect(staffSubpageTitle("/finance/cancellation-policy")).toBe(staffPageTitles.cancellationPolicy);
    expect(staffSubpageTitle("/finance")).toBeNull();
  });
});

describe("More money tools model (#1575)", () => {
  it("shows the three groups and the cards from the approved mockup, in order, with the existing page titles (and the Event money report, #1962)", () => {
    const view = buildMoneyToolsView(finance, "evt_1", allMetrics(finance, 1));
    expect(view.groups.map((group) => group.title)).toEqual(["Invoices and churches", "Funds and matching", "Rules and checks"]);
    expect(view.groups.map((group) => group.cards.map((card) => card.title))).toEqual([
      [staffPageTitles.invoices, staffPageTitles.churchOwed, staffPageTitles.billingResponsibility],
      [staffPageTitles.eventMoneyReport, staffPageTitles.scholarshipFund, staffPageTitles.squarePayments, staffPageTitles.attendanceReconciliation],
      [staffPageTitles.cancellationPolicy, staffPageTitles.ledgerCheck],
    ]);
    expect(view.groups.flatMap((group) => group.cards.map((card) => card.href))).toEqual([
      "/finance/invoices?event=evt_1",
      "/finance/church-owed?event=evt_1",
      "/finance/billing-responsibility?event=evt_1",
      "/finance/money-report?event=evt_1",
      "/finance/scholarship-fund?event=evt_1",
      "/finance/square-payments?event=evt_1",
      "/finance/attendance-reconciliation?event=evt_1",
      "/finance/cancellation-policy?event=evt_1",
      "/more/ledger-health?event=evt_1",
    ]);
    expect(view.stats ?? []).toEqual([]);
    expect(view.action ?? null).toBeNull();
  });

  it("hides every card, and reads nothing, for a viewer who cannot open the pages", () => {
    expect(neededMoneyMetrics(nobody)).toEqual([]);
    expect(buildMoneyToolsView(nobody, "evt_1", {}).groups).toEqual([]);
    expect(neededMoneyMetrics(finance).sort()).toEqual(
      (["churchFlags", "ledgerDifferences", "policyVersions", "policyInEffect", "draftInvoices", "scholarshipBalanceCents", "billingUnrecorded", "billingOutdated", "billingUnresolved", "billingNeedsContact", "billedToOrganizations", "attendanceApproved", "unmatchedSquare"] as MoneyMetricKey[]).sort(),
    );
  });

  it("covers every page the Money tab lights as More money tools", () => {
    const spec = eventTabSpecs.find((entry) => entry.key === "money")!.views.find((view) => view.key === "more-tools")!;
    expect([...(spec.alsoOwns ?? [])].sort()).toEqual([...moneyToolPaths].sort());
  });

  it("shows a failed read as Unavailable, never as zero or healthy", () => {
    const failed = allMetrics(finance, null);
    // The Event money report card (#1962) reads no number, so its chip is fixed wording and never "Unavailable".
    const withStatus = cards(failed).filter((card) => card.status && card.title !== staffPageTitles.eventMoneyReport);
    expect(withStatus.length).toBe(8);
    expect(statusOf(staffPageTitles.eventMoneyReport, failed)).toEqual({ tone: "draft", text: "Read-only report" });
    for (const card of withStatus) expect(card.status).toEqual(UNAVAILABLE_STATUS);
    // One failed read does not hide the others.
    expect(statusOf(staffPageTitles.churchOwed, { ...allMetrics(finance, 0), churchFlags: null })).toEqual(UNAVAILABLE_STATUS);
    expect(statusOf(staffPageTitles.ledgerCheck, { ...allMetrics(finance, 0), churchFlags: null })?.text).toBe("All match");
  });

  it("treats a number nobody read as unreadable, so it never claims health", () => {
    for (const card of cards({}).filter((entry) => entry.status && entry.title !== staffPageTitles.eventMoneyReport)) expect(card.status).toEqual(UNAVAILABLE_STATUS);
    expect(statusOf(staffPageTitles.cancellationPolicy, { policyVersions: 1 })).toEqual(UNAVAILABLE_STATUS);
    expect(statusOf(staffPageTitles.cancellationPolicy, { policyInEffect: 1 })).toEqual(UNAVAILABLE_STATUS);
  });

  it("says its status in words", () => {
    const zero = { ...allMetrics(finance, 0), billedToOrganizations: 1 };
    expect(statusOf(staffPageTitles.churchOwed, zero)).toEqual({ tone: "ok", text: "Nothing waiting" });
    expect(statusOf(staffPageTitles.churchOwed, { churchFlags: 1 })).toEqual({ tone: "warn", text: "1 needs the finance office" });
    expect(statusOf(staffPageTitles.churchOwed, { churchFlags: 3 })).toEqual({ tone: "warn", text: "3 need the finance office" });
    expect(statusOf(staffPageTitles.ledgerCheck, { ledgerDifferences: 2 })).toEqual({ tone: "warn", text: "2 to check" });
    expect(statusOf(staffPageTitles.invoices, zero)).toEqual({ tone: "ok", text: "No drafts open" });
    expect(statusOf(staffPageTitles.invoices, { ...zero, draftInvoices: 1 })).toEqual({ tone: "review", text: "1 draft open" });
    expect(statusOf(staffPageTitles.invoices, { ...zero, draftInvoices: 4 })).toEqual({ tone: "review", text: "4 drafts open" });
    expect(statusOf(staffPageTitles.scholarshipFund, { scholarshipBalanceCents: 123456 })).toEqual({ tone: "draft", text: "Balance $1,234.56" });
    expect(statusOf(staffPageTitles.scholarshipFund, { scholarshipBalanceCents: 0 })?.text).toBe("Balance $0.00");
    expect(statusOf(staffPageTitles.cancellationPolicy, { policyVersions: 0, policyInEffect: 0 })).toEqual({ tone: "draft", text: "No rules set" });
    expect(statusOf(staffPageTitles.cancellationPolicy, { policyVersions: 2, policyInEffect: 0 })).toEqual({ tone: "soon", text: "None in effect yet" });
    expect(statusOf(staffPageTitles.cancellationPolicy, { policyVersions: 2, policyInEffect: 1 })).toEqual({ tone: "ok", text: "In effect" });
    expect(statusOf(staffPageTitles.squarePayments, allMetrics(finance, 1))).toEqual({ tone: "warn", text: "Needs attention" });
    expect(statusOf(staffPageTitles.squarePayments, { unmatchedSquare: 4 })).toEqual({ tone: "warn", text: "Needs attention" });
    expect(statusOf(staffPageTitles.squarePayments, { unmatchedSquare: 0 })).toEqual({ tone: "ok", text: "OK" });
    expect(cards({}).find((card) => card.title === staffPageTitles.squarePayments)?.description).toContain("this event's payments only");
    expect(statusOf(staffPageTitles.squarePayments, { unmatchedSquare: null })).toEqual(UNAVAILABLE_STATUS);
    const billing = (extra: MoneyMetricValues) => statusOf(staffPageTitles.billingResponsibility, { ...zero, ...extra });
    expect(billing({})).toEqual({ tone: "ok", text: "All recorded" });
    expect(billing({ billingUnrecorded: 3 })).toEqual({ tone: "review", text: "3 to record" });
    expect(billing({ billingOutdated: 1 })).toEqual({ tone: "warn", text: "1 out of date" });
    expect(billing({ billingUnresolved: 5 })).toEqual({ tone: "warn", text: "5 unresolved" });
    expect(billing({ billingNeedsContact: 1 })).toEqual({ tone: "warn", text: "1 needs a billing contact" });
    expect(billing({ billingNeedsContact: 3 })).toEqual({ tone: "warn", text: "3 need a billing contact" });
    expect(billing({ billingUnrecorded: 2, billingUnresolved: 1 })).toEqual({ tone: "warn", text: "1 unresolved, 2 to record" });
    // Never the ok word while the page itself warns.
    for (const key of ["billingUnrecorded", "billingOutdated", "billingUnresolved", "billingNeedsContact"] as const) expect(billing({ [key]: 1 })?.tone, key).not.toBe("ok");
    const attendance = (extra: MoneyMetricValues) => statusOf(staffPageTitles.attendanceReconciliation, { ...zero, ...extra });
    expect(attendance({ attendanceApproved: 1 })).toEqual({ tone: "draft", text: "Approved version on file" });
    expect(attendance({ attendanceApproved: 0 })).toEqual({ tone: "review", text: "Not approved yet" });
    // One unreadable number makes the whole Billing responsibility card unavailable.
    expect(billing({ billingOutdated: null })).toEqual(UNAVAILABLE_STATUS);
    expect(billing({ billingUnresolved: null })).toEqual(UNAVAILABLE_STATUS);
    expect(billing({ billedToOrganizations: null })).toEqual(UNAVAILABLE_STATUS);
    expect(statusOf(staffPageTitles.attendanceReconciliation, {})).toEqual(UNAVAILABLE_STATUS);
  });

  it("shows a neutral Not used for this event on an event not billed to organizations", () => {
    const notBilled = { ...allMetrics(finance, 0), billedToOrganizations: 0, draftInvoices: 0, attendanceApproved: 0 };
    for (const title of [staffPageTitles.invoices, staffPageTitles.billingResponsibility, staffPageTitles.attendanceReconciliation]) {
      expect(statusOf(title, notBilled), title).toEqual({ tone: "draft", text: "Not used for this event" });
    }
    // The other cards are not affected.
    expect(statusOf(staffPageTitles.churchOwed, notBilled)?.text).toBe("Nothing waiting");
  });

  it("gathers the tools the event does not use into one last group, and keeps every card's chip", () => {
    const notBilled = { ...allMetrics(finance, 0), billedToOrganizations: 0 };
    const view = buildMoneyToolsView(finance, "evt_1", notBilled);
    expect(view.groups.map((group) => group.title)).toEqual(["Invoices and churches", "Funds and matching", "Rules and checks", "Not used for this event"]);
    const last = view.groups[view.groups.length - 1];
    expect(last.cards.map((card) => card.title)).toEqual([staffPageTitles.invoices, staffPageTitles.billingResponsibility, staffPageTitles.attendanceReconciliation]);
    for (const card of last.cards) expect(card.status?.text).toBe("Not used for this event");
    for (const group of view.groups.slice(0, -1)) for (const card of group.cards) expect(card.status?.text).not.toBe("Not used for this event");
    // Every card carries a chip, so it is in the same place on all of them.
    for (const card of view.groups.flatMap((group) => group.cards)) expect(card.status).not.toBeNull();
    // An unreadable card is not moved on a guess.
    const unknown = buildMoneyToolsView(finance, "evt_1", { ...notBilled, billedToOrganizations: null });
    expect(unknown.groups.map((group) => group.title)).not.toContain("Not used for this event");
    // A used event has no such group, and the three groups keep their order.
    expect(buildMoneyToolsView(finance, "evt_1", allMetrics(finance, 1)).groups).toHaveLength(3);
  });
});
