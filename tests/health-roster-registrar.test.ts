import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthRecordError } from "@/modules/health-records/errors";

/**
 * The club roster page for a club Registrar (#923): the Registrar branch that
 * builds the Health column from status only. Synthetic data throughout.
 */

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  compliance: vi.fn(),
  listRoster: vi.fn(),
  transferOptions: vi.fn(),
  viewer: vi.fn(),
  entryStatuses: vi.fn(),
  summaries: vi.fn(),
  flags: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/club-rosters/access", () => ({ getRosterAccessStateForPage: mocks.access }));
vi.mock("@/modules/background-checks/repository", () => ({ clubPortalComplianceStatuses: mocks.compliance }));
vi.mock("@/modules/club-rosters/repository", () => ({ listRoster: mocks.listRoster }));
vi.mock("@/modules/club-transfers/repository", () => ({ listTransferClubOptions: mocks.transferOptions }));
vi.mock("@/modules/health-records/flag", () => ({ healthRecordsEnabled: () => true }));
vi.mock("@/modules/health-records/access", () => ({ requireHealthViewerForClub: mocks.viewer }));
vi.mock("@/modules/health-records/repository", () => ({
  healthEntryStatusesForMembers: mocks.entryStatuses,
  healthSummariesForMembers: mocks.summaries,
  healthRecordFlagsForRoster: mocks.flags,
}));

import ClubRosterPage from "@/app/(public)/account/(portal)/clubs/[organizationId]/roster/page";
import { ClubRosterWorkspace } from "@/components/club-roster-workspace";
import type { RosterMemberRecord } from "@/modules/club-rosters/repository";

type AnyProps = Record<string, unknown>;

function componentElements(node: ReactNode, found: ReactElement<AnyProps>[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) componentElements(child, found);
    return found;
  }
  if (!isValidElement<AnyProps>(node)) return found;
  if (typeof node.type === "function") found.push(node);
  componentElements(node.props.children as ReactNode, found);
  return found;
}

const base: RosterMemberRecord = {
  id: "member-1",
  firstName: "Robin",
  lastName: "Fixture",
  attendeeType: "YOUTH",
  role: "Pathfinder",
  classLevel: "FRIEND",
  gender: null,
  status: "ACTIVE",
  source: "IMPORT",
  age: null,
  reportedAge: 10,
  birthDateNeeded: false,
  updatedAt: new Date("2026-09-01T00:00:00Z").toISOString(),
};
const members: RosterMemberRecord[] = [base, { ...base, id: "member-2", firstName: "Sam" }, { ...base, id: "member-3", firstName: "Lee" }];
const registrar = { kind: "CLUB_REGISTRAR", organizationId: "club-1", accountId: "acct-reg" };
const leader = { kind: "CLUB_LEADER", organizationId: "club-1", accountId: "acct-1" };

async function renderPage() {
  const tree = await ClubRosterPage({ params: Promise.resolve({ organizationId: "club-1" }), searchParams: Promise.resolve({}) });
  const workspace = componentElements(tree).find((element) => element.type === ClubRosterWorkspace)!;
  return { props: workspace.props, html: renderToStaticMarkup(tree) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  mocks.access.mockResolvedValue({
    state: "OPEN",
    club: { organizationId: "club-1", name: "Fixture Pathfinders", role: "REGISTRAR", sponsoringChurch: null },
    capabilities: { roster: true, manageTeam: false, seeBirthDates: false },
    actor: { kind: "ATTENDEE", accountId: "acct-reg", sessionId: "session-1" },
  });
  mocks.compliance.mockResolvedValue(null);
  mocks.listRoster.mockResolvedValue(members);
  mocks.transferOptions.mockResolvedValue([]);
  mocks.viewer.mockResolvedValue(registrar);
  mocks.flags.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the roster page for a club Registrar (#923)", () => {
  it("offers 'Enter health record' where none exists, with status only: no clinical-note flag, no summaries", async () => {
    mocks.entryStatuses.mockResolvedValue({ "member-1": { status: "NONE" }, "member-2": { status: "NONE" }, "member-3": { status: "NONE" } });
    const { props, html } = await renderPage();
    expect(mocks.entryStatuses).toHaveBeenCalledWith(registrar, "club-1", ["member-1", "member-2", "member-3"]);
    expect(mocks.summaries).not.toHaveBeenCalled();
    expect(props.healthEntryOnly).toBe(true);
    expect(props.healthTab).toEqual({
      "member-1": { status: "NONE", hasHealthNote: false },
      "member-2": { status: "NONE", hasHealthNote: false },
      "member-3": { status: "NONE", hasHealthNote: false },
    });
    expect(html).toContain("Enter health record: none yet");
    expect(html).toContain("/account/clubs/club-1/roster/member-1/health");
    expect(html).not.toContain("A health record is on file");
  });

  it("shows 'on file' text instead of an entry link where a record exists, and hasHealthNote stays false", async () => {
    mocks.entryStatuses.mockResolvedValue({ "member-1": { status: "CURRENT" }, "member-2": { status: "NEEDS_UPDATE" }, "member-3": { status: "NONE" } });
    const { props, html } = await renderPage();
    for (const value of Object.values(props.healthTab as Record<string, { hasHealthNote: boolean }>)) expect(value.hasHealthNote).toBe(false);
    expect(html.match(/A health record is on file; the director or a deputy can update it\./g)).toHaveLength(2);
    expect(html).not.toContain("roster/member-1/health");
    expect(html).not.toContain("roster/member-2/health");
    expect(html).toContain("roster/member-3/health");
    expect(html).toContain("Enter health record: none yet");
  });

  it("shows a locked state and keeps the entry link before the privacy acknowledgment, with no status leaked", async () => {
    mocks.entryStatuses.mockRejectedValue(new HealthRecordError("ACKNOWLEDGMENT_REQUIRED", "Read the notice."));
    const { props, html } = await renderPage();
    expect(props.healthEntryOnly).toBe(true);
    expect(props.healthTab).toEqual({
      "member-1": { status: "LOCKED", hasHealthNote: false },
      "member-2": { status: "LOCKED", hasHealthNote: false },
      "member-3": { status: "LOCKED", hasHealthNote: false },
    });
    expect(html).toContain("Enter health record");
    expect(html).not.toContain("none yet");
    expect(html).not.toContain("A health record is on file");
  });

  it("gives a director the Health tab, not the entry-only link", async () => {
    mocks.viewer.mockResolvedValue(leader);
    mocks.summaries.mockResolvedValue({ "member-1": { status: "CURRENT", hasHealthNote: true } });
    const { props, html } = await renderPage();
    expect(props.healthEntryOnly).toBe(false);
    expect(mocks.entryStatuses).not.toHaveBeenCalled();
    expect(html).not.toContain("Enter health record");
  });
});
