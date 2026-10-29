import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The emergency plan page and print page (#114): permission and module gates
 * on the server, the latest published version by default, a marked draft
 * preview, and a printed sheet with no interactive elements. Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  resolveEventContext: vi.fn(),
  isModuleEnabled: vi.fn(),
  getEmergencyPlanDraft: vi.fn(),
  listEmergencyPlanVersions: vi.fn(),
  getEmergencyPlanVersion: vi.fn(),
  getEmergencyPlanEvent: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ usePathname: () => "/more/emergency-plan", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));
vi.mock("@/modules/event-modules/service", () => ({ isModuleEnabled: mocks.isModuleEnabled }));
vi.mock("@/modules/emergency-plans/repository", () => ({
  getEmergencyPlanDraft: mocks.getEmergencyPlanDraft,
  listEmergencyPlanVersions: mocks.listEmergencyPlanVersions,
  getEmergencyPlanVersion: mocks.getEmergencyPlanVersion,
  getEmergencyPlanEvent: mocks.getEmergencyPlanEvent,
}));

import { AccessRestricted } from "@/components/access-restricted";
import EmergencyPlanPage from "@/app/(workspace)/more/emergency-plan/page";
import EmergencyPlanPrintPage from "@/app/(workspace)/more/emergency-plan/print/page";

const event = { id: "event-1", name: "Synthetic Camp Meeting", timezone: "America/Chicago" };
const snapshot = {
  schemaVersion: 1 as const,
  event: { name: "Synthetic Camp Meeting", startsOn: "2026-07-15", endsOn: "2026-07-19", timezone: "America/Chicago" },
  locations: [{ kind: "ASSEMBLY" as const, name: "Main field", description: "", capacityNote: "", directions: "", mapReference: "https://maps.example.test/x" }],
  procedures: [{ kind: "EVACUATION" as const, title: "Evacuate", body: "Leave calmly.", items: [{ title: "Exit", text: "Nearest door." }] }],
  contacts: [{ escalationOrder: 1, role: "Director", name: "Sample Director", phone: "(515) 555-0100" }],
};
const draftPlan = { locations: [], procedures: [], contacts: [{ role: "Director", name: "Sample", phone: "(515) 555-0100", escalationOrder: 1 }] };
const search = (params: Record<string, string> = {}) => Promise.resolve({ event: "event-1", ...params });
const isRestricted = (node: unknown) => isValidElement(node) && node.type === AccessRestricted;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveEventContext.mockResolvedValue({ event, permissions: ["VIEW_EVENT", "CONFIGURE_EVENT"] });
  mocks.isModuleEnabled.mockResolvedValue(true);
  mocks.getEmergencyPlanDraft.mockResolvedValue(draftPlan);
  mocks.listEmergencyPlanVersions.mockResolvedValue([]);
  mocks.getEmergencyPlanVersion.mockResolvedValue({ versionNumber: 4, publishedAt: new Date("2026-07-01T15:00:00Z"), snapshot });
  mocks.getEmergencyPlanEvent.mockResolvedValue({ name: "Synthetic Camp Meeting", startsAt: new Date("2026-07-15T14:00:00Z"), endsAt: new Date("2026-07-19T20:00:00Z"), timezone: "America/Chicago" });
});

describe("emergency plan page gates", () => {
  it("restricts a viewer without VIEW_EVENT and reads nothing", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event, permissions: ["MANAGE_KITCHEN_COUNTS"] });
    expect(isRestricted(await EmergencyPlanPage({ searchParams: search() }))).toBe(true);
    expect(isRestricted(await EmergencyPlanPrintPage({ searchParams: search() }))).toBe(true);
    expect(mocks.isModuleEnabled).not.toHaveBeenCalled();
    expect(mocks.getEmergencyPlanDraft).not.toHaveBeenCalled();
    expect(mocks.getEmergencyPlanVersion).not.toHaveBeenCalled();
  });

  it("restricts both pages while the module is off, and reads no plan data", async () => {
    mocks.isModuleEnabled.mockResolvedValue(false);
    expect(isRestricted(await EmergencyPlanPage({ searchParams: search() }))).toBe(true);
    expect(isRestricted(await EmergencyPlanPrintPage({ searchParams: search() }))).toBe(true);
    expect(mocks.isModuleEnabled).toHaveBeenCalledWith("event-1", "emergency-plans");
    expect(mocks.getEmergencyPlanDraft).not.toHaveBeenCalled();
    expect(mocks.getEmergencyPlanVersion).not.toHaveBeenCalled();
  });

  it("gives VIEW_EVENT-only staff a read-only page", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event, permissions: ["VIEW_EVENT"] });
    const node = await EmergencyPlanPage({ searchParams: search() });
    expect(isRestricted(node)).toBe(false);
    expect((node as { props: { canEdit: boolean } }).props.canEdit).toBe(false);
  });

  it("gives administrators the editor", async () => {
    const node = await EmergencyPlanPage({ searchParams: search() });
    expect((node as { props: { canEdit: boolean } }).props.canEdit).toBe(true);
  });
});

describe("emergency plan print page", () => {
  it("prints the latest published version by default, with the version in the footer", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event, permissions: ["VIEW_EVENT"] });
    const html = renderToStaticMarkup(await EmergencyPlanPrintPage({ searchParams: search() }));
    expect(mocks.getEmergencyPlanVersion).toHaveBeenCalledWith("event-1", undefined);
    expect(html).toContain("Version 4. Published");
    expect(html).toContain("Printed ");
    expect(html).not.toContain("DRAFT");
    expect(html).toContain("Sample Director");
  });

  it("prints a requested version", async () => {
    await EmergencyPlanPrintPage({ searchParams: search({ version: "2" }) });
    expect(mocks.getEmergencyPlanVersion).toHaveBeenCalledWith("event-1", 2);
  });

  it("rejects a malformed version", async () => {
    expect(isRestricted(await EmergencyPlanPrintPage({ searchParams: search({ version: "x" }) }))).toBe(true);
    expect(mocks.getEmergencyPlanVersion).not.toHaveBeenCalled();
  });

  it("marks a draft preview and claims no version; only administrators may preview", async () => {
    const html = renderToStaticMarkup(await EmergencyPlanPrintPage({ searchParams: search({ draft: "1" }) }));
    expect(html).toContain("DRAFT — not published");
    expect(html).not.toMatch(/Version \d/);
    expect(mocks.getEmergencyPlanVersion).not.toHaveBeenCalled();
    mocks.resolveEventContext.mockResolvedValue({ event, permissions: ["VIEW_EVENT"] });
    expect(isRestricted(await EmergencyPlanPrintPage({ searchParams: search({ draft: "1" }) }))).toBe(true);
  });

  it("has no interactive element inside the printed sheet", async () => {
    const html = renderToStaticMarkup(await EmergencyPlanPrintPage({ searchParams: search() }));
    const sheet = html.slice(html.indexOf("<article"));
    const printed = sheet.replace(/<div class="[^"]*screenOnly[^"]*">[\s\S]*?<\/div>/, "");
    expect(printed).not.toMatch(/<(button|input|select|textarea|a)[\s>]/);
    // The map reference prints as plain text.
    expect(printed).toContain("https://maps.example.test/x");
  });

  it("says so when nothing is published", async () => {
    mocks.getEmergencyPlanVersion.mockResolvedValue(null);
    const html = renderToStaticMarkup(await EmergencyPlanPrintPage({ searchParams: search() }));
    expect(html).toContain("Nothing is published yet");
  });
});

