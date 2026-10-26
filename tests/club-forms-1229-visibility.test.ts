import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1229: a submission with no club (a "Not listed" open application) is conference staff's alone. The fake table
 * honors the `organizationId` filter the way the database does, so a leak shows as a returned row. Synthetic data only.
 */
type Where = { id?: string; organizationId?: string | { not: null } };
type Row = ReturnType<typeof listRow>;

const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
  submissionFindFirst: vi.fn(),
  submissionFindMany: vi.fn(),
}));

const client = {
  clubFormTemplate: { findUnique: async () => template, findFirst: async () => template },
  clubFormTemplateVersion: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  clubFormSubmission: { findFirst: mocks.submissionFindFirst, findMany: mocks.submissionFindMany },
  $transaction: (work: (tx: unknown) => unknown) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ SECRET_ENCRYPTION_KEY: "a-synthetic-encryption-key-for-club-form-tests", APP_BASE_URL: "https://events.imsda.test" }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { buildClubFormsCsv } from "@/modules/club-forms/csv";
import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import {
  clubFormClubLabel,
  restrictedFieldKeys,
  viewerCanRevealBirthDates,
  viewerCanRevealSensitive,
  viewerCanSeeClub,
  type ClubFormsViewer,
} from "@/modules/club-forms/domain";
import { getRosterAddReview } from "@/modules/club-forms/roster-add";
import { getSubmissionForViewer, listSubmissionsForViewer } from "@/modules/club-forms/submissions";

const seed = clubFormTemplateSeeds.find((candidate) => candidate.key === "club_tlt_application")!;
const template = {
  id: "template-tlt", key: seed.key, name: seed.name, description: seed.description, version: seed.version,
  definition: seed.definition, sectionNotes: seed.sectionNotes, sensitiveFieldKeys: seed.sensitiveFieldKeys,
  birthDateFieldKeys: seed.birthDateFieldKeys, staffOnlyFieldKeys: seed.staffOnlyFieldKeys, hiddenFieldKeys: [],
  printLayout: seed.printLayout, rosterMapping: null, fillMode: "OPEN_APPLICATION", enabled: true, customizedAt: null,
};

function listRow(id: string, organizationId: string | null, unlistedClubName: string | null) {
  return {
    id, clubYear: "2026-27", rosterMemberId: null, subjectName: "Jordan Sample", status: "SUBMITTED" as const,
    submittedAt: new Date("2026-10-26T15:00:00Z"), updatedAt: new Date("2026-10-26T15:00:00Z"), enteredVia: "OPEN_APPLICATION" as const,
    hasSensitiveAnswers: false, unlistedClubName, organizationId,
    template: { key: seed.key, name: seed.name },
    organization: organizationId ? { id: organizationId, name: "Example Pathfinders" } : null,
  };
}
const listed = listRow("sub-listed", "club-a", null);
const unlisted = listRow("sub-unlisted", null, "Sample Valley Pathfinders");
const table: Row[] = [listed, unlisted];

function matches(row: Row, where: Where) {
  if (where.id && where.id !== row.id) return false;
  const org = where.organizationId;
  if (typeof org === "string") return row.organizationId === org;
  if (org && typeof org === "object") return row.organizationId !== null;
  return true;
}

const leader: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "ATTENDEE", accountId: "acct-1" } };
const otherLeader: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-b", actor: { kind: "ATTENDEE", accountId: "acct-9" } };
const coordinator: ClubFormsViewer = { kind: "AREA_COORDINATOR", actor: { kind: "ATTENDEE", accountId: "acct-2" } };
const staff: ClubFormsViewer = { kind: "STAFF", userId: "staff-1", systemAdmin: false, clubsAdministrator: false, sensitiveAnswers: true };
const admin: ClubFormsViewer = { kind: "STAFF", userId: "admin-1", systemAdmin: true, clubsAdministrator: false, sensitiveAnswers: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeAuditLog.mockResolvedValue({});
  mocks.submissionFindMany.mockImplementation(async ({ where }: { where: Where }) => table.filter((row) => matches(row, where)));
  mocks.submissionFindFirst.mockImplementation(async ({ where }: { where: Where }) => {
    const found = table.find((row) => matches(row, where));
    return found
      ? { ...found, answers: { full_name: "Jordan Sample" }, sealedSensitiveAnswers: null, templateVersion: seed.version, rosterAction: null, rosterActionMemberId: null, rosterActionMember: null, link: null, template }
      : null;
  });
});

