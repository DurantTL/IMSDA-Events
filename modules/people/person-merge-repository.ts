import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  MAX_MERGE_CHAIN_DEPTH,
  PERSON_MERGE_REASON_MIN_LENGTH,
  PersonMergeResolutionError,
  collectMergedMembers,
  resolveCanonicalIds,
  type ChildLoader,
  type LinkLoader,
} from "@/modules/people/person-merge-domain";

/**
 * Reversible soft-merge of people (#127).
 *
 * A merge is one `PersonMerge` row linking a secondary person to a primary.
 * It never rewrites a foreign key and never edits a `Person`, household
 * membership, account link, registration, payment, consent record or audit
 * actor. Its only effects are that row, the source candidate's state
 * (-> MERGED, with the prior state saved), and an `AuditLog` entry. Reads
 * resolve through ACTIVE links; unmerge sets the row REVERSED (never deletes
 * it) and puts the candidate back, so everything underneath is restored
 * exactly. Nothing here calls anonymization, and no merge happens without a
 * staff actor and reason.
 */

export type PersonMergeErrorCode =
  | "NOT_FOUND"
  | "INVALID_REASON"
  | "SAME_PERSON"
  | "INVALID_CANDIDATE"
  | "CANDIDATE_NOT_OPEN"
  | "ANONYMIZED_PERSON"
  | "NOT_ACTIVE"
  | "DEPENDENT_MERGE"
  | "RESOLUTION_FAILED"
  | "CONFLICT";

export class PersonMergeError extends Error {
  constructor(
    public readonly code: PersonMergeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PersonMergeError";
  }
}

type Client = Prisma.TransactionClient;

