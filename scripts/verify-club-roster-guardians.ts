/**
 * Proves guardian contacts on club roster members (#510) against a real
 * PostgreSQL database, where the unit tests' fake database can't:
 *
 * - up to two guardians per member, one row per slot, and the database itself
 *   refuses a third slot, a duplicate slot, and a guardian with no member;
 * - an edit replaces the whole set; a blank slot removes that guardian;
 * - removing a member deletes every guardian of that member (and only theirs),
 *   inactive members keep theirs, and deleting the row cascades;
 * - readers: the club's own leader, any Area Coordinator and sensitive-data
 *   staff read; another club's leader is refused;
 * - emergency contacts are for every member, adult or minor (owner decision
 *   Oct 15, 2026): an adult's contact is stored, read and exported, and the
 *   export carries contacts with formula-safe cells;
 * - no audit row holds a guardian value.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:club-roster-guardians
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { addRosterMember, removeRosterMember, updateRosterMember } from "@/modules/club-rosters/repository";
import { runRosterExport } from "@/modules/club-rosters/export-repository";
import { GuardianAccessError, listGuardianContactsForClub, listContactsByMember, listGuardiansByMember, listParentsByMember } from "@/modules/club-rosters/guardians-repository";
import type { GuardianViewer } from "@/modules/club-rosters/guardians-domain";

loadEnvConfig(process.cwd());
// Local-only, before any Prisma client or connection exists.
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-guardians-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = "gd510";
const clubs = { a: `${P}_club_a`, b: `${P}_club_b` };
const clubYear = "2026-27";
const actor = { accountId: `${P}_acct` };
const SECRET_NAME = "Verify Guardian Only";
const SECRET_EMAIL = "verify.guardian@example.test";
const SECRET_PHONE = "(515) 555-0188";
const PARENT_NAME = "Verify Parent Only";
const PARENT_EMAIL = "verify.parent@example.test";
const CONTACT_EMAIL = "verify.member@example.test";
const CONTACT_STREET = "100 Verify Contact St";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function rejects(promise: Promise<unknown>) {
  return promise.then(() => false, () => true);
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { metadata: { path: ["organizationId"], string_starts_with: P } } });
  await prisma.clubRosterMember.deleteMany({ where: { organizationId: { in: Object.values(clubs) } } });
  await prisma.person.deleteMany({ where: { firstName: { in: ["Verifya", "Verifyb"] }, lastName: { in: ["Alpha", "Beta"] } } });
  await prisma.organization.deleteMany({ where: { id: { in: Object.values(clubs) } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: actor.accountId } });
  await prisma.user.deleteMany({ where: { id: `${P}_staff` } });
}

const guardian = (name: string, extra: Partial<{ relationship: string; email: string; phone: string }> = {}) => ({
  name, relationship: "Mother", email: "", phone: "", ...extra,
});
const blank = { name: "", relationship: "", email: "", phone: "" };

async function main() {
  await cleanup();
  await prisma.attendeeAccount.create({ data: { id: actor.accountId, email: `director@guardians.example.test`, displayName: "Verify Director", status: "ACTIVE" } });
  await prisma.user.create({ data: { id: `${P}_staff`, email: "staff@guardians.example.test", displayName: "Verify Staff", globalRole: null } });
  for (const [key, id] of Object.entries(clubs)) {
    await prisma.organization.create({ data: { id, type: "CLUB", name: `Verify Club ${key}`, normalizedName: `verify club ${key} ${P}` } });
  }
  const base = { attendeeType: "YOUTH" as const, role: "Pathfinder", classLevel: null, gender: "FEMALE" as const };
  const added = await addRosterMember(clubs.a, clubYear, {
    ...base, firstName: "Verifya", lastName: "Alpha", birthDate: "2014-05-06",
    guardians: [guardian(SECRET_NAME, { email: SECRET_EMAIL, phone: SECRET_PHONE }), guardian("Verify Second", { relationship: "Uncle" })],
  }, actor);
  const other = await addRosterMember(clubs.a, clubYear, {
    ...base, firstName: "Verifyb", lastName: "Beta", birthDate: "2013-04-05", guardians: [guardian("Verify Other Guardian")],
  }, actor);
  const countFor = (id: string) => prisma.clubRosterGuardian.count({ where: { rosterMemberId: id } });
  assert((await countFor(added.memberId)) === 2, "two guardians are stored for the first member");

  // The database enforces the shape, not only the app.
  assert(await rejects(prisma.clubRosterGuardian.create({ data: { rosterMemberId: added.memberId, position: 3, name: "Third" } })), "a third slot is refused");
  assert(await rejects(prisma.clubRosterGuardian.create({ data: { rosterMemberId: added.memberId, position: 1, name: "Duplicate" } })), "a duplicate slot is refused");
  assert(await rejects(prisma.clubRosterGuardian.create({ data: { rosterMemberId: "no-such-member", position: 1, name: "Orphan" } })), "a guardian needs a member");

  // An edit replaces the whole set.
  await updateRosterMember(clubs.a, added.memberId, { guardians: [guardian("Verify Renamed"), blank] }, actor);
  const afterEdit = await prisma.clubRosterGuardian.findMany({ where: { rosterMemberId: added.memberId } });
  assert(afterEdit.length === 1 && afterEdit[0]!.position === 1 && afterEdit[0]!.name === "Verify Renamed", "an edit replaces the set and a blank slot removes that guardian");
  await updateRosterMember(clubs.a, added.memberId, { role: "TLT" }, actor);
  assert((await countFor(added.memberId)) === 1, "an edit that doesn't send guardians leaves them alone");
  await updateRosterMember(clubs.a, added.memberId, { guardians: [guardian(SECRET_NAME, { email: SECRET_EMAIL, phone: SECRET_PHONE }), guardian("Verify Second", { relationship: "Uncle" })] }, actor);

  // Guardian writes are refused on a row from another club year.
  await prisma.clubRosterMember.update({ where: { id: other.memberId }, data: { clubYear: "2025-26" } });
  assert(await rejects(updateRosterMember(clubs.a, other.memberId, { guardians: [guardian("Verify Prior Year")] }, actor)), "a guardian write on a prior-year row is refused");
  assert((await countFor(other.memberId)) === 1, "the refused write changed nothing");
  await prisma.clubRosterMember.update({ where: { id: other.memberId }, data: { clubYear } });

  // August (#959): the current club year is 2025-26, so the 2026-27 rows are next year's, and a director edits their contacts.
  const august = new Date("2026-08-15T15:00:00Z");
  await updateRosterMember(clubs.a, other.memberId, { guardians: [guardian("Verify August Contact", { phone: "515-555-0134" }), guardian("Verify August Second")] }, actor, august);
  assert((await countFor(other.memberId)) === 2, "an August edit adds contacts on a next-year row");
  await updateRosterMember(clubs.a, other.memberId, { guardians: [guardian("Verify August Contact Two"), blank] }, actor, august);
  const augustRows = await prisma.clubRosterGuardian.findMany({ where: { rosterMemberId: other.memberId } });
  assert(augustRows.length === 1 && augustRows[0]!.name === "Verify August Contact Two", "an August edit changes and a blank slot clears a next-year contact");
  await updateRosterMember(clubs.a, other.memberId, { guardians: [blank, blank] }, actor, august);
  assert((await countFor(other.memberId)) === 0, "an August edit clears every contact on a next-year row");
  await updateRosterMember(clubs.a, other.memberId, { guardians: [guardian("Verify Other Guardian")] }, actor, august);
  assert(await rejects(updateRosterMember(clubs.b, other.memberId, { guardians: [guardian("Verify Other Club")] }, actor, august)), "another club's director is refused on a next-year row");
  assert((await countFor(other.memberId)) === 1, "the other club's refused write changed nothing");
  await prisma.clubRosterMember.update({ where: { id: other.memberId }, data: { clubYear: "2024-25" } });
  assert(await rejects(updateRosterMember(clubs.a, other.memberId, { guardians: [guardian("Verify Past Year")] }, actor, august)), "a past-year row still refuses contact edits in August");
  assert(await rejects(updateRosterMember(clubs.a, other.memberId, { status: "INACTIVE" }, actor, august)), "a status change on a past-year row is refused too");
  assert((await countFor(other.memberId)) === 1, "the past-year refusal changed nothing");
  await prisma.clubRosterMember.update({ where: { id: other.memberId }, data: { clubYear } });

  // Readers.
  const leaderA: GuardianViewer = { kind: "CLUB_LEADER", organizationId: clubs.a, actor: { kind: "ATTENDEE", accountId: actor.accountId } };
  const leaderB: GuardianViewer = { kind: "CLUB_LEADER", organizationId: clubs.b, actor: { kind: "ATTENDEE", accountId: `${P}_acct_b` } };
  const coordinator: GuardianViewer = { kind: "AREA_COORDINATOR", actor: { kind: "ATTENDEE", accountId: `${P}_acct_area` } };
  const staff: GuardianViewer = { kind: "STAFF", userId: `${P}_staff` };
  assert(Object.keys(await listGuardiansByMember(leaderA, clubs.a, clubYear)).length === 2, "the club's leader reads its guardians");
  assert(await rejects(listGuardiansByMember(leaderB, clubs.a, clubYear)), "another club's leader is refused");
  assert((await listGuardianContactsForClub(leaderB, clubs.a, clubYear).catch((error) => error)) instanceof GuardianAccessError, "another club's leader gets a guardian access error");
  assert((await listGuardianContactsForClub(coordinator, clubs.a, clubYear)).length === 2, "an Area Coordinator reads any club");
  assert((await listGuardianContactsForClub(staff, clubs.a, clubYear)).length === 2, "sensitive-data staff read any club");

  // Every member, adult or minor (owner decision Oct 15, 2026).
  const adultInput = { ...base, attendeeType: "ADULT" as const, role: "", firstName: "Verifya", lastName: "Beta", birthDate: "1985-03-04" };
  const adult = await addRosterMember(clubs.a, clubYear, { ...adultInput, guardians: [guardian("Verify Adult Contact")] }, actor);
  assert((await countFor(adult.memberId)) === 1, "an adult's emergency contact is stored");
  await updateRosterMember(clubs.a, adult.memberId, { guardians: [guardian("Verify Adult Contact Two")] }, actor);
  assert(adult.memberId in (await listGuardiansByMember(leaderA, clubs.a, clubYear)), "an adult's contact is listed for the roster dialog");
  assert((await listGuardianContactsForClub(coordinator, clubs.a, clubYear)).some((contact) => contact.memberId === adult.memberId), "an adult's contact is shown to a coordinator");
  const exportColumns = [
    { key: "firstName" as const, header: "First" },
    { key: "guardian1Name" as const, header: "Emergency contact 1 name" },
    { key: "guardian1Phone" as const, header: "Emergency contact 1 phone" },
  ];
  await updateRosterMember(clubs.a, added.memberId, { guardians: [guardian("=SUM(1+1)", { phone: "+15155550134" }), blank] }, actor);
  const exported = await runRosterExport(clubs.a, clubYear, { mode: "csv", columns: exportColumns, confirmSensitive: true }, false, actor, true);
  const csv = "csv" in exported ? exported.csv : "";
  assert(csv.includes(`"Verifya","'=SUM(1+1)","(515) 555-0134"`), `the export carries a minor's contact with formula-safe cells (got ${JSON.stringify(csv)})`);
  assert(csv.includes("Verify Adult Contact Two"), "the export carries an adult's contact too");
  assert(await rejects(runRosterExport(clubs.a, clubYear, { mode: "csv", columns: exportColumns, confirmSensitive: true }, false, actor, false)), "the export refuses a role that may not see emergency contacts");
  await updateRosterMember(clubs.a, added.memberId, { guardians: [guardian(SECRET_NAME, { email: SECRET_EMAIL, phone: SECRET_PHONE }), guardian("Verify Second", { relationship: "Uncle" })] }, actor);

  // Parents or guardians (#2058): a separate set with the same rules, and the same readers.
  const parentCount = (id: string) => prisma.clubRosterParent.count({ where: { rosterMemberId: id } });
  await updateRosterMember(clubs.a, added.memberId, { parents: [guardian(PARENT_NAME, { email: PARENT_EMAIL, phone: "(515) 555-0134" }), guardian("Verify Parent Two", { relationship: "Father" })] }, actor);
  assert((await parentCount(added.memberId)) === 2 && (await countFor(added.memberId)) === 2, "parents are stored apart from emergency contacts");
  assert(await rejects(prisma.clubRosterParent.create({ data: { rosterMemberId: added.memberId, position: 3, name: "Third" } })), "a third parent slot is refused");
  assert(await rejects(prisma.clubRosterParent.create({ data: { rosterMemberId: added.memberId, position: 1, name: "Duplicate" } })), "a duplicate parent slot is refused");
  await updateRosterMember(clubs.a, added.memberId, { role: "TLT" }, actor);
  assert((await parentCount(added.memberId)) === 2, "an edit that doesn't send parents leaves them alone");
  await updateRosterMember(clubs.a, added.memberId, { parents: [guardian("Verify Parent Renamed"), blank] }, actor);
  assert((await parentCount(added.memberId)) === 1, "an edit replaces the parent set and a blank slot removes that parent");
  assert(await rejects(updateRosterMember(clubs.a, added.memberId, { parents: [guardian("Verify Bad Parent", { email: "not an email" })] }, actor)), "a changed bad parent email is refused");
  assert(!(adult.memberId in (await listParentsByMember(leaderA, clubs.a, clubYear))), "a member with no parents is not listed");
  assert(added.memberId in (await listParentsByMember(leaderA, clubs.a, clubYear)), "the club's leader reads its parents");
  assert(await rejects(listParentsByMember(leaderB, clubs.a, clubYear)), "another club's leader is refused the parents");
  await updateRosterMember(clubs.a, added.memberId, { parents: [guardian(PARENT_NAME, { email: PARENT_EMAIL, phone: "(515) 555-0134" })] }, actor);

  // The member's own contact details (#2060): a separate record, the same readers, never a row with every field empty.
  const memberContact = { email: CONTACT_EMAIL, phone: "515-555-0134", addressLine1: CONTACT_STREET, addressLine2: "", city: "Des Moines", state: "ia", postalCode: "50309-1234" };
  const blankContact = { email: "", phone: "", addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "" };
  const contactRow = (id: string) => prisma.clubRosterMemberContact.findUnique({ where: { rosterMemberId: id } });
  await updateRosterMember(clubs.a, added.memberId, { contact: memberContact }, actor);
  const storedContact = await contactRow(added.memberId);
  assert(storedContact?.state === "IA" && storedContact.phone === "(515) 555-0134" && storedContact.postalCode === "50309-1234", "contact details are stored trimmed, with the state in capitals and the phone tidied");
  assert((await countFor(added.memberId)) === 2 && (await parentCount(added.memberId)) === 1, "contact details are stored apart from emergency contacts and parents");
  assert((await prisma.person.findFirstOrThrow({ where: { clubRosterMemberships: { some: { id: added.memberId } } } })).normalizedEmail !== CONTACT_EMAIL.toLowerCase(), "the contact email is not written to the Person");
  await updateRosterMember(clubs.a, added.memberId, { role: "Pathfinder" }, actor);
  assert((await contactRow(added.memberId)) !== null, "an edit that doesn't send contact details leaves them alone");
  for (const bad of [{ email: "not an email" }, { phone: "call me" }, { state: "Iowa" }, { postalCode: "5030" }]) {
    assert(await rejects(updateRosterMember(clubs.a, added.memberId, { contact: { ...memberContact, ...bad } }, actor)), `bad contact details ${JSON.stringify(Object.keys(bad))} are refused`);
  }
  assert((await contactRow(added.memberId))?.addressLine1 === CONTACT_STREET, "a refused contact edit saved nothing");
  assert(added.memberId in (await listContactsByMember(leaderA, clubs.a, clubYear)), "the club's leader reads its members' contact details");
  assert(await rejects(listContactsByMember(leaderB, clubs.a, clubYear)), "another club's leader is refused the contact details");
  const contactExport = await runRosterExport(clubs.a, clubYear, {
    mode: "csv",
    columns: [{ key: "firstName" as const, header: "First" }, { key: "contactEmail" as const, header: "Member email" }, { key: "contactPostalCode" as const, header: "Member ZIP code" }],
    confirmSensitive: true,
  }, false, actor, true);
  assert("csv" in contactExport && contactExport.csv.includes(`"Verifya","${CONTACT_EMAIL}","50309-1234"`), "the export carries contact details for a director");
  assert(await rejects(runRosterExport(clubs.a, clubYear, { mode: "csv", columns: [{ key: "contactEmail" as const, header: "Member email" }], confirmSensitive: true }, false, actor, false)), "the export refuses contact columns to a role without guardian access");
  await updateRosterMember(clubs.a, other.memberId, { contact: { ...blankContact, city: "Ames" } }, actor);
  await updateRosterMember(clubs.a, other.memberId, { contact: blankContact }, actor);
  assert((await contactRow(other.memberId)) === null, "clearing every contact field deletes the row instead of storing an empty one");

  // An inactive member keeps theirs; removal deletes only that member's.
  await updateRosterMember(clubs.a, other.memberId, { status: "INACTIVE" }, actor);
  assert((await countFor(other.memberId)) === 1, "an inactive member keeps their guardians");
  await removeRosterMember(clubs.a, added.memberId, actor);
  assert((await countFor(added.memberId)) === 0, "removing a member deletes every guardian of that member");
  assert((await parentCount(added.memberId)) === 0, "removing a member deletes every parent of that member");
  assert((await contactRow(added.memberId)) === null, "removing a member deletes their contact details");
  assert((await countFor(other.memberId)) === 1, "removal leaves other members' guardians");
  assert(!(await listGuardianContactsForClub(coordinator, clubs.a, clubYear)).some((contact) => contact.memberId === added.memberId), "a removed member is not listed");

  // Deleting the member row cascades.
  await prisma.clubRosterMember.delete({ where: { id: other.memberId } });
  assert((await countFor(other.memberId)) === 0, "deleting the member row cascades to its guardians");

  // No audit row holds a guardian value.
  const audits = await prisma.auditLog.findMany({ where: { metadata: { path: ["organizationId"], string_starts_with: P } } });
  const text = JSON.stringify(audits);
  for (const secret of [CONTACT_EMAIL, CONTACT_STREET, PARENT_NAME, PARENT_EMAIL, "Verify Parent Renamed", "Verify Parent Two", SECRET_NAME, SECRET_EMAIL, SECRET_PHONE, "Verify Renamed", "Verify Second", "Verify Other Guardian", "Verify Adult Contact", "Verify Adult Contact Two", "=SUM(1+1)", "Verify August Contact", "Verify August Second", "Verify Past Year", "Verify Other Club"]) {
    assert(!text.includes(secret), `no audit row contains "${secret}"`);
  }
  assert(audits.some((row) => row.action === "CLUB_ROSTER_GUARDIANS_VIEWED"), "a coordinator's or staff opening is audited");

  console.log("Club roster guardians (#510): all checks passed.");
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
