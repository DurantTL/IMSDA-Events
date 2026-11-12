import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1686 part 2b: the TLT director reads the three TLT forms from every club, sensitive answers included, with every
 * opening audited, and nothing else. Real viewer rules and the real submission reader over a fake database; synthetic
 * people only. Dates are pinned.
 */

const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
  submissionFindFirst: vi.fn(),
  submissionFindMany: vi.fn(),
  submissionCount: vi.fn(),
  versionFindMany: vi.fn(),
  templateFindMany: vi.fn(),
  templateFindUnique: vi.fn(),
  organizationFindMany: vi.fn(),
}));

const client = {
  clubFormSubmission: { findFirst: mocks.submissionFindFirst, findMany: mocks.submissionFindMany, count: mocks.submissionCount },
  clubFormTemplate: { findMany: mocks.templateFindMany, findUnique: mocks.templateFindUnique },
  clubFormTemplateVersion: { findMany: mocks.versionFindMany, findUnique: vi.fn(async () => null) },
  organization: { findMany: mocks.organizationFindMany },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ SECRET_ENCRYPTION_KEY: "a-synthetic-encryption-key-for-club-form-tests" }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { viewerCanSeeSchoolDetails } from "@/modules/club-forms/domain";
import { buildClubFormsCsv } from "@/modules/club-forms/csv";
import { TLT_FORM_TEMPLATE_KEYS, restrictedFieldKeys, parseClubFormTemplate, type ClubFormsViewer, viewerCanRevealSensitive } from "@/modules/club-forms/domain";
import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import { sealSensitiveAnswers } from "@/modules/club-forms/sealed-answers";
import { getSubmissionForViewer, pageSubmissionsForViewer } from "@/modules/club-forms/submissions";
import { readTltFormsInbox, recordTltFormsInboxView } from "@/modules/tlt-directory/forms";
import { parseTltFormsFilters } from "@/modules/tlt-directory/forms-domain";

const director: ClubFormsViewer = { kind: "TLT_DIRECTOR", accountId: "acct-tlt" };
const areaCoordinator: ClubFormsViewer = { kind: "AREA_COORDINATOR", actor: { kind: "ATTENDEE", accountId: "acct-tlt" } };
const clubLeader: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "ATTENDEE", accountId: "acct-lead" } };
const otherLeader: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-b", actor: { kind: "ATTENDEE", accountId: "acct-other" } };
const clubsAdmin: ClubFormsViewer = { kind: "STAFF", userId: "staff-2", systemAdmin: false, clubsAdministrator: true, sensitiveAnswers: true };
const sysAdmin: ClubFormsViewer = { kind: "STAFF", userId: "staff-1", systemAdmin: true, clubsAdministrator: false, sensitiveAnswers: true };

const CONDUCT = "Synthetic conduct answer";
const BIRTH = "2011-04-02";
const NAME = "Riley Sample";

/** The real seed definition for the key, with synthetic sensitive keys marked on it (the seeds ship none). */
function templateRow(key: string) {
  const seed = clubFormTemplateSeeds.find((candidate) => candidate.key === key) ?? clubFormTemplateSeeds[0]!;
  return {
    id: `template-${key}`, key, name: `Form ${key}`, description: "", version: seed.version, enabled: true,
    definition: seed.definition,
    sectionNotes: {}, sensitiveFieldKeys: ["conduct", "birth_date"], birthDateFieldKeys: ["birth_date"], staffOnlyFieldKeys: [], hiddenFieldKeys: [], printLayout: "STANDARD", rosterMapping: null, customizedAt: null,
  };
}

