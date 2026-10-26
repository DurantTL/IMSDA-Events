import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1229: a club form's public open application. The submit goes through the same answer rules as a private link; the
 * club choice is an active club or "Not listed". Synthetic data only; the clock is pinned.
 */
const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
  templateFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  openYearFindUnique: vi.fn(),
  openYearUpsert: vi.fn(),
  submissionCreate: vi.fn(),
  submissionFindUnique: vi.fn(),
  organizationFindFirst: vi.fn(),
  organizationFindMany: vi.fn(),
  sendAlert: vi.fn(),
}));

const client = {
  clubFormTemplate: { findUnique: mocks.templateFindUnique },
  clubFormOpenLinkYear: { findUnique: mocks.openYearFindUnique, upsert: mocks.openYearUpsert },
  clubFormSubmission: { create: mocks.submissionCreate, findUnique: mocks.submissionFindUnique },
  organization: { findFirst: mocks.organizationFindFirst, findMany: mocks.organizationFindMany },
  $queryRaw: mocks.queryRaw,
  $executeRaw: mocks.executeRaw,
  $transaction: (work: (tx: unknown) => unknown) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ SECRET_ENCRYPTION_KEY: "a-synthetic-encryption-key-for-club-form-tests", APP_BASE_URL: "https://events.imsda.test" }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/notifications/settings", () => ({ isNotificationEnabled: async () => true }));
vi.mock("@/modules/club-forms/submission-alert", () => ({ sendClubFormSubmittedAlert: mocks.sendAlert }));

import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import {
  listClosedOpenApplicationKeys,
  resolveOpenApplication,
  setOpenApplicationClosed,
  submitOpenApplication,
} from "@/modules/club-forms/open-applications";
import {
  NOT_LISTED_CLUB,
  OPEN_APPLICATION_CLOSED_MESSAGE,
  OPEN_APPLICATION_OFF_MESSAGE,
  openApplicationSubmitSchema,
  withChosenClubAnswers,
  withoutClubDirectoryFields,
} from "@/modules/club-forms/open-applications-domain";

const now = new Date("2026-10-26T15:00:00Z");
const KEY = "club_tlt_application";
const seed = clubFormTemplateSeeds.find((candidate) => candidate.key === KEY)!;

function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: `template-${KEY}`,
    key: KEY,
    name: seed.name,
    description: seed.description,
    version: seed.version,
    definition: seed.definition,
    sectionNotes: seed.sectionNotes,
    sensitiveFieldKeys: seed.sensitiveFieldKeys,
    birthDateFieldKeys: seed.birthDateFieldKeys,
    staffOnlyFieldKeys: seed.staffOnlyFieldKeys,
    hiddenFieldKeys: [],
    printLayout: seed.printLayout,
    rosterMapping: null,
    fillMode: "OPEN_APPLICATION",
    enabled: true,
    customizedAt: null,
    draftUpdatedAt: null,
    ...overrides,
  };
}

const answers = {
  full_name: "Jordan Sample",
  email: "jordan@example.test",
  grade_coming_school_year: "10",
  mailing_address: { line1: "1 Example Road", locality: "Des Moines", region: "IA", postalCode: "50301", country: "US" },
  gender: "Female",
  club_name: "Example Pathfinders",
  years_in_club: 3,
  club_director_name: "Pat Director",
  club_director_email: "pat@example.test",
  meal_preference: "Neither",
  previous_conference_tlt_years: 0,
  why_conference_tlt: "To serve.",
  purpose_of_pathfinders: "To grow.",
  purpose_of_tlt_program: "To lead.",
  accuracy_acknowledgment: true,
  application_approved_acknowledgment: true,
};

const input = (overrides: Record<string, unknown> = {}) => openApplicationSubmitSchema.parse({
  organizationId: "club-a",
  idempotencyKey: "key-aaaaaaaa-0001",
  answers,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeAuditLog.mockResolvedValue({});
  mocks.templateFindUnique.mockImplementation(async () => templateRow());
  mocks.queryRaw.mockResolvedValue([]);
  mocks.executeRaw.mockResolvedValue(0);
  mocks.openYearFindUnique.mockResolvedValue(null);
  mocks.submissionCreate.mockResolvedValue({});
  mocks.submissionFindUnique.mockResolvedValue(null);
  mocks.organizationFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "club-a" ? { id: "club-a", name: "Example Pathfinders" } : null));
  // Honors `select`, like the database: the club list must ask for id and name and nothing else.
  mocks.organizationFindMany.mockImplementation(async ({ select }: { select: Record<string, boolean> }) => {
    const row: Record<string, string> = { id: "club-a", name: "Example Pathfinders", normalizedName: "example pathfinders" };
    return [Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]))];
  });
  mocks.sendAlert.mockResolvedValue(undefined);
});

