import { describe, expect, it } from "vitest";
import {
  assigneeSchema,
  decideIssue,
  expandRange,
  holderKeyOf,
  isValidAssetCode,
  issuanceActionSchema,
  issueRequestSchema,
  lodgingReferenceStatus,
  normalizeAssetCode,
  pickRoomCandidate,
  plausibleOccurredAt,
  sameHolder,
  type DecideInput,
} from "@/modules/issued-assets/domain";

/** Issued assets (#213): the rules every issue path shares, with no database. */

const alice = holderKeyOf({ kind: "ATTENDEE", attendeeId: "att_alice" });
const bob = holderKeyOf({ kind: "ATTENDEE", attendeeId: "att_bob" });
const key = { active: true, mode: "SERIALIZED" as const, assigneeKinds: ["ATTENDEE", "REGISTRATION", "ROOM"] as const };
const packet = { active: true, mode: "QUANTITY" as const, assigneeKinds: ["ATTENDEE", "REGISTRATION"] as const };
const base = (over: Partial<DecideInput>): DecideInput => ({
  type: key, asset: { availability: "AVAILABLE", quantityTotal: 1 }, holder: alice, open: [], quantity: 1, addMore: false, ...over,
});

describe("asset codes", () => {
  it("normalises what staff type and a scanner reads to one form", () => {
    expect(normalizeAssetCode(" k-214 ")).toBe("K-214");
    expect(normalizeAssetCode("bc0000300")).toBe("BC0000300");
  });

  it("accepts letters, numbers and a few separators, and nothing else", () => {
    for (const ok of ["K-214", "WP-27", "A1", "R.1", "RM/4#2"]) expect(isValidAssetCode(ok), ok).toBe(true);
    for (const bad of ["", "-K", "K 214", "K\n214", "K-214;DROP", "x".repeat(65)]) expect(isValidAssetCode(bad), bad).toBe(false);
  });
});

describe("numbered ranges", () => {
  it("expands K-201 to K-260", () => {
    const codes = expandRange("K-", 201, 260);
    expect(codes).toHaveLength(60);
    expect(codes[0]).toBe("K-201");
    expect(codes[59]).toBe("K-260");
  });

  it("upper-cases the prefix, zero-pads and allows no prefix", () => {
    expect(expandRange("k-", 7, 9, 4)).toEqual(["K-0007", "K-0008", "K-0009"]);
    expect(expandRange("", 1, 2)).toEqual(["1", "2"]);
  });

  it("refuses a backwards range, a huge one and a prefix that makes an unusable code", () => {
    expect(() => expandRange("K-", 5, 1)).toThrow(/cannot be below/);
    expect(() => expandRange("K-", 1, 501)).toThrow(/at most 500/);
    expect(() => expandRange("K !", 1, 2)).toThrow(/not a usable code/);
    expect(() => expandRange("K-", 1.5, 2)).toThrow(/whole numbers/);
  });
});

describe("decideIssue: a serialized asset", () => {
  it("issues a free key", () => {
    expect(decideIssue(base({}))).toEqual({ outcome: "ISSUE", quantity: 1 });
  });

  it("treats a second scan for the same holder as a duplicate, not an error", () => {
    expect(decideIssue(base({ open: [{ id: "iss_1", quantity: 1, holder: alice }] }))).toEqual({ outcome: "DUPLICATE", issuanceId: "iss_1" });
  });

  it("refuses a key held by someone else", () => {
    const decision = decideIssue(base({ holder: bob, open: [{ id: "iss_1", quantity: 1, holder: alice }] }));
    expect(decision).toMatchObject({ outcome: "REJECT", code: "ALREADY_ISSUED" });
  });

  it("issues one at a time", () => {
    expect(decideIssue(base({ quantity: 2 }))).toMatchObject({ outcome: "REJECT", code: "QUANTITY_INVALID" });
  });

  it("refuses a switched-off kind, an unavailable or retired key, and a holder the kind does not allow", () => {
    expect(decideIssue(base({ type: { ...key, active: false } }))).toMatchObject({ code: "TYPE_INACTIVE" });
    expect(decideIssue(base({ asset: { availability: "UNAVAILABLE", quantityTotal: 1 } }))).toMatchObject({ code: "ASSET_UNAVAILABLE" });
    expect(decideIssue(base({ asset: { availability: "RETIRED", quantityTotal: 1 } }))).toMatchObject({ code: "ASSET_UNAVAILABLE", message: "That item is retired." });
    expect(decideIssue(base({ holder: { kind: "STAFF", ref: "usr_1" } }))).toMatchObject({ code: "ASSIGNEE_KIND_NOT_ALLOWED" });
  });
});

