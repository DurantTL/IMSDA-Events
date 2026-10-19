import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The club-list JSON on the club import page (#1038): a club only, no people,
 * no invites, no roster year. Invented club and church names only.
 */

type Org = { id: string; type: string; name: string; normalizedName: string; parentOrganizationId: string | null; isActive: boolean; city?: string | null; state?: string | null; createdAt?: Date };

const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
  rejectCrossOriginRequest: vi.fn(),
  requireSystemAdministrator: vi.fn(),
  orgs: [] as Array<Record<string, unknown>>,
  identityCreate: vi.fn(),
  rosterCreate: vi.fn(),
  personCreate: vi.fn(),
  inviteCreate: vi.fn(),
  queryRaw: vi.fn(),
  identityFindMany: vi.fn(),
  calls: [] as string[],
  seq: 0,
}));

const orgs = () => mocks.orgs as Org[];
const byCreated = (a: Org, b: Org) => (a.createdAt!.getTime() - b.createdAt!.getTime()) || a.id.localeCompare(b.id);

const client = {
  organization: {
    findMany: ({ where }: { where: { type: unknown; normalizedName?: { in: string[] } } }) => {
      mocks.calls.push("org.findMany");
      return Promise.resolve(orgs()
        .filter((org) => (typeof where.type === "string" ? org.type === where.type : (where.type as { in: string[] }).in.includes(org.type)) && (typeof where.type === "string" || org.isActive))
        .filter((org) => !where.normalizedName || where.normalizedName.in.includes(org.normalizedName))
        .sort(byCreated));
    },
    findFirst: ({ where }: { where: { type: string; normalizedName: string | { in: string[] } } }) => {
      mocks.calls.push("org.findFirst");
      const wanted = typeof where.normalizedName === "string" ? [where.normalizedName] : where.normalizedName.in;
      // Like the real query with orderBy createdAt, id: the oldest match.
      return Promise.resolve(orgs().filter((org) => org.type === where.type && wanted.includes(org.normalizedName)).sort(byCreated)[0] ?? null);
    },
    findUnique: ({ where }: { where: { id: string } }) => Promise.resolve(orgs().find((org) => org.id === where.id) ?? null),
    create: ({ data }: { data: Partial<Org> }) => {
      const created = { id: `club-${orgs().length + 1}`, isActive: true, parentOrganizationId: null, createdAt: new Date(++mocks.seq), ...data } as Org;
      mocks.orgs.push(created);
      return Promise.resolve(created);
    },
    update: ({ where, data }: { where: { id: string }; data: Partial<Org> }) => {
      Object.assign(orgs().find((org) => org.id === where.id)!, data);
      return Promise.resolve({});
    },
  },
  $executeRaw: (...args: unknown[]) => { mocks.calls.push("lock"); mocks.queryRaw(...args); return Promise.resolve([]); },
  externalIdentity: { findMany: mocks.identityFindMany, findUnique: () => Promise.resolve(null), create: mocks.identityCreate },
  clubRosterMember: { findMany: () => Promise.resolve([]), create: mocks.rosterCreate },
  person: { create: mocks.personCreate },
  clubInvite: { findFirst: () => Promise.resolve(null), create: mocks.inviteCreate },
  clubDirectorGrant: { findFirst: () => Promise.resolve(null) },
  $transaction: (work: (tx: unknown) => unknown) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/background-checks/refresh-after-write", () => ({ refreshBackgroundCheckMatchesSafely: vi.fn() }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/organizations/access", () => ({ requireSystemAdministrator: mocks.requireSystemAdministrator }));

import { POST as confirmRoute } from "@/app/api/admin/club-import/route";
import { POST as previewRoute } from "@/app/api/admin/club-import/preview/route";
import { AccessDeniedError } from "@/modules/access/authorization";
import { confirmPayload, type PreviewDraft } from "@/modules/club-imports/confirm-payload";
import { ClubImportParseError, clubMatchNames, parseClubImportFile, parseClubListExport, suggestChurches } from "@/modules/club-imports/domain";
import { annotateImportDrafts, importClubs } from "@/modules/club-imports/repository";
import { stateCode } from "@/modules/club-imports/domain";
import { clubImportConfirmSchema } from "@/modules/club-imports/schemas";

