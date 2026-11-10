import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1584: the staff health pages draw a shared header frame (purpose label, back link, record block) in every state, and
 * their titles stay generic. Mock-based; synthetic names only.
 */
const mocks = vi.hoisted(() => ({
  resolveEventContext: vi.fn(),
  resolveStaffHealthViewer: vi.fn(),
  healthAcknowledgmentOwed: vi.fn(),
  loadEventHealth: vi.fn(),
  requireStaffHealthViewer: vi.fn(),
  viewHealthRecord: vi.fn(),
  rosterMemberPersonId: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: vi.fn(), usePathname: () => "/more/event-health", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));
vi.mock("@/modules/coordinator-health/access", () => ({ resolveStaffHealthViewer: mocks.resolveStaffHealthViewer }));
vi.mock("@/modules/coordinator-health/repository", () => ({
  HealthViewError: class HealthViewError extends Error { constructor(public readonly code: string, message: string) { super(message); } },
  loadEventHealth: mocks.loadEventHealth,
  healthAcknowledgmentOwed: mocks.healthAcknowledgmentOwed,
}));
vi.mock("@/modules/health-records/flag", () => ({ healthRecordsEnabled: () => true }));
vi.mock("@/modules/health-records/access", () => ({ requireStaffHealthViewer: mocks.requireStaffHealthViewer }));
vi.mock("@/modules/health-records/repository", () => ({ viewHealthRecord: mocks.viewHealthRecord }));
vi.mock("@/modules/health-records/break-glass-form", () => ({
  canStartBreakGlassInline: () => false,
  rosterMemberPersonId: mocks.rosterMemberPersonId,
}));

import { metadata as eventHealthMetadata } from "@/app/(workspace)/more/event-health/page";
import EventHealthPage from "@/app/(workspace)/more/event-health/page";
import { metadata as recordMetadata } from "@/app/(workspace)/more/health-records/[organizationId]/[memberId]/page";
import StaffHealthRecordPage from "@/app/(workspace)/more/health-records/[organizationId]/[memberId]/page";
import { staffPageTitles, staffShellPageTitle } from "@/components/staff-navigation";
import { BREAK_GLASS_REQUIRED_MESSAGE } from "@/modules/health-records/break-glass";
import { HealthRecordError } from "@/modules/health-records/errors";

const PURPOSE = "Confidential · read only";
const RECORD_PURPOSE = "Confidential · view only. Opening this page is recorded.";
const render = async (element: Promise<unknown>) => renderToStaticMarkup((await element) as React.ReactElement);
const eventPage = (query: Record<string, string> = {}) => render(EventHealthPage({ searchParams: Promise.resolve({ event: "event-1", ...query }) }));
const recordPage = (query: Record<string, string> = {}) => render(StaffHealthRecordPage({ params: Promise.resolve({ organizationId: "club-1", memberId: "member-1" }), searchParams: Promise.resolve(query) }));

const health = {
  member: { id: "member-1", firstName: "Casey", lastName: "Sample" },
  club: { name: "Synthetic Pathfinders", sponsoringChurch: null },
  status: "CURRENT",
  importedForReview: false,
  values: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveEventContext.mockResolvedValue({ event: { id: "event-1", name: "Synthetic Camporee" } });
  mocks.resolveStaffHealthViewer.mockResolvedValue({ kind: "SYSTEM_ADMIN", userId: "u1" });
  mocks.healthAcknowledgmentOwed.mockResolvedValue(false);
  mocks.loadEventHealth.mockResolvedValue({ event: { id: "event-1", name: "Synthetic Camporee", availableThrough: "2026-11-10" }, purpose: "VIEW", clubs: [] });
  mocks.requireStaffHealthViewer.mockResolvedValue({ kind: "SYSTEM_ADMIN", userId: "u1" });
  mocks.viewHealthRecord.mockResolvedValue(health);
  mocks.rosterMemberPersonId.mockResolvedValue(null);
});

