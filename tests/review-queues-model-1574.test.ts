import { describe, expect, it } from "vitest";
import { buildEventTabs, currentEventPlace, eventTabSpecs, maxViewsPerTab, type EventTabsContext } from "@/components/staff-event-tabs";
import { navigation, staffPageTitles, staffSubpageTitle } from "@/components/staff-navigation";
import type { EventPermission } from "@/modules/access/permissions";
import {
  buildReviewQueuesView,
  hasVisibleReviewQueue,
  neededReviewQueueMetrics,
  reviewQueuePaths,
  type ReviewQueueMetricValues,
  type ReviewQueuesViewer,
} from "@/modules/review-queues/review-queues-model";
import { UNAVAILABLE_STATUS } from "@/modules/system-admin/admin-hubs-model";

const more = { permissions: [] as EventPermission[], clubOversight: false, clubEvent: false, isSystemAdmin: false, clubFormsAccess: false };
const context = (permissions: EventPermission[], clubEvent = false): EventTabsContext => ({ permissions, eventId: "evt_1", isSystemAdmin: false, more: { ...more, permissions, clubEvent } });
const manager: ReviewQueuesViewer = { permissions: ["MANAGE_REGISTRATION", "VIEW_SENSITIVE_DATA"], audience: "GENERAL" };
const sensitiveOnly: ReviewQueuesViewer = { permissions: ["VIEW_SENSITIVE_DATA"], audience: "GENERAL" };
const manageOnly: ReviewQueuesViewer = { permissions: ["MANAGE_REGISTRATION"], audience: "GENERAL" };
const nobody: ReviewQueuesViewer = { permissions: ["VIEW_EVENT", "MANAGE_CHECK_IN", "VIEW_REPORTS"], audience: "GENERAL" };

const allMetrics = (viewer: ReviewQueuesViewer, value: number | null): ReviewQueueMetricValues =>
  Object.fromEntries(neededReviewQueueMetrics(viewer).map((key) => [key, value]));
const cards = (values: ReviewQueueMetricValues, viewer = manager) => buildReviewQueuesView(viewer, "evt_1", values).groups.flatMap((group) => group.cards);
const statusOf = (title: string, values: ReviewQueueMetricValues, viewer = manager) => cards(values, viewer).find((card) => card.title === title)?.status ?? null;

