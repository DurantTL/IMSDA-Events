import { centralDateKey, centralInstant } from "@/modules/event-locations/waitlist-digest-domain";

/**
 * Honors Weekend instructors hear when a youth joins or leaves one of their classes (#1098). Pure rules, so the schedule,
 * the netting and the wording are testable without a database.
 *
 * An instructor chooses DAILY (the default: one summary a day, only when something changed), IMMEDIATE (one email per
 * change) or OFF. Every email names the youth by name, club and age only: never a birth date, never an answer on a form.
 */

export const classChangeEmailChoices = ["DAILY", "IMMEDIATE", "OFF"] as const;
export type ClassChangeEmailChoice = (typeof classChangeEmailChoices)[number];

export const classChangeEmailLabels: Record<ClassChangeEmailChoice, { label: string; help: string }> = {
  DAILY: { label: "Daily summary", help: "One email a day, only on a day something changed." },
  IMMEDIATE: { label: "Right away", help: "One email each time a youth joins or leaves." },
  OFF: { label: "No emails", help: "You can still see your class list any time." },
};

export function isClassChangeEmailChoice(value: unknown): value is ClassChangeEmailChoice {
  return typeof value === "string" && (classChangeEmailChoices as readonly string[]).includes(value);
}

/** Local hour (Central) from which the day's summary may be sent. */
export const classSummaryHour = 6;
/**
 * The summary waits this long past its time. A change's row carries the time its request started, and a request that began
 * just before the cutoff may commit just after it, so the summary must not look before those writes can have landed.
 */
export const CLASS_SUMMARY_GRACE_MS = 2 * 60 * 1000;
/** A right-away email older than this is not sent: the sweep was off or the staff switch was, and a stale note would mislead. */
export const IMMEDIATE_STALE_MS = 24 * 60 * 60 * 1000;

export type ClassSummaryWindow = {
  /** The Central calendar date this summary belongs to. */
  dateKey: string;
  /** The summary's cutoff. Changes up to this moment go in it; later ones wait for tomorrow's. It is sent from a couple of minutes after. */
  sendAt: Date;
  due: boolean;
};

export function classSummaryWindow(now: Date): ClassSummaryWindow {
  const dateKey = centralDateKey(now);
  const sendAt = centralInstant(dateKey, classSummaryHour);
  return { dateKey, sendAt, due: now.getTime() >= sendAt.getTime() + CLASS_SUMMARY_GRACE_MS };
}

/** One summary per instructor per Central date: a second sweep reuses the message instead of sending twice. */
export function classSummaryIdempotencyKey(instructorId: string, dateKey: string) {
  return `honor-class-change-summary:${instructorId}:${dateKey}`;
}

export function classChangeIdempotencyKey(changeId: string, instructorId: string) {
  return `honor-class-change:${changeId}:${instructorId}`;
}

export type ClassChangeKind = "JOINED" | "LEFT";

export type LoggedClassChange = {
  id: string;
  offeringId: string;
  registrationAttendeeId: string;
  kind: ClassChangeKind;
  youthName: string;
  clubName: string | null;
  ageOnEventDate: number | null;
  at: Date;
};

/**
 * What really changed in a window. A youth who joined and left (or left and rejoined) the same class inside it is no
 * change at all. Per youth and class, the first and last change decide: the same kind twice is a change (the youth
 * was already in, or out, when the window began), opposite kinds cancel. Returned in the order they happened.
 */
export function netClassChanges(changes: readonly LoggedClassChange[]): LoggedClassChange[] {
  const ordered = [...changes].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
  const byPair = new Map<string, LoggedClassChange[]>();
  for (const change of ordered) {
    const key = `${change.offeringId}|${change.registrationAttendeeId}`;
    const list = byPair.get(key) ?? [];
    list.push(change);
    byPair.set(key, list);
  }
  const net: LoggedClassChange[] = [];
  for (const list of byPair.values()) {
    const first = list[0]!;
    const last = list[list.length - 1]!;
    if (first.kind === last.kind) net.push(last);
  }
  return net.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
}

/** "Pat Example (Synthetic Club, age 12)": name, club and age only. */
export function describeYouth(person: { youthName: string; clubName: string | null; ageOnEventDate: number | null }) {
  const details = [person.clubName, typeof person.ageOnEventDate === "number" ? `age ${person.ageOnEventDate}` : null].filter(Boolean);
  return details.length > 0 ? `${person.youthName} (${details.join(", ")})` : person.youthName;
}

export type SummaryClass = {
  offeringId: string;
  className: string;
  session: string;
  joined: Array<Pick<LoggedClassChange, "youthName" | "clubName" | "ageOnEventDate">>;
  left: Array<Pick<LoggedClassChange, "youthName" | "clubName" | "ageOnEventDate">>;
  enrolled: number;
  capacity: number;
};

function countLine(enrolled: number, capacity: number) {
  return `Now ${enrolled} of ${capacity} ${capacity === 1 ? "seat" : "seats"}${enrolled > capacity ? " (over the class limit)" : ""}.`;
}

function classBlock(entry: SummaryClass, baseUrl: string) {
  const lines = [`${entry.className} (${entry.session})`];
  for (const person of entry.joined) lines.push(`  Joined: ${describeYouth(person)}`);
  for (const person of entry.left) lines.push(`  Left: ${describeYouth(person)}`);
  lines.push(`  ${countLine(entry.enrolled, entry.capacity)}`);
  lines.push(`  Class list: ${baseUrl}/account/instructor/${encodeURIComponent(entry.offeringId)}`);
  return lines.join("\n");
}

function footer(baseUrl: string) {
  return [
    "You can change how often you get these emails, or turn them off, on your classes page:",
    `${baseUrl}/account/instructor`,
    "",
    "IMSDA Events",
  ];
}

export function buildClassChangeSummary(input: { recipientName: string; eventName: string; classes: readonly SummaryClass[]; baseUrl: string }) {
  const changes = input.classes.reduce((sum, entry) => sum + entry.joined.length + entry.left.length, 0);
  return {
    subject: `Class list changes at ${input.eventName}`,
    changes,
    bodyText: [
      `Hello ${input.recipientName.trim() || "there"},`,
      "",
      `Here is what changed on your class ${input.classes.length === 1 ? "list" : "lists"} at ${input.eventName} since your last summary.`,
      "",
      input.classes.map((entry) => classBlock(entry, input.baseUrl)).join("\n\n"),
      "",
      ...footer(input.baseUrl),
    ].join("\n"),
  };
}

export function buildClassChangeNotice(input: { recipientName: string; eventName: string; change: SummaryClass & { kind: ClassChangeKind } & Pick<LoggedClassChange, "youthName" | "clubName" | "ageOnEventDate">; baseUrl: string }) {
  const { change } = input;
  const verb = change.kind === "JOINED" ? "joined" : "left";
  return {
    subject: `${change.youthName} ${verb} ${change.className}`,
    bodyText: [
      `Hello ${input.recipientName.trim() || "there"},`,
      "",
      `${describeYouth(change)} ${verb} your class ${change.className} (${change.session}) at ${input.eventName}.`,
      countLine(change.enrolled, change.capacity),
      "",
      `Class list: ${input.baseUrl}/account/instructor/${encodeURIComponent(change.offeringId)}`,
      "",
      ...footer(input.baseUrl),
    ].join("\n"),
  };
}
