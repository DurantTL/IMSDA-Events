import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  form: null as Record<string, unknown> | null,
  moduleOn: true,
  evaluationEnabled: false,
  members: [] as Array<Record<string, unknown>>,
  grants: [] as Array<Record<string, unknown>>,
  directors: [] as Array<Record<string, unknown>>,
  answered: [] as Array<{ attendeeAccountId: string }>,
  responseCount: 0,
  created: [] as Array<Record<string, unknown>>,
  carriedFrom: null as string | null,
  membership: vi.fn(),
  where: {} as Record<string, unknown>,
  locks: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: db.membership }));
vi.mock("@/modules/notifications/settings", () => ({ isNotificationEnabled: vi.fn(async () => false) }));
vi.mock("@/modules/information-forms/submission-alert", () => ({ sendInformationFormSubmittedAlert: vi.fn(async () => undefined) }));
vi.mock("@/lib/prisma", () => {
  const client = {
    $executeRaw: vi.fn(async () => { db.locks += 1; return 0; }),
    $transaction: async (run: (tx: unknown) => unknown) => run(client),
    informationForm: { findUnique: vi.fn(async () => db.form), findMany: vi.fn(async () => []) },
    informationFormResponse: {
      findUnique: vi.fn(async () => null),
      count: vi.fn(async () => db.responseCount),
      findMany: vi.fn(async () => db.answered),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { db.created.push(data); return { id: "response-1", submittedAt: new Date("2027-03-14T14:00:00Z") }; }),
    },
    eventModule: { findUnique: vi.fn(async () => (db.moduleOn ? { id: "row" } : null)) },
    eventDebrief: { findUnique: vi.fn(async () => ({ evaluationEnabled: db.evaluationEnabled, carriedFromEventId: db.carriedFrom })) },
    event: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id === "event-old" ? "Sample Spring Camporee 2026" : "Sample Spring Camporee 2027" })) },
    eventMembership: { findMany: vi.fn(async (args: { where: Record<string, unknown> }) => { db.where = args.where; return db.members; }) },
    areaCoordinatorGrant: { findMany: vi.fn(async () => db.grants) },
    clubDirectorGrant: { findMany: vi.fn(async () => db.directors) },
  };
  return { getPrisma: () => client };
});

import { debriefFormAccess, hasAnsweredDebrief } from "@/modules/event-debriefs/access";
import { answeredAccountIds, isDebriefRecipient, resolveDebriefRecipients } from "@/modules/event-debriefs/recipients";
import { canReadDebriefAnswers, loadCarriedDebriefResults } from "@/modules/event-debriefs/results";
import { storeInformationFormResponse } from "@/modules/information-forms/responses";

const now = new Date("2027-03-14T14:00:00.000Z");
const account = (id: string, email: string, displayName: string) => ({ id, email, displayName });
const definition = { title: "Event debrief", description: "", confirmationMessage: "Thanks.", sections: [{ id: "section_questions", title: "Questions", description: "", fields: [{ id: "field_went_well", key: "went_well", label: "What went well?", helpText: "", type: "LONG_TEXT", scope: "REGISTRATION", required: false, options: [] }] }] };
const formRow = (overrides: Record<string, unknown> = {}) => ({
  id: "form-debrief", eventId: "event-1", purpose: "DEBRIEF", status: "OPEN", fillAccess: "SIGNED_IN", opensAt: null, closesAt: null,
  versions: [{ id: "version-1", status: "PUBLISHED", definition }], ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.form = formRow();
  db.moduleOn = true;
  db.evaluationEnabled = false;
  db.members = [{ user: { attendeeAccount: account("staff-1", "Staff.One@example.org", "Staff One") } }, { user: { attendeeAccount: null } }];
  db.grants = [{ attendeeAccount: account("ac-1", "ac.one@example.org", "Coordinator One") }, { attendeeAccount: account("staff-1", "staff.one@example.org", "Staff One") }];
  db.directors = [{ attendeeAccount: account("dir-1", "director.one@example.org", "Director One") }];
  db.answered = [];
  db.responseCount = 0;
  db.created = [];
  db.carriedFrom = null;
  db.locks = 0;
});

