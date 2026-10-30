/**
 * Proves reversible soft-merge of people and anonymization (#127) against a real PostgreSQL database:
 *
 * - a merge creates one link and rewrites nothing: registration, attendee, household, account link, payment,
 *   ledger and consent evidence rows are identical before and after, and so are both Person rows;
 * - unmerge restores the prior state exactly (the source candidate is OPEN again), the merge row is kept as
 *   REVERSED, and both are audited with ids only (no reason text, no name);
 * - merging an already-merged person lands on the ultimate primary; people who share a root are refused;
 * - concurrent overlapping merges (A->B with B->A, and A->B / B->C / C->A) never produce a cycle, a lost merge
 *   or two ACTIVE merges for one secondary, and the database index refuses a second one on its own;
 * - a merged person's past registrations read back with their original attribution, and that cross-event read is
 *   audited with ids only (#128);
 * - a merge or shared household gives the primary's verified address no claim on the secondary's registration (#128);
 * - an identical double-submitted merge makes one link and leaves a bystander alone (#128);
 * - anonymization of a person with payments and consent evidence keeps those rows, is idempotent and audited,
 *   and an anonymized person cannot be merged.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:person-soft-merge
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { generateMatchCandidates, listOpenMatchCandidates } from "../modules/people/duplicate-match-repository";
import { authorizeAttendeeRegistration, matchingRegistrationIdsForVerifiedEmail } from "../modules/attendee-accounts/registrations-repository";
import { anonymizePerson, PERSON_ANONYMIZED_FIELDS } from "../modules/people/anonymization";
import {
  getMergedPersonView,
  mergeMatchCandidate,
  mergePeople,
  PersonMergeError,
  resolveCanonicalPersonId,
  resolveCanonicalPersonIds,
  unmergePeople,
} from "../modules/people/person-merge-repository";

loadEnvConfig(process.cwd());
// Local-only, before any Prisma client or connection exists.
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-person-soft-merge-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `psm127_${randomUUID().slice(0, 8)}`;
const surname = `Sample${P}`;
const ids = { staff: `${P}_staff`, plain: `${P}_plain`, event: `${P}_event`, form: `${P}_form`, formVersion: `${P}_form_v1`, household: `${P}_house` };
const REASON = "Synthetic reason that must never reach an audit row";
const personIds: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function code(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  return error instanceof PersonMergeError ? error.code : error === null ? "NO_ERROR" : String(error);
}

async function newPerson(label: string, extra: Partial<Prisma.PersonUncheckedCreateInput> = {}) {
  const id = `${P}_${label}`;
  personIds.push(id);
  return prisma.person.create({ data: { id, firstName: `First${label}`, lastName: surname, normalizedEmail: `${P}-${label}@example.test`, phone: "(515) 555-0100", ...extra } });
}

async function cleanup() {
  await prisma.$transaction(async (tx) => {
    // Append-only evidence: the product never deletes it; the superuser bypass lets this check clear its own rows.
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.$executeRaw`DELETE FROM "AcknowledgmentEvidence" WHERE "eventId" = ${ids.event}`;
  });
  await prisma.personMerge.deleteMany({ where: { OR: [{ primaryPersonId: { startsWith: `${P}_` } }, { secondaryPersonId: { startsWith: `${P}_` } }] } });
  await prisma.personAnonymization.deleteMany({ where: { personId: { startsWith: `${P}_` } } });
  await prisma.personMatchCandidate.deleteMany({ where: { personAId: { startsWith: `${P}_` } } });
  const registrationIds = (await prisma.registration.findMany({ where: { eventId: ids.event }, select: { id: true } })).map((row) => row.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ eventId: ids.event }, { actorUserId: { in: [ids.staff, ids.plain] } }, { entityId: { startsWith: `${P}_` } }] } });
  await prisma.event.deleteMany({ where: { id: ids.event } });
  await prisma.registration.deleteMany({ where: { id: { in: registrationIds } } });
  await prisma.household.deleteMany({ where: { id: ids.household } });
  await prisma.person.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.staff, ids.plain] } } });
}

/** Every row a merge must leave alone, for the given people, as a comparable string. */
async function snapshot(people: string[], registrationIds: string[]) {
  const [persons, held, attendees, members, userLinks, payments, ledger, evidence] = await Promise.all([
    prisma.person.findMany({ where: { id: { in: people } }, orderBy: { id: "asc" } }),
    prisma.registration.findMany({ where: { id: { in: registrationIds } }, orderBy: { id: "asc" } }),
    prisma.registrationAttendee.findMany({ where: { registrationId: { in: registrationIds } }, orderBy: { id: "asc" } }),
    prisma.householdMember.findMany({ where: { personId: { in: people } }, orderBy: { id: "asc" } }),
    prisma.userPersonLink.findMany({ where: { personId: { in: people } }, orderBy: { id: "asc" } }),
    prisma.payment.findMany({ where: { registrationId: { in: registrationIds } }, orderBy: { id: "asc" } }),
    prisma.registrationLedgerEntry.findMany({ where: { registrationId: { in: registrationIds } }, orderBy: { id: "asc" } }),
    prisma.acknowledgmentEvidence.findMany({ where: { registrationId: { in: registrationIds } }, orderBy: { id: "asc" } }),
  ]);
  return JSON.stringify({ persons, held, attendees, members, userLinks, payments, ledger, evidence });
}