const now = new Date("2026-10-19T15:00:00Z");

const org = (id: string, type: string, name: string, extra: Partial<Org> = {}): Org => ({
  id, type, name, normalizedName: name.toLowerCase(), parentOrganizationId: null, isActive: true, city: null, state: null, createdAt: new Date(++mocks.seq), ...extra,
});

const club = (overrides: Record<string, unknown> = {}) => ({
  name: "Sample Hollow Pathfinders",
  type: "CLUB",
  isActive: true,
  sponsoringChurch: null,
  churchSearchHint: "Sample Hollow",
  state: null,
  namesOnSheet: { "2025-2026": "Sample Hollow Pathfinder Club" },
  checkNote: "Check the spelling",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.orgs.length = 0;
  mocks.calls.length = 0;
  mocks.identityFindMany.mockResolvedValue([]);
  mocks.orgs.push(
    org("church-1", "CHURCH", "Sample Hollow SDA Church", { city: "Sample Hollow", state: "IA" }),
    org("church-2", "CHURCH", "Pretend Ridge SDA Church", { city: "Pretend Ridge", state: "MO" }),
  );
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.requireSystemAdministrator.mockResolvedValue({ id: "admin-1" });
});

describe("club-list JSON validation and limits", () => {
  it("turns each club into a draft with no people and no invites", () => {
    const { drafts, skipped } = parseClubImportFile({ clubs: [club(), club({ name: "Pretend Ridge Pathfinders", isActive: false, unknownField: 1 })] }, now);
    expect(skipped).toBe(0);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ kind: "CLUB_LIST", clubName: "Sample Hollow Pathfinders", people: [], invites: [], checkNote: "Check the spelling", isActive: true, namesOnSheet: ["Sample Hollow Pathfinder Club"], churchName: "" });
    expect(drafts[1]!.isActive).toBe(false);
  });

  it("is detected by the top-level clubs array; an array is still the form 89 export", () => {
    expect(() => parseClubImportFile([], now)).toThrow(ClubImportParseError);
    expect(parseClubImportFile({ clubs: [club()] }, now).drafts[0]!.kind).toBe("CLUB_LIST");
  });

  it("refuses more than 500 clubs, a nameless club, and a state other than IA or MO", () => {
    expect(() => parseClubListExport({ clubs: Array.from({ length: 501 }, () => club()) }, now)).toThrow(/at most 500/);
    expect(parseClubListExport({ clubs: Array.from({ length: 500 }, () => club()) }, now).drafts).toHaveLength(500);
    expect(() => parseClubListExport({ clubs: [club(), club({ name: "" })] }, now)).toThrow(/Club 2/);
    expect(() => parseClubListExport({ clubs: [club({ state: "NE" })] }, now)).toThrow(ClubImportParseError);
    expect(() => parseClubListExport({ clubs: [] }, now)).toThrow(/No clubs/);
  });

  it("skips rows that are not clubs and accepts a null state and null church fields", () => {
    const { drafts, skipped } = parseClubListExport({ clubs: [club({ type: "SCHOOL" }), club({ state: null, churchSearchHint: null, checkNote: null, namesOnSheet: null })] }, now);
    expect(skipped).toBe(1);
    expect(drafts).toHaveLength(1);
  });

  it("refuses a club list over 1 MB at the preview route", async () => {
    const body = JSON.stringify({ clubs: [club({ checkNote: "x".repeat(1_000_100) })] });
    const response = await previewRoute(new Request("http://localhost/api/admin/club-import/preview", { method: "POST", body }));
    expect(response.status).toBe(413);
  });
});