describe("who is on the debrief list (#1679)", () => {
  it("is the event's active staff plus the active Area Coordinators, once each, by the account they sign in with", async () => {
    const list = await resolveDebriefRecipients((await import("@/lib/prisma")).getPrisma() as never, "event-1", "DEBRIEF", now);
    expect(list.map((recipient) => recipient.accountId)).toEqual(["ac-1", "staff-1"]);
    // A staff member with no linked attendee account has nothing to sign in with on the form, so is not listed.
    expect(list).toHaveLength(2);
    expect(db.where).toMatchObject({ eventId: "event-1", status: "ACTIVE" });
  });

  it("is the director and deputy of registered clubs for the evaluation", async () => {
    const list = await resolveDebriefRecipients((await import("@/lib/prisma")).getPrisma() as never, "event-1", "DIRECTOR_EVALUATION", now);
    expect(list.map((recipient) => recipient.accountId)).toEqual(["dir-1"]);
  });

  it("can tell whether one account is on it, and who has answered", async () => {
    const client = (await import("@/lib/prisma")).getPrisma() as never;
    expect(await isDebriefRecipient(client, "event-1", "DEBRIEF", "ac-1", now)).toBe(true);
    expect(await isDebriefRecipient(client, "event-1", "DEBRIEF", "dir-1", now)).toBe(false);
    db.answered = [{ attendeeAccountId: "ac-1" }];
    expect([...(await answeredAccountIds(client, "event-1", "DEBRIEF"))]).toEqual(["ac-1"]);
  });
});

describe("who may answer, checked on the server (#1679)", () => {
  it("lets someone on the list answer the debrief", async () => {
    expect(await debriefFormAccess("form-debrief", "ac-1", now)).toEqual({ kind: "ALLOWED", eventId: "event-1" });
  });

  it("refuses an account that is not on the list, one that is not signed in, and a switched-off Debrief", async () => {
    expect(await debriefFormAccess("form-debrief", "someone-else", now)).toEqual({ kind: "DENIED", reason: "NOT_A_RECIPIENT" });
    expect(await debriefFormAccess("form-debrief", null, now)).toEqual({ kind: "DENIED", reason: "SIGN_IN_REQUIRED" });
    db.moduleOn = false;
    expect(await debriefFormAccess("form-debrief", "ac-1", now)).toEqual({ kind: "DENIED", reason: "MODULE_OFF" });
  });

  it("keeps the director evaluation to directors, and only while its own switch is on", async () => {
    db.form = formRow({ id: "form-eval", purpose: "DIRECTOR_EVALUATION" });
    expect(await debriefFormAccess("form-eval", "dir-1", now)).toEqual({ kind: "DENIED", reason: "EVALUATION_OFF" });
    db.evaluationEnabled = true;
    expect(await debriefFormAccess("form-eval", "dir-1", now)).toEqual({ kind: "ALLOWED", eventId: "event-1" });
    expect(await debriefFormAccess("form-eval", "ac-1", now)).toEqual({ kind: "DENIED", reason: "NOT_A_RECIPIENT" });
  });

  it("has nothing to say about an ordinary information form", async () => {
    db.form = formRow({ purpose: null });
    expect(await debriefFormAccess("form-debrief", "anyone", now)).toEqual({ kind: "NOT_DEBRIEF" });
  });

  it("refuses to store an answer from a non-recipient, and stores one from a recipient", async () => {
    await expect(storeInformationFormResponse({ formId: "form-debrief", idempotencyKey: "key-12345678", answers: { went_well: "The food" }, attendeeAccountId: "someone-else", now }))
      .rejects.toMatchObject({ code: "NOT_ALLOWED" });
    expect(db.created).toHaveLength(0);
    await expect(storeInformationFormResponse({ formId: "form-debrief", idempotencyKey: "key-12345679", answers: { went_well: "The schedule" }, attendeeAccountId: "ac-1", now }))
      .resolves.toMatchObject({ created: true });
    expect(db.created[0]).toMatchObject({ formId: "form-debrief", attendeeAccountId: "ac-1" });
  });

  it("has no anonymous answer: a signed-out request is refused before anything is stored", async () => {
    await expect(storeInformationFormResponse({ formId: "form-debrief", idempotencyKey: "key-12345680", answers: {}, attendeeAccountId: null, now })).rejects.toMatchObject({ code: "SIGN_IN_REQUIRED" });
    db.form = formRow({ fillAccess: "ANYONE_WITH_LINK" });
    await expect(storeInformationFormResponse({ formId: "form-debrief", idempotencyKey: "key-12345681", answers: {}, attendeeAccountId: null, now })).rejects.toMatchObject({ code: "SIGN_IN_REQUIRED" });
    expect(db.created).toHaveLength(0);
  });

  it("refuses an empty send, so it does not use up the one answer", async () => {
    for (const answers of [{}, { went_well: "   " }]) {
      await expect(storeInformationFormResponse({ formId: "form-debrief", idempotencyKey: "key-12345690", answers, attendeeAccountId: "ac-1", now }))
        .rejects.toMatchObject({ code: "ANSWERS_INVALID", message: "Answer at least one question before sending." });
    }
    expect(db.created).toHaveLength(0);
  });

  it("checks and writes the one answer under a lock on the form and the person, so concurrent sends cannot both pass", async () => {
    await storeInformationFormResponse({ formId: "form-debrief", idempotencyKey: "key-12345691", answers: { went_well: "Good" }, attendeeAccountId: "ac-1", now });
    expect(db.locks).toBe(1);
    db.responseCount = 1;
    await expect(storeInformationFormResponse({ formId: "form-debrief", idempotencyKey: "key-12345692", answers: { went_well: "Twice" }, attendeeAccountId: "ac-1", now })).rejects.toMatchObject({ code: "ALREADY_ANSWERED" });
  });

  it("takes one answer from each person", async () => {
    db.responseCount = 1;
    expect(await hasAnsweredDebrief("form-debrief", "ac-1")).toBe(true);
    await expect(storeInformationFormResponse({ formId: "form-debrief", idempotencyKey: "key-12345682", answers: { went_well: "Again" }, attendeeAccountId: "ac-1", now })).rejects.toMatchObject({ code: "ALREADY_ANSWERED" });
    expect(db.created).toHaveLength(0);
  });
});

