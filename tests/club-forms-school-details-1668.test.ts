import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * School type and church membership answers on the Membership Application (#1668, #1778): the club's own director and
 * deputy and system administrators read them, and so do Area Coordinators and Clubs Administrators, view only (matching
 * the roster, #1758). Event Admins, another club's director and a Clubs Administrator acting as director see "Restricted"
 * on the form and nothing in the CSV. Real seed, synthetic people only.
 */

const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
  templateFindUnique: vi.fn(),
  submissionFindMany: vi.fn(),
  submissionFindFirst: vi.fn(),
  versionFindMany: vi.fn(),
}));

const client = {
  clubFormTemplate: { findUnique: mocks.templateFindUnique },
  clubFormSubmission: { findMany: mocks.submissionFindMany, findFirst: mocks.submissionFindFirst },
  clubFormTemplateVersion: { findMany: mocks.versionFindMany, findUnique: vi.fn(async () => null) },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ SECRET_ENCRYPTION_KEY: "a-synthetic-encryption-key-for-club-form-tests" }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { rosterSchoolDetailsVisible } from "@/modules/club-rosters/school-details-access";
import { buildClubFormsCsv } from "@/modules/club-forms/csv";
import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import { parseClubFormTemplate, restrictedFieldKeys, viewerCanWriteForClub, type ClubFormsViewer } from "@/modules/club-forms/domain";
import { rosterPrefillFromAnswers } from "@/modules/club-forms/roster-mapping";
import { getSubmissionForViewer } from "@/modules/club-forms/submissions";

const membership = clubFormTemplateSeeds.find((seed) => seed.key === "pathfinder_membership_application")!;
const SCHOOL = ["school_type", "church_member"];

const leader: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "ATTENDEE", accountId: "acct-1" } };
const otherClubLeader: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-b", actor: { kind: "ATTENDEE", accountId: "acct-9" } };
const sysAdminActingAsLeader: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "STAFF_ACTING", userId: "staff-1", actAsId: "act-1" } };
const clubsAdminActingAsLeader: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "STAFF_ACTING", userId: "staff-3", actAsId: "act-2", viaClubsAdministrator: true } };
const areaCoordinator: ClubFormsViewer = { kind: "AREA_COORDINATOR", actor: { kind: "ATTENDEE", accountId: "acct-2" } };
const eventAdmin: ClubFormsViewer = { kind: "STAFF", userId: "staff-2", systemAdmin: false, clubsAdministrator: false, sensitiveAnswers: true };
const clubsAdmin: ClubFormsViewer = { kind: "STAFF", userId: "staff-4", systemAdmin: false, clubsAdministrator: true, sensitiveAnswers: true };
const sysAdmin: ClubFormsViewer = { kind: "STAFF", userId: "staff-1", systemAdmin: true, clubsAdministrator: false, sensitiveAnswers: true };

const templateRow = {
  id: "template-membership", key: membership.key, name: membership.name, description: membership.description, version: membership.version,
  definition: membership.definition, sectionNotes: membership.sectionNotes, sensitiveFieldKeys: membership.sensitiveFieldKeys,
  birthDateFieldKeys: membership.birthDateFieldKeys, staffOnlyFieldKeys: membership.staffOnlyFieldKeys, printLayout: membership.printLayout, enabled: true,
};
const answers = { full_name: "Riley Sample", grade: "7th", school_type: "Public school", church_member: "Not sure" };
const submission = {
  id: "sub-1", organizationId: "club-a", clubYear: "2026-27", rosterMemberId: null, subjectName: "Riley Sample", status: "SUBMITTED",
  submittedAt: new Date("2026-10-05T15:00:00Z"), enteredVia: "LINK", unlistedClubName: null, answers,
  sealedSensitiveAnswers: null, hasSensitiveAnswers: false, templateVersion: membership.version, organization: { name: "Example Pathfinders" }, template: templateRow,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.writeAuditLog.mockResolvedValue({});
  mocks.versionFindMany.mockResolvedValue([]);
  mocks.templateFindUnique.mockResolvedValue(templateRow);
  mocks.submissionFindFirst.mockResolvedValue(submission);
});

