// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("@/components/use-accessible-dialog", () => ({ useAccessibleDialog: () => ({ current: null }) }));

import { CalendarAdminWorkspace } from "@/components/calendar-admin-workspace";
import { StaffInvitationList } from "@/components/staff-invitation-list";
import type { CalendarAdminEntry } from "@/modules/calendar/repository";
import type { InvitationListRow } from "@/modules/staff-invitations/repository";
import { buttonByText, flush, mount, type Mounted } from "./helpers/dom-render";

/**
 * "Select all N matching" covers every matching row across all pages (#1492): the server resolves the ids from the same
 * filters, and the per-row ticks stay on the page that is shown. Synthetic data only.
 */
let mounted: Mounted;
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(async () => { await mounted?.unmount(); vi.unstubAllGlobals(); });

const invite = (index: number): InvitationListRow => ({
  id: `inv-${index}`, email: `person${index}@example.test`, firstName: "Pat", lastName: `Example${index}`, group: "STAFF", status: "SENT",
  sentAt: "2026-10-01T00:00:00.000Z", sendCount: 1, registeredAt: null, confirmationCode: null, usable: true, reissuable: true, reinvitable: false, deliveryNote: null,
});
const counts = { NOT_SENT: 0, SENT: 120, DELIVERY_FAILED: 0, REGISTERED: 0, APPROVED: 0, DECLINED: 0, REVOKED: 0 };

describe("staff invitations: Select all N matching", () => {
  const list = (total: number) => createElement(StaffInvitationList, {
    eventId: "event-1", rows: [invite(1), invite(2)], counts, canSend: true, total, totalAll: total, page: 1, pageSize: 2,
    query: { filters: { status: "SENT", group: "ALL", search: "pat" }, sort: { key: "person", dir: "desc" }, page: 2 },
  });

  it("asks the server for the ids of the same filters (no sort, no page, no event) and selects them all", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ids: Array.from({ length: 120 }, (_, index) => `inv-${index}`), total: 120, limit: 2000 })));
    mounted = await mount(list(120));
    await act(async () => { buttonByText(mounted.container, "Select all 120 matching").click(); });
    await flush();
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toBe("/api/events/event-1/staff-invitations/matching-ids?status=SENT&q=pat");
    expect(mounted.container.textContent).toContain("120 selected · 2 on this page");
    // The ticks on the page that is shown are checked, and nothing else changed.
    const boxes = [...mounted.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => box.checked)).toBe(true);
  });

  it("repeated select-alls never take the selection past 2,000, and the bar says so", async () => {
    const batch = (start: number, length: number) => new Response(JSON.stringify({ ids: Array.from({ length }, (_, index) => `inv-${start + index}`), total: 1900, limit: 2000 }));
    fetchMock.mockResolvedValueOnce(batch(0, 1000)).mockResolvedValueOnce(batch(1000, 1900));
    mounted = await mount(list(1900));
    await act(async () => { buttonByText(mounted.container, "Select all 1900 matching").click(); });
    await flush();
    expect(mounted.container.textContent).toContain("1000 selected");
    await act(async () => { buttonByText(mounted.container, "Select all 1900 matching").click(); });
    await flush();
    expect(mounted.container.textContent).toContain("2000 selected");
    expect(mounted.container.textContent).toContain("Only 2,000 people can be selected at a time");
  });

  it("past the most one Send takes, says so instead of offering the button", async () => {
    mounted = await mount(list(2500));
    expect(mounted.container.textContent).toContain("Narrow the list to 2,000 or fewer to select them all.");
    expect(() => buttonByText(mounted.container, "Select all 2500 matching")).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("calendar entries: Select all N matching", () => {
  const entry = (index: number): CalendarAdminEntry => ({
    id: `e-${index}`, title: `Synthetic gathering ${index}`, description: "", startsOn: "2026-11-10", endsOn: "2026-11-10", timeLabel: "", location: "", category: "",
    linkUrl: null, status: "SCHEDULED", entryType: "STANDARD", repeat: null, repeatExceptions: [], isPublished: true, sourceFeedId: null, sourceFeedName: null,
    isHiddenLocally: false, sourceRemovedAt: null, locallyEditedFields: [], updatedAt: "2026-10-01T00:00:00.000Z", linkedIneligible: false, canLinkToEvent: true,
    linkedEvent: null, datesDifferFromEvent: false, possibleMatch: null,
  } as unknown as CalendarAdminEntry);
  const workspace = (total: number) => createElement(CalendarAdminWorkspace, {
    initialEntries: [entry(1), entry(2)], initialEvents: [],
    initialEntryList: { total, page: 1, pageSize: 50, totalAll: total, categories: [] },
  });

  it("selects every matching id from the server, across pages, and shows the count", async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).includes("matching-ids")
      ? new Response(JSON.stringify({ ids: Array.from({ length: 120 }, (_, index) => `e-${index}`), total: 120, limit: 500 }))
      : new Response(JSON.stringify({}), { status: 404 })));
    mounted = await mount(workspace(120));
    const label = [...mounted.container.querySelectorAll("label")].find((node) => node.textContent?.includes("Select all 120 matching"))!;
    const box = label.querySelector<HTMLInputElement>("input")!;
    expect(box.disabled).toBe(false);
    await act(async () => { box.click(); });
    await flush();
    expect(fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("matching-ids"))).toEqual(["/api/admin/calendar/entries/matching-ids"]);
    expect(mounted.container.textContent).toContain("120 selected");
  });

  it("is off past the bulk limit and says how far to narrow", async () => {
    mounted = await mount(workspace(501));
    const label = [...mounted.container.querySelectorAll("label")].find((node) => node.textContent?.includes("Select all 501 matching"))!;
    expect(label.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
    expect(mounted.container.textContent).toContain("Narrow the list to 500 or fewer to change them together.");
  });

  it("shows the true total and the shared pager, with no cap sentence", async () => {
    mounted = await mount(workspace(1500));
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("1500 entries match.");
    expect(text).toContain("Showing 1–2 of 1500 entries");
    expect(text).not.toMatch(/not loaded|newest start dates/);
  });
});