describe("church suggestion", () => {
  const churches = [
    { id: "a", name: "Sample Hollow SDA Church", city: "Sample Hollow", state: "IA" },
    { id: "b", name: "Sample Hollow Fellowship Church", city: "Elsewhere", state: "MO" },
    { id: "c", name: "Pretend Ridge SDA Church", city: "Pretend Ridge", state: "MO" },
    { id: "d", name: "Riverside SDA Church", city: "Pretend Ridge", state: "MO" },
  ];

  it("preselects the one best match by name", () => {
    expect(suggestChurches("Pretend Ridge", null, churches)).toMatchObject({ status: "ONE", churchId: "c" });
  });

  it("matches the town when no name matches", () => {
    expect(suggestChurches("Elsewhere", null, churches)).toMatchObject({ status: "ONE", churchId: "b" });
    expect(suggestChurches("Hollow Fellowship", null, churches)).toMatchObject({ status: "ONE", churchId: "b" });
  });

  it("says pick one when several churches match in the best tier", () => {
    const twins = [...churches, { id: "e", name: "Sample Hollow Church", city: "Sample Hollow", state: "MO" }];
    // "Sample Hollow SDA Church" and "Sample Hollow Church" have the same stem.
    expect(suggestChurches("Sample Hollow", null, twins)).toMatchObject({ status: "SEVERAL", churchId: null, candidateIds: ["a", "e", "b"] });
    // A word that is only part of several names is also several.
    expect(suggestChurches("Sample", null, churches)).toMatchObject({ status: "SEVERAL", churchId: null, candidateIds: ["a", "b"] });
    // The state narrows the twins to one.
    expect(suggestChurches("Sample Hollow", "IA", twins)).toMatchObject({ status: "ONE", churchId: "a" });
  });

  it("reads state codes and full names, as the eAdventist import stores them", () => {
    expect(["IA", "ia", "Iowa", " Iowa. ", "MO", "Missouri"].map(stateCode)).toEqual(["IA", "IA", "IA", "IA", "MO", "MO"]);
    expect(stateCode("Nebraska")).toBeNull();
    expect(stateCode(null)).toBeNull();
    const spelled = [{ id: "i", name: "Sample Hollow SDA Church", city: "X", state: "Iowa" }, { id: "m", name: "Sample Hollow Church", city: "Y", state: "Missouri" }];
    expect(suggestChurches("Sample Hollow", "MO", spelled)).toMatchObject({ status: "ONE", churchId: "m" });
  });

  it("narrows by state", () => {
    expect(suggestChurches("Sample", "IA", churches)).toMatchObject({ status: "ONE", churchId: "a" });
    expect(suggestChurches("Sample", "MO", churches)).toMatchObject({ status: "ONE", churchId: "b" });
    expect(suggestChurches("Pretend Ridge", "IA", churches)).toMatchObject({ status: "NONE" });
  });

  it("says no match, and takes a sponsor named in the file when it is a directory sponsor", () => {
    expect(suggestChurches("Nowhere", null, churches)).toEqual({ churchId: null, candidateIds: [], status: "NONE" });
    expect(suggestChurches("", null, churches).status).toBe("NONE");
    expect(suggestChurches("Nowhere", null, churches, "d")).toMatchObject({ status: "GIVEN", churchId: "d" });
    expect(suggestChurches("Nowhere", null, churches, "unknown-id").status).toBe("NONE");
  });
});

describe("existing-club matching and preview", () => {
  it("matches by the club's own name and by older names on the sheet", async () => {
    mocks.orgs.push(org("club-old", "CLUB", "Sample Hollow Pathfinder Club", { parentOrganizationId: "church-1" }));
    const { drafts } = parseClubListExport({ clubs: [club(), club({ name: "Pretend Ridge Pathfinders", namesOnSheet: {}, churchSearchHint: "Pretend Ridge", state: "MO" })] }, now);
    const annotated = await annotateImportDrafts(drafts);
    expect(annotated.drafts[0]).toMatchObject({ churchId: "church-1", existingClub: { id: "club-old", hasSponsoringChurch: true, sponsorId: "church-1" } });
    expect(annotated.drafts[1]).toMatchObject({ churchId: "church-2", existingClub: null });
    expect(annotated.drafts.every((draft) => draft.newChurchName === "" && draft.people.length === 0)).toBe(true);
  });

  it("normalizes names, own name first, de-duplicated", () => {
    expect(clubMatchNames("Sample  Hollow Pathfinders", ["sample hollow pathfinders", "Older Name"])).toEqual(["sample hollow pathfinders", "older name"]);
  });
});

