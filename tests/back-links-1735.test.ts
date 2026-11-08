import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #1735: "Back to lodging" and "Back to issued assets" show only to a viewer who may open the target page, which checks CONFIGURE_EVENT.
const mocks = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: async () => ({ event: { id: "evt_1", name: "Synthetic Event" }, permissions: mocks.permissions }) }));
vi.mock("@/modules/lodging/preferences-service", () => ({ getStaffLodgingRequestsView: async () => ({ rows: [] }) }));
vi.mock("@/modules/lodging/assignment-view", () => ({ getAssignmentWorkspace: async () => ({ rows: [] }) }));
vi.mock("@/modules/issued-assets/closeout", () => ({ getCloseoutReport: async () => ({}) }));
vi.mock("@/modules/issued-assets/view", () => ({ getAssigneeOptions: async () => ({ staff: [] }) }));
vi.mock("@/components/lodging-requests-workspace", () => ({ LodgingRequestsWorkspace: () => null }));
vi.mock("@/components/lodging-assignments-workspace", () => ({ LodgingAssignmentsWorkspace: () => null }));
vi.mock("@/components/asset-closeout-workspace", () => ({ AssetCloseoutWorkspace: () => null }));

import { BackLink } from "@/components/back-link";
import LodgingAssignmentsPage from "@/app/(workspace)/more/lodging/assignments/page";
import LodgingRequestsPage from "@/app/(workspace)/more/lodging/requests/page";
import IssuedAssetsCloseoutPage from "@/app/(workspace)/more/issued-assets/closeout/page";

function backLinks(node: ReactNode): ReactElement[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(backLinks);
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [...(element.type === BackLink ? [element] : []), ...backLinks(element.props?.children)];
}

const search = { searchParams: Promise.resolve({ event: "evt_1" }) };
const pages = [
  { name: "lodging requests", render: () => LodgingRequestsPage(search), registrar: "MANAGE_REGISTRATION", href: "/more/lodging?event=evt_1" },
  { name: "lodging assignments", render: () => LodgingAssignmentsPage(search), registrar: "MANAGE_REGISTRATION", href: "/more/lodging?event=evt_1" },
  { name: "issued asset closeout", render: () => IssuedAssetsCloseoutPage(search), registrar: "MANAGE_CHECK_IN", href: "/more/issued-assets?event=evt_1" },
];

beforeEach(() => { mocks.permissions = []; });

describe("back links only to pages the viewer may open (#1735)", () => {
  for (const page of pages) {
    it(`${page.name}: no link for staff without CONFIGURE_EVENT`, async () => {
      mocks.permissions = [page.registrar];
      expect(backLinks(await page.render())).toEqual([]);
    });
    it(`${page.name}: a link for an event administrator`, async () => {
      mocks.permissions = [page.registrar, "CONFIGURE_EVENT"];
      const links = backLinks(await page.render());
      const props = links[0].props as { href: string };
      expect(links).toHaveLength(1);
      expect(props.href).toBe(page.href);
    });
  }
});
