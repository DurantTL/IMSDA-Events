import type { PrismaClient } from "@prisma/client";
import { withReadOnlyTransaction } from "../account-merge/dry-run";
import {
  classifyIdentityMigration,
  type DryRunInput,
  type IdentityDryRunOptions,
  type IdentityDryRunReport,
} from "./identity-migration-dry-run-domain";

/**
 * Loads the rows for the identity migration dry run (#128). READ-ONLY by
 * construction, like `modules/account-merge/dry-run.ts`: one transaction that
 * starts with `SET TRANSACTION READ ONLY` (`withReadOnlyTransaction`), so
 * PostgreSQL refuses a write even if this file were edited to attempt one.
 * Only `find*` calls are used. It calls no writer: no candidate generation, no
 * backfill apply, no audit. The classification itself is the pure domain file.
 *
 * Names and phones are loaded only because the duplicate matcher compares
 * them in memory; neither is ever placed in the report.
 */
export async function runIdentityMigrationDryRun(
  prisma: Pick<PrismaClient, "$transaction">,
  options: IdentityDryRunOptions = {},
): Promise<IdentityDryRunReport> {
  const input = await withReadOnlyTransaction(prisma, async (tx): Promise<DryRunInput> => {
    const [accounts, links, persons, members, attendees, identities, merges, candidates] = await Promise.all([
      tx.attendeeAccount.findMany({ select: { id: true, email: true, status: true, emailVerifiedAt: true, disabledAt: true }, orderBy: { id: "asc" } }),
      tx.attendeeAccountPersonLink.findMany({ select: { accountId: true, personId: true }, orderBy: { id: "asc" } }),
      tx.person.findMany({ select: { id: true, firstName: true, lastName: true, normalizedEmail: true, phone: true, anonymizedAt: true }, orderBy: { id: "asc" } }),
      tx.householdMember.findMany({ select: { id: true, householdId: true, personId: true, effectiveFrom: true, effectiveTo: true, createdAt: true }, orderBy: { id: "asc" } }),
      tx.registrationAttendee.findMany({ select: { id: true, personId: true }, orderBy: { id: "asc" } }),
      tx.externalIdentity.findMany({ where: { personId: { not: null } }, select: { personId: true, provider: true, providerScope: true, externalId: true }, orderBy: { id: "asc" } }),
      tx.personMerge.findMany({ where: { state: "ACTIVE" }, select: { secondaryPersonId: true, primaryPersonId: true }, orderBy: { id: "asc" } }),
      tx.personMatchCandidate.findMany({ select: { personAId: true, personBId: true, fingerprint: true, state: true }, orderBy: { id: "asc" } }),
    ]);
    const linkedByAccount = new Map<string, string[]>();
    for (const link of links) linkedByAccount.set(link.accountId, [...(linkedByAccount.get(link.accountId) ?? []), link.personId]);
    return {
      accounts: accounts.map((account) => ({
        id: account.id,
        email: account.email,
        status: account.status,
        emailVerifiedAt: account.emailVerifiedAt !== null,
        disabled: account.disabledAt !== null,
        linkedPersonIds: linkedByAccount.get(account.id) ?? [],
      })),
      accountLinks: links,
      persons: persons.map(({ anonymizedAt, ...person }) => ({ ...person, anonymized: anonymizedAt !== null })),
      householdMembers: members.map((member) => ({
        id: member.id,
        householdId: member.householdId,
        personId: member.personId,
        effectiveFrom: member.effectiveFrom?.toISOString() ?? null,
        effectiveTo: member.effectiveTo?.toISOString() ?? null,
        createdAt: member.createdAt.toISOString(),
      })),
      attendees,
      externalIdentities: identities.flatMap((identity) => (identity.personId ? [{ ...identity, personId: identity.personId }] : [])),
      activeMerges: merges,
      existingCandidates: candidates,
    };
  });
  return classifyIdentityMigration(input, options);
}
