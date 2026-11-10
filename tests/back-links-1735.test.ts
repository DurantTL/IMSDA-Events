import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #1735: "Back to lodging" shows only to a viewer who may open the target page, which checks CONFIGURE_EVENT. The issued item pages link to each other through a strip that makes the same check (#1581, tests/issued-assets-views-1581.test.ts).
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

import { BackLink } from "@/components/back-link";
import LodgingAssignmentsPage from "@/app/(workspace)/more/lodging/assignments/page";
import LodgingRequestsPage from "@/app/(workspace)/more/lodging/requests/page";

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
];

beforeEach(() => { mocks.permissions = []; noProperty.on = false; });

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
  for (const page of pages.slice(0, 2)) {
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
