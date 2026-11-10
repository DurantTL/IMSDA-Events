import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canOpenIssueDesk, issueDeskHref, issuedAssetsViews } from "@/components/issued-assets-views-model";

// #1581: the issued item pages strip and the issue and return desk link. Synthetic data only.
const mocks = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: async () => ({ event: { id: "evt_1", name: "Synthetic Event" }, permissions: mocks.permissions }) }));
vi.mock("@/modules/issued-assets/closeout", () => ({ getCloseoutReport: async () => ({}) }));
vi.mock("@/modules/issued-assets/view", () => ({ getAssigneeOptions: async () => ({ staff: [] }), getCatalogView: async () => ({ types: [], assets: [], truncated: false }) }));
vi.mock("@/components/asset-closeout-workspace", () => ({ AssetCloseoutWorkspace: () => null }));
vi.mock("@/components/issued-assets-workspace", () => ({ IssuedAssetsWorkspace: () => null }));

import IssuedAssetsPage from "@/app/(workspace)/more/issued-assets/page";
import IssuedAssetsCloseoutPage from "@/app/(workspace)/more/issued-assets/closeout/page";
import { AccessRestricted } from "@/components/access-restricted";
import { BackLink } from "@/components/back-link";
import { IssuedAssetsViewsStrip } from "@/components/issued-assets-views-strip";

const keys = (permissions: string[]) => issuedAssetsViews("evt_1", permissions).map((view) => view.key);

describe("which issued item views each role gets (#1581)", () => {
  it("shows Inventory only to someone who can configure the event, and Closeout to the four roles the page admits", () => {
    expect(keys(["CONFIGURE_EVENT"])).toEqual(["inventory", "closeout"]);
    for (const permission of ["MANAGE_CHECK_IN", "MANAGE_FINANCE", "VIEW_REPORTS"]) expect(keys([permission]), permission).toEqual(["closeout"]);
    expect(keys(["MANAGE_REGISTRATION", "MANAGE_ATTENDEES"])).toEqual([]);
    expect(keys([])).toEqual([]);
  });

  it("keeps ?event on every link and marks the current view", () => {
    const views = issuedAssetsViews("evt 1", ["CONFIGURE_EVENT"], "closeout");
    expect(views.map((view) => view.href)).toEqual(["/more/issued-assets?event=evt%201", "/more/issued-assets/closeout?event=evt%201"]);
    expect(views.map((view) => view.current ?? false)).toEqual([false, true]);
  });

  it("never lists the issue and return desk as a view: it lives under the Check-in tab", () => {
    expect(issuedAssetsViews("evt_1", ["CONFIGURE_EVENT", "MANAGE_CHECK_IN"]).some((view) => view.href.startsWith("/check-in"))).toBe(false);
  });

  it("opens the desk link only for MANAGE_CHECK_IN, the desk's own check", () => {
    expect(canOpenIssueDesk(["MANAGE_CHECK_IN"])).toBe(true);
    expect(canOpenIssueDesk(["CONFIGURE_EVENT", "MANAGE_FINANCE", "VIEW_REPORTS"])).toBe(false);
    expect(issueDeskHref("evt 1")).toBe("/check-in/assets?event=evt%201");
  });
});

function find(node: ReactNode, match: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => find(child, match));
  const element = node as ReactElement<Record<string, unknown>>;
  return [...(match(element) ? [element] : []), ...find(element.props?.children as ReactNode, match), ...find(element.props?.strip as ReactNode, match)];
}

const search = { searchParams: Promise.resolve({ event: "evt_1" }) };
beforeEach(() => { mocks.permissions = []; });

describe("the issued item pages (#1581)", () => {
  it("replaced the closeout's back link with the strip, and gives nobody a link to a closed page", async () => {
    mocks.permissions = ["MANAGE_CHECK_IN", "CONFIGURE_EVENT"];
    const page = await IssuedAssetsCloseoutPage(search);
    expect(find(page, (element) => element.type === BackLink)).toEqual([]);
    const strips = find(page, (element) => element.type === IssuedAssetsViewsStrip);
    expect(strips).toHaveLength(1);
    expect(strips[0]!.props).toMatchObject({ current: "closeout", eventId: "evt_1", permissions: ["MANAGE_CHECK_IN", "CONFIGURE_EVENT"] });
  });

  it("closeout: the desk flag follows MANAGE_CHECK_IN, and a viewer with no closeout permission gets the restricted state", async () => {
    mocks.permissions = ["VIEW_REPORTS"];
    const reportViewer = await IssuedAssetsCloseoutPage(search);
    expect(find(reportViewer, (element) => "canOpenDesk" in element.props)[0]!.props.canOpenDesk).toBe(false);
    mocks.permissions = ["MANAGE_CHECK_IN"];
    expect(find(await IssuedAssetsCloseoutPage(search), (element) => "canOpenDesk" in element.props)[0]!.props.canOpenDesk).toBe(true);
    mocks.permissions = ["MANAGE_REGISTRATION"];
    const restricted = await IssuedAssetsCloseoutPage(search);
    expect(find(restricted, (element) => element.type === AccessRestricted)).toHaveLength(1);
    expect(find(restricted, (element) => element.type === IssuedAssetsViewsStrip)).toEqual([]);
  });

  it("inventory: administrators get the page with the strip, and the desk flag follows MANAGE_CHECK_IN; others get the restricted state", async () => {
    mocks.permissions = ["CONFIGURE_EVENT"];
    const noDesk = await IssuedAssetsPage(search);
    expect(find(noDesk, (element) => "canOpenDesk" in element.props)[0]!.props.canOpenDesk).toBe(false);
    expect(find(noDesk, (element) => element.type === IssuedAssetsViewsStrip)[0]!.props).toMatchObject({ current: "inventory", eventId: "evt_1" });
    mocks.permissions = ["CONFIGURE_EVENT", "MANAGE_CHECK_IN"];
    expect(find(await IssuedAssetsPage(search), (element) => "canOpenDesk" in element.props)[0]!.props.canOpenDesk).toBe(true);
    mocks.permissions = ["MANAGE_CHECK_IN", "VIEW_REPORTS"];
    const restricted = await IssuedAssetsPage(search);
    expect(find(restricted, (element) => element.type === AccessRestricted)).toHaveLength(1);
    expect(find(restricted, (element) => "canOpenDesk" in element.props)).toEqual([]);
  });
});
