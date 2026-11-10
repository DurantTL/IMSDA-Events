// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/honors",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("server-only", () => ({}));

import { ClubSupplyCatalogWorkspace } from "@/components/club-supply-catalog-workspace";
import { HonorCatalogWorkspace } from "@/components/honor-catalog-workspace";
import { MasterAwardRulesWorkspace } from "@/components/master-award-rules-workspace";
import { pageOwnsHeader } from "@/components/page-header-routes";
import type { HonorRecord } from "@/modules/honors/repository";
import type { ClubSupplyItemRecord } from "@/modules/club-supplies/repository";
import type { MasterAwardRuleRecord } from "@/modules/earned-awards/rules-repository";

/** #1590: the honor, Master Award rule and club supply catalogs: header, list first, focused editor. Synthetic data only. */

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

const honor = (over: Partial<HonorRecord> = {}): HonorRecord => ({
  id: "h1", code: "AR-001", name: "Sample Knots", description: "A long synthetic description that has to wrap on a phone without cutting words off at the edge of the card.",
  isActive: true, catalogNumber: null, category: null, offeringCount: 2, updatedAt: "2026-11-01T00:00:00.000Z", ...over,
});
const supply = (over: Partial<ClubSupplyItemRecord> = {}): ClubSupplyItemRecord => ({
  id: "s1", section: "INSIGNIA", name: "Sample Patch", catalogNumber: "001234", sizeLabel: null, isActive: true, honorId: null, honorCode: null,
  supplier: "ADVENTSOURCE", unitPriceCents: null, ...over,
} as ClubSupplyItemRecord);
const rule = (over: Partial<MasterAwardRuleRecord> = {}): MasterAwardRuleRecord => ({
  id: "r1", name: "Sample Master Award", status: "DRAFT", needsManualCheck: false, reviewNote: "", itemId: null, itemName: null,
  groups: [{ minimum: 1, honors: [{ id: "h1", name: "Sample Knots" }], unmatchedHonorNames: [] }], problems: [], ...over,
});

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const render = (element: ReturnType<typeof createElement>) => act(async () => root.render(element));
const click = (element: Element | null) => act(async () => { (element as HTMLElement).click(); });
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(label) || candidate.getAttribute("aria-label") === label) ?? null;
const filled = () => document.querySelectorAll(".primary-button");

describe("the catalog pages draw their own header (#1590)", () => {
  it("lists each route, so the shell draws no second title", () => {
    for (const route of ["/admin/honors", "/admin/master-award-rules", "/admin/club-supplies"]) expect(pageOwnsHeader(route), route).toBe(true);
  });

  it("titles each page with the words of the tab and hub card that open it", () => {
    expect(read("app/(workspace)/admin/honors/page.tsx")).toContain('title: "Honor catalog"');
    expect(read("app/(workspace)/admin/master-award-rules/page.tsx")).toContain('title: "Master Award rules"');
    expect(read("app/(workspace)/admin/club-supplies/page.tsx")).toContain('title: "Club supply catalog"');
  });

  it("draws no heading of its own in the workspaces, so each page keeps exactly one h1 (the header's)", () => {
    for (const file of ["honor-catalog-workspace", "master-award-rules-workspace", "club-supply-catalog-workspace"]) {
      expect(read(`components/${file}.tsx`), file).not.toMatch(/<h1\b/);
    }
  });

  it("keeps the page files' permission checks and section header as they were", () => {
    expect(read("app/(workspace)/admin/honors/page.tsx")).toContain("hasClubsAdministration(user)");
    expect(read("app/(workspace)/admin/club-supplies/page.tsx")).toContain("hasClubsAdministration(user)");
    expect(read("app/(workspace)/admin/master-award-rules/page.tsx")).toContain('user.globalRole !== "SYSTEM_ADMIN"');
  });
});

describe("honor catalog (#1590)", () => {
  it("shows one filled button (the page header draws the one h1), the list, and no editor until Add honor is pressed", async () => {
    await render(createElement(HonorCatalogWorkspace, { initialHonors: [honor(), honor({ id: "h2", code: "AR-002", name: "Sample Birds", isActive: false, offeringCount: 0 })] }));
    expect(document.querySelectorAll("h1")).toHaveLength(0);
    expect(filled()).toHaveLength(1);
    expect(filled()[0]!.textContent).toContain("Add honor");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector("form")).toBeNull();
    // Definition versus usage, and the earned-history sentence.
    expect(document.body.textContent).toContain("does not change honors members have already earned");
    expect(document.body.textContent).toContain("2 classes");
    expect(document.body.textContent).toContain("Not in any class");
    expect(document.body.textContent).toContain("Inactive");
    // The long description stays in the row, and the row's buttons are in a dense-row group.
    expect(document.body.textContent).toContain("wrap on a phone");
    expect(document.querySelector(".dense-rows .row-actions button")).not.toBeNull();
    expect(document.querySelector('a[href="/more/honors"]')?.textContent).toBe("Honors Weekend classes");
  });

  it("opens the editor from Add honor and from a row's Edit, and Cancel closes a clean editor", async () => {
    await render(createElement(HonorCatalogWorkspace, { initialHonors: [honor()] }));
    await click(button("Add honor"));
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    expect(document.body.textContent).toContain("New honor");
    await click(button("Cancel"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click(button("Edit Sample Knots"));
    expect((document.querySelector('input[name="code"]') as HTMLInputElement).value).toBe("AR-001");
    expect(document.body.textContent).toContain("2 classes teach this honor");
  });

  it("keeps the typed values and shows a duplicate-code error inside the editor when the save fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Another honor already uses that code." }), { status: 409 })));
    await render(createElement(HonorCatalogWorkspace, { initialHonors: [honor()] }));
    await click(button("Add honor"));
    const set = (name: string, value: string) => {
      const input = document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => { set("code", "AR-001"); set("name", "Duplicate Knots"); });
    await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("Another honor already uses that code.");
    expect((dialog.querySelector('input[name="name"]') as HTMLInputElement).value).toBe("Duplicate Knots");
  });

  it("asks before it discards typed work, and Keep editing leaves the editor open", async () => {
    await render(createElement(HonorCatalogWorkspace, { initialHonors: [honor()] }));
    await click(button("Add honor"));
    const input = document.querySelector('input[name="name"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Typed");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Close honor editor"));
    expect(document.body.textContent).toContain("Discard the new honor");
    await click(button("Keep editing"));
    expect(document.querySelector('input[name="name"]')).not.toBeNull();
  });

  it("explains an empty catalog and still offers Add honor and the CSV import", async () => {
    await render(createElement(HonorCatalogWorkspace, { initialHonors: [] }));
    expect(document.body.textContent).toContain("No honors yet");
    expect(filled()).toHaveLength(1);
    expect(document.body.textContent).toContain("Upload CSV");
  });

  it("puts the list before the editor in the source, and no always-open form above it", () => {
    const source = read("components/honor-catalog-workspace.tsx");
    expect(source.indexOf("<table")).toBeLessThan(source.indexOf('role="dialog"'));
    expect(source).toContain("edits.track(");
    expect(source).toContain("edits.gone(");
    expect(source).toContain("useAccessibleDialog");
  });
});

