import { pointItems, type PointItemKey } from "@/modules/club-reports/domain";

/**
 * Area Coordinator item-by-item review of Monthly Records (#1701). Pure rules: which items can be reviewed, what a
 * decision must contain, and how current decisions turn into notices and the one past-due exception. Nothing here
 * reads data. The conference switch is off by default; when it is off none of this shows anywhere.
 */

export type MonthlyRecordItemOutcome = "OK" | "RETURNED";

export const ITEM_NOTE_MAX_LENGTH = 500;

/** The twelve point items. "Submitted by the due date" is worked out by the system and is never reviewed. */
export const REVIEWABLE_ITEM_KEYS: readonly PointItemKey[] = pointItems.map((item) => item.key);

export function isReviewableItemKey(value: unknown): value is PointItemKey {
  return typeof value === "string" && (REVIEWABLE_ITEM_KEYS as readonly string[]).includes(value);
}

export type AreaReviewErrorCode = "NOT_FOUND" | "FEATURE_OFF" | "NOT_SUBMITTED" | "INVALID_DECISION" | "CONFLICT";

export class AreaReviewError extends Error {
  constructor(public readonly code: AreaReviewErrorCode, message: string) {
    super(message);
    this.name = "AreaReviewError";
  }
}

export type ItemDecisionInput = { itemKey: string; outcome: MonthlyRecordItemOutcome; note?: string | null };

/** The checked decision: the note trimmed, required (1 to 500 characters) for a return, optional for OK. */
export function checkItemDecision(input: ItemDecisionInput): { ok: true; itemKey: PointItemKey; outcome: MonthlyRecordItemOutcome; note: string } | { ok: false; message: string } {
  if (!isReviewableItemKey(input.itemKey)) return { ok: false, message: "That item can't be reviewed." };
  if (input.outcome !== "OK" && input.outcome !== "RETURNED") return { ok: false, message: "Choose OK or Return." };
  const note = (input.note ?? "").trim();
  if (note.length > ITEM_NOTE_MAX_LENGTH) return { ok: false, message: `Keep the note to ${ITEM_NOTE_MAX_LENGTH} characters or fewer.` };
  if (input.outcome === "RETURNED" && note.length === 0) return { ok: false, message: "Add a note telling the club what to change." };
  return { ok: true, itemKey: input.itemKey, outcome: input.outcome, note };
}

export type ItemDecision = { itemKey: PointItemKey; outcome: MonthlyRecordItemOutcome; note: string; reviewedAt: string; /** The date in conference time, formatted on the server. */ reviewedOnLabel: string; reviewedByName?: string | null };

export function itemLabel(key: PointItemKey) {
  return pointItems.find((item) => item.key === key)?.label ?? key;
}

export function outcomeLabel(outcome: MonthlyRecordItemOutcome) {
  return outcome === "OK" ? "OK" : "Returned";
}

export function returnedCount(decisions: readonly Pick<ItemDecision, "outcome">[]) {
  return decisions.filter((decision) => decision.outcome === "RETURNED").length;
}

export function hasReturnedItem(decisions: readonly Pick<ItemDecision, "outcome">[]) {
  return returnedCount(decisions) > 0;
}

/** What the director reads above the record, or null when nothing is returned. */
export function returnedNotice(decisions: readonly Pick<ItemDecision, "outcome">[]) {
  const count = returnedCount(decisions);
  if (count === 0) return null;
  return `Your Area Coordinator returned ${count} ${count === 1 ? "item" : "items"}. Change ${count === 1 ? "it" : "them"} and submit again.`;
}

export function decisionsByItem<T extends Pick<ItemDecision, "itemKey">>(decisions: readonly T[]) {
  return Object.fromEntries(decisions.map((decision) => [decision.itemKey, decision])) as Partial<Record<PointItemKey, T>>;
}

/**
 * The one narrow exception to the due-date lock: with the switch on for the record's club year and a current returned
 * item, the club may reopen and resubmit after the due date. Everything else about the lock is unchanged.
 */
export function mayChangeAfterReturn(switchOn: boolean, decisions: readonly Pick<ItemDecision, "outcome">[]) {
  return switchOn && hasReturnedItem(decisions);
}
