// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubImportWorkspace, type ClubImportPreview } from "@/components/club-import-workspace";
import { HealthImportWorkspace } from "@/components/health-import-workspace";
import { ImportSteps } from "@/components/import-steps";
import { areaTabSpecs, staffPlaceFor } from "@/components/staff-areas";
import { parseClubRegistrationExport } from "@/modules/club-imports/domain";
import type { AnnotatedImportDraft } from "@/modules/club-imports/repository";
import { syntheticExportEntry } from "./support/club-import-fixture";

/**
 * Club import and restricted health import as steps under the Club directory (#1589, part C).
 * Synthetic data only; no health value appears anywhere here.
 */

const mocks = vi.hoisted(() => ({
  healthOn: { current: true },
  user: { current: { id: "u1" } as { id: string } | null },
  clubsAdmin: { current: true },
  acknowledged: { current: true },
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/modules/health-records/flag", () => ({ healthRecordsEnabled: () => mocks.healthOn.current }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: async () => ({ user: mocks.user.current }) }));
vi.mock("@/modules/access/admin-roles", () => ({ hasClubsAdministration: async () => mocks.clubsAdmin.current }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/health-records/acknowledgment", () => ({ hasAcknowledgedHealthPrivacy: async () => mocks.acknowledged.current }));
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => null }));
vi.mock("@/components/health-privacy-acknowledgment", () => ({ HealthPrivacyAcknowledgment: () => createElement("p", null, "PRIVACY-NOTICE") }));
vi.mock("@/components/health-import-workspace", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/health-import-workspace")>();
  return { HealthImportWorkspace: original.HealthImportWorkspace };
});

import HealthImportPage from "@/app/(workspace)/admin/clubs/health-import/page";

const now = new Date("2026-09-28T15:00:00Z");

function preview(): ClubImportPreview {
  const [draft] = parseClubRegistrationExport([syntheticExportEntry({}, {})], now).drafts;
  const annotated: AnnotatedImportDraft = { ...draft, churchId: null, newChurchName: draft.churchName, churchSuggestion: null, ambiguousClubs: [], possibleMatches: [], importedYears: {}, existingClub: null };
  return { drafts: [annotated], churches: [], clubYearChoices: ["2025-26", "2026-27", "2027-28"], skipped: 0 };
}

const steps = (html: string) => [...html.matchAll(/<li[^>]*>/g)].map((match) => match[0]);
const currentStep = (root: ParentNode) => root.querySelector('[aria-label="Import steps"] [aria-current="step"]')?.textContent ?? "";

describe("the import step list", () => {
  it.each([
    ["Preview", ["(current step)", "(next)", "(next)"]],
    ["Review", ["(done)", "(current step)", "(next)"]],
    ["Results", ["(done)", "(done)", "(current step)"]],
  ] as const)("marks %s as the current step and says done and next in words", (current, states) => {
    const html = renderToStaticMarkup(createElement(ImportSteps, { current }));
    expect(html).toContain('aria-label="Import steps"');
    expect(html.match(/<ol/g)).toHaveLength(1);
    expect(steps(html).filter((tag) => tag.includes('aria-current="step"'))).toHaveLength(1);
    const text = [...html.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    expect(text.map((item) => item.replace(/^\d /, "").split(" ")[0])).toEqual(["Preview", "Review", "Results"]);
    states.forEach((state, index) => expect(text[index]).toContain(state));
  });

  it("starts both workspaces on Preview, and the club import on Review when it opens with a preview", () => {
    expect(currentStep(withHtml(renderToStaticMarkup(createElement(ClubImportWorkspace))))).toContain("Preview");
    expect(currentStep(withHtml(renderToStaticMarkup(createElement(HealthImportWorkspace))))).toContain("Preview");
    expect(currentStep(withHtml(renderToStaticMarkup(createElement(ClubImportWorkspace, { initialPreview: preview() }))))).toContain("Review");
  });
});

function withHtml(html: string) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

describe("a failed import stays on the step it failed at, with the server's own message", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const choose = async (input: HTMLInputElement, file: File) => {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
  };
  const click = async (label: RegExp) => {
    const button = [...host.querySelectorAll("button")].find((item) => label.test(item.textContent ?? ""))!;
    await act(async () => { button.click(); });
    await settle();
  };

  it("club import: a failed preview stays on Preview with the message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(400, { message: "Synthetic: that file is not a club export." })));
    await act(async () => root.render(createElement(ClubImportWorkspace)));
    const file = Object.assign(new File(["{}"], "clubs.json"), { text: async () => "{}" });
    await choose(host.querySelector('input[type="file"]')!, file);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Synthetic: that file is not a club export.");
    expect(currentStep(host)).toContain("Preview");
    expect(host.textContent).not.toContain("Import results");
  });

  it("club import: a failed apply stays on Review, keeps the drafts and shows the message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(500, { message: "Synthetic: the import could not be saved." })));
    await act(async () => root.render(createElement(ClubImportWorkspace, { initialPreview: preview() })));
    await click(/Import 1 club/);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Synthetic: the import could not be saved.");
    expect(currentStep(host)).toContain("Review");
    expect(host.textContent).toContain("Import 1 club");
    expect(host.textContent).not.toContain("Import results");
  });

  it("club import: FAILED rows are shown unchanged in Results, with a way back to the Club directory", async () => {
    const result = { sourceKey: "k1", clubName: "Fixture Hills Pathfinders", clubYear: "2026-27", status: "FAILED", kind: "CLUB_LIST", message: "Synthetic failure for this row.", organizationId: null, membersAdded: 0, membersSkipped: 0, skipped: [], invitesCreated: 0 };
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { results: [result] })));
    await act(async () => root.render(createElement(ClubImportWorkspace, { initialPreview: preview() })));
    await click(/Import 1 club/);
    expect(currentStep(host)).toContain("Results");
    expect(host.textContent).toContain("Synthetic failure for this row.");
    expect(host.querySelector('a[href="/admin/clubs/summary"]')?.textContent).toBe("Back to the Club directory");
  });

  it("health import: a failed preview stays on Preview, and a failed apply stays on Review with the preview kept", async () => {
    const row = { sourceId: "s1", memberId: "m1", name: "Riley Sample", clubText: "Example", clubName: "Example Pathfinders", outcome: "MATCHED", reason: null, sections: ["Allergies"], needsCorrectionCount: 0, contactsOmitted: 0 };
    const counts = { MATCHED: 1, NEEDS_CHECK: 0, UNMATCHED: 0, ALREADY_HAS_RECORD: 0, SUPERSEDED: 0, INCOMPLETE: 0 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(422, { message: "Synthetic: the file could not be read." }))
      .mockResolvedValueOnce(reply(200, { preview: { rows: [row], counts, total: 1, unreadableRows: 0, duplicateIds: 0 } }))
      .mockResolvedValueOnce(reply(500, { message: "Synthetic: the import failed." }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(createElement(HealthImportWorkspace)));
    await choose(host.querySelector('input[type="file"]')!, new File(["x"], "export.csv"));
    await click(/Preview the import/);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Synthetic: the file could not be read.");
    expect(currentStep(host)).toContain("Preview");

    await click(/Preview the import/);
    expect(currentStep(host)).toContain("Review");
    expect(host.querySelector('[role="alert"]')).toBeNull();

    await click(/^Import 1 of 1 matched/);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Synthetic: the import failed.");
    expect(currentStep(host)).toContain("Review");
    expect(host.textContent).toContain("Riley Sample");
  });

  it("health import: a result with failed rows shows on Results with its counts unchanged and no new links", async () => {
    const row = { sourceId: "s1", memberId: "m1", name: "Riley Sample", clubText: "Example", clubName: "Example Pathfinders", outcome: "MATCHED", reason: null, sections: [], needsCorrectionCount: 0, contactsOmitted: 0 };
    const counts = { MATCHED: 1, NEEDS_CHECK: 0, UNMATCHED: 0, ALREADY_HAS_RECORD: 0, SUPERSEDED: 0, INCOMPLETE: 0 };
    const applied = { runId: "run-1", rows: [{ ...row, outcome: "FAILED" }], counts: { ...counts, MATCHED: 0, IMPORTED: 0, NOT_SELECTED: 0, CHANGED: 0, FAILED: 1 }, imported: 0 };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(reply(200, { preview: { rows: [row], counts, total: 1, unreadableRows: 0, duplicateIds: 0 } }))
      .mockResolvedValueOnce(reply(200, { result: applied })));
    await act(async () => root.render(createElement(HealthImportWorkspace)));
    await choose(host.querySelector('input[type="file"]')!, new File(["x"], "export.csv"));
    await click(/Preview the import/);
    await click(/^Import 1 of 1 matched/);
    expect(currentStep(host)).toContain("Results");
    expect(host.textContent).toContain("1 could not be imported");
    expect(host.querySelector('a[href^="/admin/clubs/summary"]')).toBeNull();
    expect(host.querySelector('a[href*="member"]')).toBeNull();
  });
});