describe("who may read the answers (#1679)", () => {
  const user = (globalRole: "SYSTEM_ADMIN" | null = null) => ({ user: { id: "u", email: "u@example.org", displayName: "U", globalRole } });
  const asRole = (role: string | null, extra: Record<string, unknown> = {}) => db.membership.mockResolvedValue(role ? { eventId: "event-1", userId: "u", role, status: "ACTIVE", permissions: [], ...extra } : null);

  it("lets a system administrator, an Event Admin and a Registration Manager (event staff holding MANAGE_FORMS)", async () => {
    asRole(null);
    expect(await canReadDebriefAnswers(user("SYSTEM_ADMIN"), "event-1")).toBe(true);
    for (const role of ["EVENT_ADMIN", "REGISTRATION_MANAGER"]) {
      asRole(role);
      expect(await canReadDebriefAnswers(user(), "event-1")).toBe(true);
    }
  });

  it("refuses staff roles without that permission", async () => {
    for (const role of ["FINANCE_MANAGER", "COMMUNICATIONS_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF", "KITCHEN_STAFF"]) {
      asRole(role);
      expect(await canReadDebriefAnswers(user(), "event-1")).toBe(false);
    }
  });

  it("refuses an Area Coordinator, a plain attendee and a signed-out visitor: they hold no event membership", async () => {
    asRole(null);
    expect(await canReadDebriefAnswers(user(), "event-1")).toBe(false);
    expect(await canReadDebriefAnswers({ user: null }, "event-1")).toBe(false);
  });
});

describe("last year's answers on a copy (#1679)", () => {
  const user = { user: { id: "u", email: "u@example.org", displayName: "U", globalRole: null } };

  it("shows nothing when the event is not a copy of one that had a debrief", async () => {
    db.carriedFrom = null;
    expect(await loadCarriedDebriefResults(user, "event-1")).toBeNull();
  });

  it("is checked against the source event: staff who cannot read it there do not see it here", async () => {
    db.carriedFrom = "event-old";
    db.membership.mockImplementation(async (_userId: string, eventId: string) => (eventId === "event-1" ? { eventId, userId: "u", role: "EVENT_ADMIN", status: "ACTIVE", permissions: [] } : null));
    expect(await loadCarriedDebriefResults(user, "event-1")).toBeNull();
  });

  it("shows the source event's answers, read only, to someone who may read them there", async () => {
    db.carriedFrom = "event-old";
    db.membership.mockResolvedValue({ eventId: "event-old", userId: "u", role: "EVENT_ADMIN", status: "ACTIVE", permissions: [] });
    const carried = await loadCarriedDebriefResults(user, "event-1", now);
    expect(carried?.sourceEventId).toBe("event-old");
    expect(carried?.results.eventName).toBe("Sample Spring Camporee 2026");
  });
});