describe("document titles stay generic (#1584)", () => {
  it("keeps the event health and record titles, with no person in them", () => {
    expect(eventHealthMetadata.title).toBe(staffPageTitles.eventHealth);
    expect(recordMetadata.title).toBe("Health record");
    expect(staffShellPageTitle("/more/health-records/club-1/member-1")).toBe("Health record");
    expect(eventHealthMetadata.robots).toEqual({ index: false, follow: false, nocache: true });
    expect(recordMetadata.robots).toEqual({ index: false, follow: false, nocache: true });
  });
});

describe("event health header (#1584)", () => {
  it("shows the purpose label, the recording sentence and the one printable-sheet action", async () => {
    const html = await eventPage({ club: "club-9" });
    expect(html).toContain(PURPOSE);
    expect(html).toContain("Every time this is opened or printed it is recorded.");
    expect(html).toContain('href="/more/event-health?event=event-1&amp;club=club-9&amp;sheet=1"');
    expect(html).not.toContain("<h1");
  });

  it("keeps the purpose label on the restricted, acknowledgment and unavailable states", async () => {
    mocks.resolveStaffHealthViewer.mockResolvedValue(null);
    expect(await eventPage()).toContain(PURPOSE);
    mocks.resolveStaffHealthViewer.mockResolvedValue({ kind: "SYSTEM_ADMIN", userId: "u1" });
    mocks.healthAcknowledgmentOwed.mockResolvedValue(true);
    expect(await eventPage()).toContain(PURPOSE);
    expect(mocks.loadEventHealth).not.toHaveBeenCalled();
    mocks.healthAcknowledgmentOwed.mockResolvedValue(false);
    const { HealthViewError } = await import("@/modules/coordinator-health/repository");
    mocks.loadEventHealth.mockRejectedValue(new HealthViewError("WINDOW_CLOSED", "The window is closed."));
    expect(await eventPage()).toContain(PURPOSE);
  });
});

describe("health record header (#1584)", () => {
  it("shows the label, the member and club as before, the status, and a back link only from an event", async () => {
    const html = await recordPage({ event: "event-1" });
    expect(html).toContain(RECORD_PURPOSE);
    expect(html).toContain("Casey Sample");
    expect(html).toContain('translate="no">Synthetic Pathfinders');
    expect(html).toContain("Current for this club year");
    expect(html).toContain('href="/more/event-health?event=event-1"');
    expect(html).toContain("Back to event health information");
    const withoutEvent = await recordPage();
    expect(withoutEvent).toContain(RECORD_PURPOSE);
    expect(withoutEvent).not.toContain("Back to event health information");
    // The name appears in the record block only, never in a link.
    expect(html.match(/href="[^"]*"/g)?.some((link) => /Casey|Sample/.test(link))).toBe(false);
  });

  it("keeps the label on the restricted, acknowledgment and break-glass states and loads no record for them", async () => {
    mocks.requireStaffHealthViewer.mockRejectedValue(new HealthRecordError("FORBIDDEN", "No."));
    expect(await recordPage({ event: "event-1" })).toContain(RECORD_PURPOSE);
    expect(mocks.viewHealthRecord).not.toHaveBeenCalled();
    mocks.requireStaffHealthViewer.mockResolvedValue({ kind: "SYSTEM_ADMIN", userId: "u1" });
    mocks.viewHealthRecord.mockRejectedValue(new HealthRecordError("ACKNOWLEDGMENT_REQUIRED", "Read the notice."));
    expect(await recordPage()).toContain(RECORD_PURPOSE);
    mocks.viewHealthRecord.mockRejectedValue(new HealthRecordError("BREAK_GLASS_REQUIRED", BREAK_GLASS_REQUIRED_MESSAGE));
    const html = await recordPage();
    expect(html).toContain(RECORD_PURPOSE);
    expect(html).toContain("Break-glass access is required");
    expect(html).not.toContain("Casey");
  });
});
