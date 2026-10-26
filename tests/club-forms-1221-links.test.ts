import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1221: the six new club forms through the private-link flow (the filler sees nothing of the club but its name),
 * and an Area Coordinator sending a link for any club. Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
  templateFindFirst: vi.fn(),
  templateFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  linkCreate: vi.fn(),
  linkUpdate: vi.fn(),
  linkUpdateMany: vi.fn(),
  linkFindUnique: vi.fn(),
  submissionCreate: vi.fn(),
  submissionFindMany: vi.fn(),
  outboxCreate: vi.fn(),
  organizationFindUnique: vi.fn(),
  organizationFindMany: vi.fn(),
  configured: vi.fn(),
}));

const client = {
  clubFormTemplate: { findFirst: mocks.templateFindFirst, findUnique: mocks.templateFindUnique },
  $queryRaw: mocks.queryRaw,
  $executeRaw: mocks.executeRaw,
  clubFormLink: { create: mocks.linkCreate, update: mocks.linkUpdate, updateMany: mocks.linkUpdateMany, findUnique: mocks.linkFindUnique },
  clubFormSubmission: { create: mocks.submissionCreate, findMany: mocks.submissionFindMany },
  messageOutbox: { create: mocks.outboxCreate },
  organization: { findUnique: mocks.organizationFindUnique, findMany: mocks.organizationFindMany },
  $transaction: (work: (tx: unknown) => unknown) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ SECRET_ENCRYPTION_KEY: "a-synthetic-encryption-key-for-club-form-tests", APP_BASE_URL: "https://events.imsda.test" }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/communications/account-email", () => ({
  isAccountEmailConfigured: mocks.configured,
  getAccountEmailSender: () => ({ name: "IMSDA Events", address: "events@example.test", replyTo: null }),
}));

import { hashOpaqueToken } from "@/modules/access/tokens";
import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import {
  viewerCanSeeClub,
  viewerCanSendLinkForClub,
  viewerCanWriteForClub,
  type ClubFormsViewer,
} from "@/modules/club-forms/domain";
import { createClubFormLink, listClubFormLinks, resolveClubFormLinkForFill, submitClubFormViaLink } from "@/modules/club-forms/links";
import { listSubmissionsForViewer } from "@/modules/club-forms/submissions";

const now = new Date("2026-10-05T15:00:00Z");
const TOKEN = "R".repeat(43);
const director: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "ATTENDEE", accountId: "acct-1" } };
const otherDirector: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-b", actor: { kind: "ATTENDEE", accountId: "acct-9" } };
const coordinator: ClubFormsViewer = { kind: "AREA_COORDINATOR", actor: { kind: "ATTENDEE", accountId: "acct-2" } };
const actingCoordinator: ClubFormsViewer = { kind: "AREA_COORDINATOR", actor: { kind: "STAFF_ACTING", userId: "admin-1", actAsId: "act-2" } };
const staff: ClubFormsViewer = { kind: "STAFF", userId: "staff-1", systemAdmin: true, clubsAdministrator: false, sensitiveAnswers: true };

function templateRow(key: string, enabled = true) {
  const seed = clubFormTemplateSeeds.find((template) => template.key === key);
  if (!seed) throw new Error("missing seed");
  return {
    id: `template-${key}`,
    key,
    name: seed.name,
    description: seed.description,
    version: seed.version,
    definition: seed.definition,
    sectionNotes: seed.sectionNotes,
    sensitiveFieldKeys: seed.sensitiveFieldKeys,
    birthDateFieldKeys: seed.birthDateFieldKeys,
    staffOnlyFieldKeys: seed.staffOnlyFieldKeys,
    printLayout: seed.printLayout,
    enabled,
  };
}

function openLink(key: string) {
  return {
    id: "link-1",
    status: "OPEN",
    expiresAt: new Date("2026-10-19T15:00:00Z"),
    tokenHash: hashOpaqueToken(TOKEN),
    organizationId: "club-a",
    rosterMemberId: null,
    subjectName: "Label only the director sees",
    clubYear: "2026-27",
    organization: { name: "Example Pathfinders", isActive: true, type: "CLUB" },
    template: templateRow(key),
  };
}

const recommendationAnswers = {
  applicant_name: "Jordan Sample",
  recommender_name: "Casey Sample",
  recommender_email: "casey@example.test",
  known_how_long: "Their camp counselor for three summers.",
  qualities: "Steady and kind.",
  relates_to_people: "Warmly.",
  responds_to_stress: "Calmly.",
  honest_evaluation: true,
  signature: "Casey Sample",
};

