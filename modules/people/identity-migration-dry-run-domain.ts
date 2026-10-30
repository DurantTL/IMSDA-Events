import {
  DUPLICATE_MATCH_RULE_VERSION,
  evaluatePersonMatch,
  orderPersonPair,
  type ExternalIdentityKey,
  type MatchablePerson,
  type PersonMatchContext,
} from "./duplicate-match-domain";
import { maskEmail, normalizeEmail } from "../account-merge/dry-run-domain";

/**
 * Pure rules for the identity migration dry run (#128 items 9 and 10). No
 * database, no clock, no randomness: the same rows always give a
 * byte-identical report. It only CLASSIFIES. Nothing here links, merges,
 * backfills or resolves an ambiguous case; every ambiguous row is routed to
 * the existing review queue (candidate generation, then a human reviewer).
 * Ids only by default; masked emails; names never appear in the report.
 */

export const ACCOUNT_LINK_RULE = "VERIFIED_EMAIL_EXACT" as const;
export const HUMAN_STEP =
  "Nothing is applied by this report. Ambiguous rows are for a human to settle through the existing duplicate-candidate generation and review queue (/people/matches); production runs and any resulting link, backfill or merge are human-only.";

export type Routing = "REVIEW_QUEUE" | "DATA_FIX";

export type AccountRow = {
  id: string;
  email: string;
  status: "PENDING_VERIFICATION" | "ACTIVE";
  emailVerifiedAt: boolean;
  disabled: boolean;
  /** Person ids this account is already linked to. */
  linkedPersonIds: string[];
};
export type PersonRow = MatchablePerson & { anonymized: boolean };
export type HouseholdMemberRow = { id: string; householdId: string; personId: string; effectiveFrom: string | null; effectiveTo: string | null; createdAt: string };
export type AttendeeRow = { id: string; personId: string | null };
export type MergeLinkRow = { secondaryPersonId: string; primaryPersonId: string };
export type ExistingCandidateRow = { personAId: string; personBId: string; fingerprint: string; state: string };

export type DryRunInput = {
  accounts: AccountRow[];
  persons: PersonRow[];
  householdMembers: HouseholdMemberRow[];
  attendees: AttendeeRow[];
  externalIdentities: Array<ExternalIdentityKey & { personId: string }>;
  activeMerges: MergeLinkRow[];
  existingCandidates: ExistingCandidateRow[];
  /** Accounts' links, as [accountId, personId], including those from accounts not in `accounts`. */
  accountLinks: Array<{ accountId: string; personId: string }>;
};

export type ExceptionRow = { table: string; rowId: string; code: string; routing: Routing; relatedIds: string[] };

export type TableReconciliation = {
  table: string;
  input: number;
  buckets: Record<string, number>;
  exceptions: number;
  /** input === sum of buckets + exceptions. */
  reconciled: boolean;
};

export type IdentityDryRunOptions = { showEmails?: boolean; ruleVersion?: number };

