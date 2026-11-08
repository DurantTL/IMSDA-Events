import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rejectCrossOriginRequest: vi.fn(),
  requireClubLeaderViewer: vi.fn(),
  createOuting: vi.fn(),
  closeOuting: vi.fn(),
  sendOuting: vi.fn(),
  checkClubFormOutingSendRateLimit: vi.fn(),
  checkClubFormOutingRecipientRateLimit: vi.fn(),
  processAccountEmailQueue: vi.fn(),
  after: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOriginRequest }));
vi.mock("@/modules/club-forms/access", () => ({ requireClubLeaderViewer: mocks.requireClubLeaderViewer }));
vi.mock("@/modules/club-forms/outings", () => ({ createOuting: mocks.createOuting, closeOuting: mocks.closeOuting, sendOuting: mocks.sendOuting }));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: mocks.processAccountEmailQueue }));
vi.mock("@/modules/rate-limit/service", () => ({
  checkClubFormOutingSendRateLimit: mocks.checkClubFormOutingSendRateLimit,
  checkClubFormOutingRecipientRateLimit: mocks.checkClubFormOutingRecipientRateLimit,
}));
vi.mock("@/modules/club-rosters/access", () => ({
  RosterAccessError: class RosterAccessError extends Error {
    constructor(public readonly code: string, public readonly status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/modules/club-rosters/api-errors", () => ({
  RosterBodyError: class RosterBodyError extends Error { readonly code = "INVALID_JSON_BODY"; },
  readRosterJson: async (request: Request) => request.json(),
}));

import { POST as CREATE } from "@/app/api/attendee/clubs/[organizationId]/forms/outings/route";
import { POST as CLOSE } from "@/app/api/attendee/clubs/[organizationId]/forms/outings/[outingId]/close/route";
import { POST as SEND } from "@/app/api/attendee/clubs/[organizationId]/forms/outings/[outingId]/send/route";
import { ClubFormError } from "@/modules/club-forms/errors";
import { RosterAccessError } from "@/modules/club-rosters/access";

const leader = { kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "ATTENDEE", accountId: "acct-1" } };
const post = (body: unknown = {}) => new Request("https://events.imsda.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const create = () => ({ params: Promise.resolve({ organizationId: "club-a" }) });
const outing = () => ({ params: Promise.resolve({ organizationId: "club-a", outingId: "outing-1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectCrossOriginRequest.mockReturnValue(null);
  mocks.requireClubLeaderViewer.mockResolvedValue(leader);
  mocks.checkClubFormOutingSendRateLimit.mockResolvedValue({ allowed: true, decisions: [] });
  mocks.checkClubFormOutingRecipientRateLimit.mockResolvedValue({ allowed: true });
  mocks.createOuting.mockResolvedValue({ outingId: "outing-1" });
  mocks.closeOuting.mockResolvedValue({ closedLinks: 2 });
  mocks.sendOuting.mockResolvedValue({ sent: 1, messageIds: ["message-1"], results: [{ memberId: "member-1", name: "Riley Sample", outcome: "SENT" }] });
});

describe("the outing routes (#1672)", () => {
  it("refuse a cross-origin request before anything else", async () => {
    mocks.rejectCrossOriginRequest.mockReturnValue(new Response("no", { status: 403 }));
    for (const call of [() => CREATE(post(), create()), () => CLOSE(post(), outing()), () => SEND(post(), outing())]) {
      expect((await call()).status).toBe(403);
    }
    expect(mocks.requireClubLeaderViewer).not.toHaveBeenCalled();
  });

  it("check the club's director on every request and pass the viewer on", async () => {
    await CREATE(post({ details: {}, questions: [] }), create());
    await CLOSE(post(), outing());
    await SEND(post({ memberIds: ["member-1"] }), outing());
    expect(mocks.requireClubLeaderViewer).toHaveBeenCalledTimes(3);
    expect(mocks.requireClubLeaderViewer).toHaveBeenCalledWith("club-a");
    expect(mocks.createOuting).toHaveBeenCalledWith(leader, "club-a", { details: {}, questions: [] });
    expect(mocks.closeOuting).toHaveBeenCalledWith(leader, "club-a", "outing-1");
  });

  it("answer 403 for a role without club forms and write nothing", async () => {
    mocks.requireClubLeaderViewer.mockRejectedValue(new RosterAccessError("ROLE_NOT_ALLOWED", 403, "Not your club."));
    for (const call of [() => CREATE(post(), create()), () => CLOSE(post(), outing()), () => SEND(post(), outing())]) {
      expect((await call()).status).toBe(403);
    }
    expect(mocks.createOuting).not.toHaveBeenCalled();
    expect(mocks.sendOuting).not.toHaveBeenCalled();
  });

  it("create answers 201 with the new outing, and a refused question as 400 with its issue", async () => {
    const created = await CREATE(post({}), create());
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ outing: { id: "outing-1" } });
    mocks.createOuting.mockRejectedValue(new ClubFormError("VALIDATION_FAILED", "Question 1 can't ask for a birth date or age. The roster already has it.", [{ key: "question:1", message: "Question 1 can't ask for a birth date or age. The roster already has it." }]));
    const refused = await CREATE(post({}), create());
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "VALIDATION_FAILED", issues: [{ key: "question:1" }] });
  });

  it("create says the slip is off with a 409 and the message the director reads", async () => {
    mocks.createOuting.mockRejectedValue(new ClubFormError("SLIP_TEMPLATE_OFF", "The Off-Premises Permission Slip is not turned on yet. Ask a system administrator to turn it on, then try again."));
    const response = await CREATE(post({}), create());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "SLIP_TEMPLATE_OFF", message: expect.stringContaining("system administrator") });
  });

  it("send charges the action once, charges each address, and delivers the queued emails after the response", async () => {
    mocks.sendOuting.mockImplementation(async (_viewer, _org, _outing, _body, options: { allowRecipient: (email: string, familySize: number) => Promise<unknown> }) => {
      await options.allowRecipient("parent@example.test", 2);
      return { sent: 1, messageIds: ["message-1"], results: [{ memberId: "member-1", name: "Riley Sample", outcome: "SENT" }] };
    });
    const response = await SEND(post({ memberIds: ["member-1"] }), outing());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent: 1 });
    expect(mocks.checkClubFormOutingSendRateLimit).toHaveBeenCalledWith(expect.any(Request), "acct-1", "club-a");
    expect(mocks.checkClubFormOutingRecipientRateLimit).toHaveBeenCalledWith("club-a", "outing-1", "parent@example.test", 2);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0][0]();
    expect(mocks.processAccountEmailQueue).toHaveBeenCalledWith({ messageIds: ["message-1"], limit: 1 });
  });

  it("send answers 429 in plain words when the action limit is hit, and sends nothing", async () => {
    mocks.checkClubFormOutingSendRateLimit.mockResolvedValue({ allowed: false, decisions: [{ policy: "p", allowed: false, limit: 1, remaining: 0, count: 2, windowSeconds: 3600, resetAfterSeconds: 60 }] });
    const response = await SEND(post({ memberIds: ["member-1"] }), outing());
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining("too many times") });
    expect(mocks.sendOuting).not.toHaveBeenCalled();
  });

  it("send queues no delivery when nothing was sent, and answers 404 for another club's outing", async () => {
    mocks.sendOuting.mockResolvedValueOnce({ sent: 0, messageIds: [], results: [] });
    await SEND(post({ memberIds: ["member-1"] }), outing());
    expect(mocks.after).not.toHaveBeenCalled();
    mocks.sendOuting.mockRejectedValue(new ClubFormError("OUTING_NOT_FOUND", "That outing could not be found."));
    expect((await SEND(post({ memberIds: ["member-1"] }), outing())).status).toBe(404);
    mocks.closeOuting.mockRejectedValue(new ClubFormError("OUTING_NOT_FOUND", "That outing could not be found."));
    expect((await CLOSE(post(), outing())).status).toBe(404);
  });
});
