/**
 * Who has to carry a second factor.
 *
 * Pure, so the rule can be stated once and tested without a database.
 * Decision 2026-09-25 (issue #456): two-step sign-in is required of every
 * staff account that holds any ACTIVE event membership, of any role, plus
 * every `SYSTEM_ADMIN` — not only `EVENT_ADMIN` and `SYSTEM_ADMIN` as before.
 * Decision 2026-11-06 (Caleb): an active Clubs Administrator (a
 * `ClubsAdministratorGrant` with no `revokedAt`) carries the same requirement,
 * with or without an event membership: that role reads birth dates, guardian
 * contacts and health records in the club areas and can act as Director or
 * Area Coordinator, so it cannot rest on a password alone.
 * A staff account with none of these (not yet assigned to an event, removed
 * from every one, no Clubs Administrator grant) stays on the password alone.
 */

export type MfaSubject = {
  globalRole: "SYSTEM_ADMIN" | null;
  /** The roles of this account's *active* memberships. */
  activeEventRoles: readonly string[];
  /** Whether this account holds an active (not revoked) Clubs Administrator grant. */
  clubsAdministrator: boolean;
};

export function requiresMfa(subject: MfaSubject) {
  if (subject.globalRole === "SYSTEM_ADMIN") return true;
  if (subject.clubsAdministrator) return true;
  return subject.activeEventRoles.length > 0;
}

/**
 * Builds the subject from a user row read with `memberships` (ACTIVE only) and
 * `clubsAdministratorGrant`. Every caller goes through this so none can leave
 * the Clubs Administrator input out.
 */
export function mfaSubjectFromUser(user: {
  globalRole: "SYSTEM_ADMIN" | null;
  memberships: ReadonlyArray<{ role: string }>;
  clubsAdministratorGrant: { revokedAt: Date | null } | null;
}): MfaSubject {
  return {
    globalRole: user.globalRole,
    activeEventRoles: user.memberships.map((membership) => membership.role),
    clubsAdministrator: Boolean(user.clubsAdministratorGrant && !user.clubsAdministratorGrant.revokedAt),
  };
}

export type MfaGate =
  /** No second factor is expected; sign-in completes on the password alone. */
  | { kind: "not_required" }
  /** Enrolled and confirmed: a code is required to finish signing in. */
  | { kind: "challenge" }
  /**
   * Required by role but never enrolled. Sign-in cannot complete until it is,
   * so no session ever exists for a privileged account without a second factor.
   */
  | { kind: "enrol" };

export function mfaGateFor(
  subject: MfaSubject,
  enrollment: { status: "PENDING" | "ACTIVE" } | null,
): MfaGate {
  if (enrollment?.status === "ACTIVE") return { kind: "challenge" };
  if (requiresMfa(subject)) return { kind: "enrol" };
  return { kind: "not_required" };
}