describe("when an open application can be used (#1229)", () => {
  it("shows the form and the clubs as id and name only", async () => {
    const view = await resolveOpenApplication(KEY, now);
    expect(view.status).toBe("OPEN");
    if (view.status !== "OPEN") return;
    expect(view.clubs).toEqual([{ id: "club-a", name: "Example Pathfinders" }]);
    expect(mocks.organizationFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: "CLUB", isActive: true }, select: { id: true, name: true } }));
    expect(view.clubYear).toBe("2026-27");
  });

  it("says Not available yet when the form is turned off, and refuses a submit", async () => {
    mocks.templateFindUnique.mockImplementation(async () => templateRow({ enabled: false }));
    await expect(resolveOpenApplication(KEY, now)).resolves.toEqual({ status: "OFF", message: OPEN_APPLICATION_OFF_MESSAGE });
    expect(OPEN_APPLICATION_OFF_MESSAGE).toBe("Not available yet.");
    await expect(submitOpenApplication(KEY, input(), now)).rejects.toMatchObject({ code: "APPLICATION_OFF" });
    expect(mocks.submissionCreate).not.toHaveBeenCalled();
  });

  it("says the year is closed when staff closed the link, and refuses a submit", async () => {
    mocks.openYearFindUnique.mockResolvedValue({ closedAt: new Date("2026-10-20T00:00:00Z") });
    await expect(resolveOpenApplication(KEY, now)).resolves.toEqual({ status: "CLOSED", message: OPEN_APPLICATION_CLOSED_MESSAGE });
    expect(OPEN_APPLICATION_CLOSED_MESSAGE).toBe("Applications are closed for this club year.");
    expect(mocks.openYearFindUnique).toHaveBeenCalledWith({ where: { templateId_clubYear: { templateId: `template-${KEY}`, clubYear: "2026-27" } }, select: { closedAt: true } });
    await expect(submitOpenApplication(KEY, input(), now)).rejects.toMatchObject({ code: "APPLICATION_CLOSED" });
    expect(mocks.submissionCreate).not.toHaveBeenCalled();
  });

  it("is a 404 for an unknown key and for a form that is not an open application", async () => {
    mocks.templateFindUnique.mockResolvedValue(null);
    await expect(resolveOpenApplication("nothing_here", now)).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
    mocks.templateFindUnique.mockImplementation(async () => templateRow({ fillMode: "CLUB" }));
    await expect(resolveOpenApplication(KEY, now)).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
    await expect(submitOpenApplication(KEY, input(), now)).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
  });

  it("uses the code's default when no fill mode is stored", async () => {
    mocks.templateFindUnique.mockImplementation(async () => templateRow({ fillMode: null }));
    await expect(resolveOpenApplication(KEY, now)).resolves.toMatchObject({ status: "OPEN" });
  });
});

