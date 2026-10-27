import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1246: the "Required" setting on club form templates, and what is missing for each club. Synthetic data only.
 * Covers: the pure missing-forms rules, the card count equalling the list page's rows, the setter (audited, roles kept
 * only for a per-member requirement) and the sync, which never writes the setting.
 */
const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
  templateFindMany: vi.fn(),
  templateFindUnique: vi.fn(),
  templateUpdate: vi.fn(),
  templateUpdateMany: vi.fn(),
  templateUpsert: vi.fn(),
  orgFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
  submissionFindMany: vi.fn(),
  queryRaw: vi.fn(),
}));

const client = {
  clubFormTemplate: { findMany: mocks.templateFindMany, findUnique: mocks.templateFindUnique, update: mocks.templateUpdate, updateMany: mocks.templateUpdateMany, upsert: mocks.templateUpsert },
  clubFormTemplateVersion: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), createMany: vi.fn(async () => ({ count: 0 })), upsert: vi.fn(async () => ({})) },
  organization: { findMany: mocks.orgFindMany },
  clubRosterMember: { findMany: mocks.rosterFindMany },
  clubFormSubmission: { findMany: mocks.submissionFindMany },
  $queryRaw: mocks.queryRaw,
  $transaction: (work: (tx: unknown) => unknown) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ SECRET_ENCRYPTION_KEY: "a-synthetic-encryption-key-for-club-form-tests" }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import { getRequiredFormsStatus } from "@/modules/club-forms/required";
import {
  clubsFormsMissingHref,
  clubsWithFormsMissing,
  computeRequiredForms,
  normalizeRequirement,
  requirementSummary,
  type RequiredTemplate,
} from "@/modules/club-forms/required-domain";
import { clubsAdminHrefs, buildClubsAdminHome } from "@/modules/club-reports/clubs-admin-home-model";
import { templateRequirementSchema } from "@/modules/club-forms/schemas";
import { listClubFormTemplatesForAdmin, setClubFormTemplateRequirement, syncClubFormTemplates } from "@/modules/club-forms/templates";

const clubs = [
  { id: "c1", name: "Alpha Pathfinders", church: "Alpha Church" },
  { id: "c2", name: "Beta Pathfinders", church: "Beta Church" },
  { id: "c3", name: "Gamma Pathfinders", church: "Gamma Church" },
];
const members = [
  { id: "m1", organizationId: "c1", attendeeType: "YOUTH", name: "Zed Youth" },
  { id: "m2", organizationId: "c1", attendeeType: "YOUTH", name: "Amy Youth" },
  { id: "m3", organizationId: "c1", attendeeType: "STAFF", name: "Sam Staff" },
  { id: "m4", organizationId: "c2", attendeeType: "YOUTH", name: "Bo Youth" },
  { id: "m5", organizationId: "c2", attendeeType: "ADULT", name: "Pat Adult" },
];
const templates: RequiredTemplate[] = [
  { key: "can_collecting_report", name: "Can Collecting Report", requirement: "ONCE_PER_CLUB_YEAR", requiredRoles: [] },
  { key: "membership_application", name: "Membership Application", requirement: "PER_ROLE_MEMBER_YEAR", requiredRoles: ["YOUTH"] },
  { key: "staff_service", name: "Staff Service Information", requirement: "PER_ROLE_MEMBER_YEAR", requiredRoles: ["STAFF"] },
  { key: "optional_form", name: "Optional", requirement: "NOT_REQUIRED", requiredRoles: [] },
];
const submissions = [
  { templateKey: "can_collecting_report", organizationId: "c2", rosterMemberId: null },
  { templateKey: "membership_application", organizationId: "c1", rosterMemberId: "m1" },
  { templateKey: "membership_application", organizationId: "c2", rosterMemberId: "m4" },
  { templateKey: "staff_service", organizationId: "c1", rosterMemberId: "m3" },
];

