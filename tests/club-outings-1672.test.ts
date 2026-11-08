import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Outing permission slips (#1672): the director's side (create, send, track, close) and the parent's private link.
 * Synthetic data only: no real names, emails or phone numbers.
 */
const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
  templateFindFirst: vi.fn(),
  templateFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  outingCreate: vi.fn(),
  outingFindFirst: vi.fn(),
  outingFindMany: vi.fn(),
  outingUpdate: vi.fn(),
  linkCreate: vi.fn(),
  linkUpdate: vi.fn(),
  linkUpdateMany: vi.fn(),
  linkFindUnique: vi.fn(),
  linkFindMany: vi.fn(),
  submissionCreate: vi.fn(),
  outboxCreate: vi.fn(),
  outboxFindMany: vi.fn(),
  organizationFindUnique: vi.fn(),
  organizationFindMany: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  configured: vi.fn(),
}));

const client = {
  clubFormTemplate: { findFirst: mocks.templateFindFirst, findUnique: mocks.templateFindUnique },
  $queryRaw: mocks.queryRaw,
  $executeRaw: mocks.executeRaw,
  clubFormOuting: { create: mocks.outingCreate, findFirst: mocks.outingFindFirst, findMany: mocks.outingFindMany, update: mocks.outingUpdate },
  clubFormLink: {
    create: mocks.linkCreate,
    update: mocks.linkUpdate,
    updateMany: mocks.linkUpdateMany,
    findUnique: mocks.linkFindUnique,
    findMany: mocks.linkFindMany,
  },
  clubFormSubmission: { create: mocks.submissionCreate },
  messageOutbox: { create: mocks.outboxCreate, findMany: mocks.outboxFindMany },
  organization: { findUnique: mocks.organizationFindUnique, findMany: mocks.organizationFindMany },
  clubRosterMember: { findFirst: mocks.rosterFindFirst, findMany: mocks.rosterFindMany },
  $transaction: (work: (tx: unknown) => unknown) => work(client),
};

const limiterCounts = vi.hoisted(() => new Map<string, number>());

vi.mock("server-only", () => ({}));
vi.mock("@/modules/rate-limit/repository", () => ({
  enforceRateLimitRules: async (rules: Array<{ policy: string; limit: number; subjectHash: string }>) => {
    const decisions = rules.map((rule) => {
      const key = `${rule.policy}:${rule.subjectHash}`;
      const used = (limiterCounts.get(key) ?? 0) + 1;
      limiterCounts.set(key, used);
      return { policy: rule.policy, allowed: used <= rule.limit, limit: rule.limit, remaining: Math.max(0, rule.limit - used), count: used, windowSeconds: 3600, resetAfterSeconds: 60 };
    });
    return { allowed: decisions.every((decision) => decision.allowed), decisions };
  },
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ SECRET_ENCRYPTION_KEY: "a-synthetic-encryption-key-for-club-form-tests", APP_BASE_URL: "https://events.imsda.test" }),
}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/communications/account-email", () => ({
  isAccountEmailConfigured: mocks.configured,
  getAccountEmailSender: () => ({ name: "IMAdventist", address: "events@example.test", replyTo: null }),
}));

import { hashOpaqueToken } from "@/modules/access/tokens";
import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import { isClubFormsRole, type ClubFormsViewer } from "@/modules/club-forms/domain";
import { resolveClubFormLinkForFill, submitClubFormViaLink } from "@/modules/club-forms/links";
import { checkClubFormOutingRecipientRateLimit } from "@/modules/rate-limit/service";
import { closeOuting, createOuting, getOutingForCopy, getOutingTracking, listOutings, sendOuting } from "@/modules/club-forms/outings";

const now = new Date("2026-11-10T15:00:00Z");
const director: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "ATTENDEE", accountId: "acct-1" } };
// A deputy is the same kind of viewer (`isClubFormsRole` lets DIRECTOR and DEPUTY in), with their own account.
const deputy: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "ATTENDEE", accountId: "acct-3" } };
const otherDirector: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-b", actor: { kind: "ATTENDEE", accountId: "acct-9" } };
const areaCoordinator: ClubFormsViewer = { kind: "AREA_COORDINATOR", actor: { kind: "ATTENDEE", accountId: "acct-2" } };
const staff: ClubFormsViewer = { kind: "STAFF", userId: "staff-1", systemAdmin: true, clubsAdministrator: false, sensitiveAnswers: true };