describe("who may see a submission with no club (#1229)", () => {
  it("is conference staff only, in every permission rule", () => {
    expect(viewerCanSeeClub(staff, null)).toBe(true);
    expect(viewerCanSeeClub(admin, null)).toBe(true);
    expect(viewerCanSeeClub(leader, null)).toBe(false);
    expect(viewerCanSeeClub(coordinator, null)).toBe(false);
    expect(viewerCanRevealSensitive(leader, null)).toBe(false);
    expect(viewerCanRevealBirthDates(leader, null)).toBe(false);
    expect(viewerCanRevealSensitive(coordinator, null)).toBe(false);
    expect(viewerCanRevealSensitive(staff, null)).toBe(true);
    expect(viewerCanRevealBirthDates(staff, null)).toBe(false);
    expect(viewerCanRevealBirthDates(admin, null)).toBe(true);
    const keys = { sensitiveFieldKeys: ["health", "dob"], birthDateFieldKeys: ["dob"] };
    expect(restrictedFieldKeys(leader, null, keys).sort()).toEqual(["dob", "health"]);
  });

  it("names the club as Not listed with the typed name", () => {
    expect(clubFormClubLabel("Example Pathfinders", null)).toBe("Example Pathfinders");
    expect(clubFormClubLabel(null, "Sample Valley Pathfinders")).toBe("Not listed: Sample Valley Pathfinders");
    expect(clubFormClubLabel(null, "  ")).toBe("Not listed");
  });

  it("is left out of a club leader's list and of an Area Coordinator's list", async () => {
    expect((await listSubmissionsForViewer(leader)).map((row) => row.id)).toEqual(["sub-listed"]);
    expect((await listSubmissionsForViewer(otherLeader)).map((row) => row.id)).toEqual([]);
    expect((await listSubmissionsForViewer(coordinator)).map((row) => row.id)).toEqual(["sub-listed"]);
    expect(mocks.submissionFindMany.mock.calls[2][0].where).toMatchObject({ organizationId: { not: null } });
  });

  it("shows conference staff both, with Not listed and the typed name where the club shows", async () => {
    const rows = await listSubmissionsForViewer(staff);
    expect(rows.map((row) => [row.id, row.organizationId, row.organizationName])).toEqual([
      ["sub-listed", "club-a", "Example Pathfinders"],
      ["sub-unlisted", null, "Not listed: Sample Valley Pathfinders"],
    ]);
  });

  it("cannot be opened by a club leader or an Area Coordinator, with or without a club in the address", async () => {
    for (const viewer of [leader, otherLeader, coordinator]) {
      await expect(getSubmissionForViewer(viewer, "sub-unlisted"), viewer.kind).rejects.toMatchObject({ code: "SUBMISSION_NOT_FOUND" });
    }
    await expect(getSubmissionForViewer(coordinator, "sub-unlisted", "VIEW", "club-a")).rejects.toMatchObject({ code: "SUBMISSION_NOT_FOUND" });
    await expect(getSubmissionForViewer(leader, "sub-unlisted", "VIEW", "club-a")).rejects.toMatchObject({ code: "SUBMISSION_NOT_FOUND" });
  });

  it("opens for conference staff, labelled Not listed", async () => {
    const view = await getSubmissionForViewer(staff, "sub-unlisted");
    expect(view.organization).toEqual({ id: null, name: "Not listed: Sample Valley Pathfinders" });
    expect(view.enteredVia).toBe("OPEN_APPLICATION");
    expect(view.rosterAdd).toBeNull();
  });

  it("can never be added to a roster", async () => {
    await expect(getRosterAddReview(leader, { organizationId: "club-a", submissionId: "sub-unlisted" })).rejects.toMatchObject({ code: "SUBMISSION_NOT_FOUND" });
  });

  it("shows Not listed and the typed name in the staff CSV", async () => {
    mocks.submissionFindMany.mockResolvedValue([
      { clubYear: "2026-27", subjectName: "Jordan Sample", templateVersion: seed.version, status: "SUBMITTED", submittedAt: new Date("2026-10-26T15:00:00Z"), enteredVia: "OPEN_APPLICATION", answers: {}, unlistedClubName: "Sample Valley Pathfinders", organization: null },
    ]);
    const csv = await buildClubFormsCsv(staff, { templateKey: seed.key });
    expect(csv.csv).toContain("Not listed: Sample Valley Pathfinders");
    expect(csv.csv).toContain("Open application");
  });
});
