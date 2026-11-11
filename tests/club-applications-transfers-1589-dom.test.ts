// @vitest-environment jsdom
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1589 part B, in a real DOM: the Decision section's two-step flow and the transfer queue's Show filter, empty states and
 * completed notice. The server-rendered parts are in club-applications-transfers-1589.test.ts. Synthetic data only.
 */

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: vi.fn() }) }));

import { ClubTransferQueue } from "@/components/club-transfer-queue";
import { StaffApplicationDecision } from "@/components/staff-application-decision";
import { staffQueueEmptyText, staffQueueFilters } from "@/modules/club-transfers/domain";
import type { NewClubApplicationRecord } from "@/modules/club-applications/repository";
import type { StaffTransferRecord } from "@/modules/club-transfers/repository";
import { buttonByText, choose, click, flush, mount, type Mounted } from "./helpers/dom-render";

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-1", clubName: "Sample Valley Pathfinders", clubType: "PATHFINDER", status: "PENDING", source: "PUBLIC",
    church: { id: "church-1", name: "Sample Valley Church", type: "CHURCH", isOther: false, unavailable: false, needsChoice: false },
    director: { name: "Dana Sample", email: "dana@example.test", address: "1 Example Road", homePhone: "(515) 555-0100", workPhone: null },
    ...overrides,
  } as unknown as NewClubApplicationRecord;
}

const churches = [{ id: "church-2", name: "Other Church", type: "CHURCH" }];
const iso = "2026-10-05T15:00:00.000Z";
const transfer = (overrides: Record<string, unknown> = {}) => ({
  id: "t1", requestedName: "Sam Testperson", matchedMemberName: null, fromOrganizationId: "a", fromOrganizationName: "Club A",
  toOrganizationId: "b", toOrganizationName: "Club B", reason: "r", status: "PENDING", staffReason: null, resolution: null,
  staffNote: "", initiatedAt: iso, acknowledgeDueAt: iso, declinedAt: null, resolvedAt: null, overdue: false, canFinish: true,
  canOverride: true, canCancel: true, needsMemberChoice: false, pendingRegistrationMoves: 0, events: [], ...overrides,
}) as unknown as StaffTransferRecord;

let mounted: Mounted | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T15:00:00Z"));
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the Decision section", () => {

  const needsChoice = () => application({ church: { id: null, name: "Typed Church", type: null, isOther: true, unavailable: false, needsChoice: true } });

  it("makes staff choose a sponsoring church when the applicant's is wrong or missing, and keeps confirm off until they do", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "app-1", status: "APPROVED" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(StaffApplicationDecision, { application: needsChoice(), churches }));
    await click(buttonByText(mounted!.container, "Approve"));
    const select = mounted!.container.querySelector<HTMLSelectElement>("select")!;
    expect(select.required).toBe(true);
    expect(mounted!.container.textContent).toContain("isn't an active church or company in the directory");
    expect(buttonByText(mounted!.container, "Approve and send invite").disabled).toBe(true);
    await choose(select, "church-2");
    expect(buttonByText(mounted!.container, "Approve and send invite").disabled).toBe(false);
    await click(buttonByText(mounted!.container, "Approve and send invite"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/club-applications/app-1/decision");
    expect(JSON.parse(String(init.body))).toEqual({ decision: "approve", sponsoringChurchId: "church-2" });
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("approves a clean application in two steps without a church choice, and keeps a status message after the refresh", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "app-1", status: "APPROVED" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(StaffApplicationDecision, { application: application(), churches }));
    await click(buttonByText(mounted!.container, "Approve"));
    expect(mounted!.container.querySelector("select")).toBeNull();
    await click(buttonByText(mounted!.container, "Approve and send invite"));
    await flush();
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ decision: "approve" });
    const status = mounted!.container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Approved.");
    // Focus moves to the Decision heading instead of falling to the page.
    expect(document.activeElement?.id).toBe("application-decision-heading");
    // The page refreshes and the application is now decided: the result stays.
    await mounted!.root.render(createElement(StaffApplicationDecision, { application: application({ status: "APPROVED" }), churches }));
    await flush();
    expect(mounted!.container.querySelector('[role="status"]')?.textContent).toContain("Approved.");
    expect(mounted!.container.textContent).not.toContain("Decline");
  });

  it("declines with a reason through the same route and shows an error when the route refuses", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "That application was already decided." }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(StaffApplicationDecision, { application: application(), churches }));
    await click(buttonByText(mounted!.container, "Decline"));
    const reason = mounted!.container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(reason, "Already has a club.");
    reason.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    await click(buttonByText(mounted!.container, "Decline application"));
    await flush();
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ decision: "decline", declineReason: "Already has a club." });
    expect(mounted!.container.querySelector('[role="alert"]')?.textContent).toBe("That application was already decided.");
  });

  it("shows no Decision section for an application that was already decided, only the empty live region", () => {
    expect(renderToStaticMarkup(createElement(StaffApplicationDecision, { application: application({ status: "APPROVED" }), churches }))).not.toContain("Decision");
  });
});