function submission(key: string, over: Record<string, unknown> = {}) {
  return {
    id: "sub-1", organizationId: "club-a", clubYear: "2026-27", rosterMemberId: null, subjectName: NAME, status: "SUBMITTED",
    submittedAt: new Date("2026-11-10T15:00:00Z"), enteredVia: "LINK", unlistedClubName: null,
    answers: { applicant_name: NAME }, sealedSensitiveAnswers: sealSensitiveAnswers("sub-1", { conduct: CONDUCT, birth_date: BIRTH }), hasSensitiveAnswers: true,
    templateVersion: templateRow(key).version, rosterAction: null, rosterActionMemberId: null, rosterActionMember: null, link: null,
    organization: { name: "Example Pathfinders" }, template: templateRow(key), ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T16:00:00Z"));
  mocks.writeAuditLog.mockResolvedValue({});
  mocks.versionFindMany.mockResolvedValue([]);
  mocks.submissionFindFirst.mockResolvedValue(submission("club_tlt_application"));
});

describe("what the TLT director reads on a TLT form", () => {
  it.each(TLT_FORM_TEMPLATE_KEYS)("shows the sensitive answers on %s, and keeps birth dates Restricted", async (key) => {
    mocks.submissionFindFirst.mockResolvedValue(submission(key));
    const seen = await getSubmissionForViewer(director, "sub-1");
    expect(seen.answers).toMatchObject({ applicant_name: NAME, conduct: CONDUCT });
    expect(seen.answers).not.toHaveProperty("birth_date");
    expect(seen.restrictedKeys).toEqual(["birth_date"]);
    expect(seen.sensitiveRevealed).toBe(true);
    expect(JSON.stringify(seen)).not.toContain(BIRTH);
  });

  it("leaves an ordinary Area Coordinator on the same form Restricted, as today", async () => {
    const seen = await getSubmissionForViewer(areaCoordinator, "sub-1");
    expect(seen.answers).not.toHaveProperty("conduct");
    expect(seen.restrictedKeys.sort()).toEqual(["birth_date", "conduct"]);
    expect(JSON.stringify(seen)).not.toContain(CONDUCT);
  });

  it("changes nothing for the club's own director, another club's director or staff", async () => {
    expect((await getSubmissionForViewer(clubLeader, "sub-1")).answers).toMatchObject({ conduct: CONDUCT, birth_date: BIRTH });
    mocks.submissionFindFirst.mockResolvedValue(null);
    await expect(getSubmissionForViewer(otherLeader, "sub-1", "VIEW", "club-a")).rejects.toMatchObject({ code: "CLUB_NOT_FOUND" });
    mocks.submissionFindFirst.mockResolvedValue(submission("club_tlt_application"));
    expect((await getSubmissionForViewer(clubsAdmin, "sub-1")).answers).toMatchObject({ conduct: CONDUCT, birth_date: BIRTH });
    expect((await getSubmissionForViewer(sysAdmin, "sub-1")).answers).toMatchObject({ conduct: CONDUCT, birth_date: BIRTH });
  });

  it("reveals sensitive answers only for the three TLT forms, whatever else is asked", () => {
    const other = parseClubFormTemplate(templateRow("pathfinder_membership_application"));
    expect(viewerCanRevealSensitive(director, "club-a")).toBe(false);
    expect(viewerCanRevealSensitive(director, "club-a", "pathfinder_membership_application")).toBe(false);
    expect(viewerCanRevealSensitive(director, "club-a", "club_tlt_of_the_year")).toBe(true);
    expect(restrictedFieldKeys(director, "club-a", other)).toContain("conduct");
  });

  it("refuses an edit or a roster add: she reads and prints only", async () => {
    await expect(getSubmissionForViewer(director, "sub-1", "EDIT")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getSubmissionForViewer(director, "sub-1", "ROSTER_ADD")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    await expect(getSubmissionForViewer(director, "sub-1", "PRINT")).resolves.toBeTruthy();
  });
});

describe("the query is fixed to the three TLT forms", () => {
  it("asks only for TLT templates when opening one, so another club form is not found", async () => {
    mocks.submissionFindFirst.mockResolvedValue(null);
    await expect(getSubmissionForViewer(director, "sub-of-another-form")).rejects.toMatchObject({ code: "SUBMISSION_NOT_FOUND" });
    const where = mocks.submissionFindFirst.mock.calls[0]![0].where;
    expect(where.template).toEqual({ key: { in: [...TLT_FORM_TEMPLATE_KEYS] } });
    expect(where.status).toBe("SUBMITTED");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it.each(["pathfinder_membership_application", "club_pathfinder_of_the_year", "", "club_tlt_application' OR 1=1"])("matches nothing when the list is filtered to %j", async (form) => {
    mocks.submissionCount.mockResolvedValue(0);
    mocks.submissionFindMany.mockResolvedValue([]);
    await pageSubmissionsForViewer(director, { templateKey: form || undefined }, { sort: { key: "submitted", dir: "desc" }, page: 1, pageSize: 25 });
    const where = mocks.submissionCount.mock.calls[0]![0].where;
    expect(where.template.key).toEqual(form ? { in: [] } : { in: [...TLT_FORM_TEMPLATE_KEYS] });
  });

  it("keeps drafts out and includes a Not listed application", async () => {
    mocks.submissionCount.mockResolvedValue(0);
    mocks.submissionFindMany.mockResolvedValue([]);
    await pageSubmissionsForViewer(director, {}, { sort: { key: "submitted", dir: "desc" }, page: 1, pageSize: 25 });
    const where = mocks.submissionCount.mock.calls[0]![0].where;
    expect(where.status).toBe("SUBMITTED");
    expect(where).not.toHaveProperty("organizationId");
  });
});

describe("every view is audited, without names or answers", () => {
  it("writes TLT_FORM_SUBMISSION_VIEWED for each opening, with or without sensitive answers", async () => {
    await getSubmissionForViewer(director, "sub-1");
    mocks.submissionFindFirst.mockResolvedValue(submission("tlt_program_recommendation", { sealedSensitiveAnswers: null, hasSensitiveAnswers: false, answers: { applicant_name: NAME } }));
    await getSubmissionForViewer(director, "sub-1");
    await getSubmissionForViewer(director, "sub-1");
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(3);
    for (const [entry] of mocks.writeAuditLog.mock.calls) {
      expect(entry).toMatchObject({
        action: "TLT_FORM_SUBMISSION_VIEWED",
        entityType: "ClubFormSubmission",
        entityId: "sub-1",
        metadata: { viewerKind: "TLT_DIRECTOR", actorAttendeeAccountId: "acct-tlt", submissionId: "sub-1", organizationId: "club-a" },
      });
      const text = JSON.stringify(entry);
      expect(text).not.toContain(NAME);
      expect(text).not.toContain(CONDUCT);
      expect(text).not.toContain(BIRTH);
      expect(text).not.toContain("Example Pathfinders");
    }
    expect(mocks.writeAuditLog.mock.calls.map(([entry]) => entry.metadata.templateKey)).toEqual(["club_tlt_application", "tlt_program_recommendation", "tlt_program_recommendation"]);
  });

  it("returns nothing when the audit row cannot be written", async () => {
    mocks.writeAuditLog.mockRejectedValue(new Error("audit down"));
    await expect(getSubmissionForViewer(director, "sub-1")).rejects.toThrow("audit down");
  });

  it("records the inbox opening with filter names and counts only, never the search text", async () => {
    const filters = parseTltFormsFilters({ q: "Riley Sample", form: "club_tlt_application", club: "club-a", person: "person-1" });
    await recordTltFormsInboxView(director, { filters, shown: 3, matching: 3, page: 1 });
    const [entry] = mocks.writeAuditLog.mock.calls[0]!;
    expect(entry).toMatchObject({ action: "TLT_FORM_INBOX_VIEWED", metadata: { rowsShown: 3, rowsMatching: 3, page: 1, filters: ["q", "form", "club", "person"], formKey: "club_tlt_application", organizationId: "club-a", actorAttendeeAccountId: "acct-tlt" } });
    expect(JSON.stringify(entry)).not.toContain("Riley");
  });

  it("refuses the inbox to any viewer that is not the TLT director", async () => {
    const filters = parseTltFormsFilters({});
    for (const viewer of [areaCoordinator, clubLeader, clubsAdmin, sysAdmin]) {
      await expect(readTltFormsInbox(viewer, filters, 1)).rejects.toThrow("TLT director");
      await expect(recordTltFormsInboxView(viewer, { filters, shown: 0, matching: 0, page: 1 })).rejects.toThrow("TLT director");
    }
    expect(mocks.submissionFindMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("the inbox list", () => {
  beforeEach(() => {
    mocks.templateFindMany.mockResolvedValue([{ key: "club_tlt_application", name: "TLT Application" }]);
    mocks.organizationFindMany.mockResolvedValue([{ id: "club-a", name: "Example Pathfinders", city: null, parentOrganization: null }]);
    mocks.submissionCount.mockResolvedValue(1);
    mocks.submissionFindMany.mockResolvedValue([]);
  });

  it("lists newest first, searches the name only and filters by form, club and person by id", async () => {
    await readTltFormsInbox(director, parseTltFormsFilters({ q: " Riley ", form: "club_tlt_application", club: "club-a", person: "person-1" }), 1);
    const call = mocks.submissionFindMany.mock.calls.at(-1)![0];
    expect(call.orderBy[0]).toEqual({ submittedAt: { sort: "desc", nulls: "last" } });
    expect(call.where).toMatchObject({
      organizationId: "club-a",
      template: { key: "club_tlt_application" },
      subjectName: { contains: "Riley", mode: "insensitive" },
      OR: [{ rosterMember: { personId: "person-1" } }, { rosterActionMember: { personId: "person-1" } }],
    });
    // Labels and ids only: the list query never selects an answer.
    expect(call.select).not.toHaveProperty("answers");
    expect(call.select).not.toHaveProperty("sealedSensitiveAnswers");
  });

  it("drops a form key outside the three before it reaches the query", () => {
    expect(parseTltFormsFilters({ form: "pathfinder_membership_application" }).form).toBe("");
  });
});

describe("the CSV (the staff export, reused)", () => {
  const rows = [{ clubYear: "2026-27", subjectName: NAME, templateVersion: templateRow("club_tlt_application").version, status: "SUBMITTED", submittedAt: new Date("2026-11-10T15:00:00Z"), enteredVia: "LINK", answers: { applicant_name: NAME }, unlistedClubName: null, organization: { name: "Example Pathfinders" } }];

  it("runs for the TLT director on a TLT form, without sensitive columns, and audits it", async () => {
    mocks.templateFindUnique.mockResolvedValue(templateRow("club_tlt_application"));
    mocks.submissionFindMany.mockResolvedValue(rows);
    const { csv } = await buildClubFormsCsv(director, { templateKey: "club_tlt_application" });
    expect(csv).toContain(NAME);
    expect(csv.split("\r\n")[0]).not.toMatch(/Conduct|Birth date/);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "CLUB_FORMS_EXPORTED",
      metadata: expect.objectContaining({ viewerKind: "TLT_DIRECTOR", actorAttendeeAccountId: "acct-tlt", templateKey: "club_tlt_application" }),
    }));
    expect(mocks.writeAuditLog.mock.calls[0]![0]).not.toHaveProperty("actorUserId");
  });

  it("keeps school type and church membership out of her view and file (Event Admin level)", () => {
    expect(viewerCanSeeSchoolDetails(director, "club-a")).toBe(false);
    expect(viewerCanSeeSchoolDetails(director, null)).toBe(false);
    expect(viewerCanSeeSchoolDetails(sysAdmin, null)).toBe(true);
  });

  it.each(["pathfinder_membership_application", "club_pathfinder_of_the_year", ""])("refuses %j for the TLT director, and any viewer but staff stays refused", async (key) => {
    await expect(buildClubFormsCsv(director, { templateKey: key })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const viewer of [areaCoordinator, clubLeader]) {
      await expect(buildClubFormsCsv(viewer, { templateKey: "club_tlt_application" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(mocks.submissionFindMany).not.toHaveBeenCalled();
  });
});