describe("what each club is missing", () => {
  const result = computeRequiredForms({ templates, clubs, members, submissions });

  it("ignores a form that is not required", () => {
    expect(result[0]!.items.map((item) => item.templateKey)).toEqual(["can_collecting_report", "membership_application", "staff_service"]);
  });

  it("once per club: done when the club has a submitted entry, missing otherwise", () => {
    const statusOf = (clubId: string) => result.find((club) => club.id === clubId)!.items.find((item) => item.templateKey === "can_collecting_report")!.status;
    expect([statusOf("c1"), statusOf("c2"), statusOf("c3")]).toEqual(["MISSING", "DONE", "MISSING"]);
  });

  it("per member: lists only active members of the chosen role without a submitted entry, by name", () => {
    const alpha = result.find((club) => club.id === "c1")!.items.find((item) => item.templateKey === "membership_application")!;
    expect(alpha).toMatchObject({ status: "MISSING", memberCount: 2, missingMembers: [{ id: "m2", name: "Amy Youth" }] });
    const beta = result.find((club) => club.id === "c2")!.items.find((item) => item.templateKey === "membership_application")!;
    expect(beta).toMatchObject({ status: "DONE", memberCount: 1, missingMembers: [] });
  });

  it("a club with nobody in the role is not missing that form", () => {
    const gamma = result.find((club) => club.id === "c3")!.items.find((item) => item.templateKey === "staff_service")!;
    expect(gamma).toMatchObject({ status: "DONE", memberCount: 0 });
  });

  it("the clubs-missing list keeps only what is missing, and the card count is its length", () => {
    const missing = clubsWithFormsMissing(result);
    expect(missing.map((club) => [club.id, club.items.map((item) => item.templateKey)])).toEqual([
      ["c1", ["can_collecting_report", "membership_application"]],
      ["c3", ["can_collecting_report"]],
    ]);
    const home = buildClubsAdminHome({ clubYear: "2026-27", now: new Date("2026-10-26T18:00:00Z"), clubs: [], events: [], applications: [], waitingCount: 0, requiredForms: result });
    expect(home.counts.clubsWithFormsMissing).toBe(missing.length);
    expect(clubsAdminHrefs("2026-27").formsMissing).toBe(clubsFormsMissingHref("2026-27"));
    expect(clubsFormsMissingHref("2026-27")).toBe("/admin/club-forms?view=missing&year=2026-27");
  });

  it("nothing is missing when nothing is required", () => {
    expect(clubsWithFormsMissing(computeRequiredForms({ templates: templates.map((template) => ({ ...template, requirement: "NOT_REQUIRED" })), clubs, members, submissions: [] }))).toEqual([]);
  });
});

