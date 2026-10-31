import type { Signal } from "./model";
import type { PricingSelfTestResult } from "./pricing-self-test";

/**
 * Pure mappers for the registration and checkout checks (#1375). They hold the wording and the states and read
 * nothing. Counts and event names only: never a registration, a confirmation code or a person.
 */
type Fields = Pick<Signal, "key" | "state" | "resultText" | "checkedAt" | "whenLabel"> & { fixHref?: string };

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** OK when every calculation matched; attention names which ones differed (calculation names only, no amounts). */
export function pricingSelfTestFields(key: string, result: PricingSelfTestResult, checkedAt: string): Fields {
  if (result.differed.length === 0) {
    return { key, state: "ok", checkedAt, whenLabel: "Checked", resultText: `${result.checked} of ${result.checked} fixed calculations matched.` };
  }
  return {
    key,
    state: "attention",
    checkedAt,
    whenLabel: "Checked",
    resultText: `${result.differed.length} of ${result.checked} fixed calculations differed: ${result.differed.join(", ")}. Prices may be wrong; ask a developer to check.`,
  };
}

/**
 * Capacity is reserved when a registration is made and released only when it is cancelled or moved to the waitlist
 * (the reservation has no hold time). So "not released" means a reservation still held by a CANCELLED or WAITLISTED
 * registration. It is "watch", not "attention": a stuck hold keeps a seat from the next registrant, but nothing is
 * charged or lost.
 */
export function unreleasedHoldsFields(
  key: string,
  input: { total: number; firstEventId: string | null; firstEventHref: (eventId: string) => string; eventNames: string; readAt: string },
): Fields {
  if (input.total === 0) return { key, state: "ok", checkedAt: input.readAt, whenLabel: "Checked", resultText: "None left held." };
  return {
    key,
    state: "watch",
    checkedAt: input.readAt,
    whenLabel: "Checked",
    resultText: `${input.total} capacity ${plural(input.total, "hold is", "holds are")} still held by cancelled or waitlisted registrations${input.eventNames ? ` at ${input.eventNames}` : ""}.`,
    ...(input.firstEventId ? { fixHref: input.firstEventHref(input.firstEventId) } : {}),
  };
}

/** Open registration with no published form: a visitor sees no way to register, so it is attention. */
export function openWithoutFormFields(
  key: string,
  input: { openCount: number; withoutForm: Array<{ id: string; name: string }>; namesOf: (events: Array<{ name: string }>) => string; href: (eventId: string) => string; readAt: string },
): Fields {
  const common = { key, checkedAt: input.readAt, whenLabel: "Checked" };
  if (input.withoutForm.length === 0) {
    return { ...common, state: "ok", resultText: `${input.openCount} open ${plural(input.openCount, "event has", "events have")} a published form.` };
  }
  const count = input.withoutForm.length;
  return {
    ...common,
    state: "attention",
    resultText: `${count} open ${plural(count, "event has", "events have")} no published registration form: ${input.namesOf(input.withoutForm)}.`,
    fixHref: input.href(input.withoutForm[0].id),
  };
}

/**
 * Submissions through the public registration form in the last 24 hours (staff-entered registrations are not
 * counted). Always "info": a quiet day is not a problem and a busy one is not good news.
 */
export function registrationsReceivedFields(key: string, input: { count: number; openCount: number; readAt: string }): Fields {
  const text = input.openCount === 0
    ? "No events are open for registration, so none are counted."
    : `${input.count} public ${plural(input.count, "submission", "submissions")} in the last 24 hours across ${input.openCount} open ${plural(input.openCount, "event", "events")}. A count only.`;
  return { key, state: "info", checkedAt: input.readAt, whenLabel: "Checked", resultText: text };
}