describe("the restricted health import page", () => {
  beforeEach(() => {
    mocks.healthOn.current = true;
    mocks.user.current = { id: "u1" };
    mocks.clubsAdmin.current = true;
    mocks.acknowledged.current = true;
    mocks.redirect.mockClear();
  });

  it("does not exist while the Health Record feature is off", async () => {
    mocks.healthOn.current = false;
    await expect(HealthImportPage()).rejects.toThrow("NOT_FOUND");
  });

  it("sends a signed-out visitor to sign in and a person without Clubs administration to no access", async () => {
    mocks.user.current = null;
    await expect(HealthImportPage()).rejects.toThrow("REDIRECT:/login");
    mocks.user.current = { id: "u2" };
    mocks.clubsAdmin.current = false;
    await expect(HealthImportPage()).rejects.toThrow("REDIRECT:/no-access");
  });

  it("shows the privacy acknowledgment, not the workspace, until it is acknowledged", async () => {
    mocks.acknowledged.current = false;
    const before = renderToStaticMarkup(await HealthImportPage());
    expect(before).toContain("PRIVACY-NOTICE");
    expect(before).not.toContain("Import steps");
    mocks.acknowledged.current = true;
    const after = renderToStaticMarkup(await HealthImportPage());
    expect(after).not.toContain("PRIVACY-NOTICE");
    expect(after).toContain("Import steps");
  });
});

describe("where the imports live", () => {
  it("places both imports under the Club directory tab, health only when the flag is on", () => {
    expect(staffPlaceFor("/admin/clubs/import")).toMatchObject({ area: "clubs", tab: "club-summary" });
    expect(staffPlaceFor("/admin/clubs/health-import")).toMatchObject({ area: "clubs", tab: "club-summary" });
    const clubs = areaTabSpecs.clubs;
    const hrefs = (key: string) => (clubs.find((tab) => tab.key === key)?.views ?? []).map((view) => view.href);
    expect(hrefs("club-summary")).toEqual(expect.arrayContaining(["/admin/clubs/import", "/admin/clubs/health-import"]));
    expect(hrefs("club-administration")).not.toContain("/admin/clubs/import");
    expect(hrefs("club-administration")).not.toContain("/admin/clubs/health-import");
    const health = clubs.find((tab) => tab.key === "club-summary")!.views!.find((view) => view.href === "/admin/clubs/health-import")!;
    const viewer = { isSystemAdmin: false, held: ["CLUBS_ADMIN"], healthImport: false } as never;
    expect(health.visible(viewer)).toBe(false);
    expect(health.visible({ ...(viewer as object), healthImport: true } as never)).toBe(true);
  });
});