describe("Registrations tab views (#1574)", () => {
  const registrations = (permissions: EventPermission[], clubEvent = false) => buildEventTabs(context(permissions, clubEvent)).find((tab) => tab.key === "registrations")!;

  it("lists the four views in order and keeps within the limit", () => {
    const tab = registrations(["VIEW_SENSITIVE_DATA", "MANAGE_REGISTRATION", "MANAGE_IMPORTS"]);
    expect(tab.views.map((view) => view.label)).toEqual(["All registrations", "Attendee list", "Imports", "Review queues"]);
    expect(tab.views.length).toBeLessThanOrEqual(maxViewsPerTab);
    expect(eventTabSpecs.find((spec) => spec.key === "registrations")!.views.length).toBeLessThanOrEqual(maxViewsPerTab);
    expect(tab.views.map((view) => view.href)).toEqual([
      "/people?event=evt_1",
      "/people/attendees?event=evt_1",
      "/imports?event=evt_1",
      "/people/review-queues?event=evt_1",
    ]);
  });

  it("shows Review queues only to someone who can open at least one queue", () => {
    expect(registrations(["VIEW_SENSITIVE_DATA"]).views.map((view) => view.label)).toContain("Review queues");
    expect(registrations(["MANAGE_REGISTRATION", "VIEW_SENSITIVE_DATA"]).views.map((view) => view.label)).toContain("Review queues");
    const without = buildEventTabs(context(["VIEW_EVENT", "MANAGE_CHECK_IN"])).find((tab) => tab.key === "registrations");
    expect((without?.views ?? []).map((view) => view.label)).not.toContain("Review queues");
  });

  it("keeps Review queues for a registration manager on a club event, where the directory and team queues still apply", () => {
    // A lone view has no strip, so the tab itself opens it.
    const club = buildEventTabs(context(["MANAGE_REGISTRATION"], true)).find((tab) => tab.key === "registrations");
    expect(club?.href).toBe("/people/review-queues?event=evt_1");
  });

  it("lights Review queues for each queue page and its child pages, and All registrations for the rest", () => {
    const place = (path: string) => currentEventPlace(path, new URLSearchParams(""));
    expect(place("/people")).toEqual({ tab: "registrations", view: "registrations" });
    expect(place("/people/attendees")).toEqual({ tab: "registrations", view: "attendees" });
    expect(place("/imports")).toEqual({ tab: "registrations", view: "imports" });
    expect(place("/people/review-queues")).toEqual({ tab: "registrations", view: "review-queues" });
    expect(reviewQueuePaths).toHaveLength(6);
    for (const path of reviewQueuePaths) expect(place(path), path).toEqual({ tab: "registrations", view: "review-queues" });
    // The cross-event identity queue is system identity review, not one of this event's queues.
    expect(place("/people/matches")).toEqual({ tab: "registrations", view: "registrations" });
  });

  it("covers every page the Registrations tab lights as Review queues", () => {
    const spec = eventTabSpecs.find((entry) => entry.key === "registrations")!.views.find((view) => view.key === "review-queues")!;
    expect([...(spec.alsoOwns ?? [])].sort()).toEqual([...reviewQueuePaths].sort());
    const all = eventTabSpecs.find((entry) => entry.key === "registrations")!.views.find((view) => view.key === "registrations")!;
    expect(all.alsoOwns).toEqual(["/people/matches"]);
  });

  it("registers the page once, titled and gated like the pages it lists", () => {
    const item = navigation.find((entry) => entry.href === "/people/review-queues");
    expect(item?.label).toBe(staffPageTitles.reviewQueues);
    expect(item?.requiredAnyPermissions).toEqual(["VIEW_SENSITIVE_DATA", "MANAGE_REGISTRATION"]);
    expect(item?.sidebarParent).toBe("/people");
    expect(staffSubpageTitle("/people/review-queues")).toBe("Review queues");
    expect(staffSubpageTitle("/people")).toBeNull();
  });
});