describe("confirm", () => {
  const preview = async (list: unknown[], edit: (draft: PreviewDraft, index: number) => PreviewDraft = (draft) => draft) => {
    const { drafts } = parseClubListExport({ clubs: list }, now);
    const annotated = await annotateImportDrafts(drafts);
    return annotated.drafts.map((draft, index) => edit({ ...draft, include: true } as PreviewDraft, index));
  };

  it("creates only the club for a draft with zero people: no roster, no invites, no external identity", async () => {
    const payload = clubImportConfirmSchema.parse(confirmPayload(await preview([club({ isActive: false })])));
    expect(payload.clubs[0]).toMatchObject({ kind: "CLUB_LIST", people: [], invites: [], churchId: "church-1", isActive: false });
    const [result] = await importClubs(payload.clubs, "admin-1", now);
    expect(result).toMatchObject({ status: "IMPORTED", kind: "CLUB_LIST", membersAdded: 0, invitesCreated: 0 });
    expect(orgs().find((o) => o.type === "CLUB")).toMatchObject({ name: "Sample Hollow Pathfinders", parentOrganizationId: "church-1", isActive: false });
    expect(mocks.personCreate).not.toHaveBeenCalled();
    expect(mocks.rosterCreate).not.toHaveBeenCalled();
    expect(mocks.inviteCreate).not.toHaveBeenCalled();
    expect(mocks.identityCreate).not.toHaveBeenCalled();
    const audit = mocks.writeAuditLog.mock.calls[0]![0];
    expect(audit).toMatchObject({ action: "CLUB_IMPORTED", actorUserId: "admin-1", metadata: { clubCreated: true, membersAdded: 0, invitesCreated: 0 } });
    expect(JSON.stringify(audit)).not.toMatch(/Sample Hollow|Check the spelling/);
  });

  it("is idempotent: confirming twice creates nothing new", async () => {
    const payload = clubImportConfirmSchema.parse(confirmPayload(await preview([club()])));
    await importClubs(payload.clubs, "admin-1", now);
    const [second] = await importClubs(payload.clubs, "admin-1", now);
    // The same payload again: the club now exists, which the preview did not know. Nothing new is made.
    expect(second).toMatchObject({ status: "FAILED" });
    expect(second.message).toMatch(/preview the file again/);
    const [fresh] = await importClubs(clubImportConfirmSchema.parse(confirmPayload(await preview([club()]))).clubs, "admin-1", now);
    expect(fresh).toMatchObject({ status: "ALREADY_IMPORTED" });
    expect(orgs().filter((o) => o.type === "CLUB")).toHaveLength(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it("links an existing club found by an older name without changing it", async () => {
    mocks.orgs.push(org("club-old", "CLUB", "Sample Hollow Pathfinder Club", { parentOrganizationId: "church-2" }));
    const payload = clubImportConfirmSchema.parse(confirmPayload(await preview([club()])));
    const [result] = await importClubs(payload.clubs, "admin-1", now);
    expect(result).toMatchObject({ status: "ALREADY_IMPORTED", organizationId: "club-old" });
    expect(orgs().filter((o) => o.type === "CLUB")).toHaveLength(1);
    expect(orgs().find((o) => o.id === "club-old")!.parentOrganizationId).toBe("church-2");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("changes an existing club's church only when update church is ticked", async () => {
    mocks.orgs.push(org("club-old", "CLUB", "Sample Hollow Pathfinders", { parentOrganizationId: "church-2" }));
    const untouched = clubImportConfirmSchema.parse(confirmPayload(await preview([club()])));
    await importClubs(untouched.clubs, "admin-1", now);
    expect(orgs().find((o) => o.id === "club-old")!.parentOrganizationId).toBe("church-2");

    const ticked = clubImportConfirmSchema.parse(confirmPayload(await preview([club()], (draft) => ({ ...draft, updateChurch: true }))));
    const [result] = await importClubs(ticked.clubs, "admin-1", now);
    expect(result.message).toMatch(/church was updated/);
    expect(orgs().find((o) => o.id === "club-old")!.parentOrganizationId).toBe("church-1");
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it("does not create a new club without a church, and lists it as skipped", async () => {
    const payload = clubImportConfirmSchema.parse(confirmPayload(await preview([club({ churchSearchHint: "Nowhere" })])));
    const [result] = await importClubs(payload.clubs, "admin-1", now);
    expect(result).toMatchObject({ status: "SKIPPED", organizationId: null });
    expect(orgs().filter((o) => o.type === "CLUB")).toHaveLength(0);
  });

  it("sends nothing for a row marked skip", async () => {
    const drafts = await preview([club(), club({ name: "Pretend Ridge Pathfinders", churchSearchHint: "Pretend Ridge" })], (draft, index) => ({ ...draft, include: index === 0 }));
    expect(confirmPayload(drafts).clubs.map((c) => c.clubName)).toEqual(["Sample Hollow Pathfinders"]);
  });

  it("refuses an inactive or non-sponsor church, and a club-list row that smuggles people or a new church", async () => {
    mocks.orgs.push(org("school-1", "SCHOOL", "Invented Academy"));
    const payload = clubImportConfirmSchema.parse(confirmPayload(await preview([club()], (draft) => ({ ...draft, churchId: "school-1" }))));
    const [result] = await importClubs(payload.clubs, "admin-1", now);
    expect(result.status).toBe("FAILED");
    const base = confirmPayload(await preview([club()])).clubs[0]!;
    expect(() => clubImportConfirmSchema.parse({ clubs: [{ ...base, people: [{ firstName: "A", lastName: "B", attendeeType: "YOUTH", role: "", classLevel: null, reportedAge: null }] }] })).toThrow();
    expect(() => clubImportConfirmSchema.parse({ clubs: [{ ...base, newChurchName: "Invented Church" }] })).toThrow();
  });
});

describe("system administrators only", () => {
  it("refuses non-admins at the preview and confirm routes before reading or writing anything", async () => {
    mocks.requireSystemAdministrator.mockRejectedValue(new AccessDeniedError("Only system administrators can do that.", 403, "PERMISSION_DENIED"));
    const preview = await previewRoute(new Request("http://localhost/api/admin/club-import/preview", { method: "POST", body: JSON.stringify({ clubs: [club()] }) }));
    expect(preview.status).toBe(403);
    const payload = confirmPayload([{ ...parseClubListExport({ clubs: [club()] }, now).drafts[0]!, include: true, churchId: "church-1" } as unknown as PreviewDraft]);
    const confirm = await confirmRoute(new Request("http://localhost/api/admin/club-import", { method: "POST", body: JSON.stringify(payload) }));
    expect(confirm.status).toBe(403);
    expect(orgs().filter((o) => o.type === "CLUB")).toHaveLength(0);
  });

  it("previews a club list for an administrator and writes nothing", async () => {
    const response = await previewRoute(new Request("http://localhost/api/admin/club-import/preview", { method: "POST", body: JSON.stringify({ clubs: [club()] }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ drafts: [{ kind: "CLUB_LIST", churchId: "church-1", existingClub: null }], skipped: 0 });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(orgs().filter((o) => o.type === "CLUB")).toHaveLength(0);
  });
});

describe("review fixes (#1038)", () => {
  const draftsFor = async (list: unknown[]) => {
    const annotated = await annotateImportDrafts(parseClubListExport({ clubs: list }, now).drafts);
    return annotated.drafts.map((draft) => ({ ...draft, include: true }) as unknown as PreviewDraft);
  };

  it("never gives a list row an 'already imported' state from a form 89 identity with the same number", async () => {
    mocks.identityFindMany.mockResolvedValue([{ externalId: "1", providerScope: "form-89:2026-27", organization: { id: "club-x", name: "Unrelated Club" } }]);
    const annotated = await annotateImportDrafts(parseClubListExport({ clubs: [club()] }, now).drafts);
    expect(annotated.drafts[0]!.importedYears).toEqual({});
    // Form 89 entries are still looked up; a list-only file asks for none.
    expect(mocks.identityFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { provider: "FLUENT_FORMS", externalId: { in: [] } } }));
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { ClubImportWorkspace } = await import("@/components/club-import-workspace");
    const html = renderToStaticMarkup(createElement(ClubImportWorkspace, { initialPreview: { drafts: annotated.drafts, churches: annotated.churches, clubYearChoices: [], skipped: 0 } }));
    expect(html).not.toContain("Already imported");
    expect(html).not.toContain(">Imported<");
  });

  it("takes the club's own name over an older name", async () => {
    mocks.orgs.push(org("club-older-name", "CLUB", "Sample Hollow Pathfinder Club"), org("club-own", "CLUB", "Sample Hollow Pathfinders"));
    const [draft] = (await annotateImportDrafts(parseClubListExport({ clubs: [club()] }, now).drafts)).drafts;
    expect(draft!.existingClub?.id).toBe("club-own");
    expect(draft!.ambiguousClubs).toEqual([]);
  });

  it("marks a row ambiguous when its older names match more than one club, and makes the administrator pick", async () => {
    mocks.orgs.push(org("club-a", "CLUB", "Sample Hollow Pathfinder Club"), org("club-b", "CLUB", "Sample Hollow Club"));
    const list = [club({ namesOnSheet: { a: "Sample Hollow Pathfinder Club", b: "Sample Hollow Club" } })];
    const drafts = await draftsFor(list);
    const draft = drafts[0] as unknown as { existingClub: unknown; ambiguousClubs: Array<{ id: string }> };
    expect(draft.existingClub).toBeNull();
    expect(draft.ambiguousClubs.map((candidate) => candidate.id)).toEqual(["club-a", "club-b"]);

    // Unpicked: confirm refuses, creating and changing nothing.
    const [refused] = await importClubs(clubImportConfirmSchema.parse(confirmPayload(drafts)).clubs, "admin-1", now);
    expect(refused).toMatchObject({ status: "FAILED" });
    expect(refused.message).toMatch(/more than one club/i);
    expect(orgs().filter((o) => o.type === "CLUB")).toHaveLength(2);

    // Picked: that club is linked.
    const picked = drafts.map((d) => ({ ...d, existingClub: (d as unknown as { ambiguousClubs: Array<{ id: string; sponsorId: string | null }> }).ambiguousClubs[1]! }));
    const [linked] = await importClubs(clubImportConfirmSchema.parse(confirmPayload(picked)).clubs, "admin-1", now);
    expect(linked).toMatchObject({ status: "ALREADY_IMPORTED", organizationId: "club-b" });
  });

  it("refuses when the directory resolves to a different club than the preview showed", async () => {
    const drafts = await draftsFor([club()]);
    expect(confirmPayload(drafts).clubs[0]).toMatchObject({ existingClubId: null });
    // A club with that name appears after the preview.
    mocks.orgs.push(org("club-late", "CLUB", "Sample Hollow Pathfinders", { parentOrganizationId: "church-2" }));
    const [result] = await importClubs(clubImportConfirmSchema.parse(confirmPayload(drafts)).clubs, "admin-1", now);
    expect(result).toMatchObject({ status: "FAILED", organizationId: null });
    expect(result.message).toMatch(/preview the file again/);
    expect(orgs().filter((o) => o.type === "CLUB")).toHaveLength(1);

    // And a previewed match that is gone or different is refused too.
    const stale = confirmPayload(drafts).clubs.map((c) => ({ ...c, existingClubId: "club-gone" }));
    const [gone] = await importClubs(clubImportConfirmSchema.parse({ clubs: stale }).clubs, "admin-1", now);
    expect(gone.status).toBe("FAILED");
  });

  it("takes the advisory lock for every matched name, sorted, before looking for the club", async () => {
    const drafts = await draftsFor([club({ namesOnSheet: { a: "Zeta Old Name", b: "Alpha Old Name" } })]);
    mocks.calls.length = 0;
    await importClubs(clubImportConfirmSchema.parse(confirmPayload(drafts)).clubs, "admin-1", now);
    expect(mocks.calls.slice(0, 5)).toEqual(["lock", "lock", "lock", "org.findFirst", "org.findMany"]);
    const keys = mocks.queryRaw.mock.calls.map(([, key]) => key);
    expect(keys).toEqual(["club-list-import:alpha old name", "club-list-import:sample hollow pathfinders", "club-list-import:zeta old name"]);
  });

  it("clears 'update church' unless an existing club has a different church", async () => {
    mocks.orgs.push(org("club-old", "CLUB", "Sample Hollow Pathfinders", { parentOrganizationId: "church-1" }));
    const [same] = await draftsFor([club()]);
    // The row's church equals the club's sponsor: the tick is ignored.
    expect(confirmPayload([{ ...same!, updateChurch: true }]).clubs[0]).toMatchObject({ updateChurch: false });
    // A renamed row has no existing club any more: a hidden tick is ignored.
    expect(confirmPayload([{ ...same!, existingClub: null, churchId: "church-2", updateChurch: true }]).clubs[0]).toMatchObject({ updateChurch: false });
    expect(confirmPayload([{ ...same!, churchId: "church-2", updateChurch: true }]).clubs[0]).toMatchObject({ updateChurch: true });
  });

  it("audits a church change with the previous and new church ids only", async () => {
    mocks.orgs.push(org("club-old", "CLUB", "Sample Hollow Pathfinders", { parentOrganizationId: "church-2" }));
    const drafts = (await draftsFor([club()])).map((d) => ({ ...d, updateChurch: true }));
    await importClubs(clubImportConfirmSchema.parse(confirmPayload(drafts)).clubs, "admin-1", now);
    expect(mocks.writeAuditLog.mock.calls[0]![0].metadata).toMatchObject({ churchUpdated: true, previousParentOrganizationId: "church-2", parentOrganizationId: "church-1" });
  });

  it("allows 500 club-list rows but only 400 form 89 rows", () => {
    const row = (kind: "CLUB_LIST" | "REGISTRATION", n: number) => ({ kind, sourceKey: kind === "CLUB_LIST" ? `club-list:${n}` : `form-89:${n}`, entryId: String(n), clubYear: "2026-27", clubName: "Sample Hollow Pathfinders", churchId: "church-1", newChurchName: "", invites: [], people: [] });
    expect(clubImportConfirmSchema.safeParse({ clubs: Array.from({ length: 500 }, (_, n) => row("CLUB_LIST", n)) }).success).toBe(true);
    expect(clubImportConfirmSchema.safeParse({ clubs: Array.from({ length: 401 }, (_, n) => row("REGISTRATION", n)) }).success).toBe(false);
    expect(clubImportConfirmSchema.safeParse({ clubs: Array.from({ length: 400 }, (_, n) => row("REGISTRATION", n)) }).success).toBe(true);
    expect(clubImportConfirmSchema.safeParse({ clubs: [...Array.from({ length: 400 }, (_, n) => row("CLUB_LIST", n)), row("REGISTRATION", 1)] }).success).toBe(false);
  });

  it("renders accessible church controls and list-only result text", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { ClubImportWorkspace } = await import("@/components/club-import-workspace");
    mocks.orgs.push(org("club-old", "CLUB", "Sample Hollow Pathfinders", { parentOrganizationId: "church-2" }));
    const annotated = await annotateImportDrafts(parseClubListExport({ clubs: [club({ churchSearchHint: "Nowhere" })] }, now).drafts);
    const html = renderToStaticMarkup(createElement(ClubImportWorkspace, { initialPreview: { drafts: annotated.drafts, churches: annotated.churches, clubYearChoices: [], skipped: 0 } }));
    expect(html).not.toContain('role="status"');
    expect(html).toMatch(/<select aria-describedby="club-import-church-note-0"(?![^>]*required)/);
    expect(html).toContain('value="__none__" selected');
    expect(html).not.toContain("Choose a church or company");
  });
});

describe("the club-list preview rows", () => {
  it("shows the note, the church picker with town and state, and no roster or invites", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { ClubImportWorkspace } = await import("@/components/club-import-workspace");
    mocks.orgs.push(org("club-old", "CLUB", "Sample Hollow Pathfinder Club", { parentOrganizationId: "church-2" }));
    const annotated = await annotateImportDrafts(parseClubListExport({ clubs: [club(), club({ name: "Lonely Pathfinders", churchSearchHint: "Nowhere", namesOnSheet: {} })] }, now).drafts);
    const html = renderToStaticMarkup(createElement(ClubImportWorkspace, { initialPreview: { drafts: annotated.drafts, churches: annotated.churches, clubYearChoices: annotated.clubYearChoices, skipped: 0 } }));
    expect(html).toContain("Already in the directory");
    expect(html).toContain("Check the spelling");
    expect(html).toContain("Sample Hollow SDA Church · Sample Hollow, IA");
    expect(html).toContain("No match, pick a church.");
    expect(html).toContain("Update church of the existing club");
    expect(html).not.toContain("Roster for");
    expect(html).not.toContain("Invites (sent later");
    expect(html).toMatch(/Import 2 clubs/);
  });
});
