/**
 * Proves carrying a club roster forward to the next club year (#414) against a
 * real PostgreSQL database, where the unit tests' fake database can't:
 *
 * - the offer lists last year's active people only (inactive and removed people
 *   are not offered) and never carries a birth date;
 * - one confirmation carries the ticked people: same Person record, the same
 *   sealed birth date ciphertext (never opened), a changed type and role for a
 *   Pathfinder who becomes staff, nobody unticked, nothing copied elsewhere;
 * - last year's rows are untouched and still readable;
 * - a repeat is refused cleanly and changes nothing, and eight racing
 *   confirmations leave exactly one winner and no duplicate rows;
 * - another club's person is `MEMBER_NOT_FOUND` and nothing is written;
 * - removal is unchanged: removing a carried person leaves last year's row as it was;
 * - a person with an open outbound transfer is flagged, and a removal that commits during a carry is never carried;
 * - the oversight list shows clubs that haven't started, counts only;
 * - no audit row, and no carry-forward record, holds a birth date or a name.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:club-roster-carry-forward
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { carryRosterForward, getCarryForwardOffer, listClubsNewYearStatus } from "@/modules/club-rosters/carry-forward";
import { addRosterMember, eraseRosterRow, listRoster, removeRosterMember, updateRosterMember } from "@/modules/club-rosters/repository";

loadEnvConfig(process.cwd());
// Local-only, before any Prisma client or connection exists.
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-carry-forward-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = "cf414";
const clubs = { a: `${P}_club_a`, b: `${P}_club_b`, c: `${P}_club_c`, d: `${P}_club_d`, e: `${P}_club_e`, f: `${P}_club_f` };
const from = "2026-27";
const to = "2027-28";
// August: the next year is prepared. September 20 is a late club: the same pair of years.
const august = new Date("2027-08-15T15:00:00Z");
const september = new Date("2027-09-20T15:00:00Z");
const actor = { accountId: `${P}_acct` };
const names = ["Cfalpha", "Cfbravo", "Cfcharlie", "Cfdelta", "Cfecho", "Cffoxtrot"];
const birthDates = ["2012-03-04", "2013-05-06", "2008-07-08", "2014-09-10", "2011-11-12", "2010-01-02"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function codeOf(promise: Promise<unknown>) {
  return promise.then(() => null, (error: { code?: string }) => error.code ?? "ERROR");
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { metadata: { path: ["organizationId"], string_starts_with: P } } });
  await prisma.memberTransfer.deleteMany({ where: { fromOrganizationId: { in: Object.values(clubs) } } });
  await prisma.clubRosterCarryForward.deleteMany({ where: { organizationId: { in: Object.values(clubs) } } });
  await prisma.clubRosterMember.deleteMany({ where: { organizationId: { in: Object.values(clubs) } } });
  await prisma.person.deleteMany({ where: { lastName: "Carryfwd" } });
  await prisma.organization.deleteMany({ where: { id: { in: Object.values(clubs) } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: actor.accountId } });
}

async function addPerson(organizationId: string, index: number, type: "YOUTH" | "STAFF" = "YOUTH") {
  return addRosterMember(organizationId, from, {
    firstName: names[index]!, lastName: "Carryfwd", birthDate: birthDates[index]!, attendeeType: type,
    role: type === "YOUTH" ? "Pathfinder" : "Counselor", classLevel: type === "YOUTH" ? "RANGER" : null, gender: "FEMALE",
  }, actor);
}

async function main() {
  await cleanup();
  await prisma.attendeeAccount.create({ data: { id: actor.accountId, email: "director@carry.example.test", displayName: "Verify Director", status: "ACTIVE" } });
  for (const [key, id] of Object.entries(clubs)) {
    await prisma.organization.create({ data: { id, type: "CLUB", name: `Verify Carry Club ${key}`, normalizedName: `verify carry club ${key} ${P}` } });
  }

  // Club A: a youth (will become staff), a youth to stay, one who leaves, one inactive, one removed.
  const a = [await addPerson(clubs.a, 0), await addPerson(clubs.a, 1), await addPerson(clubs.a, 2), await addPerson(clubs.a, 3), await addPerson(clubs.a, 4, "STAFF")];
  await updateRosterMember(clubs.a, a[3]!.memberId, { status: "INACTIVE" }, actor);
  await removeRosterMember(clubs.a, a[4]!.memberId, actor);
  // Club B has its own person, and nothing else.
  const b = await addPerson(clubs.b, 5);

  // The offer: active people only, with no birth date anywhere in it.
  const offer = await getCarryForwardOffer(clubs.a, august);
  assert(offer.state === "AVAILABLE" && offer.fromClubYear === from && offer.toClubYear === to, "the offer is for 2026-27 to 2027-28 in August");
  const offered = offer.state === "AVAILABLE" ? offer.candidates : [];
  assert(offered.length === 3, "the offer lists only the three active people");
  assert(offered.every((candidate) => typeof candidate.age === "number"), "the offer shows an age");
  for (const date of birthDates) assert(!JSON.stringify(offer).includes(date), "the offer never holds a birth date");

  // Oversight before anyone starts: A and B have people last year and haven't started.
  const before = await listClubsNewYearStatus(august);
  assert(before.notStarted.some((club) => club.organizationId === clubs.a && club.lastYearActive === 3), "club A hasn't started (3 active last year)");
  assert(before.notStarted.some((club) => club.organizationId === clubs.b), "club B hasn't started");
  assert(!before.clubs.some((club) => club.organizationId === clubs.c), "a club with nobody last year is not listed");

  // Another club's person is refused as not found, and nothing is written.
  assert((await codeOf(carryRosterForward(clubs.a, { confirm: true, people: [{ memberId: b.memberId, attendeeType: "YOUTH" }] }, actor, august))) === "MEMBER_NOT_FOUND", "another club's person is MEMBER_NOT_FOUND");
  assert((await codeOf(carryRosterForward(clubs.a, { confirm: true, people: [{ memberId: "no-such-member", attendeeType: "YOUTH" }] }, actor, august))) === "MEMBER_NOT_FOUND", "an unknown id looks the same");
  // Inactive and removed rows are not carriable either.
  assert((await codeOf(carryRosterForward(clubs.a, { confirm: true, people: [{ memberId: a[3]!.memberId, attendeeType: "YOUTH" }] }, actor, august))) === "MEMBER_NOT_FOUND", "an inactive person can't be carried");
  assert((await codeOf(carryRosterForward(clubs.a, { confirm: true, people: [{ memberId: a[4]!.memberId, attendeeType: "STAFF" }] }, actor, august))) === "MEMBER_NOT_FOUND", "a removed person can't be carried");
  assert((await prisma.clubRosterMember.count({ where: { organizationId: clubs.a, clubYear: to } })) === 0, "the refusals wrote nothing");
  assert((await prisma.clubRosterCarryForward.count({ where: { organizationId: clubs.a } })) === 0, "the refusals left no confirmation");

  // One confirmation: youth 0 becomes staff, youth 1 stays; youth 2 leaves (unticked).
  const sealedBefore = await prisma.clubRosterMember.findMany({ where: { id: { in: [a[0]!.memberId, a[1]!.memberId] } }, select: { id: true, sealedBirthDate: true, personId: true } });
  const result = await carryRosterForward(clubs.a, {
    confirm: true,
    people: [{ memberId: a[0]!.memberId, attendeeType: "STAFF" }, { memberId: a[1]!.memberId, attendeeType: "YOUTH", classLevel: "VOYAGER" }],
  }, actor, august);
  assert(result.carried === 2 && result.leftBehind === 1 && result.typeChanged === 1 && result.alreadyThere === 0, "two carried, one left behind, one type changed");
  const carried = await prisma.clubRosterMember.findMany({ where: { organizationId: clubs.a, clubYear: to }, orderBy: { createdAt: "asc" } });
  assert(carried.length === 2, "two rows for the new year");
  for (const before of sealedBefore) {
    const row = carried.find((candidate) => candidate.personId === before.personId);
    assert(row, "the same Person record is carried");
    assert(row.sealedBirthDate === before.sealedBirthDate && row.sealedBirthDate !== null, "the sealed birth date is the same ciphertext");
    for (const date of birthDates) assert(row.sealedBirthDate !== date && !String(row.sealedBirthDate).includes(date), "the stored birth date is sealed");
  }
  const toStaff = carried.find((row) => row.personId === sealedBefore.find((candidate) => candidate.id === a[0]!.memberId)!.personId)!;
  assert(toStaff.attendeeType === "STAFF" && toStaff.role === "" && toStaff.classLevel === null, "a Pathfinder who becomes staff loses the Pathfinder role and class");
  const stayed = carried.find((row) => row.attendeeType === "YOUTH")!;
  assert(stayed.role === "Pathfinder" && stayed.classLevel === "VOYAGER" && stayed.status === "ACTIVE", "a youth keeps their role and takes the new class");
  assert(!carried.some((row) => row.personId === a[2]!.personId), "the unticked person was not carried");
  assert((await prisma.person.count({ where: { id: a[2]!.personId } })) === 1, "the person who left still has their record until the club removes them");
  assert((await prisma.clubRosterMember.count({ where: { organizationId: clubs.a, clubYear: to, personId: a[3]!.personId } })) === 0, "an inactive person is not carried");

  // Last year's roster is untouched and readable.
  const history = await listRoster(clubs.a, from, august);
  assert(history.length === 4 && history.filter((member) => member.status === "ACTIVE").length === 3, "last year's roster is unchanged and readable");
  assert(history.some((member) => member.id === a[0]!.memberId && member.attendeeType === "YOUTH"), "last year's row keeps its old type");
  assert((await listRoster(clubs.a, to, august)).length === 2, "the new roster lists the two carried people");

  // Nothing copied into registrations or answers.
  assert((await prisma.registration.count({ where: { attendees: { some: { personId: { in: carried.map((row) => row.personId!) } } } } })) === 0, "no registration holds a carried person");

  // A repeat, in August or later in September, is refused and changes nothing.
  assert((await codeOf(carryRosterForward(clubs.a, { confirm: true, people: [{ memberId: a[2]!.memberId, attendeeType: "YOUTH" }] }, actor, august))) === "CARRY_FORWARD_DONE", "a repeat is refused");
  assert((await codeOf(carryRosterForward(clubs.a, { confirm: true, people: [{ memberId: a[2]!.memberId, attendeeType: "YOUTH" }] }, actor, september))) === "CARRY_FORWARD_DONE", "a repeat after September 1 is refused too");
  assert((await prisma.clubRosterMember.count({ where: { organizationId: clubs.a, clubYear: to } })) === 2, "the repeat added nobody");
  assert((await getCarryForwardOffer(clubs.a, august)).state === "DONE", "the offer says it is done");
  assert((await listClubsNewYearStatus(august)).notStarted.every((club) => club.organizationId !== clubs.a), "club A shows as started");
  assert((await listClubsNewYearStatus(august)).notStarted.some((club) => club.organizationId === clubs.b), "club B still hasn't started");

  // Racing confirmations: exactly one wins, no duplicate rows (club D).
  const d = [await addPerson(clubs.d, 0), await addPerson(clubs.d, 1)];
  const race = await Promise.all(Array.from({ length: 8 }, () => codeOf(carryRosterForward(clubs.d, {
    confirm: true, people: d.map((member) => ({ memberId: member.memberId, attendeeType: "YOUTH" as const })),
  }, actor, august))));
  assert(race.filter((code) => code === null).length === 1, `exactly one of eight racing confirmations wins (got ${JSON.stringify(race)})`);
  assert(race.filter((code) => code === "CARRY_FORWARD_DONE").length === 7, "the other seven are refused as already done");
  assert((await prisma.clubRosterMember.count({ where: { organizationId: clubs.d, clubYear: to } })) === 2, "the race left two rows, not sixteen");
  assert((await prisma.clubRosterCarryForward.count({ where: { organizationId: clubs.d } })) === 1, "one confirmation record");

  // A person already on the new roster (added by hand) is skipped, not duplicated, and a late carry works for B.
  const bHand = await prisma.clubRosterMember.create({
    data: { organizationId: clubs.b, clubYear: to, personId: b.personId, attendeeType: "YOUTH", role: "Pathfinder", source: "DIRECTOR" },
  });
  const skip = await carryRosterForward(clubs.b, { confirm: true, people: [{ memberId: b.memberId, attendeeType: "YOUTH" }] }, actor, september);
  assert(skip.carried === 0 && skip.alreadyThere === 1, "someone already on the new roster is skipped");
  assert((await prisma.clubRosterMember.count({ where: { organizationId: clubs.b, clubYear: to } })) === 1 && bHand.id, "no duplicate row for them");

  // Removal is unchanged (ADR 0005 Addendum A section 6): it erases the row it is run on, and last year's row stays as it was.
  const carriedStayed = stayed.id;
  const lastYearBefore = await prisma.clubRosterMember.findUniqueOrThrow({ where: { id: a[1]!.memberId } });
  await removeRosterMember(clubs.a, carriedStayed, actor, august);
  const removedRow = await prisma.clubRosterMember.findUniqueOrThrow({ where: { id: carriedStayed } });
  assert(removedRow.status === "REMOVED" && removedRow.sealedBirthDate === null && removedRow.personId === null, "removal erases the new year's row");
  const lastYearAfter = await prisma.clubRosterMember.findUniqueOrThrow({ where: { id: a[1]!.memberId } });
  assert(lastYearAfter.updatedAt.getTime() === lastYearBefore.updatedAt.getTime() && lastYearAfter.status === "ACTIVE" && lastYearAfter.sealedBirthDate === lastYearBefore.sealedBirthDate, "last year's row is untouched by a new-year removal");

  // A person with an open outbound transfer is flagged in the offer (club E).
  const e = [await addPerson(clubs.e, 0), await addPerson(clubs.e, 1)];
  await prisma.memberTransfer.create({
    data: {
      personId: e[1]!.personId, pendingPersonId: e[1]!.personId, clubYear: from, fromOrganizationId: clubs.e, toOrganizationId: clubs.b,
      fromRosterMemberId: e[1]!.memberId, requestedFirstName: "", requestedLastName: "", reason: "", status: "PENDING",
      acknowledgeDueAt: new Date("2027-09-01T00:00:00Z"),
    },
  });
  const eOffer = await getCarryForwardOffer(clubs.e, august);
  const eCandidates = eOffer.state === "AVAILABLE" ? eOffer.candidates : [];
  assert(eCandidates.find((c) => c.memberId === e[1]!.memberId)?.transferring === true, "a person with an open transfer is flagged");
  assert(eCandidates.find((c) => c.memberId === e[0]!.memberId)?.transferring === false, "everyone else is not");

  // A carry racing a removal: the removal commits first, and the removed person is never carried (club F).
  const f = [await addPerson(clubs.f, 0), await addPerson(clubs.f, 1)];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const removal = prisma.$transaction(async (tx) => {
    await eraseRosterRow(tx, f[0]!.memberId, new Date());
    await gate;
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const racing = codeOf(carryRosterForward(clubs.f, {
    confirm: true, people: f.map((member) => ({ memberId: member.memberId, attendeeType: "YOUTH" as const })),
  }, actor, august));
  await new Promise((resolve) => setTimeout(resolve, 700));
  release();
  await removal;
  assert((await racing) === "MEMBER_NOT_FOUND", "a person removed while the carry waited is refused, not carried");
  assert((await prisma.clubRosterMember.count({ where: { organizationId: clubs.f, clubYear: to } })) === 0, "the racing carry wrote nothing");
  assert((await prisma.clubRosterCarryForward.count({ where: { organizationId: clubs.f } })) === 0, "and left no confirmation");

  // No plaintext birth date or name in any audit row or confirmation record.
  const audits = await prisma.auditLog.findMany({ where: { metadata: { path: ["organizationId"], string_starts_with: P } } });
  const records = await prisma.clubRosterCarryForward.findMany({ where: { organizationId: { in: Object.values(clubs) } } });
  const text = JSON.stringify({ audits, records });
  for (const secret of [...birthDates, ...names, "Carryfwd"]) assert(!text.includes(secret), `no audit row or record contains "${secret}"`);
  assert(audits.some((row) => row.action === "CLUB_ROSTER_CARRIED_FORWARD"), "the carry-forward is audited");

  console.log("Club roster carry-forward (#414): all checks passed.");
}

main()
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
