import { beforeEach, describe, expect, it, vi } from "vitest";

/** How a filled outing slip reads to each kind of viewer (#1672): the club's questions show, and every sensitive key keeps today's handling. */
const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
  submissionFindFirst: vi.fn(),
  queryRaw: vi.fn(),
}));

const client = {
  clubFormTemplateVersion: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  clubFormSubmission: { findFirst: mocks.submissionFindFirst },
  $queryRaw: mocks.queryRaw,
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ SECRET_ENCRYPTION_KEY: "a-synthetic-encryption-key-for-club-form-tests", APP_BASE_URL: "https://events.imsda.test" }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import type { ClubFormsViewer } from "@/modules/club-forms/domain";
import { OUTING_QUESTIONS_SECTION_ID } from "@/modules/club-forms/outing-domain";
import { sealSensitiveAnswers } from "@/modules/club-forms/sealed-answers";
import { getSubmissionForViewer } from "@/modules/club-forms/submissions";

const director: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "ATTENDEE", accountId: "acct-1" } };
const deputy: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "ATTENDEE", accountId: "acct-3" } };
const otherDirector: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-b", actor: { kind: "ATTENDEE", accountId: "acct-9" } };
const areaCoordinator: ClubFormsViewer = { kind: "AREA_COORDINATOR", actor: { kind: "ATTENDEE", accountId: "acct-2" } };
const staff: ClubFormsViewer = { kind: "STAFF", userId: "staff-1", systemAdmin: true, clubsAdministrator: false, sensitiveAnswers: true };

const seed = clubFormTemplateSeeds.find((template) => template.key === "off_premises_permission_slip")!;
// A copy edited in the app that still seals a medical answer: the rule for sealed keys is the same on an outing's slip.
const SEALED_KEYS = ["physician_name"];
const PHYSICIAN = "Dr. Synthetic Physician";
const details = { activity: "Canoe trip", startDate: "2026-11-21", endDate: "", departureTime: "", returnTime: "", transportation: "Church van", cost: "", whatToBring: "", note: "" };
const questions = [{ label: "Can your child swim?", type: "YES_NO", required: true, options: [] }];

function row(status = "SUBMITTED") {
  return {
    id: "sub-1",
    organizationId: "club-a",
    clubYear: "2026-27",
    rosterMemberId: "member-1",
    subjectName: "Riley Sample",
    status,
    submittedAt: new Date("2026-11-10T15:00:00Z"),
    enteredVia: "LINK",
    answers: { child_name: "Riley Sample", activity: "Canoe trip", activity_date: "2026-11-21", ride_with: "Church van", outing_q_1: "Yes", emergency_contact_phone: "(515) 555-0111" },
    sealedSensitiveAnswers: sealSensitiveAnswers("sub-1", { physician_name: PHYSICIAN }),
    hasSensitiveAnswers: true,
    templateVersion: seed.version,
    rosterAction: null,
    rosterActionMemberId: null,
    rosterActionMember: null,
    link: { createdAs: "CLUB_LEADER", createdByAccount: { displayName: "Dana Director" }, createdByUser: null, outing: { details, questions } },
    unlistedClubName: null,
    organization: { name: "Example Pathfinders" },
    template: {
      id: "template-slip", key: seed.key, name: seed.name, description: seed.description, version: seed.version, definition: seed.definition, sectionNotes: seed.sectionNotes,
      sensitiveFieldKeys: SEALED_KEYS, birthDateFieldKeys: [], staffOnlyFieldKeys: [], hiddenFieldKeys: [], printLayout: seed.printLayout, rosterMapping: null, enabled: true, customizedAt: new Date("2026-11-01T00:00:00Z"),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeAuditLog.mockResolvedValue({});
  // A fake table that honors the organization and the submitted-only filter, like the real query.
  mocks.submissionFindFirst.mockImplementation(async ({ where }: { where: { organizationId?: string | { not: null }; status?: string } }) => {
    const found = row();
    if (typeof where.organizationId === "string" && where.organizationId !== found.organizationId) return null;
    if (where.status && where.status !== found.status) return null;
    return found;
  });
});

describe("opening a filled outing slip (#1672)", () => {
  it("shows the director and the deputy the preset answers, the club's questions in their own section, and the sealed answers", async () => {
    for (const viewer of [director, deputy]) {
      const view = await getSubmissionForViewer(viewer, "sub-1", "VIEW", "club-a");
      expect(view.answers).toMatchObject({ activity: "Canoe trip", activity_date: "2026-11-21", ride_with: "Church van", outing_q_1: "Yes", physician_name: PHYSICIAN });
      const sections = view.template.definition.sections.map((section) => section.id);
      expect(sections).toContain(OUTING_QUESTIONS_SECTION_ID);
      expect(sections.indexOf(OUTING_QUESTIONS_SECTION_ID)).toBe(sections.indexOf("sec_permission") + 1);
      expect(view.restrictedKeys).toEqual([]);
    }
  });

  it("shows an Area Coordinator the questions and the plain answers, with the sealed answer Restricted", async () => {
    const view = await getSubmissionForViewer(areaCoordinator, "sub-1");
    expect(view.answers).toMatchObject({ outing_q_1: "Yes", emergency_contact_phone: "(515) 555-0111" });
    expect(view.answers).not.toHaveProperty("physician_name");
    expect(view.restrictedKeys).toEqual(["physician_name"]);
    expect(JSON.stringify(view)).not.toContain(PHYSICIAN);
    expect(view.template.definition.sections.map((section) => section.id)).toContain(OUTING_QUESTIONS_SECTION_ID);
  });

  it("gives an Area Coordinator submitted slips only: a draft is not found", async () => {
    mocks.submissionFindFirst.mockImplementation(async ({ where }: { where: { status?: string } }) => (where.status === "SUBMITTED" ? null : row("DRAFT")));
    await expect(getSubmissionForViewer(areaCoordinator, "sub-1")).rejects.toMatchObject({ code: "SUBMISSION_NOT_FOUND" });
  });

  it("shows conference staff the slip per the matrix", async () => {
    const view = await getSubmissionForViewer(staff, "sub-1");
    expect(view.answers).toMatchObject({ outing_q_1: "Yes", physician_name: PHYSICIAN });
  });

  it("is not found for another club's director", async () => {
    await expect(getSubmissionForViewer(otherDirector, "sub-1", "VIEW", "club-a")).rejects.toMatchObject({ code: "CLUB_NOT_FOUND" });
    await expect(getSubmissionForViewer(otherDirector, "sub-1")).rejects.toMatchObject({ code: "SUBMISSION_NOT_FOUND" });
  });

  it("leaves an ordinary slip's definition alone", async () => {
    mocks.submissionFindFirst.mockImplementation(async () => ({ ...row(), link: { createdAs: "CLUB_LEADER", createdByAccount: null, createdByUser: null, outing: null } }));
    const view = await getSubmissionForViewer(director, "sub-1");
    expect(view.template.definition.sections.map((section) => section.id)).not.toContain(OUTING_QUESTIONS_SECTION_ID);
  });
});
