import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1229: "Who fills it in": the seed defaults, the one helper, the sync that never overwrites staff, and the grouping. */
const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
  templateFindMany: vi.fn(),
  templateFindUnique: vi.fn(),
  templateUpdate: vi.fn(),
  templateUpdateMany: vi.fn(),
  queryRaw: vi.fn(),
}));

const client = {
  clubFormTemplate: { findMany: mocks.templateFindMany, findUnique: mocks.templateFindUnique, update: mocks.templateUpdate, updateMany: mocks.templateUpdateMany },
  clubFormTemplateVersion: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), createMany: vi.fn(async () => ({ count: 0 })) },
  $queryRaw: mocks.queryRaw,
  $transaction: (work: (tx: unknown) => unknown) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ SECRET_ENCRYPTION_KEY: "a-synthetic-encryption-key-for-club-form-tests" }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { clubFormTemplateSeeds, CLUB_FORM_FILL_MODES } from "@/modules/club-forms/definitions";
import { effectiveClubFormFillMode } from "@/modules/club-forms/domain";
import { groupClubFormsByFillMode } from "@/modules/club-forms/open-applications-domain";
import { listEnabledClubFormTemplates, setClubFormTemplateFillMode, syncClubFormTemplates } from "@/modules/club-forms/templates";

const defaults: Record<string, string> = {
  pathfinder_membership_application: "FAMILY",
  off_premises_permission_slip: "FAMILY",
  pathfinder_photo_video_release: "FAMILY",
  pathfinder_staff_service_information: "FAMILY",
  tlt_program_recommendation: "FAMILY",
  transportation_passenger_list: "CLUB",
  can_collecting_report: "CLUB",
  club_pathfinder_of_the_year: "CLUB",
  club_tlt_of_the_year: "CLUB",
  club_tlt_application: "OPEN_APPLICATION",
};

const rowFor = (seed: (typeof clubFormTemplateSeeds)[number], extra: Record<string, unknown> = {}) => ({
  id: `id-${seed.key}`, key: seed.key, version: seed.version, sensitiveFieldKeys: seed.sensitiveFieldKeys,
  birthDateFieldKeys: seed.birthDateFieldKeys, customizedAt: null, draftUpdatedAt: null, fillMode: null, fillModeChangedAt: null, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.templateUpdateMany.mockResolvedValue({ count: 1 });
  mocks.queryRaw.mockResolvedValue([]);
  mocks.writeAuditLog.mockResolvedValue({});
});

describe("the seeds' default fill modes (#1229)", () => {
  it("match the issue's table, and every seed has one", () => {
    expect(Object.fromEntries(clubFormTemplateSeeds.map((seed) => [seed.key, seed.fillMode]))).toEqual(defaults);
    for (const seed of clubFormTemplateSeeds) expect(CLUB_FORM_FILL_MODES).toContain(seed.fillMode);
  });

  it("are what a template with nothing stored uses; a stored value wins; an app-made template is FAMILY", () => {
    expect(effectiveClubFormFillMode(null, "club_tlt_application")).toBe("OPEN_APPLICATION");
    expect(effectiveClubFormFillMode(undefined, "can_collecting_report")).toBe("CLUB");
    expect(effectiveClubFormFillMode("FAMILY", "can_collecting_report")).toBe("FAMILY");
    expect(effectiveClubFormFillMode(null, "made_in_the_app")).toBe("FAMILY");
    expect(effectiveClubFormFillMode("SOMETHING_ELSE", "club_tlt_application")).toBe("OPEN_APPLICATION");
  });
});

