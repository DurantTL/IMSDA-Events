import { beforeEach, describe, expect, it, vi } from "vitest";
import { formTemplates, registrationFormDefinitionSchema } from "@/modules/forms/definition";

/**
 * Add a club and confirm the team (#1031), against an in-memory stand-in for the database. The stand-in's "transaction" is the
 * registration's own: the fake `submitPublicRegistration` runs the caller's hooks in it and undoes every write when one throws,
 * which is the guarantee the real Serializable transaction gives. The real DB run is in scripts/verify-general-link-registration.ts.
 */

const pbe = registrationFormDefinitionSchema.parse(formTemplates.find((template) => template.key === "pbe_registration")!.definition);

type Org = { id: string; type: string; name: string; isActive: boolean; parentOrganizationId: string | null; normalizedName?: string };
type State = {
  orgs: Map<string, Org>;
  audits: Array<{ action: string; entityId?: string; eventId?: string; summary: string; metadata?: Record<string, unknown> }>;
  registrations: Map<string, string>;
  submission: { status: "PENDING" | "CONFIRMED"; organizationId: string | null; registrationId: string | null; resolution: string | null };
};

const mocks = vi.hoisted(() => ({ state: null as unknown as State, failRegistration: false }));

function freshState(): State {
  return {
    orgs: new Map([
      ["church-1", { id: "church-1", type: "CHURCH", name: "Synthetic Church One", isActive: true, parentOrganizationId: null }],
      ["church-2", { id: "church-2", type: "CHURCH", name: "Synthetic Church Two", isActive: true, parentOrganizationId: null }],
      ["church-off", { id: "church-off", type: "CHURCH", name: "Closed Church", isActive: false, parentOrganizationId: null }],
      ["club-near", { id: "club-near", type: "CLUB", name: "Riverbend Pathfinders", isActive: true, parentOrganizationId: "church-2" }],
      ["club-same", { id: "club-same", type: "CLUB", name: "Eagle Ridge Pathfinders", isActive: true, parentOrganizationId: "church-1" }],
    ]),
    audits: [],
    registrations: new Map(),
    submission: { status: "PENDING", organizationId: null, registrationId: null, resolution: null },
  };
}

