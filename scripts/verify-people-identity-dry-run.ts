/**
 * Proves the identity migration dry run (#128) against a real PostgreSQL database:
 *
 * - synthetic rows that reach every bucket and exception are classified as expected (checked as the change in
 *   each bucket against a baseline run taken before seeding, so other rows in the database do not matter);
 * - two runs over the same data give byte-identical JSON;
 * - per-table reconciliation holds (input = classified + exceptions);
 * - the report holds ids only: no name, no full email, no phone, and masked emails by default;
 * - the run writes nothing: every table's row count (AuditLog and PersonMatchCandidate included) is unchanged,
 *   and the database itself refuses a write inside the dry-run transaction.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:people-identity-dry-run
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { withReadOnlyTransaction } from "../modules/account-merge/dry-run";
import { evaluatePersonMatch } from "../modules/people/duplicate-match-domain";
import { runIdentityMigrationDryRun } from "../modules/people/identity-migration-dry-run";
import type { IdentityDryRunReport } from "../modules/people/identity-migration-dry-run-domain";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-people-identity-dry-run-synthetic-key");

const prisma = new PrismaClient();
const P = `pid128_${randomUUID().slice(0, 8)}`;
const surname = `Sample${P}`;
const ids = { staff: `${P}_staff`, event: `${P}_event`, house: `${P}_house`, house2: `${P}_house2` };
const phoneDigits = () => String(1000 + Math.floor(Math.random() * 8999));
const email = (label: string) => `${P}-${label}@example.test`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function rowCounts() {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`;
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "${table_name.replace(/"/g, "")}"`);
    counts[table_name] = Number(row!.n);
  }
  return counts;
}

async function cleanup() {
  const like = { startsWith: `${P}_` };
  await prisma.registrationAttendee.deleteMany({ where: { personId: like } });
  await prisma.registration.deleteMany({ where: { eventId: ids.event } });
  await prisma.event.deleteMany({ where: { id: ids.event } });
  await prisma.attendeeAccountPersonLink.deleteMany({ where: { OR: [{ personId: like }, { accountId: like }] } });
  await prisma.personMerge.deleteMany({ where: { primaryPersonId: like } });
  await prisma.personMatchCandidate.deleteMany({ where: { personAId: like } });
  await prisma.householdMember.deleteMany({ where: { householdId: { in: [ids.house, ids.house2] } } });
  await prisma.household.deleteMany({ where: { id: { in: [ids.house, ids.house2] } } });
  await prisma.person.deleteMany({ where: { id: like } });
  await prisma.attendeeAccount.deleteMany({ where: { id: like } });
  await prisma.user.deleteMany({ where: { id: ids.staff } });
}

function bucket(report: IdentityDryRunReport, table: string, name: string) {
  return report.reconciliation.find((row) => row.table === table)?.buckets[name] ?? 0;
}
function exceptionCount(report: IdentityDryRunReport, table: string) {
  return report.reconciliation.find((row) => row.table === table)?.exceptions ?? 0;
}
const mine = (rowId: string) => rowId.startsWith(`${P}_`);

async function main() {
  await cleanup();
  const baseline = await runIdentityMigrationDryRun(prisma);

  await prisma.user.create({ data: { id: ids.staff, email: email("staff"), displayName: "Dry Run Staff" } });
  const person = (label: string, extra: Record<string, unknown> = {}) =>
    prisma.person.create({ data: { id: `${P}_${label}`, firstName: `First${label}`, lastName: surname, normalizedEmail: email(`p-${label}`), ...extra } });
  const account = (label: string, extra: Record<string, unknown> = {}) =>
    prisma.attendeeAccount.create({ data: { id: `${P}_acct_${label}`, email: email(`p-${label}`), displayName: `Account ${label}`, status: "ACTIVE", emailVerifiedAt: new Date(), ...extra } });
  const link = (accountId: string, personId: string) =>
    prisma.attendeeAccountPersonLink.create({ data: { accountId, personId, provenance: "SELF_SERVICE_VERIFICATION", actorAttendeeAccountId: accountId, evidenceReference: "synthetic" } });

  // Accounts
  const linkedPerson = await person("linked");
  const linkedAccount = await account("linked");
  await link(linkedAccount.id, linkedPerson.id);
  await person("would");
  await account("would");
  await account("nomatch");
  await person("unverified");
  await account("unverified", { status: "PENDING_VERIFICATION", emailVerifiedAt: null });
  await person("anon", { anonymizedAt: new Date() });
  await account("anon");
  const mergedPrimary = await person("mprimary", { normalizedEmail: null });
  const mergedSecondary = await person("msecondary");
  await prisma.personMerge.create({ data: { primaryPersonId: mergedPrimary.id, secondaryPersonId: mergedSecondary.id, actorUserId: ids.staff, reason: "synthetic", evidence: {}, priorState: {} } });
  await account("msecondary");
  const takenPerson = await person("taken");
  const otherAccount = await account("holder", { email: email("holder-only") });
  await link(otherAccount.id, takenPerson.id);
  await account("taken");
  const twoA = await person("twoa", { normalizedEmail: null });
  const twoB = await person("twob", { normalizedEmail: null });

  // Households
  await prisma.household.create({ data: { id: ids.house, name: `${P} house` } });
  await prisma.household.create({ data: { id: ids.house2, name: `${P} house two` } });
  const hm = (label: string, personId: string, data: Record<string, unknown>, householdId = ids.house) =>
    prisma.householdMember.create({ data: { id: `${P}_hm_${label}`, householdId, personId, ...data } });
  await hm("legacy", linkedPerson.id, { effectiveFrom: null });
  await hm("legacy2", mergedPrimary.id, { effectiveFrom: null }, ids.house2);
  await hm("dated", twoA.id, { effectiveFrom: new Date("2026-01-01T00:00:00Z") });
  await hm("inverted", twoB.id, { effectiveFrom: null, effectiveTo: new Date("2000-01-01T00:00:00Z") }, ids.house2);

  // Registration attendees on an active, an anonymized and a merged-secondary person
  const year = new Date().getUTCFullYear() + 1;
  await prisma.event.create({ data: { id: ids.event, slug: `${ids.event.replace(/_/g, "-")}-slug`, name: `Dry Run ${P}`, startsAt: new Date(Date.UTC(year, 2, 5, 15)), endsAt: new Date(Date.UTC(year, 2, 7, 15)), timezone: "America/Chicago", isPublished: true, audience: "GENERAL", billingMode: "ATTENDEE_PAY" } });
  const anonPerson = await prisma.person.findUniqueOrThrow({ where: { id: `${P}_anon` } });
  let n = 0;
  for (const holder of [linkedPerson, anonPerson, mergedSecondary]) {
    const registration = await prisma.registration.create({ data: { eventId: ids.event, accountHolderPersonId: holder.id, confirmationCode: `${P}-${n += 1}`, status: "CONFIRMED", totalAmount: "10.00" } });
    await prisma.registrationAttendee.create({ data: { eventId: ids.event, registrationId: registration.id, personId: holder.id, attendeeType: "ADULT", profileSnapshot: {} } });
  }

  // Duplicate pairs: new, supersede-open, already recorded, already merged
  const pair = async (label: string, extra: Record<string, unknown> = {}) => {
    const digits = phoneDigits();
    const a = await person(`${label}a`, { normalizedEmail: null, phone: `(515) 555-${digits}`, ...extra });
    const b = await person(`${label}b`, { normalizedEmail: null, phone: `(515) 555-${digits}` });
    return { a, b };
  };
  await pair("new");
  const open = await pair("open");
  const [openA, openB] = [open.a, open.b].sort((x, y) => (x.id < y.id ? -1 : 1));
  await prisma.personMatchCandidate.create({ data: { personAId: openA!.id, personBId: openB!.id, matchedSignals: ["PHONE_MATCH"], confidence: "HIGH", ruleVersion: 1, fingerprint: `${P}-stale-fingerprint` } });
  const recorded = await pair("rec");
  const [recA, recB] = [recorded.a, recorded.b].sort((x, y) => (x.id < y.id ? -1 : 1));
  const evaluation = evaluatePersonMatch(
    { person: { id: recA!.id, firstName: recA!.firstName, lastName: recA!.lastName, normalizedEmail: null, phone: recA!.phone }, activeHouseholdIds: [], externalIdentities: [] },
    { person: { id: recB!.id, firstName: recB!.firstName, lastName: recB!.lastName, normalizedEmail: null, phone: recB!.phone }, activeHouseholdIds: [], externalIdentities: [] },
  );
  assert(evaluation, "the recorded pair is surfaceable");
  await prisma.personMatchCandidate.create({ data: { personAId: recA!.id, personBId: recB!.id, matchedSignals: evaluation.matchedSignals, confidence: evaluation.confidence, ruleVersion: evaluation.ruleVersion, fingerprint: evaluation.fingerprint, state: "DISMISSED", dismissedAt: new Date(), dismissedByUserId: ids.staff, dismissalReason: "synthetic" } });
  const merged = await pair("mer");
  await prisma.personMerge.create({ data: { primaryPersonId: merged.a.id, secondaryPersonId: merged.b.id, actorUserId: ids.staff, reason: "synthetic", evidence: {}, priorState: {} } });

  // ---- Run twice, with row counts around it ----
  const countsBefore = await rowCounts();
  const first = await runIdentityMigrationDryRun(prisma);
  const second = await runIdentityMigrationDryRun(prisma);
  const countsAfter = await rowCounts();
  assert(JSON.stringify(first) === JSON.stringify(second), "two runs over the same data are byte-identical");
  assert(JSON.stringify(countsBefore) === JSON.stringify(countsAfter), "no table changed its row count (AuditLog and PersonMatchCandidate included)");
  assert(first.reconciled && first.reconciliation.every((table) => table.reconciled), "every table reconciles");

  // ---- Expected classification, as the change from the baseline ----
  const delta = (table: string, name: string) => bucket(first, table, name) - bucket(baseline, table, name);
  const exDelta = (table: string) => exceptionCount(first, table) - exceptionCount(baseline, table);
  assert(delta("AttendeeAccount", "ALREADY_LINKED") === 2, "two accounts already linked (the linked one and the holder)");
  assert(delta("AttendeeAccount", "WOULD_LINK") === 1 && delta("AttendeeAccount", "NO_PERSON_MATCH") === 1, "one account would link, one has no person match");
  assert(exDelta("AttendeeAccount") === 4, "four account exceptions (an account cannot hold two links: accountId is unique)");
  const codes = (table: string) => first.exceptions.filter((row) => row.table === table && mine(row.rowId)).map((row) => `${row.rowId.replace(`${P}_`, "")}:${row.code}`).sort();
  assert(codes("AttendeeAccount").join() === [
    "acct_anon:MATCHED_PERSON_ANONYMIZED", "acct_msecondary:MATCHED_PERSON_IS_MERGED", "acct_taken:PERSON_ALREADY_LINKED_TO_ANOTHER_ACCOUNT",
    "acct_unverified:ACCOUNT_NOT_VERIFIED_ACTIVE",
  ].join(), `account exceptions as expected, got ${codes("AttendeeAccount").join()}`);
  assert(first.exceptions.filter((row) => mine(row.rowId) && row.table === "AttendeeAccount" && row.code !== "ACCOUNT_NOT_VERIFIED_ACTIVE").every((row) => row.routing === "REVIEW_QUEUE"), "ambiguous account cases are routed to the review queue");
  const wouldLink = first.wouldLinkAccounts.filter((row) => mine(row.accountId));
  assert(wouldLink.length === 1 && wouldLink[0]!.personId === `${P}_would` && wouldLink[0]!.rule === "VERIFIED_EMAIL_EXACT", "the one link is the verified exact-email match");
  assert(delta("HouseholdMember", "NEEDS_BACKFILL") === 2 && delta("HouseholdMember", "HAS_EFFECTIVE_FROM") === 1 && exDelta("HouseholdMember") === 1, "households: two need backfill, one dated, one would invert");
  assert(first.householdsNeedingBackfill.filter((row) => mine(row.householdId)).map((row) => row.householdId).join() === [ids.house, ids.house2].sort().join(), "both households with legacy rows are listed");
  assert(codes("HouseholdMember").join() === "hm_inverted:BACKFILL_WOULD_INVERT_INTERVAL", "the row whose backfill would invert its interval is an exception");
  assert(delta("RegistrationAttendee", "ON_ACTIVE_PERSON") === 1 && delta("RegistrationAttendee", "ON_MERGED_SECONDARY") === 1 && exDelta("RegistrationAttendee") === 1, "attendees: active, merged secondary, and one on an anonymized person");
  assert(exDelta("Person") >= 1 && codes("Person").join() === "anon:ANONYMIZED_PERSON", "the anonymized person is an exception");
  const mineAll = first.duplicateCandidates.filter((row) => mine(row.personAId));
  assert(mineAll.every((row) => row.routing === "REVIEW_QUEUE"), "every proposed pair is routed to the review queue");
  // Same-surname people who share a household are also surfaced (the "twins" rule); the phone pairs are the ones seeded for this check.
  const dupes = mineAll.filter((row) => row.matchedSignals.includes("PHONE_MATCH"));
  assert(dupes.length === 2, "two phone pairs would reach the queue");
  assert(dupes.map((row) => row.action).sort().join() === "WOULD_CREATE,WOULD_SUPERSEDE_OPEN", "one new, one superseding the open candidate");
  assert(delta("PersonPair", "ALREADY_RECORDED") === 1 && delta("PersonPair", "SAME_CANONICAL_PERSON") === 1, "a recorded pair and an already-merged pair are not proposed again");

  // ---- Ids only, masked emails ----
  const text = JSON.stringify(first);
  assert(!text.includes(surname) && !text.includes("First") && !text.includes("Account ") && !text.includes("@example.test") && !text.includes("(515)"), "the report holds no name, full email or phone");
  assert(wouldLink[0]!.email.includes("***"), "emails are masked by default");
  const shown = await runIdentityMigrationDryRun(prisma, { showEmails: true });
  assert(shown.wouldLinkAccounts.some((row) => row.email === email("p-would")), "--show-emails shows the full address");

  // ---- The database itself refuses writes in the dry-run transaction ----
  const refused = await withReadOnlyTransaction(prisma, (tx) => tx.person.create({ data: { firstName: "x", lastName: "y" } }).then(() => false, () => true));
  assert(refused, "a write inside the read-only transaction is refused by PostgreSQL");
  assert(JSON.stringify(await rowCounts()) === JSON.stringify(countsAfter), "still no row count changed");

  console.log("verify-people-identity-dry-run: all checks passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      console.error("cleanup failed", error);
      process.exitCode = 1;
    }
    await prisma.$disconnect();
  });
