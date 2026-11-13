import { describe, expect, it } from "vitest";
import {
  ITEM_NOTE_MAX_LENGTH,
  REVIEWABLE_ITEM_KEYS,
  checkItemDecision,
  decisionsByItem,
  hasReturnedItem,
  isReviewableItemKey,
  itemLabel,
  mayChangeAfterReturn,
  outcomeLabel,
  returnedCount,
  returnedNotice,
} from "@/modules/club-reports/area-review-domain";
import { itemReviewSchema } from "@/modules/club-reports/area-review-schemas";
import { pointItems } from "@/modules/club-reports/domain";

/** The pure rules of Area Coordinator item review (#1701). Synthetic data only. */

const decision = (itemKey: string, outcome: "OK" | "RETURNED") => ({ itemKey: itemKey as never, outcome, note: "", reviewedAt: "2026-11-12T15:00:00.000Z", reviewedOnLabel: "Nov 12, 2026" });

describe("which items can be reviewed", () => {
  it("is exactly the twelve point items, never the on-time points", () => {
    expect(REVIEWABLE_ITEM_KEYS).toHaveLength(12);
    expect([...REVIEWABLE_ITEM_KEYS]).toEqual(pointItems.map((item) => item.key));
    expect(isReviewableItemKey("staffMeeting")).toBe(true);
    expect(isReviewableItemKey("bonus")).toBe(true);
    expect(isReviewableItemKey("onTime")).toBe(false);
    expect(isReviewableItemKey("onTimePoints")).toBe(false);
    expect(isReviewableItemKey(undefined)).toBe(false);
  });
  it("labels items and outcomes for people", () => {
    expect(itemLabel("staffMeeting")).toBe("Monthly staff meeting");
    expect(outcomeLabel("OK")).toBe("OK");
    expect(outcomeLabel("RETURNED")).toBe("Returned");
  });
});

describe("a decision", () => {
  it("needs a trimmed note of 1 to 500 characters to return an item", () => {
    expect(checkItemDecision({ itemKey: "ratio", outcome: "RETURNED", note: "  Please recount.  " })).toEqual({ ok: true, itemKey: "ratio", outcome: "RETURNED", note: "Please recount." });
    expect(checkItemDecision({ itemKey: "ratio", outcome: "RETURNED", note: "   " })).toMatchObject({ ok: false });
    expect(checkItemDecision({ itemKey: "ratio", outcome: "RETURNED" })).toMatchObject({ ok: false });
    expect(checkItemDecision({ itemKey: "ratio", outcome: "RETURNED", note: "x".repeat(ITEM_NOTE_MAX_LENGTH) })).toMatchObject({ ok: true });
    expect(checkItemDecision({ itemKey: "ratio", outcome: "RETURNED", note: "x".repeat(ITEM_NOTE_MAX_LENGTH + 1) })).toMatchObject({ ok: false });
  });
  it("may leave the note empty for OK, still trims it and caps it", () => {
    expect(checkItemDecision({ itemKey: "ratio", outcome: "OK" })).toEqual({ ok: true, itemKey: "ratio", outcome: "OK", note: "" });
    expect(checkItemDecision({ itemKey: "ratio", outcome: "OK", note: " fine " })).toMatchObject({ note: "fine" });
    expect(checkItemDecision({ itemKey: "ratio", outcome: "OK", note: "x".repeat(501) })).toMatchObject({ ok: false });
  });
  it("refuses an unknown item or outcome", () => {
    expect(checkItemDecision({ itemKey: "onTime", outcome: "OK" })).toMatchObject({ ok: false });
    expect(checkItemDecision({ itemKey: "ratio", outcome: "MAYBE" as never })).toMatchObject({ ok: false });
  });
});

describe("the route body", () => {
  const body = { organizationId: "club-1", month: "2026-10", itemKey: "ratio", outcome: "OK", version: "2026-11-05T15:00:00.000Z" };
  it("accepts exactly the known fields", () => {
    expect(itemReviewSchema.parse(body)).toEqual(body);
    expect(() => itemReviewSchema.parse({ ...body, extra: 1 })).toThrow();
    expect(() => itemReviewSchema.parse({ ...body, itemKey: "onTime" })).toThrow();
    expect(() => itemReviewSchema.parse({ ...body, month: "2026-13" })).toThrow();
    expect(() => itemReviewSchema.parse({ ...body, outcome: "NO" })).toThrow();
    expect(() => itemReviewSchema.parse({ ...body, version: undefined })).toThrow();
  });
});

describe("returned items", () => {
  it("counts them and words the director's notice", () => {
    const list = [decision("ratio", "RETURNED"), decision("devotions", "OK")];
    expect(returnedCount(list)).toBe(1);
    expect(hasReturnedItem(list)).toBe(true);
    expect(returnedNotice(list)).toBe("Your Area Coordinator returned 1 item. Change it and submit again.");
    expect(returnedNotice([...list, decision("outreach", "RETURNED")])).toBe("Your Area Coordinator returned 2 items. Change them and submit again.");
    expect(returnedNotice([decision("devotions", "OK")])).toBeNull();
    expect(returnedNotice([])).toBeNull();
  });
  it("looks decisions up by item", () => {
    expect(decisionsByItem([decision("ratio", "OK")]).ratio?.outcome).toBe("OK");
  });
  it("allows a change after the due date only with the switch on and a returned item", () => {
    expect(mayChangeAfterReturn(true, [decision("ratio", "RETURNED")])).toBe(true);
    expect(mayChangeAfterReturn(false, [decision("ratio", "RETURNED")])).toBe(false);
    expect(mayChangeAfterReturn(true, [decision("ratio", "OK")])).toBe(false);
    expect(mayChangeAfterReturn(true, [])).toBe(false);
  });
});