describe("getRequiredFormsStatus reads the same rules from the database", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orgFindMany.mockResolvedValue(clubs.map((club) => ({ id: club.id, name: club.name, parentOrganization: { name: club.church } })));
    mocks.templateFindMany.mockResolvedValue([
      { id: "t1", key: "can_collecting_report", name: "Can Collecting Report", requirement: "ONCE_PER_CLUB_YEAR", requiredRoles: [] },
      { id: "t2", key: "membership_application", name: "Membership Application", requirement: "PER_ROLE_MEMBER_YEAR", requiredRoles: ["YOUTH"] },
    ]);
    mocks.rosterFindMany.mockResolvedValue(members.map((member) => ({ id: member.id, organizationId: member.organizationId, attendeeType: member.attendeeType, person: { firstName: member.name.split(" ")[0], lastName: member.name.split(" ")[1] } })));
    mocks.submissionFindMany.mockResolvedValue([
      { organizationId: "c2", rosterMemberId: null, template: { key: "can_collecting_report" } },
      { organizationId: "c1", rosterMemberId: "m1", template: { key: "membership_application" } },
    ]);
  });

  it("counts only enabled required templates, submitted entries and active roster members of the club year", async () => {
    const status = await getRequiredFormsStatus("2026-27");
    expect(mocks.templateFindMany.mock.calls[0]![0].where).toEqual({ enabled: true, requirement: { not: "NOT_REQUIRED" } });
    expect(mocks.submissionFindMany.mock.calls[0]![0].where).toMatchObject({ clubYear: "2026-27", status: "SUBMITTED" });
    expect(mocks.rosterFindMany.mock.calls[0]![0].where).toMatchObject({ clubYear: "2026-27", status: "ACTIVE" });
    expect(clubsWithFormsMissing(status).map((club) => club.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("narrows to the director's own club", async () => {
    await getRequiredFormsStatus("2026-27", ["c1"]);
    expect(mocks.orgFindMany.mock.calls[0]![0].where).toMatchObject({ type: "CLUB", isActive: true, id: { in: ["c1"] } });
  });

  it("reads nothing else when no form is required", async () => {
    mocks.templateFindMany.mockResolvedValue([]);
    const status = await getRequiredFormsStatus("2026-27");
    expect(clubsWithFormsMissing(status)).toEqual([]);
    expect(mocks.rosterFindMany).not.toHaveBeenCalled();
    expect(mocks.submissionFindMany).not.toHaveBeenCalled();
  });
});

describe("the Required setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeAuditLog.mockResolvedValue({});
    mocks.templateUpdateMany.mockResolvedValue({ count: 0 });
    mocks.queryRaw.mockResolvedValue([]);
  });

  it("normalizes: roles are kept only for a per-member requirement, in a fixed order, without duplicates", () => {
    expect(normalizeRequirement("ONCE_PER_CLUB_YEAR", ["YOUTH"])).toEqual({ requirement: "ONCE_PER_CLUB_YEAR", roles: [] });
    expect(normalizeRequirement("PER_ROLE_MEMBER_YEAR", ["STAFF", "YOUTH", "STAFF", "bogus"])).toEqual({ requirement: "PER_ROLE_MEMBER_YEAR", roles: ["YOUTH", "STAFF"] });
    expect(requirementSummary("NOT_REQUIRED", [])).toBe("Not required");
    expect(requirementSummary("PER_ROLE_MEMBER_YEAR", ["YOUTH"])).toContain("Pathfinders");
  });

  it("the schema needs a role for a per-member requirement and refuses unknown roles and fields", () => {
    expect(templateRequirementSchema.safeParse({ requirement: "NOT_REQUIRED" }).success).toBe(true);
    expect(templateRequirementSchema.safeParse({ requirement: "PER_ROLE_MEMBER_YEAR", requiredRoles: [] }).success).toBe(false);
    expect(templateRequirementSchema.safeParse({ requirement: "PER_ROLE_MEMBER_YEAR", requiredRoles: ["DIRECTOR"] }).success).toBe(false);
    expect(templateRequirementSchema.safeParse({ requirement: "ONCE_PER_CLUB_YEAR", other: 1 }).success).toBe(false);
  });

  it("saves who and when, and audits the change with before and after", async () => {
    mocks.templateFindUnique.mockResolvedValue({ id: "template-1", requirement: "NOT_REQUIRED", requiredRoles: [] });
    const when = new Date("2026-10-27T15:00:00Z");
    const saved = await setClubFormTemplateRequirement("membership_application", { requirement: "PER_ROLE_MEMBER_YEAR", requiredRoles: ["STAFF", "YOUTH"] }, "admin-1", when);
    expect(saved).toEqual({ key: "membership_application", requirement: "PER_ROLE_MEMBER_YEAR", requiredRoles: ["YOUTH", "STAFF"] });
    expect(mocks.templateUpdate).toHaveBeenCalledWith({
      where: { id: "template-1" },
      data: { requirement: "PER_ROLE_MEMBER_YEAR", requiredRoles: ["YOUTH", "STAFF"], requirementChangedAt: when, requirementChangedByUserId: "admin-1" },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: "admin-1", action: "CLUB_FORM_REQUIREMENT_CHANGED", entityType: "ClubFormTemplate", entityId: "template-1", metadata: { templateKey: "membership_application", from: "NOT_REQUIRED", to: "PER_ROLE_MEMBER_YEAR", fromRoles: [], toRoles: ["YOUTH", "STAFF"] } }),
      client,
    );
  });

  it("clears the roles when switched away from per-member, and writes no audit row for a no-op", async () => {
    mocks.templateFindUnique.mockResolvedValue({ id: "template-1", requirement: "PER_ROLE_MEMBER_YEAR", requiredRoles: ["YOUTH"] });
    await setClubFormTemplateRequirement("membership_application", { requirement: "ONCE_PER_CLUB_YEAR", requiredRoles: ["YOUTH"] }, "admin-1");
    expect(mocks.templateUpdate.mock.calls[0]![0].data).toMatchObject({ requirement: "ONCE_PER_CLUB_YEAR", requiredRoles: [] });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    mocks.templateFindUnique.mockResolvedValue({ id: "template-1", requirement: "ONCE_PER_CLUB_YEAR", requiredRoles: [] });
    await setClubFormTemplateRequirement("membership_application", { requirement: "ONCE_PER_CLUB_YEAR", requiredRoles: [] }, "admin-1");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("is not found for an unknown form", async () => {
    mocks.templateFindUnique.mockResolvedValue(null);
    await expect(setClubFormTemplateRequirement("nothing", { requirement: "NOT_REQUIRED", requiredRoles: [] }, "admin-1")).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
  });

  it("is listed for the admin page, NOT_REQUIRED by default for a form not synced yet", async () => {
    mocks.templateFindMany.mockResolvedValue([
      { key: clubFormTemplateSeeds[0]!.key, name: "A", description: "d", enabled: true, enabledAt: null, version: 1, customizedAt: null, draftUpdatedAt: null, draftBaseVersion: null, fillMode: null, requirement: "PER_ROLE_MEMBER_YEAR", requiredRoles: ["YOUTH"], _count: { submissions: 0 } },
    ]);
    const listed = await listClubFormTemplatesForAdmin();
    expect(listed[0]).toMatchObject({ requirement: "PER_ROLE_MEMBER_YEAR", requiredRoles: ["YOUTH"] });
    expect(listed.slice(1).every((row) => row.requirement === "NOT_REQUIRED" && row.requiredRoles.length === 0)).toBe(true);
  });
});