describe("Master Award rules (#1590)", () => {
  const choices = { honors: [{ id: "h1", name: "Sample Knots" }], items: [] };

  it("shows one filled button (the page header draws the one h1), status and availability, and no editor until Review is pressed", async () => {
    await render(createElement(MasterAwardRulesWorkspace, {
      choices,
      initialRules: [rule(), rule({ id: "r2", name: "Active Sample Award", status: "ACTIVE", needsManualCheck: true, reviewNote: "Long synthetic review note that must wrap and stay readable on a phone." })],
    }));
    expect(document.querySelectorAll("h1")).toHaveLength(0);
    expect(filled()).toHaveLength(1);
    expect(filled()[0]!.textContent).toContain("Upload rules file");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain("Not used for club progress");
    expect(document.body.textContent).toContain("Manual check");
    expect(document.body.textContent).toContain("does not change honors members have already earned");
    expect(document.querySelector('a[href="/admin/honors"]')?.textContent).toBe("Honor catalog");
  });

  it("opens the rule editor on Review, and Cancel closes it when nothing changed", async () => {
    await render(createElement(MasterAwardRulesWorkspace, { choices, initialRules: [rule()] }));
    await click(button("Review Sample Master Award"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Save and activate");
    await click(button("Cancel"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows a failed save inside the editor and keeps the dialog open", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "The rule could not be saved." }), { status: 400 })));
    await render(createElement(MasterAwardRulesWorkspace, { choices, initialRules: [rule()] }));
    await click(button("Review Sample Master Award"));
    await click(button("Save changes"));
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe("The rule could not be saved.");
  });

  it("explains an empty rule list", async () => {
    await render(createElement(MasterAwardRulesWorkspace, { choices, initialRules: [] }));
    expect(document.body.textContent).toContain("No rules yet");
  });
});

describe("club supply catalog (#1590)", () => {
  it("shows one filled button (the page header draws the one h1), the list, availability and supplier, and no editor until Supplier and price is pressed", async () => {
    await render(createElement(ClubSupplyCatalogWorkspace, {
      initialItems: [supply(), supply({ id: "s2", name: "Sample Conference Pin", isActive: false, supplier: "CONFERENCE", unitPriceCents: 125 })],
    }));
    expect(document.querySelectorAll("h1")).toHaveLength(0);
    expect(filled()).toHaveLength(1);
    expect(filled()[0]!.textContent).toContain("Upload CSV");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain("Inactive");
    expect(document.body.textContent).toContain("Conference-supplied");
    expect(document.body.textContent).toContain("does not change the quantities or prices on orders already placed");
    expect(document.querySelector('a[href="/admin/club-supplies/conference-orders"]')?.textContent).toBe("Conference club orders");
    expect(document.querySelector('a[href="/more/merchandise"]')?.textContent).toBe("Merchandise catalog");
  });

  it("opens the supplier editor from the row, with Save and Cancel, and shows a failed save in it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "The supplier could not be saved." }), { status: 500 })));
    await render(createElement(ClubSupplyCatalogWorkspace, { initialItems: [supply()] }));
    await click(button("Supplier and price: Sample Patch"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(button("Save supplier")).not.toBeNull();
    await click(button("Save supplier"));
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe("The supplier could not be saved.");
    await click(button("Cancel"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("explains an empty catalog", async () => {
    await render(createElement(ClubSupplyCatalogWorkspace, { initialItems: [] }));
    expect(document.body.textContent).toContain("No items yet");
  });

  it("keeps the supplier, price and stock behavior on the same routes", () => {
    const source = read("components/club-supply-catalog-workspace.tsx");
    expect(source).toContain("/api/admin/club-supplies/${encodeURIComponent(item.id)}/ordering");
    expect(source).toContain("/api/admin/club-supplies/import");
    expect(source).toContain('href="/admin/club-supplies/conference-orders"');
  });
});

describe("styles (#1590)", () => {
  it("keeps the new module on tokens with 44px links and no raw colors, sizes or radii", () => {
    const css = read("components/catalog-workspace.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/font-size:\s*\d/);
    expect(css).not.toMatch(/border-radius:\s*\d/);
    expect(css).toContain(".links a { display: inline-flex; align-items: center; min-height: 44px; }");
  });
});
