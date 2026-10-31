import type { SignalState } from "./model";

/**
 * The pure state and wording of the "Event operations" checks (#1379). Counts in, a state and a sentence out: no
 * database, no clock. Counts and event names only, never a person, a registration or an id.
 */

export const IMPORT_STUCK_AFTER_MS = 60 * 60 * 1000;
export const HONOR_OFFER_OVERDUE_AFTER_MS = 30 * 60 * 1000;
export const CLUB_ORDER_OPEN_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export type EventOpsResult = { state: SignalState; resultText: string };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Up to `limit` distinct event names, then "and N more". */
export function eventNames(names: readonly string[], limit = 3) {
  const unique = [...new Set(names)];
  return unique.length <= limit ? unique.join(", ") : `${unique.slice(0, limit).join(", ")} and ${unique.length - limit} more`;
}

const at = (names: readonly string[]) => (names.length > 0 ? ` at ${eventNames(names)}` : "");

/** A preview waiting to be committed. Previews with errors are left out: they can never be committed and are flagged under Import review. */
export function importsStuckResult(input: { waiting: number; failed: number; names: readonly string[] }): EventOpsResult {
  const { waiting, failed, names } = input;
  const failedNote = failed > 0 ? ` ${plural(failed, "failed commit is", "failed commits are")} listed under Import review.` : "";
  if (waiting === 0) return { state: "ok", resultText: `No import preview has waited over an hour without being committed.${failedNote}` };
  return {
    state: "watch",
    resultText: `${plural(waiting, "import preview has", "import previews have")} waited over an hour without being committed${at(names)}.${failedNote}`,
  };
}

export function checkInStationsResult(count: number): EventOpsResult {
  return {
    state: "info",
    resultText: `${plural(count, "check-in station", "check-in stations")} expired without being stopped or revoked. A count only: an expired station can no longer be used.`,
  };
}

export function honorOffersOverdueResult(count: number, names: readonly string[]): EventOpsResult {
  if (count === 0) return { state: "ok", resultText: "No honors class offer is more than 30 minutes past its expiry." };
  return {
    state: "attention",
    resultText: `${plural(count, "honors class offer is", "honors class offers are")} over 30 minutes past expiry${at(names)}. The honors waitlist step of the 5-minute sweep may not be running.`,
  };
}

export function lodgingOffersLapsedResult(count: number, names: readonly string[]): EventOpsResult {
  if (count === 0) return { state: "ok", resultText: "No lodging offer has lapsed without being handled." };
  return {
    state: "watch",
    resultText: `${plural(count, "lodging offer has", "lodging offers have")} lapsed${at(names)}. A lapsed offer is handled when staff next offer the space.`,
  };
}

export function lodgingChangeRequestsResult(count: number): EventOpsResult {
  return { state: "info", resultText: `${plural(count, "lodging change request is", "lodging change requests are")} open. A count only.` };
}

export function scholarshipPledgesResult(count: number): EventOpsResult {
  return { state: "info", resultText: `${plural(count, "scholarship pledge is", "scholarship pledges are")} not yet received. A count only: a pledge is normal until the sponsor pays.` };
}

export function clubOrdersResult(count: number): EventOpsResult {
  return { state: "info", resultText: `${plural(count, "club supply order has", "club supply orders have")} been ordered for over 30 days and not received. A count only, across all events.` };
}

/** Meal tickets, mirroring the ledger check: a failed event read never lets "none found" read as OK. */
export function mealTicketsResult(input: { missing: number; names: readonly string[]; failed: number; checked: number }): EventOpsResult {
  const { missing, names, failed } = input;
  const note = failed > 0 ? ` ${plural(failed, "event", "events")} could not be read.` : "";
  if (missing > 0) {
    return { state: "watch", resultText: `${plural(missing, "meal selection does", "meal selections do")} not have the tickets it calls for${at(names)}.${note}` };
  }
  if (failed > 0) return { state: "unavailable", resultText: `None found in the events that were read.${note} It is not shown as OK.` };
  return { state: "ok", resultText: `All meal selections have their tickets (${plural(input.checked, "event", "events")} checked).` };
}