async function activeLinks(people: string[]) {
  return prisma.personMerge.findMany({ where: { state: "ACTIVE", OR: [{ primaryPersonId: { in: people } }, { secondaryPersonId: { in: people } }] } });
}

async function assertForest(people: string[], label: string) {
  const links = await activeLinks(people);
  const secondaries = links.map((link) => link.secondaryPersonId);
  assert(new Set(secondaries).size === secondaries.length, `${label}: no person has two ACTIVE merges (two primaries)`);
  const resolved = await resolveCanonicalPersonIds(people); // throws on a cycle
  for (const id of people) assert(resolved.get(id), `${label}: ${id} resolves`);
  return { links, resolved };
}

async function main() {
  await cleanup();
  await prisma.user.create({ data: { id: ids.staff, email: `${P}-staff@example.test`, displayName: "Merge Check Staff", globalRole: "SYSTEM_ADMIN" } });
  await prisma.user.create({ data: { id: ids.plain, email: `${P}-plain@example.test`, displayName: "Merge Check Plain" } });
  const year = new Date().getUTCFullYear() + 1;
  await prisma.event.create({ data: { id: ids.event, slug: `${ids.event.replace(/_/g, "-")}-slug`, name: `Merge Check ${P}`, startsAt: new Date(Date.UTC(year, 2, 5, 15)), endsAt: new Date(Date.UTC(year, 2, 7, 15)), timezone: "America/Chicago", isPublished: true, audience: "GENERAL", billingMode: "ATTENDEE_PAY" } });
  await prisma.registrationForm.create({
    data: {
      id: ids.form, eventId: ids.event, createdByUserId: ids.staff, name: "Merge check form", slug: `${P}-form`, status: "PUBLISHED",
      versions: { create: { id: ids.formVersion, createdByUserId: ids.staff, versionNumber: 1, status: "PUBLISHED", publishedAt: new Date(), definition: {} } },
    },
  });
  await prisma.household.create({ data: { id: ids.household, name: `${P} household` } });

  // ---- Fixture: a primary and a secondary person who each have history ----
  const primary = await newPerson("primary");
  const secondary = await newPerson("secondary");
  await prisma.householdMember.create({ data: { householdId: ids.household, personId: primary.id, effectiveFrom: new Date("2026-01-01T00:00:00Z"), canManage: true } });
  await prisma.householdMember.create({ data: { householdId: ids.household, personId: secondary.id, effectiveFrom: new Date("2026-02-01T00:00:00Z") } });
  await prisma.userPersonLink.create({ data: { userId: ids.plain, personId: secondary.id, provenance: "STAFF_ACTION", actorUserId: ids.staff, evidenceReference: "synthetic evidence" } });
  const primaryRegistration = await prisma.registration.create({ data: { eventId: ids.event, accountHolderPersonId: primary.id, confirmationCode: `${P}-P`, status: "CONFIRMED", totalAmount: "50.00" } });
  const secondaryRegistration = await prisma.registration.create({ data: { eventId: ids.event, accountHolderPersonId: secondary.id, householdId: ids.household, confirmationCode: `${P}-S`, status: "CONFIRMED", totalAmount: "75.00" } });
  const secondaryAttendee = await prisma.registrationAttendee.create({ data: { eventId: ids.event, registrationId: secondaryRegistration.id, personId: secondary.id, attendeeType: "ADULT", profileSnapshot: { firstName: "Synthetic" } } });
  const primaryAttendee = await prisma.registrationAttendee.create({ data: { eventId: ids.event, registrationId: primaryRegistration.id, personId: primary.id, attendeeType: "ADULT", profileSnapshot: { firstName: "Synthetic" } } });
  void primaryAttendee;
  await prisma.payment.create({ data: { eventId: ids.event, registrationId: secondaryRegistration.id, amount: "75.00", status: "SUCCEEDED", method: "CHECK", receivedAt: new Date() } });
  await prisma.registrationLedgerEntry.create({ data: { eventId: ids.event, registrationId: secondaryRegistration.id, kind: "CHARGE", amountCents: 7500, pricingSnapshot: {}, sourceType: "REGISTRATION_SUBMISSION", sourceId: `${P}-ledger` } });
  const hash = "0".repeat(63) + "1";
  await prisma.acknowledgmentEvidence.create({
    data: {
      eventId: ids.event, registrationId: secondaryRegistration.id, registrationAttendeeId: secondaryAttendee.id, subjectPersonId: secondary.id, actedByPersonId: secondary.id,
      channel: "ONLINE", formVersionId: ids.formVersion, fieldId: `${P}_ack`, fieldKey: "att_ack", fieldLabel: "Synthetic acknowledgment", source: "TEXT",
      shownText: "Synthetic statement", contentHash: hash, contentRef: `text:${hash}`, subjectMinorStatus: "ADULT", acknowledgedAt: new Date(), idempotencyKey: `${P}-ack`, requestHash: "synthetic",
    },
  });
  const registrationIds = [primaryRegistration.id, secondaryRegistration.id];
  const candidate = await prisma.personMatchCandidate.create({
    data: { personAId: [primary.id, secondary.id].sort()[0]!, personBId: [primary.id, secondary.id].sort()[1]!, matchedSignals: ["PHONE_MATCH"], confidence: "HIGH", ruleVersion: 1, fingerprint: `${P}-fp` },
  });

  // ---- Merge: a link, and no foreign key rewritten ----
  const before = await snapshot([primary.id, secondary.id], registrationIds);
  assert(await code(mergeMatchCandidate(candidate.id, primary.id, ids.staff, "no")) === "INVALID_REASON", "a short reason is refused");
  assert(await prisma.personMerge.count({ where: { secondaryPersonId: secondary.id } }) === 0, "nothing was written by the refusal");
  const merge = await mergeMatchCandidate(candidate.id, primary.id, ids.staff, REASON);
  assert(merge.primaryPersonId === primary.id && merge.secondaryPersonId === secondary.id && merge.state === "ACTIVE" && merge.reason === REASON && merge.actorUserId === ids.staff, "one ACTIVE link with actor and reason");
  assert((merge.evidence as { requestedPrimaryPersonId?: string }).requestedPrimaryPersonId === primary.id, "evidence keeps the requested ids");
  assert(await snapshot([primary.id, secondary.id], registrationIds) === before, "merge rewrote no registration, attendee, household, link, payment, ledger, consent or person row");
  assert((await prisma.personMatchCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).state === "MERGED", "the source candidate is MERGED");
  assert(await resolveCanonicalPersonId(secondary.id) === primary.id && await resolveCanonicalPersonId(primary.id) === primary.id, "the secondary resolves to the primary");
  const mergeAudit = await prisma.auditLog.findMany({ where: { action: "PERSON_MERGED", entityId: merge.id } });
  assert(mergeAudit.length === 1 && mergeAudit[0]!.actorUserId === ids.staff, "the merge is audited once, with the actor");
  assert(!JSON.stringify(mergeAudit).includes(REASON) && !JSON.stringify(mergeAudit).includes("First"), "the audit row holds ids only (no reason, no name)");

  // ---- A merged person's past registration reads with its original attribution ----
  const view = await getMergedPersonView(secondary.id, ids.staff);
  assert(view.canonicalPersonId === primary.id && view.requestedPersonId === secondary.id, "the view resolves to the canonical person");
  assert([...view.memberPersonIds].sort().join() === [primary.id, secondary.id].sort().join(), "the view lists both people");
  const secondaryRead = view.registrations.find((row) => row.registrationId === secondaryRegistration.id && row.role === "ACCOUNT_HOLDER");
  assert(secondaryRead?.originalPersonId === secondary.id && secondaryRead.confirmationCode === `${P}-S`, "the secondary's registration still reads as the secondary's");
  assert(view.registrations.some((row) => row.registrationId === secondaryRegistration.id && row.role === "ATTENDEE" && row.originalPersonId === secondary.id), "and so does the attendee row");
  assert(view.registrations.some((row) => row.registrationId === primaryRegistration.id && row.originalPersonId === primary.id), "the primary's own registration is in the same view");
  assert((await prisma.registration.findUniqueOrThrow({ where: { id: secondaryRegistration.id } })).accountHolderPersonId === secondary.id, "the registration row itself still points at the secondary");
  assert(await prisma.person.count({ where: { id: { in: [primary.id, secondary.id] } } }) === 2, "both people remain queryable");

  const readAudit = await prisma.auditLog.findMany({ where: { action: "PERSON_CROSS_EVENT_READ", entityId: primary.id } });
  assert(readAudit.length === 1 && readAudit[0]!.actorUserId === ids.staff && readAudit[0]!.eventId === null, "the cross-event read is audited once, with the actor and no event");
  assert(!JSON.stringify(readAudit).includes("First") && !JSON.stringify(readAudit).includes(P + "-primary@") && !JSON.stringify(readAudit).includes(REASON), "the read audit holds ids only");

  // ---- #128: a merge (or a shared household) gives the primary's address no claim on the secondary's registration ----
  const primaryEmail = `${P}-primary@example.test`;
  assert([...await matchingRegistrationIdsForVerifiedEmail(primaryEmail)].sort().join() === [primaryRegistration.id].join(), "while merged, the primary's verified address still claims only its own registration");
  assert(await authorizeAttendeeRegistration(primaryEmail, secondaryRegistration.id) === null, "the primary's account cannot authorize the secondary's registration, merged or in one household");
  assert(await authorizeAttendeeRegistration(`${P}-secondary@example.test`, secondaryRegistration.id) !== null, "the secondary's own address still reaches it");

  // ---- Refusals ----
  assert(await code(mergePeople({ primaryPersonId: secondary.id, secondaryPersonId: primary.id, actorUserId: ids.staff, reason: REASON })) === "SAME_PERSON", "merging the reverse of an active merge is refused (would cycle)");
  assert(await code(mergeMatchCandidate(candidate.id, primary.id, ids.staff, REASON)) === "SAME_PERSON", "a merged candidate cannot be merged again (they already share a root)");
  assert(await prisma.personMerge.count({ where: { state: "ACTIVE", OR: [{ primaryPersonId: { in: [primary.id, secondary.id] } }, { secondaryPersonId: { in: [primary.id, secondary.id] } }] } }) === 1, "still exactly one ACTIVE link");

  // ---- Unmerge restores the prior state exactly ----
  assert(await code(unmergePeople(merge.id, ids.staff, "no")) === "INVALID_REASON", "an unmerge needs a reason");
  const reversed = await unmergePeople(merge.id, ids.staff, REASON);
  assert(reversed.state === "REVERSED" && reversed.reversedByUserId === ids.staff && reversed.reversalReason === REASON && reversed.reversedAt, "the merge is REVERSED with who, when and why");
  assert(await prisma.personMerge.count({ where: { id: merge.id } }) === 1, "the merge row is kept");
  assert(await snapshot([primary.id, secondary.id], registrationIds) === before, "after unmerge every row is exactly as before");
  const restored = await prisma.personMatchCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
  assert(restored.state === "OPEN" && restored.dismissedAt === null && restored.dismissalReason === null, "the candidate is OPEN again");
  assert(await resolveCanonicalPersonId(secondary.id) === secondary.id, "the secondary is independent again");
  assert(await code(unmergePeople(merge.id, ids.staff, REASON)) === "NOT_ACTIVE", "a reversed merge cannot be unmerged twice");
  const reverseAudit = await prisma.auditLog.findMany({ where: { action: "PERSON_MERGE_REVERSED", entityId: merge.id } });
  assert(reverseAudit.length === 1 && reverseAudit[0]!.actorUserId === ids.staff && !JSON.stringify(reverseAudit).includes(REASON), "the unmerge is audited once with ids only");
  const remerged = await mergePeople({ primaryPersonId: secondary.id, secondaryPersonId: primary.id, actorUserId: ids.staff, reason: REASON });
  assert(remerged.id !== merge.id && remerged.primaryPersonId === secondary.id, "after an unmerge the pair can be merged again, either way round");
  await unmergePeople(remerged.id, ids.staff, REASON);

  // ---- An already-merged person resolves to the ultimate primary; unmerging a middle link restores what is under it ----
  const [a, b, c, d] = await Promise.all(["a", "b", "c", "d"].map((label) => newPerson(label)));
  const ab = await mergePeople({ primaryPersonId: b!.id, secondaryPersonId: a!.id, actorUserId: ids.staff, reason: REASON }); // a -> b
  const bc = await mergePeople({ primaryPersonId: c!.id, secondaryPersonId: a!.id, actorUserId: ids.staff, reason: REASON }); // a resolves to b, so b -> c
  assert(bc.secondaryPersonId === b!.id && bc.primaryPersonId === c!.id, "merging an already-merged person links its root");
  assert(await resolveCanonicalPersonId(a!.id) === c!.id, "a resolves through b to c");
  const dd = await mergePeople({ primaryPersonId: a!.id, secondaryPersonId: d!.id, actorUserId: ids.staff, reason: REASON }); // d joins c, the ultimate primary
  assert(dd.primaryPersonId === c!.id, "a person merged under a merged person joins the ultimate primary");
  assert(await code(mergePeople({ primaryPersonId: d!.id, secondaryPersonId: c!.id, actorUserId: ids.staff, reason: REASON })) === "SAME_PERSON", "a cycle is refused");
  assert(await code(unmergePeople(bc.id, ids.staff, REASON)) === "DEPENDENT_MERGE", "the middle link cannot be undone while d's merge (made through a) relies on it");
  await unmergePeople(dd.id, ids.staff, REASON);
  assert(await resolveCanonicalPersonId(d!.id) === d!.id && await resolveCanonicalPersonId(a!.id) === c!.id, "undoing the later merge leaves the rest as it was");
  await unmergePeople(bc.id, ids.staff, REASON);
  assert(await resolveCanonicalPersonId(a!.id) === b!.id && await resolveCanonicalPersonId(b!.id) === b!.id && await resolveCanonicalPersonId(d!.id) === d!.id, "unmerging the middle link restores exactly what was under it");
  void ab;

  // ---- An inner link that a later reviewed merge relies on cannot be unmerged first ----
  const [da, db, dc] = await Promise.all(["dpa", "dpb", "dpc"].map((label) => newPerson(label)));
  const inner = await mergePeople({ primaryPersonId: da!.id, secondaryPersonId: db!.id, actorUserId: ids.staff, reason: REASON }); // b -> a
  const [lo, hi] = [db!.id, dc!.id].sort();
  const laterCandidate = await prisma.personMatchCandidate.create({ data: { personAId: lo!, personBId: hi!, matchedSignals: ["PHONE_MATCH"], confidence: "HIGH", ruleVersion: 1, fingerprint: `${P}-fp-dep` } });
  const outer = await mergeMatchCandidate(laterCandidate.id, dc!.id, ids.staff, REASON); // b resolves to a, so a -> c
  assert(outer.secondaryPersonId === da!.id && outer.primaryPersonId === dc!.id, "the later merge stores the roots (a under c)");
  assert(await code(unmergePeople(inner.id, ids.staff, REASON)) === "DEPENDENT_MERGE", "unmerging the inner link is refused while the later merge depends on it");
  assert((await prisma.personMerge.findUniqueOrThrow({ where: { id: inner.id } })).state === "ACTIVE" && await resolveCanonicalPersonId(db!.id) === dc!.id, "the refusal changed nothing");
  await unmergePeople(outer.id, ids.staff, REASON);
  assert((await prisma.personMatchCandidate.findUniqueOrThrow({ where: { id: laterCandidate.id } })).state === "OPEN", "the later merge's candidate is OPEN again");
  await unmergePeople(inner.id, ids.staff, REASON);
  assert(await resolveCanonicalPersonId(db!.id) === db!.id, "with the later merge undone first, the inner one can be undone");

  // ---- Concurrency: overlapping merges never cycle, lose a merge, or give a person two primaries ----
  for (let round = 0; round < 5; round += 1) {
    const [x, y] = await Promise.all([newPerson(`x${round}`), newPerson(`y${round}`)]);
    const settled = await Promise.allSettled([
      mergePeople({ primaryPersonId: y!.id, secondaryPersonId: x!.id, actorUserId: ids.staff, reason: REASON }),
      mergePeople({ primaryPersonId: x!.id, secondaryPersonId: y!.id, actorUserId: ids.staff, reason: REASON }),
    ]);
    const { links } = await assertForest([x!.id, y!.id], `A->B / B->A round ${round}`);
    assert(settled.filter((result) => result.status === "fulfilled").length === 1 && links.length === 1, `A->B / B->A round ${round}: exactly one merge won, the other was refused`);
    assert(settled.some((result) => result.status === "rejected" && result.reason instanceof PersonMergeError && result.reason.code === "SAME_PERSON"), `round ${round}: the loser was refused as the same person`);
  }
  for (let round = 0; round < 5; round += 1) {
    const [p, q, r] = await Promise.all([newPerson(`p${round}`), newPerson(`q${round}`), newPerson(`r${round}`)]);
    const settled = await Promise.allSettled([
      mergePeople({ primaryPersonId: q!.id, secondaryPersonId: p!.id, actorUserId: ids.staff, reason: REASON }), // A->B
      mergePeople({ primaryPersonId: r!.id, secondaryPersonId: q!.id, actorUserId: ids.staff, reason: REASON }), // B->C
      mergePeople({ primaryPersonId: p!.id, secondaryPersonId: r!.id, actorUserId: ids.staff, reason: REASON }), // C->A
    ]);
    const { links, resolved } = await assertForest([p!.id, q!.id, r!.id], `A->B / B->C / C->A round ${round}`);
    const won = settled.filter((result) => result.status === "fulfilled").length;
    assert(won === 2 && links.length === 2, `ring round ${round}: exactly two of the three merges stand (the third would close the cycle), got ${won}`);
    assert(new Set([...resolved.values()]).size === 1, `ring round ${round}: all three resolve to one primary`);
  }
  const lost = await prisma.personMerge.count({ where: { state: "ACTIVE", secondaryPersonId: { startsWith: `${P}_` } } });
  assert(lost >= 11, "no winning merge was lost");
  // Many at once for one secondary: only one can win.
  const [hub, ...spokes] = await Promise.all(["hub", "s1", "s2", "s3", "s4"].map((label) => newPerson(label)));
  const crowd = await Promise.allSettled(spokes.map((spoke, index) => mergePeople({ primaryPersonId: index % 2 ? hub!.id : spokes[(index + 1) % spokes.length]!.id, secondaryPersonId: spoke!.id, actorUserId: ids.staff, reason: REASON })));
  await assertForest([hub!.id, ...spokes.map((spoke) => spoke!.id)], "crowd");
  assert(crowd.some((result) => result.status === "fulfilled"), "at least one merge in the crowd succeeded");

  // ---- #128 invariant 6: an identical double submit makes one merge and never touches a bystander ----
  for (let round = 0; round < 5; round += 1) {
    const [m, n, bystander] = await Promise.all([newPerson(`dm${round}`), newPerson(`dn${round}`), newPerson(`db${round}`)]);
    const settled = await Promise.allSettled([
      mergePeople({ primaryPersonId: n!.id, secondaryPersonId: m!.id, actorUserId: ids.staff, reason: REASON }),
      mergePeople({ primaryPersonId: n!.id, secondaryPersonId: m!.id, actorUserId: ids.staff, reason: REASON }),
    ]);
    const { links, resolved } = await assertForest([m!.id, n!.id, bystander!.id], `double submit round ${round}`);
    assert(settled.filter((result) => result.status === "fulfilled").length === 1 && links.length === 1, `double submit round ${round}: exactly one merge stands`);
    assert(resolved.get(bystander!.id) === bystander!.id && resolved.get(m!.id) === n!.id, `double submit round ${round}: the bystander is still its own person`);
  }

  // ---- The database refuses a second ACTIVE merge for one secondary, and a self-merge, on its own ----
  const [e, f, g] = await Promise.all(["e", "f", "g"].map((label) => newPerson(label)));
  const row = (primaryPersonId: string, secondaryPersonId: string) => ({ primaryPersonId, secondaryPersonId, actorUserId: ids.staff, reason: "synthetic", evidence: {}, priorState: {} });
  await prisma.personMerge.create({ data: row(f!.id, e!.id) });
  assert(await prisma.personMerge.create({ data: row(g!.id, e!.id) }).then(() => false, (error: unknown) => /unique/i.test(String(error))), "the unique index refuses two ACTIVE merges for one secondary");
  assert(await prisma.personMerge.create({ data: row(e!.id, e!.id) }).then(() => false, (error: unknown) => /distinct_people_check|check constraint/i.test(String(error))), "the database refuses a person merged into itself");
  assert(await prisma.person.delete({ where: { id: e!.id } }).then(() => false, () => true), "a person with merge history cannot be deleted");

  // ---- Anonymization keeps payments, ledger, consent evidence and audit history ----
  const kept = await snapshot([], registrationIds);
  const auditBefore = await prisma.auditLog.count({ where: { actorUserId: ids.staff } });
  assert(await anonymizePerson({ personId: secondary.id, approvedByUserId: ids.plain, approvalReference: "Synthetic request 1" }).then(() => false, (error: unknown) => /system administrator/i.test(String(error))), "only a system administrator can approve");
  const outcome = await anonymizePerson({ personId: secondary.id, approvedByUserId: ids.staff, approvalReference: "Synthetic request 1" });
  assert(!outcome.alreadyAnonymized, "the person is anonymized");
  const anonymous = await prisma.person.findUniqueOrThrow({ where: { id: secondary.id } });
  assert(anonymous.firstName === "Anonymized" && anonymous.lastName === "Person" && anonymous.normalizedEmail === null && anonymous.phone === null && anonymous.anonymizedAt, "the declared personal fields are replaced");
  const record = await prisma.personAnonymization.findUniqueOrThrow({ where: { personId: secondary.id } });
  assert(record.approvedByUserId === ids.staff && record.approvalReference === "Synthetic request 1" && record.fields.join() === [...PERSON_ANONYMIZED_FIELDS].join(), "the approval and the field list are recorded");
  assert(await snapshot([], registrationIds) === kept, "registrations, attendees, payments, ledger and consent evidence are untouched");
  assert(await prisma.payment.count({ where: { registrationId: secondaryRegistration.id, status: "SUCCEEDED" } }) === 1 && await prisma.acknowledgmentEvidence.count({ where: { registrationId: secondaryRegistration.id } }) === 1, "the payment and the consent evidence are still there");
  assert(await prisma.auditLog.count({ where: { actorUserId: ids.staff } }) === auditBefore + 1, "one audit row was added and none removed");
  const anonAudit = await prisma.auditLog.findMany({ where: { action: "PERSON_ANONYMIZED", entityId: secondary.id } });
  assert(anonAudit.length === 1 && !JSON.stringify(anonAudit).includes("Synthetic request"), "the anonymization is audited with ids only");
  const again = await anonymizePerson({ personId: secondary.id, approvedByUserId: ids.staff, approvalReference: "Synthetic request 2" });
  assert(again.alreadyAnonymized && await prisma.personAnonymization.count({ where: { personId: secondary.id } }) === 1 && await prisma.auditLog.count({ where: { action: "PERSON_ANONYMIZED", entityId: secondary.id } }) === 1, "anonymizing again is a no-op");
  assert(await code(mergePeople({ primaryPersonId: primary.id, secondaryPersonId: secondary.id, actorUserId: ids.staff, reason: REASON })) === "ANONYMIZED_PERSON", "an anonymized person cannot be merged");
  const raced = await Promise.all([f, g].map((person) => anonymizePerson({ personId: person!.id, approvedByUserId: ids.staff, approvalReference: "Synthetic request 3" })));
  assert(raced.every((result) => !result.alreadyAnonymized), "two people anonymize independently");
  const sameOne = await Promise.all([anonymizePerson({ personId: hub!.id, approvedByUserId: ids.staff, approvalReference: "Synthetic request 4" }), anonymizePerson({ personId: hub!.id, approvedByUserId: ids.staff, approvalReference: "Synthetic request 4" })]);
  assert(sameOne.filter((result) => !result.alreadyAnonymized).length === 1 && await prisma.personAnonymization.count({ where: { personId: hub!.id } }) === 1, "racing anonymizations of one person write once");

  // ---- An anonymized person never comes back into the review queue ----
  // (Two people cannot share one external identity: the database makes the tuple unique, so a shared phone drives the pair.)
  const [qa, qb] = await Promise.all(["qa", "qb"].map((label) => newPerson(label, { phone: "(515) 555-0177" })));
  await generateMatchCandidates();
  const pairOpen = () => prisma.personMatchCandidate.count({ where: { state: "OPEN", OR: [{ personAId: { in: [qa!.id, qb!.id] } }, { personBId: { in: [qa!.id, qb!.id] } }], AND: [{ OR: [{ personAId: { in: [qa!.id, qb!.id] }, personBId: { in: [qa!.id, qb!.id] } }] }] } });
  assert(await pairOpen() === 1, "control: a scan surfaces the pair before anonymization");
  await anonymizePerson({ personId: qa!.id, approvedByUserId: ids.staff, approvalReference: "Synthetic request 5" });
  assert(await pairOpen() === 0, "anonymizing supersedes the open candidate");
  await generateMatchCandidates();
  assert(await pairOpen() === 0, "a rescan does not bring the anonymized person's pair back");
  assert(await prisma.personMatchCandidate.count({ where: { state: "OPEN", OR: [{ personAId: qa!.id }, { personBId: qa!.id }] } }) === 0, "no OPEN candidate involves the anonymized person at all");
  // Anonymization blanks the phone, so give the anonymized person the shared phone back: only the anonymizedAt filter keeps the pair out now.
  await prisma.person.update({ where: { id: qa!.id }, data: { phone: "(515) 555-0177" } });
  await generateMatchCandidates();
  assert(await pairOpen() === 0, "a rescan skips an anonymized person even when a signal still matches");
  await prisma.personMatchCandidate.create({ data: { personAId: [qa!.id, qb!.id].sort()[0]!, personBId: [qa!.id, qb!.id].sort()[1]!, confidence: "MEDIUM", ruleVersion: 0, fingerprint: `synthetic-${randomUUID()}`, matchedSignals: ["PHONE_MATCH"] } });
  assert(!(await listOpenMatchCandidates(ids.staff)).some((candidate) => [candidate.personA.id, candidate.personB.id].includes(qa!.id)), "the review queue drops an OPEN pair with an anonymized person");

  console.log("verify-person-soft-merge: all checks passed");
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
