import { describe, expect, it } from "vitest";
import {
  notRestoredNotice,
  notRestoredReasonText,
  notRestoredReport,
  planRestore,
  type NotRestoredPick,
  type RestoreCounts,
} from "@/modules/honors/restore-domain";

const counts = (overrides: Partial<Record<keyof RestoreCounts, Record<string, number>>> = {}): RestoreCounts => ({
  taken: new Map(Object.entries(overrides.taken ?? {})),
  reserved: new Map(Object.entries(overrides.reserved ?? {})),
  clubTaken: new Map(Object.entries(overrides.clubTaken ?? {})),
  clubReserved: new Map(Object.entries(overrides.clubReserved ?? {})),
});
const offerings = (rows: Record<string, { capacity: number; perClubLimit?: number | null }>) =>
  new Map(Object.entries(rows).map(([id, row]) => [id, { capacity: row.capacity, perClubLimit: row.perClubLimit ?? null }]));
const pick = (id: string, offeringId: string, consumesSeat = true) => ({ id, offeringId, consumesSeat });

describe("restoring class picks (#880): which picks still fit", () => {
  it("keeps every pick when the classes have room", () => {
    const plan = planRestore([pick("a", "c1"), pick("b", "c2")], offerings({ c1: { capacity: 2 }, c2: { capacity: 1 } }), counts({ taken: { c1: 1 } }));
    expect(plan).toEqual({ keep: ["a", "b"], dropped: [], keptOver: [] });
  });

  it("drops a pick whose class was filled in the meantime", () => {
    const plan = planRestore([pick("a", "c1"), pick("b", "c2")], offerings({ c1: { capacity: 2 }, c2: { capacity: 3 } }), counts({ taken: { c1: 2 } }));
    expect(plan.keep).toEqual(["b"]);
    expect(plan.dropped).toEqual([{ pickId: "a", offeringId: "c1", reason: "CLASS_FULL" }]);
  });

  it("counts seats held for live waitlist offers as taken", () => {
    const plan = planRestore([pick("a", "c1")], offerings({ c1: { capacity: 2 } }), counts({ taken: { c1: 1 }, reserved: { c1: 1 } }));
    expect(plan.dropped.map((entry) => entry.reason)).toEqual(["CLASS_FULL"]);
  });

  it("counts the picks it keeps here, so several of one registration never overfill a class", () => {
    const plan = planRestore([pick("a", "c1"), pick("b", "c1"), pick("c", "c1")], offerings({ c1: { capacity: 2 } }), counts());
    expect(plan.keep).toEqual(["a", "b"]);
    expect(plan.dropped.map((entry) => entry.pickId)).toEqual(["c"]);
  });

  it("drops a pick that would pass the per-club limit, and says so", () => {
    const plan = planRestore(
      [pick("a", "c1"), pick("b", "c1")],
      offerings({ c1: { capacity: 10, perClubLimit: 2 } }),
      counts({ clubTaken: { c1: 1 } }),
    );
    expect(plan.keep).toEqual(["a"]);
    expect(plan.dropped).toEqual([{ pickId: "b", offeringId: "c1", reason: "CLUB_LIMIT_REACHED" }]);
  });

  it("counts the club's live offers toward its limit", () => {
    const plan = planRestore([pick("a", "c1")], offerings({ c1: { capacity: 10, perClubLimit: 1 } }), counts({ clubReserved: { c1: 1 } }));
    expect(plan.dropped.map((entry) => entry.reason)).toEqual(["CLUB_LIMIT_REACHED"]);
  });

  it("reports a full class before a club limit", () => {
    const plan = planRestore([pick("a", "c1")], offerings({ c1: { capacity: 1, perClubLimit: 1 } }), counts({ taken: { c1: 1 }, clubTaken: { c1: 1 } }));
    expect(plan.dropped.map((entry) => entry.reason)).toEqual(["CLASS_FULL"]);
  });

  it("never drops a pick with attendance or completion marks: it stays, flagged, and counts against the class", () => {
    const plan = planRestore(
      [pick("plain", "c1"), { ...pick("marked", "c1"), hasMarks: true }],
      offerings({ c1: { capacity: 1 } }),
      counts(),
    );
    expect(plan.keep.sort()).toEqual(["marked"]);
    expect(plan.dropped.map((entry) => entry.pickId)).toEqual(["plain"]);
    const full = planRestore([{ ...pick("marked", "c1"), hasMarks: true }], offerings({ c1: { capacity: 1 } }), counts({ taken: { c1: 1 } }));
    expect(full.keep).toEqual(["marked"]);
    expect(full.dropped).toEqual([]);
    expect(full.keptOver).toEqual([{ pickId: "marked", offeringId: "c1", reason: "CLASS_FULL", because: "HAS_MARKS" }]);
  });

  it("drops nothing once class changes have closed, and flags what is over capacity", () => {
    const plan = planRestore(
      [pick("a", "c1"), pick("b", "c2")],
      offerings({ c1: { capacity: 1 }, c2: { capacity: 5, perClubLimit: 1 } }),
      counts({ taken: { c1: 1 }, clubTaken: { c2: 1 } }),
      false,
    );
    expect(plan.keep).toEqual(["a", "b"]);
    expect(plan.dropped).toEqual([]);
    expect(plan.keptOver).toEqual([
      { pickId: "a", offeringId: "c1", reason: "CLASS_FULL", because: "CLASS_CHANGES_CLOSED" },
      { pickId: "b", offeringId: "c2", reason: "CLUB_LIMIT_REACHED", because: "CLASS_CHANGES_CLOSED" },
    ]);
  });

  it("always keeps picks that take no seat, and picks for a class it can't find", () => {
    const plan = planRestore(
      [pick("staff", "c1", false), pick("gone", "missing")],
      offerings({ c1: { capacity: 1, perClubLimit: 1 } }),
      counts({ taken: { c1: 5 }, clubTaken: { c1: 5 } }),
    );
    expect(plan).toEqual({ keep: ["staff", "gone"], dropped: [], keptOver: [] });
  });

  it("does not let a dropped pick use up room", () => {
    const plan = planRestore([pick("a", "c1"), pick("b", "c2"), pick("c", "c2")], offerings({ c1: { capacity: 1 }, c2: { capacity: 1 } }), counts({ taken: { c1: 1 } }));
    expect(plan.keep).toEqual(["b"]);
    expect(plan.dropped.map((entry) => entry.pickId)).toEqual(["a", "c"]);
  });
});