const releaseAnswers = {
  minor_name: "Riley Sample",
  minor_signature: "Riley Sample",
  guardian_signature: "Pat Sample",
  release_date: "2020-01-01",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeAuditLog.mockResolvedValue({});
  mocks.configured.mockReturnValue(true);
  mocks.organizationFindUnique.mockResolvedValue({ type: "CLUB", isActive: true, name: "Example Pathfinders" });
  mocks.organizationFindMany.mockResolvedValue([]);
  mocks.templateFindFirst.mockResolvedValue(templateRow("tlt_program_recommendation"));
  mocks.templateFindUnique.mockReset();
  mocks.templateFindUnique.mockResolvedValue(templateRow("tlt_program_recommendation"));
  mocks.executeRaw.mockReset();
  mocks.executeRaw.mockResolvedValue(0);
  mocks.queryRaw.mockReset();
  mocks.queryRaw.mockResolvedValue([]);
  mocks.linkCreate.mockResolvedValue({ id: "link-1" });
  mocks.linkUpdate.mockResolvedValue({});
  mocks.linkUpdateMany.mockResolvedValue({ count: 1 });
  mocks.outboxCreate.mockResolvedValue({ id: "message-1" });
  mocks.submissionCreate.mockResolvedValue({});
  mocks.linkFindUnique.mockResolvedValue(openLink("tlt_program_recommendation"));
});

describe("the TLT recommendation through a private link (#1221)", () => {
  it("shows the person only the club's name and the form, never the applicant's application or any other club data", async () => {
    const view = await resolveClubFormLinkForFill(TOKEN, now);
    expect(view.clubName).toBe("Example Pathfinders");
    expect(view.form.key).toBe("tlt_program_recommendation");
    const serialized = JSON.stringify(view);
    for (const leaked of ["Label only the director sees", "club-a", "link-1", "recipientEmail", "acct-1", "Jordan"]) {
      expect(serialized, leaked).not.toContain(leaked);
    }
  });

  it("stores the recommendation in the link's club as a private-link submission, with nobody credited", async () => {
    await submitClubFormViaLink(TOKEN, recommendationAnswers, now);
    const data = mocks.submissionCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ organizationId: "club-a", enteredVia: "LINK", linkId: "link-1", status: "SUBMITTED", hasSensitiveAnswers: false });
    expect(data).not.toHaveProperty("enteredByAccountId");
    expect(data.answers.recommender_name).toBe("Casey Sample");
  });

  it("refuses an incomplete recommendation, so the required questions are required", async () => {
    const missing: Record<string, unknown> = { ...recommendationAnswers };
    delete missing.honest_evaluation;
    await expect(submitClubFormViaLink(TOKEN, missing, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(mocks.submissionCreate).not.toHaveBeenCalled();
  });

  it("works once: a spent link is refused and nothing is stored", async () => {
    mocks.linkUpdateMany.mockResolvedValue({ count: 0 });
    await expect(submitClubFormViaLink(TOKEN, recommendationAnswers, now)).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
    expect(mocks.submissionCreate).not.toHaveBeenCalled();
  });

  it("has no viewer who is the applicant: only the club's leaders, Area Coordinators and conference staff are viewers", () => {
    // The applicant only ever holds a private link to their own application; `ClubFormsViewer` has no applicant kind.
    const kinds = [director, coordinator, staff].map((viewer) => viewer.kind);
    expect(kinds).toEqual(["CLUB_LEADER", "AREA_COORDINATOR", "STAFF"]);
    // Another club's director cannot read this club's forms.
    expect(viewerCanSeeClub(otherDirector, "club-a")).toBe(false);
    expect(viewerCanSeeClub(coordinator, "club-a")).toBe(true);
    expect(viewerCanSeeClub(staff, "club-a")).toBe(true);
  });
});

