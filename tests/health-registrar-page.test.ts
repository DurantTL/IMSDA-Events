import { beforeEach, describe, expect, it, vi } from "vitest";
import { HealthRecordError } from "@/modules/health-records/errors";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  access: vi.fn(),
  viewer: vi.fn(),
  view: vi.fn(),
  entry: vi.fn(),
  links: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: vi.fn() }));
vi.mock("@/modules/health-records/flag", () => ({ healthRecordsEnabled: () => true }));
vi.mock("@/modules/club-rosters/access", () => ({
  getRosterAccessStateForPage: mocks.access,
  RosterAccessError: class RosterAccessError extends Error {},
}));
vi.mock("@/modules/health-records/access", () => ({ requireHealthViewerForClub: mocks.viewer }));
vi.mock("@/modules/health-records/repository", () => ({
  viewHealthRecord: mocks.view,
  viewHealthEntryStatus: mocks.entry,
  listHealthRecordLinks: mocks.links,
}));

import ClubMemberHealthPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/roster/[memberId]/health/page";
import { HealthPrivacyAcknowledgment } from "@/components/health-privacy-acknowledgment";

const props = { params: Promise.resolve({ organizationId: "club-a", memberId: "member-1" }) };
const registrar = { kind: "CLUB_REGISTRAR", organizationId: "club-a", accountId: "acct-reg" };
const leader = { kind: "CLUB_LEADER", organizationId: "club-a", accountId: "acct-1" };

const entry = {
  member: { id: "member-1", firstName: "Casey", lastName: "Sample" },
  club: { name: "Synthetic Pathfinders", sponsoringChurch: null },
  exists: true,
  status: "CURRENT",
  lastConfirmedAt: "2026-10-05T15:00:00.000Z",
  consentText: { emergencyTreatment: "x", activities: "y", photocopy: "z" },
  consentVersion: "v",
};

function text(node: unknown): string {
  return JSON.stringify(node, (_key, value: unknown) => (typeof value === "function" ? "[fn]" : value));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ state: "OPEN" });
  mocks.links.mockResolvedValue([]);
});

describe("the Health tab page for a club member (#923)", () => {
  it("gives a Registrar the entry page when no record exists: the status and a blank form, and never reads the record", async () => {
    mocks.viewer.mockResolvedValue(registrar);
    mocks.entry.mockResolvedValue({ ...entry, exists: false, status: "NONE", lastConfirmedAt: null });
    const element = text(await ClubMemberHealthPage(props));
    expect(mocks.entry).toHaveBeenCalledWith(registrar, "club-a", "member-1");
    expect(mocks.view).not.toHaveBeenCalled();
    expect(mocks.links).not.toHaveBeenCalled();
    expect(element).toContain("cannot read it back");
    expect(element).toContain("when none exists yet");
    // The form starts empty: no stored value is passed to it.
    expect(element).toContain('"initialValues":{}');
    expect(element).not.toContain("HealthRecordView");
    expect(element).not.toContain("Confirm this record");
  });

  it("shows a Registrar the status only, and no form, when a record is on file", async () => {
    mocks.viewer.mockResolvedValue(registrar);
    mocks.entry.mockResolvedValue(entry);
    const element = text(await ClubMemberHealthPage(props));
    expect(element).toContain("A health record is on file; the director or a deputy can update it.");
    expect(element).not.toContain("initialValues");
    expect(element).not.toContain("consentText");
    expect(mocks.view).not.toHaveBeenCalled();
  });

  it("asks a Registrar who has not acknowledged for the one-time notice, and shows nothing else", async () => {
    mocks.viewer.mockResolvedValue(registrar);
    mocks.entry.mockRejectedValue(new HealthRecordError("ACKNOWLEDGMENT_REQUIRED", "Read the notice."));
    const element = (await ClubMemberHealthPage(props)) as { type: unknown; props: { as: string } };
    expect(element.type).toBe(HealthPrivacyAcknowledgment);
    expect(element.props.as).toBe("ATTENDEE");
    expect(mocks.view).not.toHaveBeenCalled();
  });

  it("asks a director who has not acknowledged for the notice before the record opens", async () => {
    mocks.viewer.mockResolvedValue(leader);
    mocks.view.mockRejectedValue(new HealthRecordError("ACKNOWLEDGMENT_REQUIRED", "Read the notice."));
    const element = (await ClubMemberHealthPage(props)) as { type: unknown };
    expect(element.type).toBe(HealthPrivacyAcknowledgment);
    expect(mocks.entry).not.toHaveBeenCalled();
    expect(mocks.links).not.toHaveBeenCalled();
  });

  it("still opens the record for a director once acknowledged, with edit and links", async () => {
    mocks.viewer.mockResolvedValue(leader);
    mocks.view.mockResolvedValue({
      member: { id: "member-1", firstName: "Casey", lastName: "Sample" },
      club: { name: "Synthetic Pathfinders", sponsoringChurch: null },
      status: "CURRENT",
      hasHealthNote: false,
      values: {},
      needsCorrection: [],
      canEdit: true,
      consentText: { emergencyTreatment: "x", activities: "y", photocopy: "z" },
      consentVersion: "v",
    });
    await ClubMemberHealthPage(props);
    expect(mocks.view).toHaveBeenCalledWith(leader, "club-a", "member-1");
    expect(mocks.links).toHaveBeenCalled();
    expect(mocks.entry).not.toHaveBeenCalled();
  });

  it("is a 404 when the repository refuses a Registrar for any other reason", async () => {
    mocks.viewer.mockResolvedValue(registrar);
    mocks.entry.mockRejectedValue(new HealthRecordError("MEMBER_NOT_FOUND", "That person could not be found."));
    await expect(ClubMemberHealthPage(props)).rejects.toThrow("NOT_FOUND");
  });
});