const TOKEN = "T".repeat(43);

function slipRow(overrides: Record<string, unknown> = {}) {
  const seed = clubFormTemplateSeeds.find((template) => template.key === "off_premises_permission_slip")!;
  return {
    id: "template-slip",
    key: seed.key,
    name: seed.name,
    description: seed.description,
    version: seed.version,
    definition: seed.definition,
    sectionNotes: seed.sectionNotes,
    sensitiveFieldKeys: seed.sensitiveFieldKeys,
    birthDateFieldKeys: seed.birthDateFieldKeys,
    staffOnlyFieldKeys: seed.staffOnlyFieldKeys,
    printLayout: seed.printLayout,
    enabled: true,
    ...overrides,
  };
}

const details = {
  activity: "Canoe trip",
  startDate: "2026-11-21",
  endDate: "",
  departureTime: "08:30",
  returnTime: "16:45",
  transportation: "Church van with Pat Sample",
  cost: "$15",
  whatToBring: "Lunch",
  note: "",
};
const swim = { label: "Can your child swim?", type: "YES_NO", required: true, options: [] };
const shirt = { label: "T-shirt size", type: "CHOICE", required: false, options: ["Small", "Medium", "Large"] };
const input = { details, questions: [swim, shirt] };

function outingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "outing-1",
    organizationId: "club-a",
    templateId: "template-slip",
    clubYear: "2026-27",
    activity: details.activity,
    startDate: details.startDate,
    details,
    questions: [swim, shirt],
    status: "OPEN",
    closedAt: null,
    createdAt: new Date("2026-11-09T12:00:00Z"),
    template: { definition: slipRow().definition },
    ...overrides,
  };
}

function member(id: string, first: string, emails: string[], attendeeType = "YOUTH") {
  return { id, attendeeType, person: { firstName: first, lastName: "Sample" }, guardians: emails.map((email) => ({ email })) };
}

const parentAnswers = {
  child_name: "Riley Sample",
  street: "6 Example Road",
  city: "Exampleville",
  state: "IA",
  zip: "50001",
  phone: "(515) 555-0110",
  parent_signature: "Pat Sample",
  relationship: "Parent",
  emergency_contact_phone: "(515) 555-0111",
  outing_q_1: "Yes",
  outing_q_2: "Medium",
};

function outingLink(overrides: Record<string, unknown> = {}) {
  return {
    id: "link-1",
    status: "OPEN",
    expiresAt: new Date("2026-11-24T15:00:00Z"),
    tokenHash: hashOpaqueToken(TOKEN),
    organizationId: "club-a",
    rosterMemberId: "member-1",
    subjectName: "Riley Sample",
    clubYear: "2026-27",
    outingId: "outing-1",
    outing: { status: "OPEN", details, questions: [swim, shirt] },
    organization: { name: "Example Pathfinders", isActive: true, type: "CLUB" },
    template: slipRow(),
    ...overrides,
  };
}

beforeEach(() => {
  limiterCounts.clear();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.writeAuditLog.mockResolvedValue({});
  mocks.configured.mockReturnValue(true);
  mocks.organizationFindUnique.mockResolvedValue({ type: "CLUB", isActive: true, name: "Example Pathfinders" });
  mocks.organizationFindMany.mockResolvedValue([]);
  mocks.templateFindFirst.mockResolvedValue(slipRow());
  mocks.templateFindUnique.mockReset();
  mocks.templateFindUnique.mockResolvedValue(slipRow());
  mocks.executeRaw.mockReset();
  mocks.executeRaw.mockResolvedValue(0);
  mocks.queryRaw.mockReset();
  mocks.queryRaw.mockResolvedValue([]);
  mocks.outingCreate.mockResolvedValue({ id: "outing-1" });
  mocks.outingFindFirst.mockImplementation(async ({ where }: { where: { id: string; organizationId: string } }) => (["outing-1", "outing-2"].includes(where.id) && where.organizationId === "club-a" ? outingRow({ id: where.id }) : null));
  mocks.outingFindMany.mockResolvedValue([]);
  mocks.outingUpdate.mockResolvedValue({});
  let linkNumber = 0;
  mocks.linkCreate.mockImplementation(async () => ({ id: `link-${++linkNumber}` }));
  mocks.linkUpdate.mockResolvedValue({});
  mocks.linkUpdateMany.mockResolvedValue({ count: 1 });
  mocks.linkFindMany.mockResolvedValue([]);
  mocks.linkFindUnique.mockResolvedValue(outingLink());
  mocks.outboxCreate.mockImplementation(async () => ({ id: `message-${mocks.outboxCreate.mock.calls.length}` }));
  mocks.outboxFindMany.mockResolvedValue([]);
  mocks.submissionCreate.mockResolvedValue({});
  mocks.rosterFindFirst.mockResolvedValue({ id: "member-1", person: { firstName: "Riley", lastName: "Sample" } });
  mocks.rosterFindMany.mockResolvedValue([]);
});