describe("submitting an open application (#1229)", () => {
  it("saves into the chosen club as an open-application submission with no link and no account", async () => {
    const result = await submitOpenApplication(KEY, input(), now);
    const data = mocks.submissionCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizationId: "club-a",
      unlistedClubName: null,
      enteredVia: "OPEN_APPLICATION",
      linkId: null,
      status: "SUBMITTED",
      clubYear: "2026-27",
      idempotencyKey: "key-aaaaaaaa-0001",
      subjectName: "Jordan Sample",
    });
    expect(data).not.toHaveProperty("enteredByAccountId");
    expect(result.confirmationMessage).toBe(seed.definition.confirmationMessage);
    expect(mocks.sendAlert).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "club-a", openApplication: true, actor: null }), true);
  });

  it("takes many submissions from the one link", async () => {
    for (let index = 0; index < 3; index += 1) {
      await submitOpenApplication(KEY, input({ idempotencyKey: `key-bbbbbbbb-000${index}` }), now);
    }
    expect(mocks.submissionCreate).toHaveBeenCalledTimes(3);
    const ids = mocks.submissionCreate.mock.calls.map((call) => call[0].data.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("refuses an id that is not an active club, and saves nothing", async () => {
    await expect(submitOpenApplication(KEY, input({ organizationId: "club-unknown" }), now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(mocks.organizationFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "club-unknown", type: "CLUB", isActive: true } }));
    expect(mocks.submissionCreate).not.toHaveBeenCalled();
    expect(mocks.sendAlert).not.toHaveBeenCalled();
  });

  it("files a Not listed club with no club and the typed name", async () => {
    await submitOpenApplication(KEY, input({ organizationId: NOT_LISTED_CLUB, unlistedClubName: "  Sample Valley Pathfinders " }), now);
    const data = mocks.submissionCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ organizationId: null, unlistedClubName: "Sample Valley Pathfinders", enteredVia: "OPEN_APPLICATION" });
    expect(mocks.organizationFindFirst).not.toHaveBeenCalled();
    expect(mocks.sendAlert).toHaveBeenCalledWith(expect.objectContaining({ organizationId: null, unlistedClubName: "Sample Valley Pathfinders" }), true);
  });

  it("requires a typed name for Not listed", () => {
    expect(() => openApplicationSubmitSchema.parse({ organizationId: NOT_LISTED_CLUB, idempotencyKey: "key-aaaaaaaa-0001", answers })).toThrow();
    expect(() => openApplicationSubmitSchema.parse({ organizationId: NOT_LISTED_CLUB, unlistedClubName: "   ", idempotencyKey: "key-aaaaaaaa-0001", answers })).toThrow();
    expect(() => openApplicationSubmitSchema.parse({ organizationId: NOT_LISTED_CLUB, unlistedClubName: "x".repeat(121), idempotencyKey: "key-aaaaaaaa-0001", answers })).toThrow();
  });

  it("limits the idempotency key to 8 to 100 safe characters and refuses extra fields", () => {
    expect(() => openApplicationSubmitSchema.parse({ organizationId: "club-a", idempotencyKey: "short", answers })).toThrow();
    expect(() => openApplicationSubmitSchema.parse({ organizationId: "club-a", idempotencyKey: "k".repeat(101), answers })).toThrow();
    expect(() => openApplicationSubmitSchema.parse({ organizationId: "club-a", idempotencyKey: "has spaces in it", answers })).toThrow();
    expect(() => openApplicationSubmitSchema.parse({ organizationId: "club-a", idempotencyKey: "key-aaaaaaaa-0001", answers, linkId: "x" })).toThrow();
  });

  it("sets the form's own club fields from the chosen club, over anything the client sent", async () => {
    await submitOpenApplication(KEY, input({ answers: { ...answers, club_name: "Sample Valley", club_name_other: "Somewhere Else" } }), now);
    const data = mocks.submissionCreate.mock.calls[0][0].data;
    expect(data.answers.club_name).toBe("Example Pathfinders");
    expect(data.answers).not.toHaveProperty("club_name_other");
  });

  it("sets Not listed and the typed name in the companion for a club that is not listed", async () => {
    mocks.organizationFindMany.mockImplementation(async () => [{ id: "club-a", name: "Example Pathfinders", normalizedName: "example pathfinders" }]);
    await submitOpenApplication(KEY, input({ organizationId: NOT_LISTED_CLUB, unlistedClubName: "Sample Valley Pathfinders", answers: { ...answers, club_name: "Example Pathfinders" } }), now);
    const data = mocks.submissionCreate.mock.calls[0][0].data;
    expect(data.answers).toMatchObject({ club_name: "Not listed", club_name_other: "Sample Valley Pathfinders" });
  });

  it("does not show the form's own club fields to the applicant", async () => {
    const view = await resolveOpenApplication(KEY, now);
    if (view.status !== "OPEN") throw new Error("expected open");
    const keys = view.form.definition.sections.flatMap((section) => section.fields.map((field) => field.key));
    expect(keys).not.toContain("club_name");
    expect(keys).not.toContain("club_name_other");
    expect(keys).toContain("years_in_club");
    expect(withoutClubDirectoryFields(seed.definition)).not.toBe(seed.definition);
    expect(withChosenClubAnswers(seed.definition, { club_name: "Other" }, { name: "Mine" })).toMatchObject({ club_name: "Mine" });
  });

  it("collapses control characters and whitespace in a typed club name, so it cannot add lines to an email", () => {
    const parsed = openApplicationSubmitSchema.parse({ organizationId: NOT_LISTED_CLUB, unlistedClubName: "  Sample\r\nBcc: x@example.test\t\u2028 Valley  ", idempotencyKey: "key-aaaaaaaa-0001", answers });
    expect(parsed.unlistedClubName).toBe("Sample Bcc: x@example.test Valley");
    expect(parsed.unlistedClubName).not.toMatch(/[\r\n\u2028]/);
    expect(() => openApplicationSubmitSchema.parse({ organizationId: NOT_LISTED_CLUB, unlistedClubName: "\n\t \r", idempotencyKey: "key-aaaaaaaa-0001", answers })).toThrow();
  });

  it("applies the same answer rules as a private link", async () => {
    const incomplete: Record<string, unknown> = { ...answers };
    delete incomplete.full_name;
    await expect(submitOpenApplication(KEY, input({ answers: incomplete }), now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(mocks.submissionCreate).not.toHaveBeenCalled();
  });

  it("returns the first result for the same idempotency key, with no second row", async () => {
    mocks.submissionFindUnique.mockResolvedValue({ id: "first-submission", templateId: `template-${KEY}` });
    const result = await submitOpenApplication(KEY, input(), now);
    expect(result).toMatchObject({ submissionId: "first-submission", replayed: true });
    expect(mocks.submissionCreate).not.toHaveBeenCalled();
    expect(mocks.sendAlert).not.toHaveBeenCalled();
  });

  it("handles two requests racing with the same key: the loser gets the winner's result", async () => {
    mocks.submissionFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "winner", templateId: `template-${KEY}` });
    mocks.submissionCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test", meta: { target: ["idempotencyKey"] } }));
    const result = await submitOpenApplication(KEY, input(), now);
    expect(result).toMatchObject({ submissionId: "winner", replayed: true });
    expect(mocks.sendAlert).not.toHaveBeenCalled();
  });

  it("does not hide any other error behind a replay", async () => {
    mocks.submissionCreate.mockRejectedValue(new Error("synthetic database failure"));
    await expect(submitOpenApplication(KEY, input(), now)).rejects.toThrow("synthetic database failure");
  });

  it("audits without answers, email addresses or the typed club name", async () => {
    await submitOpenApplication(KEY, input({ organizationId: NOT_LISTED_CLUB, unlistedClubName: "Sample Valley Pathfinders" }), now);
    const entry = mocks.writeAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({ action: "CLUB_FORM_APPLICATION_SUBMITTED", metadata: { organizationId: null, listed: false, templateKey: KEY } });
    const serialized = JSON.stringify(entry);
    for (const leaked of ["Jordan", "example.test", "Sample Valley", "Pat Director"]) expect(serialized, leaked).not.toContain(leaked);
  });

  it("refuses when the form is switched off or closed between reading and saving", async () => {
    let reads = 0;
    mocks.templateFindUnique.mockImplementation(async () => templateRow({ enabled: ++reads <= 1 }));
    await expect(submitOpenApplication(KEY, input(), now)).rejects.toMatchObject({ code: "APPLICATION_OFF" });
    expect(mocks.submissionCreate).not.toHaveBeenCalled();
  });
});