describe("transfer queue in a DOM", () => {
  it("puts a changed Show filter in the address (push, so Back undoes it) and reads the queue for the view it is given", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ transfers: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(ClubTransferQueue, { filter: "declined" }));
    await flush(10);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/club-transfers?filter=declined", { cache: "no-store" });
    const select = mounted!.container.querySelector<HTMLSelectElement>("select")!;
    expect(select.value).toBe("declined");
    await choose(select, "overdue");
    expect(nav.push).toHaveBeenCalledWith("/admin/clubs/transfers?view=overdue", { scroll: false });
    await choose(select, "open");
    expect(nav.push).toHaveBeenLastCalledWith("/admin/clubs/transfers", { scroll: false });
  });


  it("keeps the last cards on screen, marked busy, while a new view loads, and clears the completed notice on a view change", async () => {
    let release: (() => void) | undefined;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ registrationMovesQueued: 0 }), { status: 200 });
      if (String(url).includes("filter=overdue")) await new Promise<void>((resolve) => { release = resolve; });
      return new Response(JSON.stringify({ transfers: [transfer({ id: "t1", overdue: true })] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(ClubTransferQueue, { filter: "open" }));
    await flush(10);
    await click(buttonByText(mounted!.container, "Finish"));
    await flush();
    await click([...document.body.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Finish transfer")!);
    await flush(10);
    expect(mounted!.container.textContent).toContain("Transfer completed.");
    // The address changes (the page passes the new view in): the old cards stay, busy, and the notice goes.
    await choose(mounted!.container.querySelector("select")!, "overdue");
    await act(async () => { mounted!.root.render(createElement(ClubTransferQueue, { filter: "overdue" })); });
    await flush(10);
    expect(mounted!.container.querySelector("#transfer-t1")).not.toBeNull();
    expect(mounted!.container.querySelector("ul.transfer-list")?.getAttribute("aria-busy")).toBe("true");
    expect(mounted!.container.textContent).not.toContain("Transfer completed.");
    expect(release).toBeDefined();
    release?.();
    await flush(50);
    expect(mounted!.container.querySelector("ul.transfer-list")?.getAttribute("aria-busy")).toBe("false");
  });

  it("offers a next step from an empty view, and none on open", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ transfers: [] }), { status: 200 })));
    mounted = await mount(createElement(ClubTransferQueue, { filter: "declined" }));
    await flush(10);
    expect(mounted!.container.querySelector('a[href="/admin/clubs/transfers"]')?.textContent).toBe("Show all open transfers");
    await mounted!.unmount();
    mounted = await mount(createElement(ClubTransferQueue, { filter: "open" }));
    await flush(10);
    expect(mounted!.container.textContent).toContain("No open transfers.");
    expect(mounted!.container.querySelector("a")).toBeNull();
  });

  it("says what is empty for each view, apart from loading and a failed read", async () => {
    expect(new Set(Object.values(staffQueueEmptyText)).size).toBe(staffQueueFilters.length);
    expect(staffQueueEmptyText.overdue).toBe("No overdue transfers.");
    expect(renderToStaticMarkup(createElement(ClubTransferQueue, { filter: "unmatched" }))).toContain("Loading…");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ transfers: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(ClubTransferQueue, { filter: "overdue" }));
    await flush(10);
    expect(mounted!.container.textContent).toContain("No overdue transfers.");
    expect(mounted!.container.textContent).not.toContain("Nothing here.");
    await mounted!.unmount();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Not allowed." }), { status: 403 })));
    mounted = await mount(createElement(ClubTransferQueue, { filter: "overdue" }));
    await flush(10);
    expect(mounted!.container.querySelector('[role="alert"]')?.textContent).toBe("Not allowed.");
  });


  it("says Transfer completed, with the queued registration moves, after a transferred member's Finish", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ registrationMovesQueued: 2 }), { status: 200 });
      return new Response(JSON.stringify({ transfers: [transfer({ id: "t1", overdue: true })] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    mounted = await mount(createElement(ClubTransferQueue, { filter: "overdue" }));
    await flush(10);
    expect(mounted!.container.querySelector("#transfer-t1")).not.toBeNull();
    await click(buttonByText(mounted!.container, "Finish"));
    await flush();
    await click([...document.body.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Finish transfer")!);
    await flush(10);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/club-transfers/t1/finish", expect.objectContaining({ method: "POST" }));
    const notice = mounted!.container.querySelector('[role="status"]');
    expect(notice?.textContent).toBe("Transfer completed. 2 registration moves now wait for approval below.");
  });
});
