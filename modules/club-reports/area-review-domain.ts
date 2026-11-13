import { pointItems, type PickedPoints, type PointItemKey, type ReportHonor } from "@/modules/club-reports/domain";

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

/**
 * The conference switch for a club year (#1701): that year's own setting when it has one, otherwise the setting of the
 * latest earlier year (so it carries over into the next club year), otherwise off. `null` means "no row".
 */
export function areaReviewSwitchChoice(thisYear: boolean | null | undefined, latestEarlier: boolean | null | undefined) {
  return thisYear ?? latestEarlier ?? false;
}

/** The record fields a director may not change after the due date, even with a returned item. */
export type LockableRecordFields = {
  meetingPlace?: string | null;
  meetingSchedule?: string | null;
  averageAttendance?: number | null;
  pathfinderCount?: number | null;
  tltCount?: number | null;
  staffCount?: number | null;
  investitureDate?: string | null;
  classLevels?: readonly string[] | null;
  points?: PickedPoints | null;
  honors?: readonly ReportHonor[] | null;
};

const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? "") === (b ?? "");
const sameCount = (a: number | null | undefined, b: number | null | undefined) => (a ?? null) === (b ?? null);
const sameLevels = (a: readonly string[] | null | undefined, b: readonly string[] | null | undefined) => {
  const left = [...new Set(a ?? [])].sort();
  const right = [...new Set(b ?? [])].sort();
  return left.length === right.length && left.every((level, index) => level === right[index]);
};
const keptHonors = (honors: readonly ReportHonor[] | null | undefined) =>
  (honors ?? []).filter((honor) => honor.name.trim() || honor.participants !== null).map((honor) => [honor.name.trim(), honor.participants ?? null] as const);
const sameHonors = (a: LockableRecordFields["honors"], b: LockableRecordFields["honors"]) => JSON.stringify(keptHonors(a)) === JSON.stringify(keptHonors(b));

/**
 * After the due date, a record reopened by an Area Coordinator's return may change only its returned items (#1701).
 * Compares the incoming record with the stored one and names what would change but is locked: a point item that is not
 * returned, the club facts, and the honors list or class levels unless their own item ("honors", "classLevel") is
 * returned. The signature is never compared. Returns the plain names, in form order; empty means the change is allowed.
 */
export function lockedChanges(stored: LockableRecordFields, incoming: LockableRecordFields, returnedKeys: readonly PointItemKey[]): string[] {
  const returned = new Set<string>(returnedKeys);
  const names: string[] = [];
  if (!sameText(stored.meetingPlace, incoming.meetingPlace)) names.push("Meeting place");
  if (!sameText(stored.meetingSchedule, incoming.meetingSchedule)) names.push("Meeting day and time");
  if (!sameCount(stored.averageAttendance, incoming.averageAttendance)) names.push("Average attendance");
  if (!sameCount(stored.pathfinderCount, incoming.pathfinderCount)) names.push("Number of members");
  if (!sameCount(stored.tltCount, incoming.tltCount)) names.push("Number of TLTs");
  if (!sameCount(stored.staffCount, incoming.staffCount)) names.push("Number of staff");
  if (!sameText(stored.investitureDate, incoming.investitureDate)) names.push("Investiture date");
  for (const item of pointItems) {
    if (returned.has(item.key)) continue;
    if ((stored.points?.[item.key] ?? null) !== (incoming.points?.[item.key] ?? null)) names.push(item.label);
  }
  if (!returned.has("classLevel") && !sameLevels(stored.classLevels, incoming.classLevels)) names.push("Class levels worked on");
  if (!returned.has("honors") && !sameHonors(stored.honors, incoming.honors)) names.push("Honors worked on");
  return names;
}

export function lockedChangesMessage(names: readonly string[]) {
  return `Your Area Coordinator returned only some items, so after the due date you can change only the items marked Returned. Locked: ${names.join(", ")}.`;
}

/** Shown above the form while only the returned items can be changed. */
export const RETURNED_ONLY_NOTE = "Your Area Coordinator returned only the items marked Returned. Other answers are locked after the due date.";