describe("closing and reopening for the club year (#1229)", () => {
  it("closes the current club year and audits who did it", async () => {
    mocks.templateFindUnique.mockResolvedValue({ id: `template-${KEY}`, fillMode: "OPEN_APPLICATION" });
    await expect(setOpenApplicationClosed(KEY, true, "admin-1", now)).resolves.toEqual({ key: KEY, clubYear: "2026-27", closed: true });
    expect(mocks.openYearUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { templateId_clubYear: { templateId: `template-${KEY}`, clubYear: "2026-27" } },
      update: { closedAt: now, closedByUserId: "admin-1" },
    }));
    expect(mocks.writeAuditLog.mock.calls[0][0]).toMatchObject({ actorUserId: "admin-1", action: "CLUB_FORM_OPEN_LINK_CLOSED", metadata: { templateKey: KEY, clubYear: "2026-27" } });
  });

  it("reopens a closed year, and does nothing (no audit) when the state is unchanged", async () => {
    mocks.templateFindUnique.mockResolvedValue({ id: `template-${KEY}`, fillMode: "OPEN_APPLICATION" });
    mocks.openYearFindUnique.mockResolvedValue({ closedAt: new Date("2026-10-20T00:00:00Z") });
    await setOpenApplicationClosed(KEY, false, "admin-1", now);
    expect(mocks.openYearUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { closedAt: null, closedByUserId: null } }));
    expect(mocks.writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "CLUB_FORM_OPEN_LINK_REOPENED" });
    mocks.writeAuditLog.mockClear();
    mocks.openYearUpsert.mockClear();
    await setOpenApplicationClosed(KEY, true, "admin-1", now).then(() => setOpenApplicationClosed(KEY, true, "admin-1", now));
    expect(mocks.openYearUpsert).toHaveBeenCalledTimes(0);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("only applies to a form that is an open application", async () => {
    mocks.templateFindUnique.mockResolvedValue({ id: "template-x", fillMode: "FAMILY" });
    await expect(setOpenApplicationClosed("pathfinder_membership_application", true, "admin-1", now)).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
  });

  it("lists the closed forms for the admin page by key", async () => {
    (client.clubFormOpenLinkYear as Record<string, unknown>).findMany = vi.fn(async () => [{ template: { key: KEY } }]);
    await expect(listClosedOpenApplicationKeys(now)).resolves.toEqual(new Set([KEY]));
  });
});
