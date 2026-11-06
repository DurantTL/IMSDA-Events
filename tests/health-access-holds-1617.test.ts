// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

vi.mock("server-only", () => ({}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/health-access", useSearchParams: () => new URLSearchParams() }));

import { HealthAccessHolds, type HoldRow } from "@/components/health-access-holds";
import { buttonByText, flush, mount, submitForm, typeInto, click, type Mounted } from "./helpers/dom-render";

/** The holds client posts to the existing routes, after a confirmation (#1617). Synthetic values only. */

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
  refresh.mockClear();
});

const active: HoldRow = { id: "hold-1", scope: "PERSON", personId: "person-9", eventId: null, reason: "Synthetic hold reason", placedAt: "2026-11-01T12:00:00.000Z", liftedAt: null, liftReason: null, snapshotsCovered: 2 };

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("the holds client", () => {
  it("places a person hold only after the confirmation, through the holds route", async () => {
    const fetchMock = stubFetch();
    mounted = await mount(createElement(HealthAccessHolds, { holds: [] }));
    await typeInto(mounted.container.querySelector("input")!, "person-7");
    await typeInto(mounted.container.querySelector("textarea")!, "Synthetic reason for the hold");
    await submitForm(mounted.container.querySelector("form")!);
    expect(fetchMock).not.toHaveBeenCalled();
    await click(buttonByText(mounted.container.querySelector<HTMLElement>("[role=dialog]")!, "Place hold"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/staff/health-snapshots/holds");
    expect(JSON.parse(String(init.body))).toEqual({ scope: "PERSON", personId: "person-7", reason: "Synthetic reason for the hold" });
    expect(refresh).toHaveBeenCalled();
  });

  it("lifts an active hold with a typed reason, through the lift route", async () => {
    const fetchMock = stubFetch();
    mounted = await mount(createElement(HealthAccessHolds, { holds: [active] }));
    await click(buttonByText(mounted.container, "Lift hold"));
    await typeInto(mounted.container.querySelector("[role=dialog] textarea")!, "Synthetic reason for lifting");
    await click(buttonByText(mounted.container.querySelector<HTMLElement>("[role=dialog]")!, "Lift hold"));
    await flush();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/staff/health-snapshots/holds/hold-1/lift");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "Synthetic reason for lifting" });
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the route's message at the top when a place fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Hold refused for a synthetic reason." }), { status: 400, headers: { "Content-Type": "application/json" } })));
    mounted = await mount(createElement(HealthAccessHolds, { holds: [] }));
    await typeInto(mounted.container.querySelector("input")!, "person-7");
    await typeInto(mounted.container.querySelector("textarea")!, "Synthetic reason for the hold");
    await submitForm(mounted.container.querySelector("form")!);
    await click(buttonByText(mounted.container.querySelector<HTMLElement>("[role=dialog]")!, "Place hold"));
    await flush();
    expect(mounted.container.textContent).toContain("Hold refused for a synthetic reason.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