export type IdentityDryRunReport = {
  kind: "people-identity-dry-run";
  readOnly: true;
  ruleVersion: number;
  accountLinkRule: typeof ACCOUNT_LINK_RULE;
  humanStep: string;
  wouldLinkAccounts: Array<{ accountId: string; personId: string; rule: typeof ACCOUNT_LINK_RULE; email: string }>;
  householdsNeedingBackfill: Array<{ householdId: string; memberRowIds: string[]; personIds: string[] }>;
  duplicateCandidates: Array<{ personAId: string; personBId: string; action: "WOULD_CREATE" | "WOULD_SUPERSEDE_OPEN"; matchedSignals: string[]; confidence: string; routing: "REVIEW_QUEUE" }>;
  exceptions: ExceptionRow[];
  reconciliation: TableReconciliation[];
  reconciled: boolean;
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function increment(buckets: Record<string, number>, key: string) {
  buckets[key] = (buckets[key] ?? 0) + 1;
}

function reconcile(table: string, input: number, buckets: Record<string, number>, exceptions: number): TableReconciliation {
  const sorted = Object.fromEntries(Object.entries(buckets).sort(([a], [b]) => byText(a, b)));
  const classified = Object.values(sorted).reduce((sum, count) => sum + count, 0);
  return { table, input, buckets: sorted, exceptions, reconciled: input === classified + exceptions };
}

/** Follows active merge links to the root. `null` on a cycle or an over-long chain (reported, never thrown). */
function rootResolver(merges: readonly MergeLinkRow[]) {
  const parent = new Map(merges.map((merge) => [merge.secondaryPersonId, merge.primaryPersonId]));
  return (personId: string): string | null => {
    let current = personId;
    for (let depth = 0; depth <= 25; depth += 1) {
      const next = parent.get(current);
      if (!next) return current;
      current = next;
    }
    return null;
  };
}

export function classifyIdentityMigration(input: DryRunInput, options: IdentityDryRunOptions = {}): IdentityDryRunReport {
  const ruleVersion = options.ruleVersion ?? DUPLICATE_MATCH_RULE_VERSION;
  const exceptions: ExceptionRow[] = [];
  const reconciliation: TableReconciliation[] = [];
  const root = rootResolver(input.activeMerges);
  const personById = new Map(input.persons.map((person) => [person.id, person]));
  const mergedSecondaries = new Set(input.activeMerges.map((merge) => merge.secondaryPersonId));

  // ---- Person ----
  const personBuckets: Record<string, number> = {};
  let personExceptions = 0;
  for (const person of [...input.persons].sort((a, b) => byText(a.id, b.id))) {
    if (person.anonymized) {
      exceptions.push({ table: "Person", rowId: person.id, code: "ANONYMIZED_PERSON", routing: "DATA_FIX", relatedIds: [] });
      personExceptions += 1;
    } else if (root(person.id) === null) {
      exceptions.push({ table: "Person", rowId: person.id, code: "MERGE_CHAIN_UNRESOLVABLE", routing: "REVIEW_QUEUE", relatedIds: [] });
      personExceptions += 1;
    } else increment(personBuckets, mergedSecondaries.has(person.id) ? "MERGED_SECONDARY" : "ACTIVE");
  }
  reconciliation.push(reconcile("Person", input.persons.length, personBuckets, personExceptions));

  // ---- AttendeeAccount: who would receive a link ----
  const personByEmail = new Map<string, string[]>();
  for (const person of input.persons) {
    if (!person.normalizedEmail) continue;
    const key = normalizeEmail(person.normalizedEmail);
    personByEmail.set(key, [...(personByEmail.get(key) ?? []), person.id]);
  }
  const linkedPeople = new Map<string, Set<string>>();
  for (const link of input.accountLinks) linkedPeople.set(link.personId, new Set([...(linkedPeople.get(link.personId) ?? []), link.accountId]));
  const wouldLink: IdentityDryRunReport["wouldLinkAccounts"] = [];
  const accountBuckets: Record<string, number> = {};
  let accountExceptions = 0;
  const fail = (account: AccountRow, code: string, relatedIds: string[], routing: Routing = "REVIEW_QUEUE") => {
    exceptions.push({ table: "AttendeeAccount", rowId: account.id, code, routing, relatedIds: [...relatedIds].sort(byText) });
    accountExceptions += 1;
  };
  for (const account of [...input.accounts].sort((a, b) => byText(a.id, b.id))) {
    if (account.linkedPersonIds.length > 1) { fail(account, "ACCOUNT_LINKED_TO_SEVERAL_PEOPLE", account.linkedPersonIds); continue; }
    if (account.linkedPersonIds.length === 1) { increment(accountBuckets, "ALREADY_LINKED"); continue; }
    if (!account.emailVerifiedAt || account.status !== "ACTIVE" || account.disabled) { fail(account, "ACCOUNT_NOT_VERIFIED_ACTIVE", [], "DATA_FIX"); continue; }
    const matches = personByEmail.get(normalizeEmail(account.email)) ?? [];
    if (matches.length === 0) { increment(accountBuckets, "NO_PERSON_MATCH"); continue; }
    if (matches.length > 1) { fail(account, "SEVERAL_PEOPLE_MATCH_EMAIL", matches); continue; }
    const personId = matches[0]!;
    const person = personById.get(personId)!;
    if (person.anonymized) { fail(account, "MATCHED_PERSON_ANONYMIZED", [personId]); continue; }
    if (mergedSecondaries.has(personId) || root(personId) === null) { fail(account, "MATCHED_PERSON_IS_MERGED", [personId]); continue; }
    const otherAccounts = [...(linkedPeople.get(personId) ?? [])].filter((id) => id !== account.id);
    if (otherAccounts.length > 0) { fail(account, "PERSON_ALREADY_LINKED_TO_ANOTHER_ACCOUNT", [personId, ...otherAccounts]); continue; }
    increment(accountBuckets, "WOULD_LINK");
    wouldLink.push({ accountId: account.id, personId, rule: ACCOUNT_LINK_RULE, email: options.showEmails ? normalizeEmail(account.email) : maskEmail(account.email) });
  }
  reconciliation.push(reconcile("AttendeeAccount", input.accounts.length, accountBuckets, accountExceptions));

  // ---- HouseholdMember: effective-date backfill (the rows household-backfill.ts selects) ----
  const householdBuckets: Record<string, number> = {};
  let householdExceptions = 0;
  const needing = new Map<string, { memberRowIds: string[]; personIds: Set<string> }>();
  for (const member of [...input.householdMembers].sort((a, b) => byText(a.id, b.id))) {
    if (member.effectiveFrom !== null) {
      if (member.effectiveTo !== null && member.effectiveTo < member.effectiveFrom) {
        exceptions.push({ table: "HouseholdMember", rowId: member.id, code: "INVERTED_INTERVAL", routing: "DATA_FIX", relatedIds: [member.householdId, member.personId] });
        householdExceptions += 1;
      } else increment(householdBuckets, "HAS_EFFECTIVE_FROM");
      continue;
    }
    if (member.effectiveTo !== null && member.effectiveTo < member.createdAt) {
      // Backfilling effectiveFrom = createdAt would make the interval end before it starts.
      exceptions.push({ table: "HouseholdMember", rowId: member.id, code: "BACKFILL_WOULD_INVERT_INTERVAL", routing: "DATA_FIX", relatedIds: [member.householdId, member.personId] });
      householdExceptions += 1;
      continue;
    }
    increment(householdBuckets, "NEEDS_BACKFILL");
    const entry = needing.get(member.householdId) ?? { memberRowIds: [], personIds: new Set<string>() };
    entry.memberRowIds.push(member.id);
    entry.personIds.add(member.personId);
    needing.set(member.householdId, entry);
  }
  reconciliation.push(reconcile("HouseholdMember", input.householdMembers.length, householdBuckets, householdExceptions));

  // ---- RegistrationAttendee ----
  const attendeeBuckets: Record<string, number> = {};
  let attendeeExceptions = 0;
  for (const attendee of [...input.attendees].sort((a, b) => byText(a.id, b.id))) {
    const person = attendee.personId ? personById.get(attendee.personId) : undefined;
    if (!attendee.personId || !person) {
      exceptions.push({ table: "RegistrationAttendee", rowId: attendee.id, code: "NO_PERSON", routing: "DATA_FIX", relatedIds: attendee.personId ? [attendee.personId] : [] });
      attendeeExceptions += 1;
    } else if (person.anonymized) {
      exceptions.push({ table: "RegistrationAttendee", rowId: attendee.id, code: "PERSON_ANONYMIZED", routing: "DATA_FIX", relatedIds: [person.id] });
      attendeeExceptions += 1;
    } else increment(attendeeBuckets, mergedSecondaries.has(person.id) ? "ON_MERGED_SECONDARY" : "ON_ACTIVE_PERSON");
  }
  reconciliation.push(reconcile("RegistrationAttendee", input.attendees.length, attendeeBuckets, attendeeExceptions));

  // ---- Likely duplicates: the slice 2 matcher, pairs only ----
  const eligible = input.persons.filter((person) => !person.anonymized);
  const eligibleById = new Map(eligible.map((person) => [person.id, person]));
  const activeHouseholds = new Map<string, string[]>();
  const householdGroups = new Map<string, string[]>();
  for (const member of input.householdMembers) {
    if (member.effectiveTo !== null || !eligibleById.has(member.personId)) continue;
    activeHouseholds.set(member.personId, [...(activeHouseholds.get(member.personId) ?? []), member.householdId]);
    householdGroups.set(member.householdId, [...(householdGroups.get(member.householdId) ?? []), member.personId]);
  }
  const identities = new Map<string, ExternalIdentityKey[]>();
  const identityGroups = new Map<string, string[]>();
  for (const identity of input.externalIdentities) {
    if (!eligibleById.has(identity.personId)) continue;
    identities.set(identity.personId, [...(identities.get(identity.personId) ?? []), { provider: identity.provider, providerScope: identity.providerScope, externalId: identity.externalId }]);
    const key = `${identity.provider} ${identity.providerScope} ${identity.externalId}`;
    identityGroups.set(key, [...(identityGroups.get(key) ?? []), identity.personId]);
  }
  const phoneGroups = new Map<string, string[]>();
  for (const person of eligible) {
    const digits = person.phone?.replace(/\D/g, "");
    if (digits) phoneGroups.set(digits, [...(phoneGroups.get(digits) ?? []), person.id]);
  }
  const pairKeys = new Set<string>();
  for (const group of [...phoneGroups.values(), ...householdGroups.values(), ...identityGroups.values()]) {
    const unique = [...new Set(group)].sort(byText);
    for (let i = 0; i < unique.length; i += 1) for (let j = i + 1; j < unique.length; j += 1) pairKeys.add(`${unique[i]} ${unique[j]}`);
  }
  const context = (id: string): PersonMatchContext => ({ person: eligibleById.get(id)!, activeHouseholdIds: activeHouseholds.get(id) ?? [], externalIdentities: identities.get(id) ?? [] });
  const recorded = new Set(input.existingCandidates.map((row) => `${row.personAId} ${row.personBId} ${row.fingerprint}`));
  const openPairs = new Set(input.existingCandidates.filter((row) => row.state === "OPEN").map((row) => `${row.personAId} ${row.personBId}`));
  const duplicateCandidates: IdentityDryRunReport["duplicateCandidates"] = [];
  const pairBuckets: Record<string, number> = {};
  let pairExceptions = 0;
  for (const key of [...pairKeys].sort(byText)) {
    const [x, y] = key.split(" ") as [string, string];
    const [a, b] = orderPersonPair({ id: x }, { id: y });
    const rootA = root(a.id);
    const rootB = root(b.id);
    if (rootA === null || rootB === null) {
      exceptions.push({ table: "PersonPair", rowId: key.replace(" ", ":"), code: "MERGE_CHAIN_UNRESOLVABLE", routing: "REVIEW_QUEUE", relatedIds: [a.id, b.id] });
      pairExceptions += 1;
      continue;
    }
    if (rootA === rootB) { increment(pairBuckets, "SAME_CANONICAL_PERSON"); continue; }
    const evaluation = evaluatePersonMatch(context(a.id), context(b.id), ruleVersion);
    if (!evaluation) { increment(pairBuckets, "NOT_SURFACED"); continue; }
    if (recorded.has(`${a.id} ${b.id} ${evaluation.fingerprint}`)) { increment(pairBuckets, "ALREADY_RECORDED"); continue; }
    const supersedes = openPairs.has(`${a.id} ${b.id}`);
    increment(pairBuckets, supersedes ? "WOULD_SUPERSEDE_OPEN" : "WOULD_CREATE");
    duplicateCandidates.push({ personAId: a.id, personBId: b.id, action: supersedes ? "WOULD_SUPERSEDE_OPEN" : "WOULD_CREATE", matchedSignals: [...evaluation.matchedSignals].sort(byText), confidence: evaluation.confidence, routing: "REVIEW_QUEUE" });
  }
  reconciliation.push(reconcile("PersonPair", pairKeys.size, pairBuckets, pairExceptions));

  exceptions.sort((a, b) => byText(a.table, b.table) || byText(a.rowId, b.rowId) || byText(a.code, b.code));
  return {
    kind: "people-identity-dry-run",
    readOnly: true,
    ruleVersion,
    accountLinkRule: ACCOUNT_LINK_RULE,
    humanStep: HUMAN_STEP,
    wouldLinkAccounts: wouldLink,
    householdsNeedingBackfill: [...needing.entries()]
      .sort(([a], [b]) => byText(a, b))
      .map(([householdId, entry]) => ({ householdId, memberRowIds: entry.memberRowIds, personIds: [...entry.personIds].sort(byText) })),
    duplicateCandidates,
    exceptions,
    reconciliation,
    reconciled: reconciliation.every((table) => table.reconciled),
  };
}

export function formatIdentityDryRunText(report: IdentityDryRunReport): string {
  const lines = [
    "People identity migration dry run (read-only)",
    HUMAN_STEP,
    "",
    `Would receive account links (${report.accountLinkRule}): ${report.wouldLinkAccounts.length}`,
    `Households needing effective-date backfill: ${report.householdsNeedingBackfill.length}`,
    `Likely duplicate candidates for the review queue: ${report.duplicateCandidates.length}`,
    `Exceptions: ${report.exceptions.length}`,
    "",
    "Reconciliation (input = classified + exceptions):",
  ];
  for (const table of report.reconciliation) {
    const buckets = Object.entries(table.buckets).map(([name, count]) => `${name}=${count}`).join(" ");
    lines.push(`  ${table.reconciled ? "OK " : "BAD"} ${table.table}: input=${table.input} ${buckets} exceptions=${table.exceptions}`);
  }
  if (report.exceptions.length > 0) {
    lines.push("", "Exceptions (ids only):");
    for (const row of report.exceptions) lines.push(`  ${row.table} ${row.rowId} ${row.code} -> ${row.routing}${row.relatedIds.length ? ` [${row.relatedIds.join(", ")}]` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}