describe("decideIssue: a quantity lot", () => {
  const lot = (total: number, open: DecideInput["open"], over: Partial<DecideInput> = {}) => base({ type: packet, asset: { availability: "AVAILABLE", quantityTotal: total }, open, ...over });

  it("issues up to what is left and never past it", () => {
    expect(decideIssue(lot(5, [{ id: "i1", quantity: 3, holder: bob }], { quantity: 2 }))).toEqual({ outcome: "ISSUE", quantity: 2 });
    expect(decideIssue(lot(5, [{ id: "i1", quantity: 3, holder: bob }], { quantity: 3 }))).toMatchObject({ code: "INSUFFICIENT_QUANTITY", message: "Only 2 left to issue." });
  });

  it("says none are left when the lot is spent", () => {
    expect(decideIssue(lot(2, [{ id: "i1", quantity: 2, holder: bob }]))).toMatchObject({ code: "INSUFFICIENT_QUANTITY", message: "None left to issue." });
  });

  it("treats a repeated tap for the same holder as a duplicate unless more is asked for", () => {
    const open = [{ id: "i1", quantity: 1, holder: alice }];
    expect(decideIssue(lot(5, open))).toEqual({ outcome: "DUPLICATE", issuanceId: "i1" });
    expect(decideIssue(lot(5, open, { addMore: true }))).toEqual({ outcome: "ISSUE", quantity: 1 });
  });

  it("counts every open issue against the lot, whoever holds it", () => {
    const open = [{ id: "i1", quantity: 2, holder: bob }, { id: "i2", quantity: 2, holder: { kind: "REGISTRATION" as const, ref: "reg_1" } }];
    expect(decideIssue(lot(4, open))).toMatchObject({ code: "INSUFFICIENT_QUANTITY" });
  });
});

describe("holders", () => {
  it("keys each kind by its own reference, and a label ignoring case", () => {
    expect(holderKeyOf({ kind: "REGISTRATION", registrationId: "reg_1" })).toEqual({ kind: "REGISTRATION", ref: "reg_1" });
    expect(holderKeyOf({ kind: "TEAM", assigneeLabel: " Kitchen " })).toEqual({ kind: "TEAM", ref: "KITCHEN" });
    expect(sameHolder(holderKeyOf({ kind: "TEAM", assigneeLabel: "kitchen" }), holderKeyOf({ kind: "TEAM", assigneeLabel: "KITCHEN" }))).toBe(true);
  });

  it("never treats an empty reference as the same holder, and a room key's room is not the holder", () => {
    expect(sameHolder({ kind: "ATTENDEE", ref: "" }, { kind: "ATTENDEE", ref: "" })).toBe(false);
    expect(holderKeyOf({ kind: "ATTENDEE", attendeeId: "att_1", roomUnitId: "unit_1" })).toEqual({ kind: "ATTENDEE", ref: "att_1" });
    expect(holderKeyOf({ kind: "ROOM", roomUnitId: "unit_1" })).toEqual({ kind: "ROOM", ref: "unit_1" });
  });
});

