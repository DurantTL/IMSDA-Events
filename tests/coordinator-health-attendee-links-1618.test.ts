import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAreaHealthViewer: vi.fn(),
  loadEventHealth: vi.fn(),
  enabled: vi.fn(() => false),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }), redirect: vi.fn() }));
vi.mock("@/modules/organizations/area-coordinators", () => ({ requireSecondStepForAreaCoordinator: async () => undefined }));
vi.mock("@/modules/coordinator-health/access", () => ({ resolveAreaHealthViewer: mocks.resolveAreaHealthViewer }));
vi.mock("@/modules/coordinator-health/repository", () => ({
  HealthViewError: class HealthViewError extends Error {},
  loadEventHealth: mocks.loadEventHealth,
  listHealthEvents: vi.fn(),
  healthAcknowledgmentOwed: async () => false,
}));
vi.mock("@/modules/health-records/flag", () => ({ healthRecordsEnabled: mocks.enabled }));

import AreaHealthPage from "@/app/(public)/account/(portal)/area/health/page";
import { EventHealthSheet } from "@/components/event-health-sheet";
import { areaAttendeeHealthHref, pickRosterMemberId, type HealthClubSheet } from "@/modules/coordinator-health/domain";

const row = (rosterMemberId: string | null) => ({
  attendeeId: "a1", name: "Avery Synthetic", dietary: null, medicalFlag: null, emergencyContacts: [], emergencyStatus: "NONE_ON_FILE" as const, rosterMemberId,
});
const clubs = (rosterMemberId: string | null): HealthClubSheet[] => [{ organizationId: "club 1", clubName: "Synthetic Club", attendees: [row(rosterMemberId)] }];
const href = (organizationId: string, memberId: string) => `/h/${organizationId}/${memberId}`;

describe("picking the roster member for the link (#1618)", () => {
  it("uses the one match, and null for none", () => {
    expect(pickRosterMemberId([{ id: "m1", clubYear: "2026-27", status: "ACTIVE" }])).toBe("m1");
    expect(pickRosterMemberId([])).toBeNull();
  });
  it("takes the later club year when an event spans two", () => {
    expect(pickRosterMemberId([{ id: "old", clubYear: "2025-26", status: "ACTIVE" }, { id: "new", clubYear: "2026-27", status: "ACTIVE" }])).toBe("new");
  });
  it("gives null when every row is inactive, since the record page loads active members only", () => {
    expect(pickRosterMemberId([{ id: "gone", clubYear: "2026-27", status: "INACTIVE" }])).toBeNull();
  });
  it("prefers an active row over a later inactive one", () => {
    expect(pickRosterMemberId([{ id: "active", clubYear: "2025-26", status: "ACTIVE" }, { id: "gone", clubYear: "2026-27", status: "INACTIVE" }])).toBe("active");
  });
});

describe("the attendee link on the health sheet (#1618)", () => {
  it("links the name only when the href function is given and the row has a roster member", () => {
    const linked = renderToStaticMarkup(createElement(EventHealthSheet, { clubs: clubs("m1"), attendeeHref: href }));
    expect(linked).toContain('href="/h/club 1/m1"');
    expect(linked).toContain('<span class="sr-only">: Health Record</span>');
    expect(renderToStaticMarkup(createElement(EventHealthSheet, { clubs: clubs("m1") }))).not.toContain("Health Record");
    expect(renderToStaticMarkup(createElement(EventHealthSheet, { clubs: clubs(null), attendeeHref: href }))).not.toContain("Health Record");
  });
});

describe("the area health page passes the per-attendee link only with the switch on (#1618)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAreaHealthViewer.mockResolvedValue({ kind: "AREA_COORDINATOR", accountId: "acct" });
    mocks.loadEventHealth.mockResolvedValue({ event: { id: "e 1", name: "Synthetic", availableThrough: "2026-11-10" }, purpose: "VIEW", clubs: clubs("m 1") });
  });
  const html = async (query: Record<string, string>) => {
    const element = await AreaHealthPage({ searchParams: Promise.resolve({ event: "e 1", ...query }) });
    return renderToStaticMarkup(element);
  };
  it("links with the switch on", async () => {
    mocks.enabled.mockReturnValue(true);
    expect(await html({})).toContain('href="/account/area-clubs/health/e%201/club%201/m%201"');
  });
  it("does not link with the switch off, or on the printable sheet", async () => {
    mocks.enabled.mockReturnValue(false);
    expect(await html({})).not.toContain("/account/area-clubs/health/");
    mocks.enabled.mockReturnValue(true);
    expect(await html({ sheet: "1" })).not.toContain("/account/area-clubs/health/");
  });
  it("builds the encoded href", () => {
    expect(areaAttendeeHealthHref("e/1", "o", "m")).toBe("/account/area-clubs/health/e%2F1/o/m");
  });
});