const full: NotRestoredPick = { youthName: "Test Youth", className: "Knot Tying", sessionName: "Session One", reason: "CLASS_FULL", perClubLimit: null, ownerKind: "club" };
const limited: NotRestoredPick = { youthName: "Test Other", className: "Birds", sessionName: null, reason: "CLUB_LIMIT_REACHED", perClubLimit: 2, ownerKind: "club" };

describe("restoring class picks (#880): the staff report and the director's notice", () => {
  it("gives a plain reason for each kind of drop", () => {
    expect(notRestoredReasonText(full)).toMatch(/class filled up/);
    expect(notRestoredReasonText(limited)).toBe("the class allows 2 youth per club and that limit was already reached");
    expect(notRestoredReasonText({ ...limited, ownerKind: "group" })).toMatch(/per group/);
  });

  it("lists each pick that was not restored with its class, session and reason", () => {
    expect(notRestoredReport([full, limited])).toEqual([
      "Test Youth: Knot Tying (Session One) was not restored because the class filled up while the registration was not active.",
      "Test Other: Birds was not restored because the class allows 2 youth per club and that limit was already reached.",
    ]);
    expect(notRestoredReport([])).toEqual([]);
  });

  const open = { changesOpen: true, ownerKind: "club" as const };

  it("writes one notice naming every dropped class, what to do next, and the link", () => {
    const notice = notRestoredNotice({ directorName: "Pat Director", eventName: "Honors Weekend", items: [full, limited], link: "https://events.example.test/account/clubs/c/events/e", ...open });
    expect(notice.subject).toBe("2 class picks were not restored for Honors Weekend");
    expect(notice.text).toContain("Hello Pat Director,");
    expect(notice.text).toContain("- Test Youth: Knot Tying (Session One) was not restored");
    expect(notice.text).toContain("- Test Other: Birds was not restored");
    expect(notice.text).toMatch(/choose another class .* join the class waitlist/);
    expect(notice.text).toContain("https://events.example.test/account/clubs/c/events/e");
  });

  it("uses singular wording for one pick and a fallback greeting without a name", () => {
    const notice = notRestoredNotice({ directorName: "", eventName: "Honors Weekend", items: [full], link: "https://events.example.test", ...open });
    expect(notice.subject).toBe("A class pick was not restored for Honors Weekend");
    expect(notice.text).toContain("Hello there,");
    expect(notice.text).toContain("One Honors Weekend class pick could not come back");
  });

  it("offers no waitlist to a group, which has none", () => {
    const notice = notRestoredNotice({ directorName: "Pat", eventName: "Honors Weekend", items: [{ ...full, ownerKind: "group" }], link: "__LINK__", changesOpen: true, ownerKind: "group" });
    expect(notice.text).toMatch(/choose another class for these youth on your registration page/);
    expect(notice.text).not.toMatch(/waitlist/);
    expect(notice.text).toContain("__LINK__");
  });

  it("promises no re-picking when class changes have closed", () => {
    const notice = notRestoredNotice({ directorName: "Pat", eventName: "Honors Weekend", items: [full], link: "https://events.example.test", changesOpen: false, ownerKind: "club" });
    expect(notice.text).toMatch(/Class changes have closed, so please contact the event office/);
    expect(notice.text).not.toMatch(/choose another class|join the class waitlist|https:\/\/events/);
  });

  it("says staff will follow up for picks kept over capacity, and reports them to staff in the same words", () => {
    const kept: NotRestoredPick = { ...full, keptBecause: "CLASS_CHANGES_CLOSED" };
    const marked: NotRestoredPick = { ...limited, keptBecause: "HAS_MARKS" };
    expect(notRestoredReport([kept, marked])).toEqual([
      "Test Youth: Knot Tying (Session One) kept over capacity after class changes closed (the class filled up while the registration was not active).",
      "Test Other: Birds kept over capacity: already has attendance or completion marks (the class allows 2 youth per club and that limit was already reached).",
    ]);
    const notice = notRestoredNotice({ directorName: "Pat", eventName: "Honors Weekend", items: [kept], link: "https://events.example.test", changesOpen: false, ownerKind: "club" });
    expect(notice.subject).toBe("A class pick needs follow-up for Honors Weekend");
    expect(notice.text).toMatch(/Staff will follow up/);
    expect(notice.text).not.toMatch(/could not come back|choose another class/);
  });
});