describe("which viewers may read school type and church membership on a form", () => {
  const template = parseClubFormTemplate(templateRow);

  it("names the two questions on the Membership Application only", () => {
    expect(membership.schoolDetailFieldKeys).toEqual(SCHOOL);
    expect(clubFormTemplateSeeds.filter((seed) => seed.key !== membership.key).every((seed) => !seed.schoolDetailFieldKeys)).toBe(true);
  });

  it.each([
    ["the club's own director", leader, "club-a", []],
    ["a system administrator acting as the director", sysAdminActingAsLeader, "club-a", []],
    ["a system administrator", sysAdmin, "club-a", []],
    ["another club's director", otherClubLeader, "club-a", SCHOOL],
    ["an Area Coordinator (view only, #1778)", areaCoordinator, "club-a", []],
    ["an Event Admin", eventAdmin, "club-a", SCHOOL],
    ["a Clubs Administrator (view only, #1778)", clubsAdmin, "club-a", []],
    ["a Clubs Administrator acting as the director", clubsAdminActingAsLeader, "club-a", SCHOOL],
  ] as const)("%s: restricted keys %j", (_label, viewer, organizationId, expected) => {
    const restricted = restrictedFieldKeys(viewer, organizationId, template).filter((key) => SCHOOL.includes(key));
    expect(restricted).toEqual(expected);
  });
});

describe("the form view (Area Coordinator and staff pages)", () => {
  it("gives the new viewers (#1778) no way to write: only the club's own leaders save a form", () => {
    expect(viewerCanWriteForClub(areaCoordinator, "club-a")).toBe(false);
    expect(viewerCanWriteForClub(clubsAdmin, "club-a")).toBe(false);
    expect(viewerCanWriteForClub(leader, "club-a")).toBe(true);
  });

  it.each([["an Event Admin", eventAdmin], ["a Clubs Administrator acting as director", clubsAdminActingAsLeader]])("hides the values from %s", async (_label, viewer) => {
    const seen = await getSubmissionForViewer(viewer, "sub-1");
    expect(seen.answers).not.toHaveProperty("school_type");
    expect(seen.answers).not.toHaveProperty("church_member");
  });

  it.each([
    ["the club's director", leader],
    ["a system administrator", sysAdmin],
    ["a system administrator acting as director", sysAdminActingAsLeader],
    ["an Area Coordinator (view only, #1778)", areaCoordinator],
    ["a Clubs Administrator (view only, #1778)", clubsAdmin],
  ])("shows the values to %s", async (_label, viewer) => {
    const seen = await getSubmissionForViewer(viewer, "sub-1");
    expect(seen.restrictedKeys.filter((key) => SCHOOL.includes(key))).toEqual([]);
    expect(seen.answers).toMatchObject({ school_type: "Public school", church_member: "Not sure" });
  });

  it("leaves roster mapping working for the club: the director's view still pre-fills grade, school type and church membership", async () => {
    const seen = await getSubmissionForViewer(leader, "sub-1");
    const spec = { definition: membership.definition, sensitiveFieldKeys: membership.sensitiveFieldKeys, birthDateFieldKeys: membership.birthDateFieldKeys, hiddenFieldKeys: [] as string[] };
    expect(rosterPrefillFromAnswers(membership.rosterMapping!, seen.answers, spec)).toMatchObject({ schoolGrade: "GRADE_7", schoolType: "PUBLIC_SCHOOL", churchMember: "NOT_SURE" });
  });
});

describe("the submissions CSV", () => {
  const rows = [{
    clubYear: "2026-27", subjectName: "Riley Sample", templateVersion: membership.version, status: "SUBMITTED", submittedAt: new Date("2026-10-30T12:00:00Z"),
    enteredVia: "LINK", answers, unlistedClubName: null, organization: { name: "Example Pathfinders" },
  }];

  it.each([["an Event Admin", eventAdmin]])("leaves school type and church membership out for %s", async (_label, viewer) => {
    mocks.submissionFindMany.mockResolvedValue(rows);
    const { csv } = await buildClubFormsCsv(viewer, { templateKey: membership.key });
    const header = csv.split("\r\n")[0];
    expect(header).not.toContain("School type");
    expect(header).not.toContain("member of the Seventh-day Adventist church");
    expect(csv).not.toMatch(/Public school|Not sure/);
    expect(csv).toContain("Riley Sample");
  });

  it.each([["a system administrator", sysAdmin], ["a Clubs Administrator (#1778)", clubsAdmin]])("includes them for %s", async (_label, viewer) => {
    mocks.submissionFindMany.mockResolvedValue(rows);
    const { csv } = await buildClubFormsCsv(viewer, { templateKey: membership.key });
    expect(csv.split("\r\n")[0]).toContain("School type");
    expect(csv).toContain("Public school");
    expect(csv).toContain("Not sure");
  });
});

describe("the roster page and routes (#1668)", () => {
  it("shows school details to a director, deputy or registrar and a system administrator acting as director, never a Clubs Administrator acting as director", () => {
    expect(rosterSchoolDetailsVisible({ actor: { kind: "ATTENDEE" } })).toBe(true);
    expect(rosterSchoolDetailsVisible({ actor: { kind: "STAFF_ACTING" } })).toBe(true);
    expect(rosterSchoolDetailsVisible({ actor: { kind: "STAFF_ACTING", viaClubsAdministrator: true } })).toBe(false);
  });
});