/** One fixed key: merges are rare, so serializing all of them is fine. */
async function lockMerges(tx: Client) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('person-merge', 0))`;
}

function linkLoader(client: Client): LinkLoader {
  return async (secondaryIds) => {
    const rows = await client.personMerge.findMany({
      where: { secondaryPersonId: { in: secondaryIds }, state: "ACTIVE" },
      select: { secondaryPersonId: true, primaryPersonId: true },
    });
    return new Map(rows.map((row) => [row.secondaryPersonId, row.primaryPersonId]));
  };
}

function childLoader(client: Client): ChildLoader {
  return (primaryIds) =>
    client.personMerge.findMany({
      where: { primaryPersonId: { in: primaryIds }, state: "ACTIVE" },
      select: { id: true, primaryPersonId: true, secondaryPersonId: true },
    });
}

async function resolveOrThrow(personIds: string[], client: Client) {
  try {
    return await resolveCanonicalIds(personIds, linkLoader(client));
  } catch (error) {
    if (error instanceof PersonMergeResolutionError) throw new PersonMergeError("RESOLUTION_FAILED", error.message);
    throw error;
  }
}

/** The ultimate primary for a person (itself when it is not merged). Throws on a cycle or an over-long chain. */
export async function resolveCanonicalPersonId(personId: string, client: Client = getPrisma()): Promise<string> {
  return (await resolveCanonicalIds([personId], linkLoader(client))).get(personId)!;
}

/** Batch form of `resolveCanonicalPersonId`: one query per hop for all ids. */
export async function resolveCanonicalPersonIds(personIds: string[], client: Client = getPrisma()): Promise<Map<string, string>> {
  return resolveCanonicalIds([...new Set(personIds)], linkLoader(client));
}

export type MergePeopleInput = {
  /** The person the reviewer chose to keep as primary. */
  primaryPersonId: string;
  /** The person the reviewer chose to merge under the primary. */
  secondaryPersonId: string;
  actorUserId: string;
  reason: string;
  /** The reviewed candidate this merge came from, which is marked MERGED. */
  sourceCandidateId?: string | null;
};

function requireReason(reason: string) {
  const trimmed = reason.trim();
  if (trimmed.length < PERSON_MERGE_REASON_MIN_LENGTH) {
    throw new PersonMergeError("INVALID_REASON", "A reason of at least five characters is required.");
  }
  return trimmed;
}

/**
 * Links the secondary person's root under the primary person's root. Both
 * selected people resolve to their current roots first, inside the lock, so
 * merging an already-merged person lands on the ultimate primary, and two
 * people who already share a root are refused instead of creating a cycle.
 */
export async function mergePeople(input: MergePeopleInput) {
  const reason = requireReason(input.reason);
  if (!input.actorUserId) throw new PersonMergeError("INVALID_REASON", "A merge needs the staff member who made it.");
  if (input.primaryPersonId === input.secondaryPersonId) {
    throw new PersonMergeError("SAME_PERSON", "Choose two different people to merge.");
  }

  return getPrisma().$transaction(async (tx) => {
    await lockMerges(tx);

    const selectedIds = [input.primaryPersonId, input.secondaryPersonId];
    const roots = await resolveOrThrow(selectedIds, tx);
    const primaryRoot = roots.get(input.primaryPersonId)!;
    const secondaryRoot = roots.get(input.secondaryPersonId)!;

    const people = await tx.person.findMany({
      where: { id: { in: [...new Set([...selectedIds, primaryRoot, secondaryRoot])] } },
      select: { id: true, anonymizedAt: true },
    });
    const byId = new Map(people.map((person) => [person.id, person]));
    for (const id of selectedIds) {
      if (!byId.has(id)) throw new PersonMergeError("NOT_FOUND", "One of those people was not found.");
    }
    if (people.some((person) => person.anonymizedAt)) {
      throw new PersonMergeError("ANONYMIZED_PERSON", "An anonymized person cannot be merged.");
    }
    if (primaryRoot === secondaryRoot) {
      throw new PersonMergeError("SAME_PERSON", "Those two people are already the same person.");
    }

    // Attaching the secondary's tree under the primary must stay readable.
    let secondaryHeight: number;
    try {
      secondaryHeight = (await collectMergedMembers(secondaryRoot, childLoader(tx))).height;
    } catch (error) {
      if (error instanceof PersonMergeResolutionError) throw new PersonMergeError("RESOLUTION_FAILED", error.message);
      throw error;
    }
    if (secondaryHeight + 1 > MAX_MERGE_CHAIN_DEPTH) {
      throw new PersonMergeError("RESOLUTION_FAILED", `That merge would make a chain longer than ${MAX_MERGE_CHAIN_DEPTH} links.`);
    }

    let sourceCandidate: { id: string; state: string } | null = null;
    let evidenceSignals: { matchedSignals: string[]; ruleVersion: number } | null = null;
    if (input.sourceCandidateId) {
      const candidate = await tx.personMatchCandidate.findUnique({ where: { id: input.sourceCandidateId } });
      if (!candidate) throw new PersonMergeError("NOT_FOUND", "That match candidate was not found.");
      if (candidate.state !== "OPEN") {
        throw new PersonMergeError("CANDIDATE_NOT_OPEN", "Only an open match candidate can be merged.");
      }
      const pair = new Set([candidate.personAId, candidate.personBId]);
      if (!pair.has(input.primaryPersonId) || !pair.has(input.secondaryPersonId)) {
        throw new PersonMergeError("INVALID_CANDIDATE", "Those people are not the pair in that candidate.");
      }
      sourceCandidate = { id: candidate.id, state: candidate.state };
      evidenceSignals = { matchedSignals: candidate.matchedSignals, ruleVersion: candidate.ruleVersion };
    }

    let merge;
    try {
      merge = await tx.personMerge.create({
        data: {
          primaryPersonId: primaryRoot,
          secondaryPersonId: secondaryRoot,
          actorUserId: input.actorUserId,
          reason,
          evidence: {
            requestedPrimaryPersonId: input.primaryPersonId,
            requestedSecondaryPersonId: input.secondaryPersonId,
            resolvedPrimaryPersonId: primaryRoot,
            resolvedSecondaryPersonId: secondaryRoot,
            ...(evidenceSignals ?? {}),
          },
          sourceCandidateId: sourceCandidate?.id ?? null,
          priorState: { sourceCandidate },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new PersonMergeError("CONFLICT", "That person was merged by someone else a moment ago. Reload and try again.");
      }
      throw error;
    }

    if (sourceCandidate) {
      // Guarded on OPEN so a dismissal that landed since the read above is never overwritten.
      const marked = await tx.personMatchCandidate.updateMany({ where: { id: sourceCandidate.id, state: "OPEN" }, data: { state: "MERGED" } });
      if (marked.count === 0) throw new PersonMergeError("CANDIDATE_NOT_OPEN", "Only an open match candidate can be merged.");
    }

    await writeAuditLog({
      actorUserId: input.actorUserId,
      action: "PERSON_MERGED",
      entityType: "PersonMerge",
      entityId: merge.id,
      correlationId: randomUUID(),
      summary: `Merged person ${secondaryRoot} under person ${primaryRoot} (merge ${merge.id}).`,
      metadata: {
        mergeId: merge.id,
        primaryPersonId: primaryRoot,
        secondaryPersonId: secondaryRoot,
        requestedPrimaryPersonId: input.primaryPersonId,
        requestedSecondaryPersonId: input.secondaryPersonId,
        sourceCandidateId: sourceCandidate?.id ?? null,
        before: { candidateState: sourceCandidate?.state ?? null },
        after: { candidateState: sourceCandidate ? "MERGED" : null },
      },
    }, tx);

    return merge;
  }, { timeout: 15000 });
}

/** The route's entry point: merges the two people of an OPEN candidate, keeping the chosen one as primary. */
export async function mergeMatchCandidate(candidateId: string, primaryPersonId: string, actorUserId: string, reason: string) {
  const candidate = await getPrisma().personMatchCandidate.findUnique({
    where: { id: candidateId },
    select: { personAId: true, personBId: true },
  });
  if (!candidate) throw new PersonMergeError("NOT_FOUND", "That match candidate was not found.");
  if (primaryPersonId !== candidate.personAId && primaryPersonId !== candidate.personBId) {
    throw new PersonMergeError("INVALID_CANDIDATE", "The primary person must be one of the two people in the candidate.");
  }
  const secondaryPersonId = primaryPersonId === candidate.personAId ? candidate.personBId : candidate.personAId;
  return mergePeople({ primaryPersonId, secondaryPersonId, actorUserId, reason, sourceCandidateId: candidateId });
}

/**
 * Closes an ACTIVE merge: the row becomes REVERSED (kept, never deleted) and
 * the source candidate returns to the state it had before the merge. Nothing
 * else changed at merge time, so nothing else needs restoring: everyone
 * underneath the secondary resolves to the secondary again.
 */
export async function unmergePeople(mergeId: string, actorUserId: string, reason: string) {
  const trimmedReason = requireReason(reason);
  if (!actorUserId) throw new PersonMergeError("INVALID_REASON", "An unmerge needs the staff member who made it.");

  return getPrisma().$transaction(async (tx) => {
    await lockMerges(tx);

    const existing = await tx.personMerge.findUnique({ where: { id: mergeId } });
    if (!existing) throw new PersonMergeError("NOT_FOUND", "That merge was not found.");
    if (existing.state !== "ACTIVE") {
      throw new PersonMergeError("NOT_ACTIVE", "Only an active merge can be unmerged.");
    }

    // A later reviewed merge may rely on this link: its stored link sits outside the people about to be
    // detached while one of the people its reviewer picked sits inside. Undoing this one would silently
    // undo that merge too, so the later one has to be undone first.
    let detached: Set<string>;
    try {
      const { members } = await collectMergedMembers(existing.secondaryPersonId, childLoader(tx));
      detached = new Set([existing.secondaryPersonId, ...members.map((member) => member.personId)]);
    } catch (error) {
      if (error instanceof PersonMergeResolutionError) throw new PersonMergeError("RESOLUTION_FAILED", error.message);
      throw error;
    }
    const others = await tx.personMerge.findMany({
      where: { state: "ACTIVE", id: { not: mergeId } },
      select: { id: true, primaryPersonId: true, secondaryPersonId: true, evidence: true },
    });
    const dependent = others.find((other) => {
      if (detached.has(other.secondaryPersonId)) return false;
      const evidence = (other.evidence ?? {}) as { requestedPrimaryPersonId?: string; requestedSecondaryPersonId?: string };
      return [evidence.requestedPrimaryPersonId, evidence.requestedSecondaryPersonId].some((id) => id !== undefined && detached.has(id));
    });
    if (dependent) {
      // Names go to the administrator in the response only (as the "Merged people" list shows them), never to the audit log.
      const named = await tx.person.findMany({
        where: { id: { in: [dependent.primaryPersonId, dependent.secondaryPersonId] } },
        select: { id: true, firstName: true, lastName: true },
      });
      const nameOf = (id: string) => {
        const row = named.find((person) => person.id === id);
        return row ? `${row.firstName} ${row.lastName}` : id;
      };
      throw new PersonMergeError(
        "DEPENDENT_MERGE",
        `Undo the later merge first: ${nameOf(dependent.secondaryPersonId)} merged under ${nameOf(dependent.primaryPersonId)} was made through one of these people and relies on this merge.`,
      );
    }

    const reversed = await tx.personMerge.update({
      where: { id: mergeId },
      data: { state: "REVERSED", reversedAt: new Date(), reversedByUserId: actorUserId, reversalReason: trimmedReason },
    });

    const prior = (existing.priorState as { sourceCandidate?: { id: string; state: string } | null } | null)?.sourceCandidate ?? null;
    let restoredCandidateState: string | null = null;
    if (prior && existing.sourceCandidateId) {
      const candidate = await tx.personMatchCandidate.findUnique({ where: { id: existing.sourceCandidateId }, select: { state: true, personAId: true, personBId: true } });
      if (candidate?.state === "MERGED") {
        // If a newer open candidate now exists for this pair, the restored one is superseded rather than a duplicate.
        const newer = prior.state === "OPEN"
          ? await tx.personMatchCandidate.findFirst({
            where: { personAId: candidate.personAId, personBId: candidate.personBId, state: "OPEN", id: { not: existing.sourceCandidateId } },
            select: { id: true },
          })
          : null;
        // An anonymized person is not a duplicate to review, so the pair does not come back to the queue.
        const anonymized = await tx.person.findMany({
          where: { id: { in: [candidate.personAId, candidate.personBId] }, anonymizedAt: { not: null } },
          select: { id: true },
        });
        const restoreTo = prior.state === "OPEN" && (newer || anonymized.length > 0) ? "SUPERSEDED" : prior.state;
        const restored = await tx.personMatchCandidate.updateMany({
          where: { id: existing.sourceCandidateId, state: "MERGED" },
          data: { state: restoreTo as Prisma.PersonMatchCandidateUpdateInput["state"] },
        });
        if (restored.count > 0) restoredCandidateState = restoreTo;
      }
    }

    await writeAuditLog({
      actorUserId,
      action: "PERSON_MERGE_REVERSED",
      entityType: "PersonMerge",
      entityId: mergeId,
      correlationId: randomUUID(),
      summary: `Reversed merge ${mergeId} of person ${existing.secondaryPersonId} under person ${existing.primaryPersonId}.`,
      metadata: {
        mergeId,
        primaryPersonId: existing.primaryPersonId,
        secondaryPersonId: existing.secondaryPersonId,
        sourceCandidateId: existing.sourceCandidateId,
        before: { state: "ACTIVE", candidateState: restoredCandidateState ? "MERGED" : null },
        after: { state: "REVERSED", candidateState: restoredCandidateState },
      },
    }, tx);

    return reversed;
  }, { timeout: 15000 });
}

export type MergedRegistrationRead = {
  registrationId: string;
  eventId: string;
  confirmationCode: string;
  status: string;
  /** How the original person relates to it. */
  role: "ACCOUNT_HOLDER" | "ATTENDEE";
  /** The person the registration still points at (never rewritten). */
  originalPersonId: string;
};

export type MergedPersonView = {
  requestedPersonId: string;
  canonicalPersonId: string;
  /** The canonical person first, then everyone merged beneath it. */
  memberPersonIds: string[];
  merges: Array<{ mergeId: string; personId: string; mergedIntoPersonId: string }>;
  registrations: MergedRegistrationRead[];
};

/**
 * The aggregate read for a person: resolves to the canonical person, lists
 * every person merged beneath it, and gathers their registrations with the
 * ORIGINAL attribution. It only reads; nothing is repointed.
 */
export async function getMergedPersonView(personId: string): Promise<MergedPersonView> {
  const prisma = getPrisma();
  const canonicalPersonId = await resolveCanonicalPersonId(personId, prisma);
  let collected;
  try {
    collected = await collectMergedMembers(canonicalPersonId, childLoader(prisma));
  } catch (error) {
    if (error instanceof PersonMergeResolutionError) throw new PersonMergeError("RESOLUTION_FAILED", error.message);
    throw error;
  }
  const memberPersonIds = [canonicalPersonId, ...collected.members.map((member) => member.personId)];

  const [held, attended] = await Promise.all([
    prisma.registration.findMany({
      where: { accountHolderPersonId: { in: memberPersonIds } },
      select: { id: true, eventId: true, confirmationCode: true, status: true, accountHolderPersonId: true },
    }),
    prisma.registrationAttendee.findMany({
      where: { personId: { in: memberPersonIds } },
      select: { personId: true, registration: { select: { id: true, eventId: true, confirmationCode: true, status: true } } },
    }),
  ]);

  const registrations: MergedRegistrationRead[] = [
    ...held.map((row) => ({
      registrationId: row.id,
      eventId: row.eventId,
      confirmationCode: row.confirmationCode,
      status: row.status as string,
      role: "ACCOUNT_HOLDER" as const,
      originalPersonId: row.accountHolderPersonId,
    })),
    ...attended.map((row) => ({
      registrationId: row.registration.id,
      eventId: row.registration.eventId,
      confirmationCode: row.registration.confirmationCode,
      status: row.registration.status as string,
      role: "ATTENDEE" as const,
      originalPersonId: row.personId,
    })),
  ];

  return {
    requestedPersonId: personId,
    canonicalPersonId,
    memberPersonIds,
    merges: collected.members.map((member) => ({ mergeId: member.mergeId, personId: member.personId, mergedIntoPersonId: member.parentPersonId })),
    registrations,
  };
}

export type PersonMergeRecord = {
  id: string;
  primaryPerson: { id: string; firstName: string; lastName: string };
  secondaryPerson: { id: string; firstName: string; lastName: string };
  reason: string;
  mergedAt: string;
};

const mergePersonSelect = { id: true, firstName: true, lastName: true } as const;

/** ACTIVE merges for the "Merged people" list: names only, like the review queue. */
export async function listActivePersonMerges(): Promise<PersonMergeRecord[]> {
  const rows = await getPrisma().personMerge.findMany({
    where: { state: "ACTIVE" },
    orderBy: { mergedAt: "desc" },
    select: {
      id: true,
      reason: true,
      mergedAt: true,
      primaryPerson: { select: mergePersonSelect },
      secondaryPerson: { select: mergePersonSelect },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    primaryPerson: row.primaryPerson,
    secondaryPerson: row.secondaryPerson,
    reason: row.reason,
    mergedAt: row.mergedAt.toISOString(),
  }));
}