describe("room links", () => {
  const rows = (...specs: Array<[string, string, string, string]>) => specs.map(([assignmentId, unitId, firstNight, lastNight]) => ({ assignmentId, unitId, firstNight, lastNight }));

  it("refuses a holder with no room", () => {
    expect(pickRoomCandidate([], "2027-06-16")).toEqual({ ok: false, code: "ROOM_ASSIGNMENT_REQUIRED" });
  });

  it("takes the one room, preferring the stay that covers the night", () => {
    const picked = pickRoomCandidate(rows(["a1", "u1", "2027-06-15", "2027-06-15"], ["a2", "u1", "2027-06-16", "2027-06-18"]), "2027-06-17");
    expect(picked).toMatchObject({ ok: true, candidate: { assignmentId: "a2" } });
    expect(pickRoomCandidate(rows(["a1", "u1", "2027-06-15", "2027-06-15"], ["a2", "u1", "2027-06-16", "2027-06-18"]), "2027-06-30")).toMatchObject({ ok: true, candidate: { assignmentId: "a1" } });
  });

  it("asks for a choice when the holder has more than one room", () => {
    expect(pickRoomCandidate(rows(["a1", "u1", "2027-06-15", "2027-06-16"], ["a2", "u2", "2027-06-17", "2027-06-18"]), "2027-06-17")).toEqual({ ok: false, code: "ROOM_ASSIGNMENT_AMBIGUOUS" });
  });

  it("reads where the lodging stands against the remembered room", () => {
    expect(lodgingReferenceStatus(null, [], null)).toBeNull();
    expect(lodgingReferenceStatus({ cancelledAt: null }, ["u2"], "u1")).toBe("CURRENT");
    expect(lodgingReferenceStatus({ cancelledAt: new Date() }, ["u2"], "u1")).toBe("MOVED");
    expect(lodgingReferenceStatus({ cancelledAt: new Date() }, [], "u1")).toBe("RELEASED");
    // The assignment was re-cut (a split stay) but the family is still in the key's room.
    expect(lodgingReferenceStatus({ cancelledAt: new Date() }, ["u1"], "u1")).toBe("CURRENT");
  });
});

describe("request schemas", () => {
  const items = [{ code: "K-214" }, { code: "K-215" }];

  it("defaults a request to a manual, non-atomic issue 'at check-in'", () => {
    const parsed = issueRequestSchema.parse({ assignee: { kind: "ATTENDEE", attendeeId: "att_1" }, items });
    expect(parsed).toMatchObject({ entryMethod: "MANUAL", atomic: false, purpose: "Issued at check-in" });
    expect(parsed.items[0]).toEqual({ code: "K-214", quantity: 1, addMore: false });
  });

  it("limits a request to 50 items and requires at least one", () => {
    expect(issueRequestSchema.safeParse({ assignee: { kind: "ATTENDEE", attendeeId: "a" }, items: [] }).success).toBe(false);
    expect(issueRequestSchema.safeParse({ assignee: { kind: "ATTENDEE", attendeeId: "a" }, items: Array.from({ length: 51 }, (_, index) => ({ code: `K-${index}` })) }).success).toBe(false);
  });

  it("accepts a stated time only from an offline entry", () => {
    const occurredAt = "2027-06-15T18:00:00Z";
    expect(issueRequestSchema.safeParse({ assignee: { kind: "ATTENDEE", attendeeId: "a" }, items, occurredAt }).success).toBe(false);
    expect(issueRequestSchema.safeParse({ assignee: { kind: "ATTENDEE", attendeeId: "a" }, items, occurredAt, entryMethod: "OFFLINE" }).success).toBe(true);
  });

  it("rejects unknown fields and holder kinds without their reference", () => {
    expect(issueRequestSchema.safeParse({ assignee: { kind: "ATTENDEE", attendeeId: "a" }, items, surprise: true }).success).toBe(false);
    expect(assigneeSchema.safeParse({ kind: "ROOM" }).success).toBe(false);
    expect(assigneeSchema.safeParse({ kind: "TEAM", label: " " }).success).toBe(false);
    expect(assigneeSchema.safeParse({ kind: "TEAM", label: "Kitchen" }).success).toBe(true);
  });

  it("requires a reason to transfer, replace or correct", () => {
    expect(issuanceActionSchema.safeParse({ action: "correct", reason: " " }).success).toBe(false);
    expect(issuanceActionSchema.safeParse({ action: "replace", replacementCode: "K-300", reason: "Lost the key" }).success).toBe(true);
    expect(issuanceActionSchema.safeParse({ action: "transfer", to: { kind: "ATTENDEE", attendeeId: "a" }, reason: "" }).success).toBe(false);
  });
});

describe("offline times", () => {
  const now = new Date("2027-06-15T18:00:00Z");

  it("accepts a recent moment, and a clock a few minutes fast", () => {
    expect(plausibleOccurredAt(new Date("2027-06-15T16:00:00Z"), now)).toBe(true);
    expect(plausibleOccurredAt(new Date("2027-06-15T18:03:00Z"), now)).toBe(true);
  });

  it("refuses the future and the stale", () => {
    expect(plausibleOccurredAt(new Date("2027-06-15T19:00:00Z"), now)).toBe(false);
    expect(plausibleOccurredAt(new Date("2027-05-01T00:00:00Z"), now)).toBe(false);
  });
});