describe("sync writes the seed's fill mode but never over a staff choice (#1229)", () => {
  it("writes the default where nothing is stored, only while staff have not changed it", async () => {
    mocks.templateFindMany.mockResolvedValue(clubFormTemplateSeeds.map((seed) => rowFor(seed)));
    await syncClubFormTemplates(client as never);
    expect(mocks.templateUpdateMany).toHaveBeenCalledTimes(clubFormTemplateSeeds.length);
    const tlt = clubFormTemplateSeeds.find((seed) => seed.key === "club_tlt_application")!;
    expect(mocks.templateUpdateMany).toHaveBeenCalledWith({ where: { id: `id-${tlt.key}`, fillModeChangedAt: null }, data: { fillMode: "OPEN_APPLICATION" } });
  });

  it("changes nothing when run again", async () => {
    mocks.templateFindMany.mockResolvedValue(clubFormTemplateSeeds.map((seed) => rowFor(seed, { fillMode: seed.fillMode })));
    await syncClubFormTemplates(client as never);
    expect(mocks.templateUpdateMany).not.toHaveBeenCalled();
  });

  it("leaves a value staff changed, even when it differs from the seed", async () => {
    const [first, ...others] = clubFormTemplateSeeds;
    mocks.templateFindMany.mockResolvedValue([
      rowFor(first, { fillMode: first.fillMode === "CLUB" ? "FAMILY" : "CLUB", fillModeChangedAt: new Date("2026-10-20T00:00:00Z") }),
      ...others.map((seed) => rowFor(seed, { fillMode: seed.fillMode })),
    ]);
    await syncClubFormTemplates(client as never);
    expect(mocks.templateUpdateMany).not.toHaveBeenCalled();
  });

  it("writes it for a template edited in the app too (a setting, not part of the definition), but never over staff", async () => {
    const [first, second, ...others] = clubFormTemplateSeeds;
    mocks.templateFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const seed = clubFormTemplateSeeds.find((candidate) => `id-${candidate.key}` === where.id)!;
      return { version: seed.version, sensitiveFieldKeys: seed.sensitiveFieldKeys, birthDateFieldKeys: seed.birthDateFieldKeys, customizedAt: new Date(), draftUpdatedAt: null };
    });
    mocks.templateFindMany.mockResolvedValue([
      rowFor(first, { customizedAt: new Date("2026-10-01T00:00:00Z"), fillMode: "CLUB" === first.fillMode ? "FAMILY" : "CLUB" }),
      rowFor(second, { customizedAt: new Date("2026-10-01T00:00:00Z"), fillMode: "CLUB" === second.fillMode ? "FAMILY" : "CLUB", fillModeChangedAt: new Date("2026-10-02T00:00:00Z") }),
      ...others.map((seed) => rowFor(seed, { fillMode: seed.fillMode })),
    ]);
    const result = await syncClubFormTemplates(client as never);
    expect(result.skipped.map((item) => item.key)).toEqual([first.key, second.key]);
    expect(mocks.templateUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.templateUpdateMany).toHaveBeenCalledWith({ where: { id: `id-${first.key}`, fillModeChangedAt: null }, data: { fillMode: first.fillMode } });
  });
});

describe("staff changing who fills a form in (#1229)", () => {
  it("records who and when, so sync leaves it alone, and audits the change without anything else", async () => {
    mocks.templateFindUnique.mockResolvedValue({ id: "template-1", fillMode: null });
    const when = new Date("2026-10-26T15:00:00Z");
    await expect(setClubFormTemplateFillMode("can_collecting_report", "FAMILY", "admin-1", when)).resolves.toEqual({ key: "can_collecting_report", fillMode: "FAMILY" });
    expect(mocks.templateUpdate).toHaveBeenCalledWith({ where: { id: "template-1" }, data: { fillMode: "FAMILY", fillModeChangedAt: when, fillModeChangedByUserId: "admin-1" } });
    expect(mocks.writeAuditLog.mock.calls[0][0]).toMatchObject({ actorUserId: "admin-1", action: "CLUB_FORM_FILL_MODE_CHANGED", metadata: { templateKey: "can_collecting_report", from: "CLUB", to: "FAMILY" } });
  });

  it("still records the choice, with no audit row, when it matches what is in effect", async () => {
    mocks.templateFindUnique.mockResolvedValue({ id: "template-1", fillMode: "CLUB" });
    await setClubFormTemplateFillMode("can_collecting_report", "CLUB", "admin-1");
    expect(mocks.templateUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("is not found for an unknown form", async () => {
    mocks.templateFindUnique.mockResolvedValue(null);
    await expect(setClubFormTemplateFillMode("nothing", "CLUB", "admin-1")).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
  });
});

describe("what a club is offered (#1229)", () => {
  it("lists the effective fill mode beside the name, nothing more", async () => {
    mocks.templateFindMany.mockResolvedValue([
      { key: "club_tlt_application", name: "TLT Application", description: "d", fillMode: null },
      { key: "can_collecting_report", name: "Can", description: "d", fillMode: "FAMILY" },
      { key: "made_in_the_app", name: "Mine", description: "d", fillMode: null },
    ]);
    expect((await listEnabledClubFormTemplates()).map((row) => [row.key, row.fillMode])).toEqual([
      ["club_tlt_application", "OPEN_APPLICATION"], ["can_collecting_report", "FAMILY"], ["made_in_the_app", "FAMILY"],
    ]);
  });

  it("splits into families and club forms, with open applications under club forms, and either may be empty", () => {
    const templates = [
      { key: "a", fillMode: "FAMILY" as const }, { key: "b", fillMode: "CLUB" as const }, { key: "c", fillMode: "OPEN_APPLICATION" as const }, { key: "d", fillMode: "FAMILY" as const },
    ];
    const groups = groupClubFormsByFillMode(templates);
    expect(groups.families.map((row) => row.key)).toEqual(["a", "d"]);
    expect(groups.club.map((row) => row.key)).toEqual(["b", "c"]);
    expect(groupClubFormsByFillMode(templates.filter((row) => row.fillMode === "FAMILY")).club).toEqual([]);
    expect(groupClubFormsByFillMode([]).families).toEqual([]);
  });
});
