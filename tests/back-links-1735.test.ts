import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #1735: a page links only to pages the viewer may open. The lodging pages (#1578) carry the Lodging views strip, which offers Inventory only to
// viewers with CONFIGURE_EVENT, and their no-property panel links the Lodging page only to them. The issued item pages link to each other through
// a strip that makes the same check (#1581, tests/issued-assets-views-1581.test.ts).
const mocks = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: async () => ({ event: { id: "evt_1", name: "Synthetic Event" }, permissions: mocks.permissions }) }));
const noProperty = vi.hoisted(() => ({ on: false }));
const lodgingError = vi.hoisted(() => class LodgingError extends Error { code = "NO_PROPERTY"; });
vi.mock("@/modules/lodging/errors", () => ({ LodgingError: lodgingError }));
vi.mock("@/modules/lodging/preferences-service", () => ({ getStaffLodgingRequestsView: async () => { if (noProperty.on) throw new lodgingError(); return { rows: [] }; } }));
vi.mock("@/modules/lodging/assignment-view", () => ({ getAssignmentWorkspace: async () => { if (noProperty.on) throw new lodgingError(); return { rows: [] }; } }));
vi.mock("@/components/lodging-requests-workspace", () => ({ LodgingRequestsWorkspace: () => null }));
vi.mock("@/components/lodging-assignments-workspace", () => ({ LodgingAssignmentsWorkspace: () => null }));

import { LodgingViewsStrip } from "@/components/lodging-views-strip";
import { lodgingViews } from "@/modules/lodging/lodging-views-model";
import LodgingAssignmentsPage from "@/app/(workspace)/more/lodging/assignments/page";
import LodgingRequestsPage from "@/app/(workspace)/more/lodging/requests/page";

const search = { searchParams: Promise.resolve({ event: "evt_1" }) };
const lodgingPages = [
  { name: "lodging requests", render: () => LodgingRequestsPage(search), registrar: "MANAGE_REGISTRATION" },
  { name: "lodging assignments", render: () => LodgingAssignmentsPage(search), registrar: "MANAGE_REGISTRATION" },
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