describe("the photo and video release through a private link (#1221)", () => {
  beforeEach(() => {
    mocks.templateFindFirst.mockResolvedValue(templateRow("pathfinder_photo_video_release"));
    mocks.templateFindUnique.mockResolvedValue(templateRow("pathfinder_photo_video_release"));
    mocks.linkFindUnique.mockResolvedValue(openLink("pathfinder_photo_video_release"));
  });

  it("shows the release text and nothing else about the club", async () => {
    const view = await resolveClubFormLinkForFill(TOKEN, now);
    expect(view.form.sectionNotes.sec_release.join(" ")).toMatch(/^I hereby grant permission/);
    const serialized = JSON.stringify(view);
    for (const leaked of ["Label only the director sees", "club-a", "link-1", "acct-1"]) expect(serialized, leaked).not.toContain(leaked);
  });

  it("sets the date on the server over whatever was sent, and never asks for the club director's email", async () => {
    await submitClubFormViaLink(TOKEN, releaseAnswers, now);
    const data = mocks.submissionCreate.mock.calls[0][0].data;
    expect(data.answers.release_date).toBe("2026-10-05");
    expect(data).toMatchObject({ organizationId: "club-a", enteredVia: "LINK" });
    const keys = Object.keys(templateRow("pathfinder_photo_video_release").definition.sections.flatMap((section) => section.fields).map((field) => field.key));
    expect(keys.length).toBe(5);
    expect(JSON.stringify(templateRow("pathfinder_photo_video_release").definition)).not.toMatch(/director.s email/i);
  });

  it("requires the minor's name and both typed signatures", async () => {
    for (const key of ["minor_name", "minor_signature", "guardian_signature"]) {
      const answers: Record<string, unknown> = { ...releaseAnswers };
      delete answers[key];
      await expect(submitClubFormViaLink(TOKEN, answers, now), key).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expect(mocks.submissionCreate).not.toHaveBeenCalled();
  });
});

describe("an Area Coordinator sending a link (#1221)", () => {
  const input = { organizationId: "club-b", templateKey: "tlt_program_recommendation", recipientEmail: "Casey@Example.test" };

  it("is allowed for any club, creates the link in that club, and records who sent it and as what", async () => {
    await createClubFormLink(coordinator, input, now);
    const link = mocks.linkCreate.mock.calls[0][0].data;
    expect(link).toMatchObject({ organizationId: "club-b", createdByAccountId: "acct-2", createdAs: "AREA_COORDINATOR", recipientEmail: "casey@example.test" });
    expect(mocks.outboxCreate).toHaveBeenCalledTimes(1);
    const audit = mocks.writeAuditLog.mock.calls[0][0];
    expect(audit).toMatchObject({ action: "CLUB_FORM_LINK_CREATED", metadata: { viewerKind: "AREA_COORDINATOR", organizationId: "club-b" } });
    expect(JSON.stringify(audit)).not.toContain("example.test");
  });

  it("credits a system administrator acting as a coordinator to the staff user", async () => {
    await createClubFormLink(actingCoordinator, input, now);
    expect(mocks.linkCreate.mock.calls[0][0].data).toMatchObject({ createdByUserId: "admin-1", createdAs: "AREA_COORDINATOR" });
    expect(mocks.linkCreate.mock.calls[0][0].data).not.toHaveProperty("createdByAccountId");
  });

  it("records a director's link as sent by the director", async () => {
    await createClubFormLink(director, { ...input, organizationId: "club-a" }, now);
    expect(mocks.linkCreate.mock.calls[0][0].data).toMatchObject({ createdByAccountId: "acct-1", createdAs: "CLUB_LEADER" });
  });

  it("refuses a form that is turned off, with nothing created", async () => {
    mocks.templateFindFirst.mockResolvedValue(null);
    await expect(createClubFormLink(coordinator, input, now)).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
    expect(mocks.linkCreate).not.toHaveBeenCalled();
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("refuses an inactive or unknown club", async () => {
    mocks.organizationFindUnique.mockResolvedValue({ type: "CLUB", isActive: false, name: "Example Pathfinders" });
    await expect(createClubFormLink(coordinator, input, now)).rejects.toMatchObject({ code: "CLUB_NOT_FOUND" });
    mocks.organizationFindUnique.mockResolvedValue(null);
    await expect(createClubFormLink(coordinator, input, now)).rejects.toMatchObject({ code: "CLUB_NOT_FOUND" });
    expect(mocks.linkCreate).not.toHaveBeenCalled();
  });

  it("keeps the director's rules: working email is needed, and another club's director or staff still cannot send", async () => {
    mocks.configured.mockReturnValue(false);
    await expect(createClubFormLink(coordinator, input, now)).rejects.toMatchObject({ code: "EMAIL_NOT_CONFIGURED" });
    mocks.configured.mockReturnValue(true);
    for (const viewer of [otherDirector, staff]) {
      await expect(createClubFormLink(viewer, { ...input, organizationId: "club-a" }, now)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(mocks.linkCreate).not.toHaveBeenCalled();
  });

  it("uses the same expiry as the director's path", async () => {
    const result = await createClubFormLink(coordinator, { ...input, expiresInDays: 400 }, now);
    expect(result.expiresAt).toEqual(new Date("2026-11-04T15:00:00Z"));
  });

  it("keeps the one send rule in one place, without widening writing or the link list", async () => {
    expect(viewerCanSendLinkForClub(coordinator, "any-club")).toBe(true);
    expect(viewerCanSendLinkForClub(director, "club-a")).toBe(true);
    expect(viewerCanSendLinkForClub(director, "club-b")).toBe(false);
    expect(viewerCanSendLinkForClub(staff, "club-a")).toBe(false);
    // Filling a form in for a member, and the director's list of links, stay with the club's own leaders.
    expect(viewerCanWriteForClub(coordinator, "club-a")).toBe(false);
    await expect(listClubFormLinks(coordinator, "club-a", now)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the new forms reach the coordinator and staff views without a hard-coded form list (#1221)", () => {
  it("lists submissions for an Area Coordinator and for staff by club and status only, never by a set of form keys", async () => {
    mocks.submissionFindMany.mockResolvedValue([]);
    await listSubmissionsForViewer(coordinator, { organizationId: "club-a" });
    await listSubmissionsForViewer(staff, {});
    for (const [call] of mocks.submissionFindMany.mock.calls) {
      expect(call.where).not.toHaveProperty("template");
      expect(call.where.status).toBe("SUBMITTED");
    }
    expect(mocks.submissionFindMany.mock.calls[0][0].where.organizationId).toBe("club-a");
  });

  it("keeps a director to their own club's forms", async () => {
    mocks.submissionFindMany.mockResolvedValue([]);
    await listSubmissionsForViewer(director, {});
    expect(mocks.submissionFindMany.mock.calls[0][0].where.organizationId).toBe("club-a");
    await expect(listSubmissionsForViewer(director, { organizationId: "club-b" })).rejects.toMatchObject({ code: "CLUB_NOT_FOUND" });
  });
});
