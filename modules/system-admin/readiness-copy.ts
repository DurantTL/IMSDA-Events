/**
 * Wording for the System readiness page (#1183), kept apart from the page so a test can hold it to the delivered
 * #874 contract. Pure: no database access, no secrets, no host or account names.
 *
 * The page keeps four things separate, and none of them stands in for another:
 * 1. live health: measured now, on the System home;
 * 2. implemented behavior: what the app does today (the Sterling Volunteers check-in rules, #874);
 * 3. human evidence: ticks that record a person did something (#870);
 * 4. remaining setup: what is still unchecked or needs attention.
 *
 * Wording rule (#443): screening is always called "Sterling Volunteers".
 */
import { STERLING_CHECK_NEEDED_MESSAGE } from "@/modules/checkin/domain";
import type { SystemReadiness } from "./readiness-repository";

export const ISSUE_BASE_URL = "https://github.com/DurantTL/IMSDA-Events/issues";

/** The domain decision for the check-in rules: recorded on #218, built and closed as #874. */
export const SCREENING_DECISION_LINKS = [
  { label: "#874: check-in rules (delivered)", href: `${ISSUE_BASE_URL}/874` },
  { label: "#218: where the decision was recorded", href: `${ISSUE_BASE_URL}/218` },
] as const;

export type ReadinessKind = { key: "health" | "behavior" | "evidence" | "setup"; title: string; text: string };

/** The four things this page and the System home keep apart. */
export const readinessKinds: readonly ReadinessKind[] = [
  {
    key: "health",
    title: "Live health",
    text: "Measured now: the email sweep, queue, alerts and delivery problems. It is on the System home and says when each reading was made.",
  },
  {
    key: "behavior",
    title: "Implemented behavior",
    text: "What the app already does. Nothing here is waiting to be built, and nothing here is approval.",
  },
  {
    key: "evidence",
    title: "Human evidence",
    text: "Checks a person ticked, with who and when. A tick records evidence only. It does not send, enable, deploy, migrate or unlock anything, and it is not a health reading.",
  },
  {
    key: "setup",
    title: "Remaining setup",
    text: "What is still unchecked, needs attention or could not be read. A check that could not be read is not counted as done.",
  },
];

/**
 * The Sterling Volunteers check-in contract as delivered by #874. Described as behavior that exists, in the present
 * tense. It is not a sign-off and changing it is out of scope for this page.
 */
export const screeningBehavior = {
  title: "Sterling Volunteers check-in rules (implemented)",
  intro: "The app already applies these rules. This section describes them. It does not approve them, and it changes nothing.",
  points: [
    "Registration and login are never blocked by a Sterling Volunteers check. Roster access is not blocked either.",
    `At youth and children's events, an adult or staff member whose check is not current (none on file, expired, or not in compliance) cannot be checked in. Check-in shows \u201c${STERLING_CHECK_NEEDED_MESSAGE}\u201d instead of the Check in button.`,
    "A staff member with check-in permission can override with a typed reason. Every override is audited.",
    "Each event has a Sterling Volunteers follow-up list of registered adults and staff who are not current. Directors see their own club’s people, as status only.",
    "What is stored depends on the upload. A Sterling CSV records only clear checks, as dates; a row that is not clear is reported and nothing is stored. A roster compliance upload keeps its mark per person (Clear, Flagged for expiring soon, or Not in compliance) and a staff-only issues note with the check and training dates. Not in compliance holds a person at check-in; Clear and Flagged do not.",
  ],
  /** Why a tick does not certify this by itself. */
  evidenceNote:
    "These rules were delivered on 20 October 2026 (#874). A sign-off ticked before that date recorded the earlier flags-only rules, not these. A tick is a person’s record as of its date and is not re-checked when behavior changes. Whether an earlier tick should be cleared is a separate decision and is not made here.",
} as const;

/** Shown under every manual item: what a tick is. */
export const TICK_RECORD_NOTE =
  "A tick records that a person did the work, as of the date shown. It does not re-check anything and does not perform the action.";

export type RemainingSetup = {
  /** Automatic checks that need attention. */
  needsAttention: string[];
  /** Automatic checks that could not be read, so they are not done. */
  unreadable: string[];
  /** Manual items nobody has ticked. */
  unticked: string[];
  /** True when the tick table could not be read, so the unticked list is not known. */
  ticksUnknown: boolean;
};

export function buildRemainingSetup(readiness: SystemReadiness): RemainingSetup {
  const manual = readiness.groups.flatMap((group) => group.items);
  return {
    needsAttention: readiness.automatic.filter((row) => row.status === "attention").map((row) => row.title),
    unreadable: readiness.automatic.filter((row) => row.status === "unknown").map((row) => row.title),
    // With unreadable ticks every item looks unticked, which would claim work is outstanding that may be done.
    unticked: readiness.ticksAvailable ? manual.filter((item) => !item.tick).map((item) => item.title) : [],
    ticksUnknown: !readiness.ticksAvailable,
  };
}