describe("who can reach an outing (#1672)", () => {
  it("treats the director and deputy as the club's forms roles, and no one else", () => {
    expect(isClubFormsRole("DIRECTOR")).toBe(true);
    expect(isClubFormsRole("DEPUTY")).toBe(true);
    expect(isClubFormsRole("REGISTRAR")).toBe(false);
  });

  it("lets the director and a deputy create, list and open an outing for their club", async () => {
    for (const viewer of [director, deputy]) {
      await expect(createOuting(viewer, "club-a", input, now)).resolves.toEqual({ outingId: "outing-1" });
      await expect(listOutings(viewer, "club-a", now)).resolves.toEqual([]);
      await expect(getOutingTracking(viewer, "club-a", "outing-1", now)).resolves.toMatchObject({ id: "outing-1", status: "OPEN" });
    }
  });

  it("refuses an Area Coordinator, conference staff and another club's director on every outing action", async () => {
    for (const viewer of [areaCoordinator, staff, otherDirector]) {
      await expect(createOuting(viewer, "club-a", input, now)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(listOutings(viewer, "club-a", now)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(getOutingTracking(viewer, "club-a", "outing-1", now)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(getOutingForCopy(viewer, "club-a", "outing-1")).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(closeOuting(viewer, "club-a", "outing-1", now)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(sendOuting(viewer, "club-a", "outing-1", { memberIds: ["member-1"] }, {}, now)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(mocks.outingCreate).not.toHaveBeenCalled();
    expect(mocks.linkCreate).not.toHaveBeenCalled();
    expect(mocks.outingUpdate).not.toHaveBeenCalled();
  });

  it("treats another club's outing id as not found, never as forbidden", async () => {
    await expect(getOutingTracking(otherDirector, "club-b", "outing-1", now)).rejects.toMatchObject({ code: "OUTING_NOT_FOUND" });
    expect(mocks.outingFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "outing-1", organizationId: "club-b" } }));
    await expect(closeOuting(otherDirector, "club-b", "outing-1", now)).rejects.toMatchObject({ code: "OUTING_NOT_FOUND" });
    await expect(sendOuting(otherDirector, "club-b", "outing-1", { memberIds: ["member-1"] }, {}, now)).rejects.toMatchObject({ code: "OUTING_NOT_FOUND" });
  });
});

describe("creating an outing (#1672)", () => {
  it("stores the details and questions for this club and year, and audits counts only", async () => {
    await createOuting(director, "club-a", input, now);
    expect(mocks.outingCreate.mock.calls[0][0].data).toMatchObject({
      organizationId: "club-a",
      templateId: "template-slip",
      clubYear: "2026-27",
      activity: "Canoe trip",
      startDate: "2026-11-21",
    });
    const entry = mocks.writeAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({ action: "CLUB_FORM_OUTING_CREATED", entityType: "ClubFormOuting", metadata: expect.objectContaining({ questionCount: 2, organizationId: "club-a" }) });
    expect(JSON.stringify(entry)).not.toContain("Canoe");
    expect(JSON.stringify(entry)).not.toContain("swim");
  });

  it("tells the director plainly when the conference has not turned the slip on, and creates nothing", async () => {
    mocks.templateFindUnique.mockResolvedValue(slipRow({ enabled: false }));
    await expect(createOuting(director, "club-a", input, now)).rejects.toMatchObject({
      code: "SLIP_TEMPLATE_OFF",
      message: expect.stringMatching(/not turned on yet.*system administrator/),
    });
    expect(mocks.outingCreate).not.toHaveBeenCalled();
  });

  it("refuses a birth-date or medical club question on the server and creates nothing", async () => {
    for (const label of ["Child's birth date", "Does your child take medication?", "Food allergies"]) {
      await expect(createOuting(director, "club-a", { details, questions: [{ label, type: "TEXT", required: false, options: [] }] }, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    await expect(createOuting(director, "club-a", { details, questions: Array.from({ length: 6 }, (_, n) => ({ label: `Question ${n}`, type: "TEXT", required: false, options: [] })) }, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(mocks.outingCreate).not.toHaveBeenCalled();
  });

  it("copies a past outing's details and questions with the dates left empty", async () => {
    const copy = await getOutingForCopy(director, "club-a", "outing-1");
    expect(copy.details).toMatchObject({ activity: "Canoe trip", transportation: details.transportation, startDate: "", endDate: "" });
    expect(copy.questions).toHaveLength(2);
  });
});

describe("sending to the chosen families (#1672)", () => {
  const send = (body: Record<string, unknown>, options = {}) => sendOuting(director, "club-a", "outing-1", body, options, now);

  it("gives each chosen family its own link and its own email, tied to the outing", async () => {
    mocks.rosterFindMany.mockResolvedValue([
      member("member-1", "Riley", ["", "pat.one@example.test"]),
      member("member-2", "Jordan", ["pat.two@example.test"]),
    ]);
    const result = await send({ memberIds: ["member-1", "member-2"] });
    expect(result.sent).toBe(2);
    expect(result.results.map((entry) => entry.outcome)).toEqual(["SENT", "SENT"]);
    expect(result.messageIds).toHaveLength(2);
    expect(mocks.linkCreate).toHaveBeenCalledTimes(2);
    expect(mocks.outboxCreate).toHaveBeenCalledTimes(2);
    const links = mocks.linkCreate.mock.calls.map((call) => call[0].data);
    expect(links.map((link) => link.recipientEmail)).toEqual(["pat.one@example.test", "pat.two@example.test"]);
    expect(links.map((link) => link.rosterMemberId)).toEqual(["member-1", "member-2"]);
    for (const link of links) expect(link).toMatchObject({ outingId: "outing-1", organizationId: "club-a", createdAs: "CLUB_LEADER" });
    // One recipient per email, never a list.
    for (const call of mocks.outboxCreate.mock.calls) {
      const message = call[0].data;
      expect(message.recipientEmail).not.toContain(",");
      expect(message.subjectSnapshot).toContain("Canoe trip");
      expect(message.bodyTextSnapshot).toContain("Canoe trip");
      expect(message.bodyTextSnapshot).toContain("{{club_form_link}}");
    }
    // Results name members, never an address.
    expect(JSON.stringify(result.results)).not.toContain("example.test");
  });

  it("reports each member it did not send to, and why", async () => {
    mocks.rosterFindMany.mockResolvedValue([
      member("member-1", "Riley", []),
      member("member-2", "Jordan", ["pat.two@example.test"]),
      member("member-3", "Casey", ["pat.three@example.test"]),
      member("member-4", "Avery", ["pat.four@example.test"]),
      member("member-5", "Quinn", ["pat.five@example.test"], "STAFF"),
    ]);
    const held = [
      { id: "old-2", rosterMemberId: "member-2", status: "USED", expiresAt: new Date("2026-11-20T00:00:00Z") },
      { id: "old-3", rosterMemberId: "member-3", status: "OPEN", expiresAt: new Date("2026-11-24T00:00:00Z") },
    ];
    // Like the real table: the per-member lookup under the lock only sees that member's links.
    mocks.linkFindMany.mockImplementation(async ({ where }: { where: { rosterMemberId: string | { in: string[] } } }) => (
      typeof where.rosterMemberId === "string" ? held.filter((link) => link.rosterMemberId === where.rosterMemberId) : held
    ));
    const result = await send({ memberIds: ["member-1", "member-2", "member-3", "member-4", "member-5", "member-of-club-b"] });
    expect(Object.fromEntries(result.results.map((entry) => [entry.memberId, entry.outcome]))).toEqual({
      "member-1": "NO_PARENT_EMAIL",
      "member-2": "ALREADY_SIGNED",
      "member-3": "ALREADY_SENT",
      "member-4": "SENT",
      "member-5": "NOT_ELIGIBLE",
      "member-of-club-b": "NOT_FOUND",
    });
    expect(mocks.linkCreate).toHaveBeenCalledTimes(1);
  });

  it("looks members up in this club and year only", async () => {
    mocks.rosterFindMany.mockResolvedValue([]);
    await send({ memberIds: ["member-of-club-b"] });
    expect(mocks.rosterFindMany.mock.calls[0][0].where).toMatchObject({ organizationId: "club-a", clubYear: "2026-27", status: "ACTIVE" });
  });

  it("resends to a member whose link expired, and withdraws a link that is still open", async () => {
    mocks.rosterFindMany.mockResolvedValue([member("member-1", "Riley", ["pat.one@example.test"]), member("member-2", "Jordan", ["pat.two@example.test"])]);
    mocks.linkFindMany.mockResolvedValue([
      { id: "expired-1", rosterMemberId: "member-1", status: "OPEN", expiresAt: new Date("2026-11-01T00:00:00Z") },
      { id: "live-2", rosterMemberId: "member-2", status: "OPEN", expiresAt: new Date("2026-11-24T00:00:00Z") },
    ]);
    const result = await send({ memberIds: ["member-1", "member-2"], resend: true });
    expect(result.results.map((entry) => entry.outcome)).toEqual(["SENT", "SENT"]);
    // The old links are withdrawn inside the same transaction that makes the new one, under the member's row lock.
    for (const memberId of ["member-1", "member-2"]) {
      expect(mocks.linkUpdateMany).toHaveBeenCalledWith({ where: { outingId: "outing-1", rosterMemberId: memberId, status: "OPEN" }, data: { status: "REVOKED", revokedAt: now } });
    }
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    const order = mocks.linkUpdateMany.mock.invocationCallOrder[0];
    expect(order).toBeLessThan(mocks.linkCreate.mock.invocationCallOrder[0]);
  });

  it("answers a double click as already sent: the second send finds the first one's link under the lock", async () => {
    mocks.rosterFindMany.mockResolvedValue([member("member-1", "Riley", ["pat.one@example.test"])]);
    mocks.linkFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "first", status: "OPEN", expiresAt: new Date("2026-11-24T00:00:00Z") }]);
    const result = await send({ memberIds: ["member-1"] });
    expect(result.results[0].outcome).toBe("ALREADY_SENT");
    expect(mocks.linkCreate).not.toHaveBeenCalled();
  });

  it("never resends to a member who already signed", async () => {
    mocks.rosterFindMany.mockResolvedValue([member("member-1", "Riley", ["pat.one@example.test"])]);
    mocks.linkFindMany.mockResolvedValue([{ id: "done", rosterMemberId: "member-1", status: "USED", expiresAt: new Date("2026-11-01T00:00:00Z") }]);
    const result = await send({ memberIds: ["member-1"], resend: true });
    expect(result.results[0].outcome).toBe("ALREADY_SIGNED");
    expect(mocks.linkCreate).not.toHaveBeenCalled();
  });

  it("applies the route's per-recipient rate limit to each address", async () => {
    mocks.rosterFindMany.mockResolvedValue([member("member-1", "Riley", ["pat.one@example.test"])]);
    const allowRecipient = vi.fn(async () => ({ allowed: false as const, reason: "ADDRESS" as const }));
    const result = await send({ memberIds: ["member-1"] }, { allowRecipient });
    expect(allowRecipient).toHaveBeenCalledWith("pat.one@example.test", 1);
    expect(result.results[0].outcome).toBe("RATE_LIMITED");
    const club = await send({ memberIds: ["member-1"] }, { allowRecipient: async () => ({ allowed: false as const, reason: "CLUB_DAY" as const }) });
    expect(club.results[0].outcome).toBe("CLUB_LIMIT");
    expect(mocks.linkCreate).not.toHaveBeenCalled();
  });

  it("sends nothing for a closed outing, a bad request or when email is not set up", async () => {
    mocks.outingFindFirst.mockResolvedValue(outingRow({ status: "CLOSED" }));
    await expect(send({ memberIds: ["member-1"] })).rejects.toMatchObject({ code: "OUTING_CLOSED" });
    mocks.outingFindFirst.mockResolvedValue(outingRow());
    await expect(send({ memberIds: [] })).rejects.toBeTruthy();
    await expect(send({ memberIds: Array.from({ length: 101 }, (_, n) => `member-${n}`) })).rejects.toBeTruthy();
    mocks.rosterFindMany.mockResolvedValue([member("member-1", "Riley", ["pat.one@example.test"])]);
    mocks.configured.mockReturnValue(false);
    await expect(send({ memberIds: ["member-1"] })).rejects.toMatchObject({ code: "EMAIL_NOT_CONFIGURED" });
    expect(mocks.linkCreate).not.toHaveBeenCalled();
  });

  it("refuses to send an Area Coordinator's link for an outing, even through the shared link function", async () => {
    const { createClubFormLink } = await import("@/modules/club-forms/links");
    await expect(createClubFormLink(areaCoordinator, { organizationId: "club-a", templateKey: "off_premises_permission_slip", recipientEmail: "pat.one@example.test", outingId: "outing-1" }, now))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("sending with the real limiter (#1672)", () => {
  const siblings = (count: number) => Array.from({ length: count }, (_, n) => member(`sib-${n + 1}`, `Child${n + 1}`, ["family@example.test"]));
  const sendTo = (outingId: string, ids: string[], resend = false) => sendOuting(director, "club-a", outingId, { memberIds: ids, resend }, {
    allowRecipient: (email, size) => checkClubFormOutingRecipientRateLimit("club-a", outingId, email, size),
  }, now);

  it("gives four siblings on one guardian address a link each in one send", async () => {
    mocks.rosterFindMany.mockResolvedValue(siblings(4));
    const result = await sendTo("outing-1", ["sib-1", "sib-2", "sib-3", "sib-4"]);
    expect(result.results.map((entry) => entry.outcome)).toEqual(["SENT", "SENT", "SENT", "SENT"]);
    expect(mocks.linkCreate).toHaveBeenCalledTimes(4);
    expect(mocks.outboxCreate).toHaveBeenCalledTimes(4);
  });

  it("sends two outings back to back to two siblings, every slip going through", async () => {
    mocks.rosterFindMany.mockResolvedValue(siblings(2));
    for (const outingId of ["outing-1", "outing-2"]) {
      const result = await sendTo(outingId, ["sib-1", "sib-2"]);
      expect(result.results.map((entry) => entry.outcome)).toEqual(["SENT", "SENT"]);
    }
    expect(mocks.linkCreate).toHaveBeenCalledTimes(4);
  });

  it("refuses a fourth resend of the same outing to one address in an hour, in plain words", async () => {
    mocks.rosterFindMany.mockResolvedValue(siblings(2));
    const outcomes = [];
    for (let attempt = 0; attempt < 4; attempt += 1) outcomes.push((await sendTo("outing-1", ["sib-1", "sib-2"], true)).results.map((entry) => entry.outcome));
    expect(outcomes.slice(0, 3)).toEqual([["SENT", "SENT"], ["SENT", "SENT"], ["SENT", "SENT"]]);
    expect(outcomes[3]).toEqual(["RATE_LIMITED", "RATE_LIMITED"]);
    expect(mocks.linkCreate).toHaveBeenCalledTimes(6);
  });

  it("charges the club budget only for a family that went through", async () => {
    mocks.rosterFindMany.mockResolvedValue(siblings(2));
    for (let attempt = 0; attempt < 5; attempt += 1) await sendTo("outing-1", ["sib-1", "sib-2"], true);
    const clubDay = [...limiterCounts].filter(([key]) => key.startsWith("club-form.outing-recipient.club-day")).reduce((total, [, used]) => total + used, 0);
    // Three sends passed, two children each; the two refused sends used none.
    expect(clubDay).toBe(6);
  });
});

describe("tracking and closing (#1672)", () => {
  it("lists each member once with signed, not yet or link expired, newest link first, and no email address", async () => {
    mocks.linkFindMany.mockResolvedValue([
      { id: "l3", messageId: null, rosterMemberId: "m3", status: "OPEN", expiresAt: new Date("2026-11-24T00:00:00Z"), usedAt: null, revokedAt: null, createdAt: new Date("2026-11-09T00:00:00Z"), rosterMember: { person: { firstName: "Casey", lastName: "Sample" } }, submission: null },
      { id: "l2b", messageId: null, rosterMemberId: "m2", status: "OPEN", expiresAt: new Date("2026-11-05T00:00:00Z"), usedAt: null, revokedAt: null, createdAt: new Date("2026-11-02T00:00:00Z"), rosterMember: { person: { firstName: "Jordan", lastName: "Sample" } }, submission: null },
      { id: "l2a", messageId: null, rosterMemberId: "m2", status: "REVOKED", expiresAt: new Date("2026-11-04T00:00:00Z"), usedAt: null, revokedAt: null, createdAt: new Date("2026-11-01T00:00:00Z"), rosterMember: { person: { firstName: "Jordan", lastName: "Sample" } }, submission: null },
      { id: "l1", messageId: null, rosterMemberId: "m1", status: "USED", expiresAt: new Date("2026-11-20T00:00:00Z"), usedAt: new Date("2026-11-08T00:00:00Z"), revokedAt: null, createdAt: new Date("2026-11-01T00:00:00Z"), rosterMember: { person: { firstName: "Riley", lastName: "Sample" } }, submission: { id: "sub-1" } },
    ]);
    const tracking = await getOutingTracking(director, "club-a", "outing-1", now);
    expect(tracking.members.map((row) => [row.name, row.state, row.submissionId])).toEqual([
      ["Casey Sample", "NOT_YET", null],
      ["Jordan Sample", "EXPIRED", null],
      ["Riley Sample", "SIGNED", "sub-1"],
    ]);
    expect(tracking.counts).toEqual({ SIGNED: 1, NOT_YET: 1, EXPIRED: 1 });
    expect(mocks.linkFindMany.mock.calls[0][0].where).toEqual({ outingId: "outing-1", organizationId: "club-a" });
    expect(JSON.stringify(tracking)).not.toMatch(/@|recipientEmail/);
  });

  it("shows a withdrawn link as withdrawn on the day it was withdrawn, not as expiring in the future", async () => {
    mocks.linkFindMany.mockResolvedValue([
      { id: "w", messageId: null, rosterMemberId: "m1", status: "REVOKED", expiresAt: new Date("2026-11-24T00:00:00Z"), usedAt: null, revokedAt: new Date("2026-11-09T00:00:00Z"), createdAt: new Date("2026-11-08T00:00:00Z"), rosterMember: { person: { firstName: "Riley", lastName: "Sample" } }, submission: null },
    ]);
    const tracking = await getOutingTracking(director, "club-a", "outing-1", now);
    expect(tracking.members[0]).toMatchObject({ state: "EXPIRED", withdrawnAt: "2026-11-09T00:00:00.000Z" });
    // The slip's own labels come with the tracking data, for the page and the print view.
    expect(tracking.detailRows.map((row) => row.label)).toContain("On the date of");
  });

  it("still opens the tracking data when the stored slip definition can't be read, with plain labels", async () => {
    mocks.outingFindFirst.mockResolvedValue(outingRow({ template: { definition: { broken: true } } }));
    const tracking = await getOutingTracking(director, "club-a", "outing-1", now);
    expect(tracking.detailRows.slice(0, 2).map((row) => row.label)).toEqual(["Activity", "Date"]);
  });

  it("closing withdraws every link still open and audits counts", async () => {
    mocks.linkUpdateMany.mockResolvedValue({ count: 3 });
    await expect(closeOuting(director, "club-a", "outing-1", now)).resolves.toEqual({ closedLinks: 3 });
    expect(mocks.outingUpdate).toHaveBeenCalledWith({ where: { id: "outing-1" }, data: { status: "CLOSED", closedAt: now } });
    expect(mocks.linkUpdateMany).toHaveBeenCalledWith({ where: { outingId: "outing-1", status: "OPEN" }, data: { status: "REVOKED", revokedAt: now } });
    expect(mocks.writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "CLUB_FORM_OUTING_CLOSED", metadata: expect.objectContaining({ withdrawnLinks: 3 }) });
  });

  it("closing an outing that is already closed changes nothing", async () => {
    mocks.outingFindFirst.mockResolvedValue({ id: "outing-1", status: "CLOSED" });
    await expect(closeOuting(director, "club-a", "outing-1", now)).resolves.toEqual({ closedLinks: 0 });
    expect(mocks.outingUpdate).not.toHaveBeenCalled();
  });
});

describe("the parent's private link (#1672)", () => {
  it("shows the outing's details read-only, the club's questions, and the slip's own sections unchanged", async () => {
    const view = await resolveClubFormLinkForFill(TOKEN, now);
    expect(view.outing?.detailRows.map((row) => row.label)).toEqual([
      "I hereby give my permission for my child to participate in the pre-planned activity of",
      "On the date of",
      "Leaving",
      "Back",
      "I give my child permission to ride with",
      "Cost",
      "What to bring",
    ]);
    expect(view.outing?.sectionId).toBe("sec_permission");
    const keys = view.form.definition.sections.flatMap((section) => section.fields.map((field) => field.key));
    // The parent has no field for the three details: they cannot type them.
    for (const preset of ["activity", "activity_date", "ride_with"]) expect(keys).not.toContain(preset);
    expect(keys).toEqual(expect.arrayContaining(["child_name", "parent_signature", "emergency_contact_phone", "outing_q_1", "outing_q_2"]));
    const seed = clubFormTemplateSeeds.find((template) => template.key === "off_premises_permission_slip")!;
    for (const id of ["sec_child", "sec_parent", "sec_medical"]) {
      expect(view.form.definition.sections.find((section) => section.id === id)).toEqual(seed.definition.sections.find((section) => section.id === id));
    }
    expect(view.form.sectionNotes).toEqual(seed.sectionNotes);
    // Nothing about the club or the roster leaks.
    const serialized = JSON.stringify(view);
    for (const leaked of ["Riley", "member-1", "club-a", "link-1", "subjectName", "recipientEmail", "acct-1", "outing-1"]) expect(serialized, leaked).not.toContain(leaked);
  });

  it("an ordinary link is unchanged: no outing, all three typed fields", async () => {
    mocks.linkFindUnique.mockResolvedValue(outingLink({ outingId: null, outing: null }));
    const view = await resolveClubFormLinkForFill(TOKEN, now);
    expect(view.outing).toBeNull();
    const keys = view.form.definition.sections.flatMap((section) => section.fields.map((field) => field.key));
    expect(keys).toEqual(expect.arrayContaining(["activity", "activity_date", "ride_with"]));
  });

  it("a closed outing's link and a link of a switched-off slip answer like any unusable link", async () => {
    for (const found of [outingLink({ outing: { status: "CLOSED", details, questions: [] } }), outingLink({ status: "REVOKED" })]) {
      mocks.linkFindUnique.mockResolvedValue(found);
      await expect(resolveClubFormLinkForFill(TOKEN, now)).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
      await expect(submitClubFormViaLink(TOKEN, parentAnswers, now)).rejects.toMatchObject({ code: "LINK_UNAVAILABLE" });
    }
    expect(mocks.submissionCreate).not.toHaveBeenCalled();
  });

  it("sets activity, date and ride-with from the outing whatever the parent sends, and keeps the club's answers", async () => {
    await submitClubFormViaLink(TOKEN, { ...parentAnswers, activity: "Something else", activity_date: "2030-01-01", ride_with: "A stranger" }, now);
    const data = mocks.submissionCreate.mock.calls[0][0].data;
    expect(data.answers).toMatchObject({
      activity: "Canoe trip",
      activity_date: "2026-11-21",
      ride_with: "Church van with Pat Sample",
      outing_q_1: "Yes",
      outing_q_2: "Medium",
      child_name: "Riley Sample",
      parent_signature_date: "2026-11-10",
    });
    expect(data).toMatchObject({ organizationId: "club-a", linkId: "link-1", enteredVia: "LINK", status: "SUBMITTED", rosterMemberId: "member-1" });
  });

  it("still requires every required section of the conference slip", async () => {
    for (const missing of ["child_name", "parent_signature", "relationship", "emergency_contact_phone", "street"]) {
      const rest: Record<string, string> = { ...parentAnswers };
      delete rest[missing];
      await expect(submitClubFormViaLink(TOKEN, rest, now), missing).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expect(mocks.submissionCreate).not.toHaveBeenCalled();
  });

  it("enforces the club's required question and its choices", async () => {
    const withoutRequired: Record<string, string> = { ...parentAnswers };
    delete withoutRequired.outing_q_1;
    await expect(submitClubFormViaLink(TOKEN, withoutRequired, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(submitClubFormViaLink(TOKEN, { ...parentAnswers, outing_q_2: "Extra large" }, now)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(mocks.submissionCreate).not.toHaveBeenCalled();
  });

  it("the club's questions never become sensitive answers: nothing is sealed for them", async () => {
    await submitClubFormViaLink(TOKEN, parentAnswers, now);
    const data = mocks.submissionCreate.mock.calls[0][0].data;
    expect(data.hasSensitiveAnswers).toBe(false);
    expect(data.sealedSensitiveAnswers).toBeNull();
  });
});
