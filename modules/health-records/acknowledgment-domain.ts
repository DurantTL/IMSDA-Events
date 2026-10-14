/**
 * The one-time privacy acknowledgment (#923, ADR 0005 Addendum B, decision of
 * 2026-10-14). It stands in for training: it appears before health access works
 * for a person and is recorded, per person, with the wording version.
 *
 * It covers everyone who reads health data (directors, deputies, Area
 * Coordinators, the event health role, and system administrators) and the
 * Registrars who enter it. Pure: no database, no I/O.
 */

/**
 * Stored with every acknowledgment. Changing `HEALTH_PRIVACY_ACK_TEXT` means
 * changing this too, so everyone acknowledges the new wording again.
 */
export const HEALTH_PRIVACY_ACK_VERSION = "health-privacy-ack-2026-10-b";

/**
 * Draft wording for the Communication Director to confirm. Kept in one place so
 * a wording change is a one-file change together with a new version.
 */
export const HEALTH_PRIVACY_ACK_TEXT = {
  title: "Before you work with health information",
  intro: "Health information about young people is confidential. Please read and confirm the following. You are asked once; you are asked again only if this wording changes.",
  points: [
    "I will use health information only to care for the young person it is about, at the event or club activity it was collected for.",
    "I will not copy, photograph, forward, post or share it, and I will not discuss it with anyone who does not need it for that care.",
    "I understand that every time I open, enter, change, print or try to open a health record is recorded, with my name and the time.",
    "If I am a club Registrar, I understand that I can enter a health record when none exists yet, but cannot read it back.",
    "I will report anything that looks like a mistake or a leak to the Communication Director right away.",
  ],
  confirm: "I have read this and I agree.",
} as const;

export type AcknowledgmentSubject = { userId: string } | { attendeeAccountId: string };

/**
 * The part of a viewer that says which signed-in person it is. Both health
 * modules' viewer types fit it: staff are identified by user, everyone else by
 * attendee account (a staff member acting as a director is staff).
 */
export type AcknowledgmentViewer =
  | { kind: "SYSTEM_ADMIN" | "HEALTH_ROLE"; userId: string }
  | { kind: "AREA_COORDINATOR" | "CLUB_REGISTRAR" | "CLUB_LEADER"; accountId: string }
  | { kind: "CLUB_LEADER"; actor: { kind: "ATTENDEE"; accountId: string } | { kind: "STAFF_ACTING"; userId: string } };

export function acknowledgmentSubjectFor(viewer: AcknowledgmentViewer): AcknowledgmentSubject {
  if ("userId" in viewer) return { userId: viewer.userId };
  if ("accountId" in viewer) return { attendeeAccountId: viewer.accountId };
  return viewer.actor.kind === "ATTENDEE" ? { attendeeAccountId: viewer.actor.accountId } : { userId: viewer.actor.userId };
}
