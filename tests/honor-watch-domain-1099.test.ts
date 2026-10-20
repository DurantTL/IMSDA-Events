import { describe, expect, it } from "vitest";
import { CLASS_CHANGE_RETENTION_DAYS, classSummaryWindow, netClassChanges, type LoggedClassChange } from "@/modules/honors/class-change-domain";
import {
  HONOR_WATCHES_MAX_PER_EVENT,
  HONOR_WATCH_MAX_RECIPIENTS,
  buildHonorWatchSummary,
  checkWatchRecipients,
  honorWatchIdempotencyKey,
  honorWatchesPutSchema,
  sameIdSet,
  watchMatchesClass,
  watchWindow,
} from "@/modules/honors/watch-domain";

/** Honor watch rules (#1099): matching by honor and class, the window, the wording and the limits. Synthetic data only. */

const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);

function change(overrides: Partial<LoggedClassChange> & Pick<LoggedClassChange, "id" | "kind" | "at">): LoggedClassChange {
  return { offeringId: "class-1", registrationAttendeeId: "kid-1", youthName: "Pat Example", clubName: "Synthetic Club", ageOnEventDate: 12, ...overrides };
}

describe("which classes a watch looks at", () => {
  it("matches a class that teaches a watched honor", () => {
    expect(watchMatchesClass({ honorIds: ["birds"], offeringIds: [] }, { id: "c1", honorIds: ["birds"] })).toBe(true);
    expect(watchMatchesClass({ honorIds: ["birds"], offeringIds: [] }, { id: "c1", honorIds: ["knots"] })).toBe(false);
  });

  it("matches a class that teaches several honors through any one of them (#812)", () => {
    const multi = { id: "c2", honorIds: ["birds", "knots", "fire"] };
    expect(watchMatchesClass({ honorIds: ["fire"], offeringIds: [] }, multi)).toBe(true);
    expect(watchMatchesClass({ honorIds: ["birds"], offeringIds: [] }, multi)).toBe(true);
    expect(watchMatchesClass({ honorIds: ["stars"], offeringIds: [] }, multi)).toBe(false);
  });

  it("matches a chosen class whatever it teaches, and only that class", () => {
    expect(watchMatchesClass({ honorIds: [], offeringIds: ["c3"] }, { id: "c3", honorIds: ["anything"] })).toBe(true);
    expect(watchMatchesClass({ honorIds: [], offeringIds: ["c3"] }, { id: "c4", honorIds: ["anything"] })).toBe(false);
  });

  it("matches nothing when the watch looks at nothing", () => {
    expect(watchMatchesClass({ honorIds: [], offeringIds: [] }, { id: "c1", honorIds: ["birds"] })).toBe(false);
  });
});

describe("what a watch reports", () => {
  it("drops a join followed by a leave, using the same netting as the instructor summary", () => {
    const rows = [
      change({ id: "a", kind: "JOINED", at: at("2026-11-02T14:00:00Z") }),
      change({ id: "b", kind: "LEFT", at: at("2026-11-02T15:00:00Z") }),
      change({ id: "c", kind: "JOINED", registrationAttendeeId: "kid-2", youthName: "Sam Example", at: at("2026-11-02T16:00:00Z") }),
    ];
    expect(netClassChanges(rows).map((row) => row.youthName)).toEqual(["Sam Example"]);
  });

  it("starts a window at the later of the last summary and the watch's creation", () => {
    const until = at("2026-11-03T12:00:00Z");
    expect(watchWindow({ summaryAt: null, createdAt: at("2026-11-01T10:00:00Z") }, until).since).toEqual(at("2026-11-01T10:00:00Z"));
    expect(watchWindow({ summaryAt: at("2026-11-02T12:00:00Z"), createdAt: at("2026-11-01T10:00:00Z") }, until).since).toEqual(at("2026-11-02T12:00:00Z"));
    expect(watchWindow({ summaryAt: at("2026-10-01T12:00:00Z"), createdAt: at("2026-11-02T20:00:00Z") }, until).since).toEqual(at("2026-11-02T20:00:00Z"));
  });

  it("keeps a daily window inside the log's retention, so a pruned row is never one a window still needs", () => {
    // Every day the watch is due its point moves to that day's cutoff, so the next window is one day long.
    const first = classSummaryWindow(at("2026-11-02T13:00:00Z"));
    const next = classSummaryWindow(at("2026-11-03T13:00:00Z"));
    expect(next.sendAt.getTime() - first.sendAt.getTime()).toBeLessThanOrEqual(DAY + 60 * 60 * 1000);
    expect(CLASS_CHANGE_RETENTION_DAYS * DAY).toBeGreaterThan(2 * DAY);
  });

  it("is keyed by watch, Central date and address, so a second sweep reuses the message", () => {
    expect(honorWatchIdempotencyKey("w1", "2026-11-03", "a@example.test")).toBe("honor-watch-summary:w1:2026-11-03:a@example.test");
    expect(honorWatchIdempotencyKey("w1", "2026-11-03", "b@example.test")).not.toBe(honorWatchIdempotencyKey("w1", "2026-11-03", "a@example.test"));
    expect(honorWatchIdempotencyKey("w1", "2026-11-04", "a@example.test")).not.toBe(honorWatchIdempotencyKey("w1", "2026-11-03", "a@example.test"));
  });
});