describe("club-forms:sync never writes the Required setting", () => {
  const rowFor = (seed: (typeof clubFormTemplateSeeds)[number], extra: Record<string, unknown> = {}) => ({
    id: `id-${seed.key}`, key: seed.key, version: seed.version, sensitiveFieldKeys: seed.sensitiveFieldKeys,
    birthDateFieldKeys: seed.birthDateFieldKeys, customizedAt: null, draftUpdatedAt: null, fillMode: null, fillModeChangedAt: null, ...extra,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.templateUpdateMany.mockResolvedValue({ count: 1 });
    mocks.templateUpdate.mockResolvedValue({});
    mocks.templateUpsert.mockResolvedValue({ id: "x" });
    mocks.queryRaw.mockResolvedValue([]);
    mocks.writeAuditLog.mockResolvedValue({});
  });

  it("a sync of rows behind the code, and of rows already current, writes no requirement column", async () => {
    mocks.templateFindMany.mockResolvedValue(clubFormTemplateSeeds.map((seed, index) => rowFor(seed, index === 0 ? { version: 0 } : {})));
    mocks.templateFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const seed = clubFormTemplateSeeds.find((candidate) => `id-${candidate.key}` === where.id)!;
      return { id: where.id, version: 0, sensitiveFieldKeys: seed.sensitiveFieldKeys, birthDateFieldKeys: seed.birthDateFieldKeys, customizedAt: null, draftUpdatedAt: null };
    });
    await syncClubFormTemplates(client as never).catch(() => undefined);
    const writes = [...mocks.templateUpdate.mock.calls, ...mocks.templateUpdateMany.mock.calls, ...mocks.templateUpsert.mock.calls];
    expect(writes.length).toBeGreaterThan(0);
    for (const [args] of writes) {
      const data = JSON.stringify({ data: args.data, create: args.create, update: args.update });
      expect(data).not.toMatch(/requirement|requiredRoles/);
    }
  });
});