function makeTx() {
  const { state } = mocks;
  return {
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const org = state.orgs.get(where.id);
        if (!org) return null;
        const parent = org.parentOrganizationId ? state.orgs.get(org.parentOrganizationId) : null;
        return { ...org, parentOrganization: parent ? { name: parent.name, isActive: parent.isActive, type: parent.type } : null };
      },
      findFirst: async ({ where }: { where: { id: string } }) => {
        const org = state.orgs.get(where.id);
        return org && org.isActive && ["CHURCH", "COMPANY", "GROUP"].includes(org.type) ? { id: org.id, churchLocation: { city: "Synthville", state: "XX" } } : null;
      },
      findMany: async () => [...state.orgs.values()].filter((org) => org.type === "CLUB" && org.isActive).map((org) => ({
        id: org.id, name: org.name, parentOrganization: org.parentOrganizationId ? { id: org.parentOrganizationId, name: state.orgs.get(org.parentOrganizationId)!.name, churchLocation: null } : null,
      })),
      create: async ({ data }: { data: Org }) => {
        state.orgs.set(data.id, { ...data });
        return { ...data };
      },
    },
    auditLog: { create: async ({ data }: { data: State["audits"][number] }) => { state.audits.push(data); return data; } },
    generalLinkSubmission: {
      updateMany: async ({ where, data }: { where: { status: string }; data: Partial<State["submission"]> }) => {
        if (mocks.state.submission.status !== where.status) return { count: 0 };
        Object.assign(mocks.state.submission, data);
        return { count: 1 };
      },
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    generalLinkSubmission: {
      findFirst: async () => ({
        id: "sub-1", status: mocks.state.submission.status, organizationId: mocks.state.submission.organizationId, registrationId: mocks.state.submission.registrationId,
        suggestedOrganizationId: null, idempotencyKey: "key-1", teamName: "Bible Bees", teamKey: "bible bees", locationId: null, createdAt: new Date("2026-10-19T12:00:00Z"),
        directorEmail: "director@example.test", directorName: "Synthetic Director", confirmationCode: "PBE-TEST",
        payload: mocks.state.submission.status === "PENDING" ? { versionId: "v1", responses: { club_name: "Not listed", club_name_other: "Synthetic Trailblazers" }, attendees: [{ clientId: "p1", responses: { first_name: "Alex", last_name: "Synthetic", attendee_age: 14, attendee_type: "Pathfinder" } }] } : null,
        organization: mocks.state.submission.organizationId ? { name: mocks.state.orgs.get(mocks.state.submission.organizationId)?.name ?? "" } : null,
        event: { slug: "pbe-2027", name: "Synthetic PBE" },
      }),
      findUnique: async () => ({ status: mocks.state.submission.status, organizationId: mocks.state.submission.organizationId, registrationId: mocks.state.submission.registrationId }),
    },
    organization: makeTx().organization,
  }),
}));
vi.mock("@/modules/club-registrations/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/club-registrations/repository")>()),
  publishedClubForm: async () => ({ slug: "pbe" }),
}));
vi.mock("@/modules/club-teams/settings-repository", () => ({ getTeamSettings: async () => null }));
vi.mock("@/modules/forms/public-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/forms/public-repository")>()),
  getPublicRegistrationExperience: async () => ({ form: { versionId: "v1", definition: pbe } }),
  submitPublicRegistration: async (_slug: string, _form: string, input: { idempotencyKey: string; attendees?: unknown[] }, _now: Date, bulk: {
    prepareAttendees: (tx: unknown, args: unknown) => Promise<unknown>;
    inTransaction: (tx: unknown, created: { registrationId: string; confirmationCode: string; waitlisted: boolean }) => Promise<void>;
  }) => {
    const before = { orgs: new Map(mocks.state.orgs), audits: [...mocks.state.audits], registrations: new Map(mocks.state.registrations), submission: { ...mocks.state.submission } };
    const tx = makeTx();
    try {
      await bulk.prepareAttendees(tx, { definition: pbe, event: { id: "event-1", startsAt: new Date("2027-03-01T00:00:00Z"), timezone: "UTC" }, input });
      if (mocks.state.registrations.has(input.idempotencyKey)) return; // a replay: nothing new commits
      if (mocks.failRegistration) throw new Error("registration refused");
      mocks.state.registrations.set(input.idempotencyKey, "reg-1");
      await bulk.inTransaction(tx, { registrationId: "reg-1", confirmationCode: "REG-TEST", waitlisted: false });
    } catch (error) {
      Object.assign(mocks.state, before);
      throw error;
    }
  },
}));

import { addedClubId, GeneralLinkError, resolvePendingTeam, similarClubsFor } from "@/modules/general-link-registrations/repository";

const add = { action: "ADD_CLUB" as const, clubName: "  Synthetic   Trailblazers ", sponsoringChurchId: "church-1" };
const run = (input: Parameters<typeof resolvePendingTeam>[3] = add) => resolvePendingTeam("event-1", "sub-1", "admin-1", input);
const clubs = () => [...mocks.state.orgs.values()].filter((org) => org.type === "CLUB");

beforeEach(() => {
  mocks.state = freshState();
  mocks.failRegistration = false;
});