describe("Review queues model (#1574)", () => {
  it("shows two groups of three cards, in order, each carrying the event", () => {
    const view = buildReviewQueuesView(manager, "evt_1", allMetrics(manager, 1));
    expect(view.groups.map((group) => group.title)).toEqual(["People and families", "Teams and staff sign-ups"]);
    expect(view.groups.map((group) => group.cards.map((card) => card.title))).toEqual([
      ["Responsible adults", "Find duplicates", "Directory review"],
      ["Teams waiting for a club", "Staff invitations", "Staff approvals"],
    ]);
    const hrefs = view.groups.flatMap((group) => group.cards.map((card) => card.href));
    expect(hrefs).toEqual([
      "/people/responsible-adults?event=evt_1",
      "/people/duplicates?event=evt_1",
      "/people/directory-review?event=evt_1",
      "/people/pending-teams?event=evt_1",
      "/people/staff-invitations?event=evt_1",
      "/people/staff-invitations/approvals?event=evt_1",
    ]);
    expect(hrefs.map((href) => href.split("?")[0])).toEqual([...reviewQueuePaths]);
    expect(hrefs.some((href) => href.includes("/people/matches"))).toBe(false);
    expect(view.stats ?? []).toEqual([]);
    expect(view.action ?? null).toBeNull();
  });

  it("gates each card exactly as its own page does", () => {
    const titles = (viewer: ReviewQueuesViewer) => cards({}, viewer).map((card) => card.title);
    expect(titles(manager)).toHaveLength(6);
    expect(titles(sensitiveOnly)).toEqual(["Responsible adults", "Find duplicates"]);
    expect(titles(manageOnly)).toEqual(["Directory review", "Teams waiting for a club", "Staff invitations", "Staff approvals"]);
    expect(titles(nobody)).toEqual([]);
    expect(hasVisibleReviewQueue(nobody)).toBe(false);
    expect(hasVisibleReviewQueue(sensitiveOnly)).toBe(true);
    expect(hasVisibleReviewQueue(manageOnly)).toBe(true);
  });

  it("leaves out the staff invitation pages on a club event, where they say Not available", () => {
    const club: ReviewQueuesViewer = { ...manager, audience: "CLUB" };
    expect(cards({}, club).map((card) => card.title)).toEqual(["Responsible adults", "Find duplicates", "Directory review", "Teams waiting for a club"]);
    expect(hasVisibleReviewQueue({ permissions: ["MANAGE_REGISTRATION"], audience: "CLUB" })).toBe(true);
    expect(neededReviewQueueMetrics(club)).not.toContain("approvalsWaiting");
  });

  it("never leaves a lone card in a group: a group left with one card joins its neighbour", () => {
    const layout = (viewer: ReviewQueuesViewer) => buildReviewQueuesView(viewer, "evt_1", {}).groups.map((group) => [group.title, group.cards.map((card) => card.title)]);
    // A registration manager on a club event loses the two invitation cards.
    expect(layout({ ...manager, audience: "CLUB" })).toEqual([
      ["People and families", ["Responsible adults", "Find duplicates", "Directory review", "Teams waiting for a club"]],
    ]);
    // Registration management without the sensitive-data permission loses two of the first group's cards.
    expect(layout(manageOnly)).toEqual([["Teams and staff sign-ups", ["Directory review", "Teams waiting for a club", "Staff invitations", "Staff approvals"]]]);
    for (const viewer of [manager, { ...manager, audience: "CLUB" as const }, sensitiveOnly, manageOnly]) {
      const groups = buildReviewQueuesView(viewer, "evt_1", {}).groups;
      if (groups.length > 1) for (const group of groups) expect(group.cards.length).toBeGreaterThan(1);
    }
  });

  it("asks only for the numbers of the cards the viewer sees", () => {
    expect(neededReviewQueueMetrics(nobody)).toEqual([]);
    expect(neededReviewQueueMetrics(sensitiveOnly)).toEqual(["responsibleAdults"]);
    expect([...neededReviewQueueMetrics(manageOnly)].sort()).toEqual(["approvalsWaiting", "directoryEntries", "pendingTeams"]);
    expect([...neededReviewQueueMetrics(manager)].sort()).toEqual(["approvalsWaiting", "directoryEntries", "pendingTeams", "responsibleAdults"]);
    expect(buildReviewQueuesView(nobody, "evt_1", {}).groups).toEqual([]);
  });

  it("shows a failed read as Unavailable, never as zero or nothing waiting", () => {
    const withStatus = cards(allMetrics(manager, null)).filter((card) => card.status);
    expect(withStatus).toHaveLength(4);
    for (const card of withStatus) expect(card.status).toEqual(UNAVAILABLE_STATUS);
    expect(statusOf("Teams waiting for a club", { ...allMetrics(manager, 0), pendingTeams: null })).toEqual(UNAVAILABLE_STATUS);
    expect(statusOf("Directory review", { ...allMetrics(manager, 0), pendingTeams: null })?.text).toBe("Nothing waiting");
  });

  it("treats a number nobody read as unreadable", () => {
    for (const card of cards({}).filter((entry) => entry.status)) expect(card.status).toEqual(UNAVAILABLE_STATUS);
    expect(statusOf("Staff approvals", { pendingTeams: 0 })).toEqual(UNAVAILABLE_STATUS);
  });

  it("says its status in words, and a card with no honest count has no chip", () => {
    expect(statusOf("Responsible adults", { responsibleAdults: 3 })).toEqual({ tone: "review", text: "3 to review" });
    expect(statusOf("Responsible adults", { responsibleAdults: 0 })).toEqual({ tone: "ok", text: "Nothing waiting" });
    expect(statusOf("Directory review", { directoryEntries: 2 })).toEqual({ tone: "review", text: "2 not in the directory" });
    expect(statusOf("Teams waiting for a club", { pendingTeams: 1 })).toEqual({ tone: "review", text: "1 team waiting" });
    expect(statusOf("Teams waiting for a club", { pendingTeams: 4 })).toEqual({ tone: "review", text: "4 teams waiting" });
    expect(statusOf("Staff approvals", { approvalsWaiting: 5 })).toEqual({ tone: "review", text: "5 waiting for approval" });
    expect(statusOf("Staff approvals", { approvalsWaiting: 0 })).toEqual({ tone: "ok", text: "Nothing waiting" });
    expect(statusOf("Find duplicates", allMetrics(manager, 1))).toBeNull();
    expect(statusOf("Staff invitations", allMetrics(manager, 1))).toBeNull();
  });
});
