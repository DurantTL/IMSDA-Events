import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real limiter (only its counter store is faked) for an outing send (#1672): a club's whole roster goes through,
 * each address and the club's day stay bounded, and the words say which limit was hit.
 */
const counts = vi.hoisted(() => new Map<string, number>());
const mocks = vi.hoisted(() => ({ requireClubLeaderViewer: vi.fn(), sendOuting: vi.fn(), after: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/club-forms/access", () => ({ requireClubLeaderViewer: mocks.requireClubLeaderViewer }));
vi.mock("@/modules/club-forms/outings", () => ({ sendOuting: mocks.sendOuting }));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: vi.fn() }));
vi.mock("@/modules/club-rosters/access", () => ({ RosterAccessError: class extends Error {} }));
vi.mock("@/modules/club-rosters/api-errors", () => ({ RosterBodyError: class extends Error {}, readRosterJson: async (request: Request) => request.json() }));
vi.mock("@/modules/rate-limit/repository", () => ({
  enforceRateLimitRules: async (rules: Array<{ policy: string; limit: number; subjectHash: string }>) => {
    const decisions = rules.map((rule) => {
      const key = `${rule.policy}:${rule.subjectHash}`;
      const used = (counts.get(key) ?? 0) + 1;
      counts.set(key, used);
      return { policy: rule.policy, allowed: used <= rule.limit, limit: rule.limit, remaining: Math.max(0, rule.limit - used), count: used, windowSeconds: 3600, resetAfterSeconds: 60 };
    });
    return { allowed: decisions.every((decision) => decision.allowed), decisions };
  },
}));

import { POST as SEND } from "@/app/api/attendee/clubs/[organizationId]/forms/outings/[outingId]/send/route";
import { OUTING_SLIPS_PER_DAY, outingSendOutcomeText } from "@/modules/club-forms/outing-domain";
import { OUTING_SLIPS_PER_CLUB_DAY, checkClubFormOutingRecipientRateLimit, checkClubFormOutingSendRateLimit } from "@/modules/rate-limit/service";

const request = () => new Request("https://events.imsda.test/x", { method: "POST", headers: { "content-type": "application/json", "user-agent": "director-browser" }, body: JSON.stringify({ memberIds: ["m"] }) });
const context = () => ({ params: Promise.resolve({ organizationId: "club-a", outingId: "outing-1" }) });

beforeEach(() => {
  counts.clear();
  vi.clearAllMocks();
  mocks.requireClubLeaderViewer.mockResolvedValue({ kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "ATTENDEE", accountId: "acct-1" } });
});

describe("an outing send and the real limiter (#1672)", () => {
  it("lets a 35-family send through the route, every address allowed", async () => {
    const outcomes: unknown[] = [];
    mocks.sendOuting.mockImplementation(async (_viewer, _org, _outing, _body, options: { allowRecipient: (email: string, familySize: number) => Promise<unknown> }) => {
      for (let family = 1; family <= 35; family += 1) outcomes.push(await options.allowRecipient(`parent${family}@example.test`, 1));
      return { sent: 35, messageIds: [], results: [] };
    });
    const response = await SEND(request(), context());
    expect(response.status).toBe(200);
    expect(outcomes).toHaveLength(35);
    expect(outcomes.every((outcome) => (outcome as { allowed: boolean }).allowed)).toBe(true);
  });

  it("holds each address to 3 an hour, and says it is the address", async () => {
    const results = [];
    for (let attempt = 0; attempt < 4; attempt += 1) results.push(await checkClubFormOutingRecipientRateLimit("club-a", "outing-1", "Parent@Example.test"));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results[3]).toEqual({ allowed: false, reason: "ADDRESS" });
    expect(outingSendOutcomeText.RATE_LIMITED).toMatch(/3 times in the last hour, or 12 slips in all/);
  });

  it("holds an address to 12 an hour across outings", async () => {
    const results = [];
    for (let outing = 1; outing <= 13; outing += 1) results.push((await checkClubFormOutingRecipientRateLimit("club-a", `outing-${outing}`, "parent@example.test")).allowed);
    expect(results.slice(0, 12).every(Boolean)).toBe(true);
    expect(results[12]).toBe(false);
  });

  it("does not charge the club's day to an address that was refused", async () => {
    const clubDay = () => [...counts].filter(([key]) => key.startsWith("club-form.outing-recipient.club-day")).reduce((total, [, used]) => total + used, 0);
    for (let attempt = 0; attempt < 3; attempt += 1) await checkClubFormOutingRecipientRateLimit("club-a", "outing-1", "parent@example.test");
    expect(clubDay()).toBe(3);
    for (let attempt = 0; attempt < 5; attempt += 1) expect(await checkClubFormOutingRecipientRateLimit("club-a", "outing-1", "parent@example.test")).toEqual({ allowed: false, reason: "ADDRESS" });
    expect(clubDay()).toBe(3);
  });

  it("charges a family's club budget once for each child", async () => {
    await checkClubFormOutingRecipientRateLimit("club-a", "outing-1", "parent@example.test", 4);
    expect([...counts].filter(([key]) => key.startsWith("club-form.outing-recipient.club-day")).reduce((total, [, used]) => total + used, 0)).toBe(4);
  });

  it("holds a club to a daily allowance sized for a roster, and says it is the club's", async () => {
    expect(OUTING_SLIPS_PER_CLUB_DAY).toBe(OUTING_SLIPS_PER_DAY);
    let last;
    for (let family = 1; family <= OUTING_SLIPS_PER_CLUB_DAY + 1; family += 1) last = await checkClubFormOutingRecipientRateLimit("club-a", "outing-1", `family${family}@example.test`);
    expect(last).toEqual({ allowed: false, reason: "CLUB_DAY" });
    // Another club is untouched.
    expect(await checkClubFormOutingRecipientRateLimit("club-b", "outing-1", "family1@example.test")).toEqual({ allowed: true });
    expect(outingSendOutcomeText.CLUB_LIMIT).toContain(String(OUTING_SLIPS_PER_DAY));
  });

  it("charges the send action once, and bounds how often a club can send", async () => {
    const outcomes = [];
    for (let action = 0; action < 101; action += 1) outcomes.push((await checkClubFormOutingSendRateLimit(request(), "acct-1", "club-a")).allowed);
    expect(outcomes.slice(0, 40).every(Boolean)).toBe(true);
    // The per-director hour (40) is the first to run out.
    expect(outcomes[40]).toBe(false);
  });
});