describe("add a club and confirm the team in one step", () => {
  it("creates the club under its church and confirms the team against it, with ids only in the audit", async () => {
    const result = await run();
    expect(result).toMatchObject({ status: "CONFIRMED", alreadyDone: false, registrationId: "reg-1", clubName: "Synthetic Trailblazers" });
    const created = clubs().filter((org) => org.name === "Synthetic Trailblazers");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ type: "CLUB", parentOrganizationId: "church-1", isActive: true, normalizedName: "synthetic trailblazers" });
    expect(mocks.state.submission).toMatchObject({ status: "CONFIRMED", organizationId: created[0]!.id, registrationId: "reg-1", resolution: "STAFF_REASSIGNED" });
    const actions = mocks.state.audits.map((audit) => audit.action);
    expect(actions).toEqual(["ORGANIZATION_CREATED", "GENERAL_LINK_TEAM_CLUB_ADDED"]);
    const [orgAudit, teamAudit] = mocks.state.audits;
    expect(orgAudit).toMatchObject({ entityId: created[0]!.id, eventId: "event-1", metadata: { type: "CLUB", parentOrganizationId: "church-1", generalLinkSubmissionId: "sub-1" } });
    expect(teamAudit!.metadata).toMatchObject({ organizationId: created[0]!.id, organizationCreated: true, registrationId: "reg-1" });
    expect(JSON.stringify(mocks.state.audits)).not.toMatch(/Trailblazers|director@|Bible Bees/);
  });

  it("makes no club when the registration cannot be made: both or neither", async () => {
    mocks.failRegistration = true;
    await expect(run()).rejects.toThrow("registration refused");
    expect(clubs().map((org) => org.id).sort()).toEqual(["club-near", "club-same"]);
    expect(mocks.state.audits).toEqual([]);
    expect(mocks.state.submission.status).toBe("PENDING");
  });

  it("makes one club when the same action is sent twice", async () => {
    const first = await run();
    const second = await run();
    expect(first.alreadyDone).toBe(false);
    expect(second).toMatchObject({ status: "CONFIRMED", alreadyDone: true, registrationId: "reg-1" });
    expect(clubs().filter((org) => org.name === "Synthetic Trailblazers")).toHaveLength(1);
    expect(mocks.state.audits).toHaveLength(2);
  });

  it("finds the club it made earlier instead of making another when a retry reaches the transaction", async () => {
    const id = addedClubId("sub-1");
    mocks.state.orgs.set(id, { id, type: "CLUB", name: "Synthetic Trailblazers", isActive: true, parentOrganizationId: "church-1" });
    await expect(run()).resolves.toMatchObject({ status: "CONFIRMED", clubName: "Synthetic Trailblazers" });
    expect(clubs().filter((org) => org.name === "Synthetic Trailblazers")).toHaveLength(1);
    expect(mocks.state.submission.organizationId).toBe(id);
  });

  it("refuses to add the same club twice at one church, even when staff have checked the similar ones", async () => {
    await expect(run({ ...add, clubName: "Eagle Ridge Pathfinders", acknowledgeSimilar: true })).rejects.toMatchObject({ code: "CLUB_EXISTS" });
    expect(clubs()).toHaveLength(2);
    expect(mocks.state.submission.status).toBe("PENDING");
  });

  it("wants similar names checked first, then goes ahead once staff say none is the club", async () => {
    const similar = { ...add, clubName: "Riverbend Pathfinder Club" };
    await expect(run(similar)).rejects.toMatchObject({ code: "SIMILAR_CLUBS" });
    expect(clubs()).toHaveLength(2);
    await expect(run({ ...similar, acknowledgeSimilar: true })).resolves.toMatchObject({ status: "CONFIRMED", clubName: "Riverbend Pathfinder Club" });
    expect(clubs()).toHaveLength(3);
  });

  it("needs an active church or company from the directory and a real name", async () => {
    await expect(run({ ...add, sponsoringChurchId: "church-off" })).rejects.toMatchObject({ code: "CLUB_INVALID" });
    await expect(run({ ...add, sponsoringChurchId: "nowhere" })).rejects.toMatchObject({ code: "CLUB_INVALID" });
    await expect(run({ ...add, clubName: " x " })).rejects.toBeInstanceOf(GeneralLinkError);
    expect(clubs()).toHaveLength(2);
  });

  it("will not attach a team that was already attached elsewhere", async () => {
    mocks.state.submission = { status: "CONFIRMED", organizationId: "club-same", registrationId: "reg-9", resolution: "STAFF_CONFIRMED" };
    await expect(run()).rejects.toMatchObject({ code: "ALREADY_RESOLVED" });
    expect(clubs()).toHaveLength(2);
  });
});

describe("the close-name suggestions staff see before adding", () => {
  it("lists directory clubs close to the typed name, the same church first", async () => {
    const matches = await similarClubsFor({ clubName: "Eagle Ridge Pathfinder", sponsoringChurchId: "church-1" });
    expect(matches.map((match) => match.id)).toEqual(["club-same"]);
    expect(matches[0]).toMatchObject({ sameSponsor: true });
  });

  it("finds a close name at another church, and nothing for a short or unrelated name", async () => {
    expect((await similarClubsFor({ clubName: "Riverbend Pathfinder Club", sponsoringChurchId: null })).map((match) => match.id)).toEqual(["club-near"]);
    expect(await similarClubsFor({ clubName: "x", sponsoringChurchId: null })).toEqual([]);
    expect(await similarClubsFor({ clubName: "Entirely Different Voyagers", sponsoringChurchId: "church-1" })).toEqual([]);
  });
});
