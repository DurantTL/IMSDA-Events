import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #1735: "Back to issued assets" shows only to a viewer who may open the target page, which checks CONFIGURE_EVENT. The lodging pages
// (#1578) carry the Lodging views strip instead of a back link, which offers Inventory only to the same viewers.
const mocks = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: async () => ({ event: { id: "evt_1", name: "Synthetic Event" }, permissions: mocks.permissions }) }));
const noProperty = vi.hoisted(() => ({ on: false }));
const lodgingError = vi.hoisted(() => class LodgingError extends Error { code = "NO_PROPERTY"; });
vi.mock("@/modules/lodging/errors", () => ({ LodgingError: lodgingError }));
vi.mock("@/modules/lodging/preferences-service", () => ({ getStaffLodgingRequestsView: async () => { if (noProperty.on) throw new lodgingError(); return { rows: [] }; } }));
vi.mock("@/modules/lodging/assignment-view", () => ({ getAssignmentWorkspace: async () => { if (noProperty.on) throw new lodgingError(); return { rows: [] }; } }));
vi.mock("@/modules/issued-assets/closeout", () => ({ getCloseoutReport: async () => ({}) }));
vi.mock("@/modules/issued-assets/view", () => ({ getAssigneeOptions: async () => ({ staff: [] }) }));
vi.mock("@/components/lodging-requests-workspace", () => ({ LodgingRequestsWorkspace: () => null }));
vi.mock("@/components/lodging-assignments-workspace", () => ({ LodgingAssignmentsWorkspace: () => null }));
vi.mock("@/components/asset-closeout-workspace", () => ({ AssetCloseoutWorkspace: () => null }));

import { BackLink } from "@/components/back-link";
import { LodgingViewsStrip } from "@/components/lodging-views-strip";
import { lodgingViews } from "@/modules/lodging/lodging-views-model";
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
const lodgingPages = [
  { name: "lodging requests", render: () => LodgingRequestsPage(search), registrar: "MANAGE_REGISTRATION" },
  { name: "lodging assignments", render: () => LodgingAssignmentsPage(search), registrar: "MANAGE_REGISTRATION" },
];
const pages = [
  { name: "issued asset closeout", render: () => IssuedAssetsCloseoutPage(search), registrar: "MANAGE_CHECK_IN", href: "/more/issued-assets?event=evt_1" },
];

beforeEach(() => { mocks.permissions = []; noProperty.on = false; });

function strips(node: ReactNode): ReactElement<{ eventId: string; access: { inventory: boolean; registrations: boolean } }>[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(strips);
  const element = node as ReactElement<{ children?: ReactNode; eventId: string; access: { inventory: boolean; registrations: boolean } }>;
  return [...(element.type === LodgingViewsStrip ? [element] : []), ...strips(element.props?.children)];
}

function linkHrefs(node: ReactNode): string[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(linkHrefs);
  const element = node as ReactElement<{ children?: ReactNode; href?: string }>;
  return [...(typeof element.props?.href === "string" ? [element.props.href] : []), ...linkHrefs(element.props?.children)];
}
function text(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text((node as ReactElement<{ children?: ReactNode }>).props?.children);
}

describe("no-property panel links the Lodging page only to event administrators (#1735)", () => {
  for (const page of lodgingPages) {
    it(`${page.name}: registrar sees plain text, event admin sees the link`, async () => {
      noProperty.on = true;
      mocks.permissions = ["MANAGE_REGISTRATION"];
      const registrar = await page.render();
      expect(linkHrefs(registrar)).toEqual([]);
      expect(text(registrar)).toContain("Ask your event administrator to choose one first.");
      mocks.permissions = ["MANAGE_REGISTRATION", "CONFIGURE_EVENT"];
      expect(linkHrefs(await page.render())).toEqual(["/more/lodging?event=evt_1"]);
    });
  }
});

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

describe("the Lodging views strip offers Inventory only to those who may open it (#1578, #1735)", () => {
  for (const page of lodgingPages) {
    it(`${page.name}: no Inventory link for staff without CONFIGURE_EVENT, one for an event administrator`, async () => {
      mocks.permissions = [page.registrar];
      const [registrarStrip] = strips(await page.render());
      expect(lodgingViews(registrarStrip.props.eventId, registrarStrip.props.access).map((view) => view.label)).toEqual(["Requests", "Assignments"]);
      mocks.permissions = [page.registrar, "CONFIGURE_EVENT"];
      const [adminStrip] = strips(await page.render());
      expect(lodgingViews(adminStrip.props.eventId, adminStrip.props.access).map((view) => view.href)).toContain("/more/lodging?event=evt_1");
    });
  }
});