describe("the summary email", () => {
  const body = buildHonorWatchSummary({
    watchName: "Nature honors",
    eventName: "Synthetic Honors Weekend",
    classes: [{
      offeringId: "c1",
      className: "Birds + Knots",
      session: "Sabbath afternoon",
      joined: [{ youthName: "Pat Example", clubName: "Synthetic Club", ageOnEventDate: 12 }],
      left: [{ youthName: "Sam Example", clubName: null, ageOnEventDate: null }],
    }],
  });

  it("names the youth by name, club and age, the class and time, and joined or left", () => {
    expect(body.bodyText).toContain("Birds + Knots (Sabbath afternoon)");
    expect(body.bodyText).toContain("Joined: Pat Example (Synthetic Club, age 12)");
    expect(body.bodyText).toContain("Left: Sam Example");
    expect(body.subject).toBe('Honor watch "Nature honors" at Synthetic Honors Weekend');
    expect(body).toMatchObject({ changes: 2, joined: 1, left: 1 });
  });

  it("never carries a birth date", () => {
    expect(body.bodyText).not.toMatch(/birth|dob/i);
  });
});

describe("the limits", () => {
  const watch = { name: "Nature", recipients: ["a@example.test"], honorIds: ["h1"], offeringIds: [] };

  it("allows 20 watches an event and no more", () => {
    expect(HONOR_WATCHES_MAX_PER_EVENT).toBe(20);
    expect(honorWatchesPutSchema.safeParse({ watches: Array.from({ length: 20 }, () => watch) }).success).toBe(true);
    expect(honorWatchesPutSchema.safeParse({ watches: Array.from({ length: 21 }, () => watch) }).success).toBe(false);
  });

  it("rejects an unknown field and a name that is too short", () => {
    expect(honorWatchesPutSchema.safeParse({ watches: [{ ...watch, extra: 1 }] }).success).toBe(false);
    expect(honorWatchesPutSchema.safeParse({ watches: [{ ...watch, name: "x" }] }).success).toBe(false);
  });

  it("allows ten typed addresses, lower-cased and de-duplicated, and nothing malformed", () => {
    expect(HONOR_WATCH_MAX_RECIPIENTS).toBe(10);
    const ten = Array.from({ length: 10 }, (_, index) => `Person${index}@Example.test`);
    const ok = checkWatchRecipients(ten);
    expect(ok.ok && ok.emails).toHaveLength(10);
    expect(ok.ok && ok.emails[0]).toBe("person0@example.test");
    expect(checkWatchRecipients([...ten, "extra@example.test"]).ok).toBe(false);
    expect(checkWatchRecipients(["not an address"]).ok).toBe(false);
    expect(checkWatchRecipients([]).ok).toBe(false);
    const twice = checkWatchRecipients(["a@example.test", "A@example.test"]);
    expect(twice.ok && twice.emails).toEqual(["a@example.test"]);
  });

  it("compares honor sets ignoring order and repeats", () => {
    expect(sameIdSet(["a", "b"], ["b", "a", "a"])).toBe(true);
    expect(sameIdSet(["a"], ["a", "b"])).toBe(false);
  });
});
