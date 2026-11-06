import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Break-glass and legal holds page (#1617). Synthetic data only. */

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  healthRecordsEnabled: vi.fn(() => true),
  hasAcknowledged: vi.fn(async () => true),
  listGrants: vi.fn(),
  listHolds: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/components/admin-page-header", () => ({ AdminPageHeader: () => createElement("header", null, "header") }));
vi.mock("@/components/health-privacy-acknowledgment", () => ({ HealthPrivacyAcknowledgment: () => createElement("p", null, "ACK-NOTICE") }));
vi.mock("@/modules/health-records/flag", () => ({ healthRecordsEnabled: mocks.healthRecordsEnabled }));
vi.mock("@/modules/health-records/acknowledgment", () => ({ hasAcknowledgedHealthPrivacy: mocks.hasAcknowledged }));
vi.mock("@/modules/health-records/snapshot-access-repository", () => ({
  listSnapshotBreakGlassGrants: mocks.listGrants,
  listSnapshotHolds: mocks.listHolds,
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));

import HealthAccessPage from "@/app/(workspace)/admin/health-access/page";
import { HealthBreakGlassForm } from "@/components/health-break-glass-form";
import { systemNavGroups, systemSubpageTitle } from "@/components/system-navigation";
import { canStartBreakGlassInline } from "@/modules/health-records/break-glass-form";

const NOW = new Date("2026-11-10T12:00:00Z");
const grant = (id: string, expiresAt: string) => ({
  id, userId: "admin-1", userDisplayName: "Synthetic Admin", personId: "person-1", reason: "Synthetic review reason",
  grantedAt: new Date("2026-11-09T12:00:00Z"), expiresAt: new Date(expiresAt),
  uses: { total: 2, lastUsedAt: new Date("2026-11-09T13:00:00Z"), byKind: { LIVE_RECORD: 2 } },
});
const hold = (id: string, liftedAt: Date | null) => ({
  id, scope: "PERSON" as const, personId: "person-9", eventId: null, reason: "Synthetic hold reason",
  placedAt: new Date("2026-11-01T12:00:00Z"), liftedAt, liftReason: liftedAt ? "Synthetic lift reason" : null, snapshotsCovered: 3,
});

async function renderPage() {
  return renderToStaticMarkup(await HealthAccessPage());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.getCurrentSession.mockReset().mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
  mocks.healthRecordsEnabled.mockReturnValue(true);
  mocks.hasAcknowledged.mockClear(); mocks.hasAcknowledged.mockResolvedValue(true);
  mocks.listGrants.mockReset().mockResolvedValue([grant("g1", "2026-11-10T20:00:00Z"), grant("g2", "2026-11-09T20:00:00Z")]);
  mocks.listHolds.mockReset().mockResolvedValue([hold("h1", null), hold("h2", new Date("2026-11-05T12:00:00Z"))]);
  mocks.redirect.mockClear();
});

describe("who sees the page", () => {
  it("shows it to a system administrator, with the grants and holds read as that administrator", async () => {
    const html = await renderPage();
    expect(html).toContain("Break-glass grants");
    expect(html).toContain("Legal holds");
    expect(mocks.listGrants).toHaveBeenCalledWith({ kind: "SYSTEM_ADMIN", userId: "admin-1" });
    expect(mocks.listHolds).toHaveBeenCalledWith({ kind: "SYSTEM_ADMIN", userId: "admin-1" });
  });

  it.each([
    ["a Clubs Administrator or event staff member", { id: "u2", globalRole: "STAFF" }],
    ["a club director", { id: "u3", globalRole: "USER" }],
  ])("sends %s to no-access and reads nothing", async (_label, user) => {
    mocks.getCurrentSession.mockResolvedValue({ user });
    await expect(HealthAccessPage()).rejects.toThrow("REDIRECT:/no-access");
    expect(mocks.listGrants).not.toHaveBeenCalled();
    expect(mocks.listHolds).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to staff sign in", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    await expect(HealthAccessPage()).rejects.toThrow("REDIRECT:/login");
  });
});

describe("the page content", () => {
  it("splits active grants from history and shows who, when, reason, person id, end and use", async () => {
    const html = await renderPage();
    expect(html).toContain("Active now");
    expect(html).toContain("Review history");
    expect(html).toContain("Synthetic Admin");
    expect(html).toContain("2026-11-10 20:00 UTC");
    expect(html).toContain("person-1");
    expect(html).toContain("Synthetic review reason");
    expect(html).toContain("2 times (2 live record)");
  });

  it("lists holds with a Lift button only on the active one", async () => {
    const html = await renderPage();
    expect(html).toContain("Synthetic hold reason");
    expect(html).toContain("Synthetic lift reason");
    expect(html.match(/Lift hold/g)).toHaveLength(1);
    expect(html).toContain("Place hold");
  });

  it("renders no health value fields", async () => {
    const html = await renderPage();
    expect(html).not.toMatch(/allerg|medication|insurance|tetanus|emergency contact|diagnos/i);
  });
});

describe("the privacy acknowledgment", () => {
  it("comes first and alone while the switch is on and it is not acknowledged", async () => {
    mocks.hasAcknowledged.mockResolvedValue(false);
    const html = await renderPage();
    expect(html).toContain("ACK-NOTICE");
    expect(html).not.toContain("Legal holds");
    expect(mocks.listHolds).not.toHaveBeenCalled();
  });

  it("is skipped with the switch off, so holds and the review still show", async () => {
    mocks.healthRecordsEnabled.mockReturnValue(false);
    mocks.hasAcknowledged.mockResolvedValue(false);
    const html = await renderPage();
    expect(html).not.toContain("ACK-NOTICE");
    expect(html).toContain("Legal holds");
    expect(html).toContain("Break-glass grants");
    expect(mocks.hasAcknowledged).not.toHaveBeenCalled();
  });
});

describe("the inline break-glass form", () => {
  it("is allowed for a system administrator, including one acting as a director", () => {
    expect(canStartBreakGlassInline({ kind: "SYSTEM_ADMIN", userId: "a1" })).toBe(true);
    expect(canStartBreakGlassInline({ kind: "SYSTEM_ADMIN", userId: "a1", actAsId: "d1" })).toBe(true);
  });

  it("is not allowed for a Clubs Administrator, a director or a health role", () => {
    expect(canStartBreakGlassInline({ kind: "SYSTEM_ADMIN", userId: "c1", viaClubsAdministrator: true })).toBe(false);
    expect(canStartBreakGlassInline({ kind: "CLUB_LEADER", organizationId: "o1", accountId: "acc1" })).toBe(false);
    expect(canStartBreakGlassInline({ kind: "HEALTH_ROLE", userId: "u1", eventIds: ["e1"] })).toBe(false);
  });

  it("renders a labelled, required reason with a length hint", () => {
    const html = renderToStaticMarkup(createElement(HealthBreakGlassForm, { personId: "person-1", message: "Needs break-glass." }));
    expect(html).toContain("Needs break-glass.");
    expect(html).toMatch(/<label[^>]*>Reason for reading this record/);
    expect(html).toContain("required");
    expect(html).toContain("10 to 500 characters");
    expect(html).toContain("Start break-glass");
  });
});

describe("navigation", () => {
  it("lists the page once in the People group with a matching title", () => {
    const people = systemNavGroups.find((group) => group.key === "system-people")!;
    const item = people.items.find((entry) => entry.href === "/admin/health-access");
    expect(item?.label).toBe("Break-glass and legal holds");
    expect(item?.description.length).toBeGreaterThan(10);
    expect(systemSubpageTitle("/admin/health-access")).toBe(item?.label);
    expect(systemNavGroups.flatMap((group) => group.items).filter((entry) => entry.href === "/admin/health-access")).toHaveLength(1);
  });
});
