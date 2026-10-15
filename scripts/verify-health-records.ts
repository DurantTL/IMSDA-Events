/**
 * Proves the Pathfinder Health Record (#611) against a real PostgreSQL
 * database, where the unit tests' fake database can't:
 *
 * - with HEALTH_RECORDS_ENABLED off nothing is stored, even when asked to;
 * - with it on, every health field is its own sealed row and the plaintext
 *   appears in no column, audit row or outbox row; it round-trips for the
 *   club's director, and another club's director is refused;
 * - every view writes one audit row with no health text;
 * - a system administrator, acting as a director or not, reads a live record only inside an unexpired
 *   break-glass grant for that person (#929): refused with BREAK_GLASS_REQUIRED and audited without it, allowed
 *   with it (the use is recorded), refused again after 24 hours, and the review list shows the use;
 * - a parent's private link: minted at delivery, stored only as a hash, works
 *   exactly once even when many submits race, and the record it writes is
 *   Current for this club year; an older club year reads Needs update;
 * - removing a roster member erases the record and withdraws its open links;
 * - the owner decisions of 2026-10-14 (#923): a Registrar enters and replaces a
 *   record but never reads one back (refusals audited, no value in any row),
 *   and, since the follow-up decision of the same day, only when none exists
 *   yet: a save over an existing record is refused (audited with ids and a
 *   reason, no value), including when several Registrar saves for one member
 *   race, where exactly one creates it;
 *   and nobody reads or enters health data until they have acknowledged the
 *   current privacy wording once (per person and version, staff by user and
 *   everyone else by attendee account, with the table holding no event, club,
 *   roster or person reference so event and roster deletion never touch it).
 *
 * Uses fictitious rows it creates and removes itself, and a synthetic key.
 *
 *   npm run test:health-records
 */
import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { assertLocalDatabase } from "./support/local-only-guard";
import { PrismaClient } from "@prisma/client";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";

loadEnvConfig(process.cwd());
// Local-only, before any Prisma client or connection exists.
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("RESEND_API_KEY", "verify-script-placeholder-never-sent");
fillBlankSyntheticEnv("ACCOUNT_EMAIL_SENDER_ADDRESS", "events@health.example.test");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-health-records-synthetic-key-not-a-secret");
// The origin the links are built on is set explicitly, whatever .env holds
// (the local default is http://localhost:3000). Nothing is delivered to it.
const syntheticOrigin = "https://events.health.example.test";
process.env.APP_BASE_URL = syntheticOrigin;
process.env.HEALTH_RECORDS_ENABLED = "false";

/** The delivered link, over http or https, and only on the synthetic origin set above. */
function linkFrom(bodyText: string) {
  const link = bodyText.match(/https?:\/\/\S+/)?.[0];
  if (link && !link.startsWith(`${syntheticOrigin}/`)) {
    throw new Error("The delivered link is not on the synthetic verification origin.");
  }
  return link;
}

const prisma = new PrismaClient();
const P = "hr611";
const clubs = { a: `${P}_club_a`, b: `${P}_club_b` };
const accounts = { a: `${P}_acct_a`, b: `${P}_acct_b`, reg: `${P}_acct_reg`, reg2: `${P}_acct_reg2`, temp: `${P}_acct_temp` };
const adminUserId = `${P}_admin_user`;
const emailDomain = "health.example.test";
const SECRETS = ["Verify allergy text only", "Verify medication text only", "Verify Mutual Insurer", "4 Verify Road", "515-555-0188"];

const record = {
  addressLine1: "4 Verify Road",
  city: "Exampleville",
  state: "IA",
  zip: "50001",
  phone: "515-555-0188",
  email: "kid@health.example.test",
  lastTetanusBooster: "2024-03-01",
  hasAllergies: "YES",
  allergyDetails: "Verify allergy text only",
  medications: "Verify medication text only",
  hasInsurance: "YES",
  insuranceCompany: "Verify Mutual Insurer",
  insuranceGroupNumber: "VG-1",
  insurancePolicyNumber: "VP-1",
  insurancePhone: "515-555-0189",
  guardianFirstName: "Pat",
  guardianLastName: "Verify",
  guardianPhone: "515-555-0190",
  emergencyContacts: [{ firstName: "Alex", lastName: "Verify", phone: "515-555-0191", relationship: "Aunt" }],
  consentEmergencyTreatment: true,
  consentActivities: true,
  consentPhotocopy: true,
  signature: "Pat Verify",
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function expectCode(promise: Promise<unknown>, code: string, message: string) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  assert(
    error && typeof error === "object" && "code" in error && (error as { code: string }).code === code,
    `${message}: expected ${code}, got ${String(error)}`,
  );
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function cleanup() {
  const records = await prisma.healthRecord.findMany({ where: { organizationId: { in: Object.values(clubs) } }, select: { id: true } });
  const links = await prisma.healthRecordLink.findMany({ where: { organizationId: { in: Object.values(clubs) } }, select: { id: true, messageId: true } });
  const members = await prisma.clubRosterMember.findMany({ where: { organizationId: { in: Object.values(clubs) } }, select: { id: true } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ entityId: { in: [...records, ...links, ...members].map((row) => row.id) } }, { entityId: { startsWith: P } }, { actorUserId: { in: [adminUserId, `${P}_admin2_user`] } }] },
  });
  // Grants and uses outlive a deleted person or user (the review trail), so remove them by the fictitious ids.
  await prisma.healthBreakGlassUse.deleteMany({ where: { OR: [{ person: { id: { startsWith: `${P}_` } } }, { userId: { in: [adminUserId, `${P}_admin2_user`] } }] } });
  await prisma.healthSnapshotBreakGlass.deleteMany({ where: { OR: [{ person: { id: { startsWith: `${P}_` } } }, { userId: { in: [adminUserId, `${P}_admin2_user`] } }] } });
  await prisma.healthRecord.deleteMany({ where: { organizationId: { in: Object.values(clubs) } } });
  await prisma.healthRecordLink.deleteMany({ where: { organizationId: { in: Object.values(clubs) } } });
  await prisma.messageOutbox.deleteMany({ where: { recipientEmail: { endsWith: `@${emailDomain}` } } });
  await prisma.rateLimitBucket.deleteMany({ where: { policy: { startsWith: "club-form." } } });
  await prisma.clubRosterMember.deleteMany({ where: { organizationId: { in: Object.values(clubs) } } });
  await prisma.person.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { in: Object.values(accounts) } } });
  await prisma.healthPrivacyAcknowledgment.deleteMany({ where: { userId: { in: [adminUserId, `${P}_admin2_user`] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, `${P}_admin2_user`] } } });
  await prisma.organization.deleteMany({ where: { id: { in: Object.values(clubs) } } });
}

async function main() {
  const repo = await import("../modules/health-records/repository");
  const acknowledgment = await import("../modules/health-records/acknowledgment");
  const breakGlass = await import("../modules/health-records/snapshot-access-repository");
  const acknowledgmentDomain = await import("../modules/health-records/acknowledgment-domain");
  const linkEmail = await import("../modules/health-records/link-email");
  const rosterDomain = await import("../modules/club-rosters/domain");
  const rosterRepo = await import("../modules/club-rosters/repository");
  type Viewer = import("../modules/health-records/domain").HealthViewer;
  const directorA: Viewer = { kind: "CLUB_LEADER", organizationId: clubs.a, accountId: accounts.a };
  const directorB: Viewer = { kind: "CLUB_LEADER", organizationId: clubs.b, accountId: accounts.b };
  const registrarA: Viewer = { kind: "CLUB_REGISTRAR", organizationId: clubs.a, accountId: accounts.reg };
  const registrarB: Viewer = { kind: "CLUB_REGISTRAR", organizationId: clubs.b, accountId: accounts.reg2 };
  const adminViewer: Viewer = { kind: "SYSTEM_ADMIN", userId: adminUserId };
  const now = new Date();
  const clubYear = rosterDomain.clubYearFor(now);

  await cleanup();
  await prisma.organization.createMany({
    data: [
      { id: clubs.a, type: "CLUB", name: "Verify Health Club A", normalizedName: "verify health club a" },
      { id: clubs.b, type: "CLUB", name: "Verify Health Club B", normalizedName: "verify health club b" },
    ],
  });
  for (const [key, id] of Object.entries(accounts)) {
    await prisma.attendeeAccount.create({ data: { id, email: `account-${key}@${emailDomain}`, displayName: `Verify ${key}`, status: "ACTIVE" } });
  }
  await prisma.user.create({ data: { id: adminUserId, email: `admin@${emailDomain}`, displayName: "Verify Admin" } });
  await prisma.person.create({ data: { id: `${P}_riley`, firstName: "Riley", lastName: "Verify" } });
  const member = await prisma.clubRosterMember.create({
    data: { organizationId: clubs.a, clubYear, personId: `${P}_riley`, attendeeType: "YOUTH", role: "Pathfinder", source: "DIRECTOR" },
  });

  // 1. Switched off: nothing is stored -----------------------------------
  await expectCode(repo.saveHealthRecord(directorA, clubs.a, member.id, record, now), "NOT_FOUND", "saving with the flag off");
  await expectCode(repo.viewHealthRecord(directorA, clubs.a, member.id, now), "NOT_FOUND", "viewing with the flag off");
  assert((await prisma.healthRecord.count({ where: { organizationId: clubs.a } })) === 0, "nothing is stored with the flag off");

  // 2. Switched on: sealed per field, audited, role scoped ---------------
  process.env.HEALTH_RECORDS_ENABLED = "true";
  // The environment is read once per process; load a fresh copy of it.
  const envModule = await import("../lib/env");
  envModule.resetServerEnvCache();
  assert((await import("../modules/health-records/flag")).healthRecordsEnabled(), "the flag is on for the rest of this script");

  // Nobody enters or reads anything until they have acknowledged the privacy notice (#923).
  await expectCode(repo.saveHealthRecord(directorA, clubs.a, member.id, record, now), "ACKNOWLEDGMENT_REQUIRED", "saving before acknowledging");
  await expectCode(repo.viewHealthRecord(directorA, clubs.a, member.id, now), "ACKNOWLEDGMENT_REQUIRED", "viewing before acknowledging");
  assert((await prisma.healthRecord.count({ where: { organizationId: clubs.a } })) === 0, "nothing is stored before the acknowledgment");
  assert((await prisma.auditLog.count({ where: { action: "HEALTH_RECORD_VIEWED", entityId: member.id } })) === 0, "a refused view is not audited as a view");
  await acknowledgment.recordHealthPrivacyAcknowledgment(directorA, now);
  await acknowledgment.recordHealthPrivacyAcknowledgment(directorB, now);

  await repo.saveHealthRecord(directorA, clubs.a, member.id, record, now);
  const stored = await prisma.healthRecord.findUniqueOrThrow({ where: { rosterMemberId: member.id }, include: { fields: true } });
  assert(stored.hasHealthNote === true && stored.confirmedClubYear === clubYear, "the flag and club year are stored in the clear");
  assert(stored.fields.length >= 15, "each field is its own row");
  assert(new Set(stored.fields.map((field) => field.sealedValue)).size === stored.fields.length, "no two fields share a ciphertext");
  const dump = JSON.stringify(stored) + JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: stored.id } }));
  for (const secret of SECRETS) assert(!dump.includes(secret), `"${secret}" is in no stored column or audit row`);

  await expectCode(repo.viewHealthRecord(directorB, clubs.a, member.id, now), "MEMBER_NOT_FOUND", "another club's director");
  await expectCode(repo.saveHealthRecord(directorB, clubs.a, member.id, record, now), "MEMBER_NOT_FOUND", "another club's director saving");

  const before = await prisma.auditLog.count({ where: { action: "HEALTH_RECORD_VIEWED", entityId: stored.id } });
  const view = await repo.viewHealthRecord(directorA, clubs.a, member.id, now);
  assert(view.values.allergyDetails === "Verify allergy text only" && view.status === "CURRENT", "the director reads the record back");
  const viewRows = await prisma.auditLog.findMany({ where: { action: "HEALTH_RECORD_VIEWED", entityId: stored.id } });
  assert(viewRows.length === before + 1, "one view writes one audit row");
  for (const secret of SECRETS) assert(!JSON.stringify(viewRows).includes(secret), "the view audit row holds no health text");

  const old = await prisma.healthRecord.update({ where: { id: stored.id }, data: { confirmedClubYear: "2020-21" } });
  assert((await repo.viewHealthRecord(directorA, clubs.a, member.id, now)).status === "NEEDS_UPDATE" && old.id === stored.id, "an old club year reads Needs update");
  await repo.confirmHealthRecord(directorA, clubs.a, member.id, now);
  assert((await repo.viewHealthRecord(directorA, clubs.a, member.id, now)).status === "CURRENT", "confirming makes it Current");

  // 3. Parent link: hash only, exactly once, even under a race -----------
  const created = await repo.createHealthRecordLink(directorA, { organizationId: clubs.a, rosterMemberId: member.id, recipientEmail: `parent@${emailDomain}` }, now);
  const outbox = await prisma.messageOutbox.findUniqueOrThrow({ where: { id: created.messageId } });
  assert(outbox.bodyTextSnapshot.includes(linkEmail.HEALTH_RECORD_LINK_SENTINEL) && !/https?:\/\//.test(outbox.bodyTextSnapshot), "the queued body holds a sentinel, never a link");
  assert(!/Riley|allerg|medicat/i.test(outbox.bodyTextSnapshot), "the email names neither the child nor any health text");
  assert((await prisma.healthRecordLink.findUniqueOrThrow({ where: { id: created.linkId } })).tokenHash === null, "no token exists until delivery");
  const delivered = await linkEmail.prepareHealthRecordLinkBodyForDelivery({ messageId: created.messageId, bodyText: outbox.bodyTextSnapshot, now });
  const url = linkFrom(delivered.bodyText);
  assert(url, "delivery produces the link");
  const token = decodeURIComponent(url.split("/health-records/")[1]!);
  assert((await prisma.healthRecordLink.findUniqueOrThrow({ where: { id: created.linkId } })).tokenHash === sha256(token), "only the hash of the token is stored");
  const page = await repo.resolveHealthLinkForFill(token, now);
  assert(page.memberFirstName === "Riley" && !JSON.stringify(page).includes("Verify allergy"), "the page shows the first name and no stored value");

  const racers = await Promise.allSettled(Array.from({ length: 8 }, () => repo.submitHealthRecordViaLink(token, { ...record, medications: "Verify medication text only" }, now)));
  assert(racers.filter((result) => result.status === "fulfilled").length === 1, "exactly one of eight racing submits succeeds");
  await expectCode(repo.submitHealthRecordViaLink(token, record, now), "LINK_UNAVAILABLE", "a used link");
  await expectCode(repo.resolveHealthLinkForFill(token, now), "LINK_UNAVAILABLE", "opening a used link");
  assert((await prisma.healthRecord.count({ where: { organizationId: clubs.a } })) === 1, "the link updated the member's one record");

  const expiring = await repo.createHealthRecordLink(directorA, { organizationId: clubs.a, rosterMemberId: member.id, recipientEmail: `parent2@${emailDomain}`, expiresInDays: 1 }, now);
  const expiringMessage = await prisma.messageOutbox.findUniqueOrThrow({ where: { id: expiring.messageId } });
  const expiringBody = await linkEmail.prepareHealthRecordLinkBodyForDelivery({ messageId: expiring.messageId, bodyText: expiringMessage.bodyTextSnapshot, now });
  const expiringToken = decodeURIComponent(linkFrom(expiringBody.bodyText)!.split("/health-records/")[1]!);
  const later = new Date(now.getTime() + 3 * 86_400_000);
  await expectCode(repo.submitHealthRecordViaLink(expiringToken, record, later), "LINK_UNAVAILABLE", "an expired link");

  // 4. Removing the member erases the record and withdraws the link ------
  await prisma.$transaction((tx) => rosterRepo.eraseRosterRow(tx, member.id, now));
  assert((await prisma.healthRecord.count({ where: { rosterMemberId: member.id } })) === 0, "removal erases the health record");
  assert((await prisma.healthRecordField.count({ where: { recordId: stored.id } })) === 0, "removal erases the sealed fields");
  assert((await prisma.healthRecordLink.count({ where: { rosterMemberId: member.id, status: "OPEN" } })) === 0, "removal withdraws open links");

  // 5. A record on an earlier year's row dies with the person -------------
  await prisma.person.create({ data: { id: `${P}_casey`, firstName: "Casey", lastName: "Verify" } });
  const lastYearDate = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate(), 15));
  const priorRow = await prisma.clubRosterMember.create({
    data: { organizationId: clubs.a, clubYear: rosterDomain.clubYearFor(lastYearDate), personId: `${P}_casey`, attendeeType: "YOUTH", role: "Pathfinder", source: "DIRECTOR" },
  });
  const currentRow = await prisma.clubRosterMember.create({
    data: { organizationId: clubs.a, clubYear, personId: `${P}_casey`, attendeeType: "YOUTH", role: "Pathfinder", source: "DIRECTOR" },
  });
  await repo.saveHealthRecord(directorA, clubs.a, priorRow.id, record, lastYearDate);
  const carried = await repo.viewHealthRecord(directorA, clubs.a, currentRow.id, now);
  assert(carried.status === "NEEDS_UPDATE", "last year's record follows the person and reads Needs update");
  await prisma.healthRecordLink.create({
    data: { organizationId: clubs.a, rosterMemberId: priorRow.id, clubYear: rosterDomain.clubYearFor(lastYearDate), recipientEmail: `old@${emailDomain}`, expiresAt: new Date(now.getTime() + 86_400_000), tokenHash: sha256("verify-open-link") },
  });
  await prisma.$transaction((tx) => rosterRepo.eraseRosterRow(tx, currentRow.id, now));
  assert((await prisma.healthRecord.count({ where: { organizationId: clubs.a, rosterMemberId: { in: [priorRow.id, currentRow.id] } } })) === 0, "removing the current-year row erases the earlier year's record too");
  assert((await prisma.healthRecordLink.count({ where: { rosterMemberId: priorRow.id, status: "OPEN" } })) === 0, "and withdraws the earlier row's open link");

  // 6. A Registrar enters and replaces a record but never reads one (#923) -
  await prisma.person.create({ data: { id: `${P}_morgan`, firstName: "Morgan", lastName: "Verify" } });
  const morgan = await prisma.clubRosterMember.create({
    data: { organizationId: clubs.a, clubYear, personId: `${P}_morgan`, attendeeType: "YOUTH", role: "Pathfinder", source: "DIRECTOR" },
  });
  await expectCode(repo.saveHealthRecord(registrarA, clubs.a, morgan.id, record, now), "ACKNOWLEDGMENT_REQUIRED", "a Registrar entering before acknowledging");
  await acknowledgment.recordHealthPrivacyAcknowledgment(registrarA, now);
  await acknowledgment.recordHealthPrivacyAcknowledgment(registrarB, now);
  await repo.saveHealthRecord(registrarA, clubs.a, morgan.id, record, now);
  const entered = await prisma.healthRecord.findUniqueOrThrow({ where: { rosterMemberId: morgan.id }, include: { fields: true } });
  assert(entered.fields.length >= 15 && entered.lastConfirmedAt !== null && entered.confirmedClubYear === clubYear, "the Registrar's entry is sealed field by field and dated");
  assert(!JSON.stringify(entered).includes("Verify allergy text only"), "no plaintext is stored for a Registrar's entry");
  const createdRows = await prisma.auditLog.findMany({ where: { action: "HEALTH_RECORD_CREATED", entityId: entered.id } });
  assert(createdRows.length === 1 && (createdRows[0]!.metadata as { viewerKind?: string }).viewerKind === "CLUB_REGISTRAR", "the Registrar's save is audited as theirs");
  for (const secret of SECRETS) assert(!JSON.stringify(createdRows).includes(secret), "the save audit row holds no health text");

  await expectCode(repo.viewHealthRecord(registrarA, clubs.a, morgan.id, now), "FORBIDDEN", "a Registrar reading a record");
  await expectCode(repo.healthSummariesForMembers(registrarA, clubs.a, [morgan.id], now), "FORBIDDEN", "a Registrar reading summaries");
  await expectCode(repo.confirmHealthRecord(registrarA, clubs.a, morgan.id, now), "FORBIDDEN", "a Registrar confirming");
  await expectCode(repo.listHealthRecordLinks(registrarA, clubs.a, morgan.id, now), "FORBIDDEN", "a Registrar listing links");
  await expectCode(repo.viewHealthRecord(registrarB, clubs.a, morgan.id, now), "MEMBER_NOT_FOUND", "another club's Registrar reading");
  await expectCode(repo.saveHealthRecord(registrarB, clubs.a, morgan.id, record, now), "MEMBER_NOT_FOUND", "another club's Registrar writing");
  const refusals = await prisma.auditLog.findMany({ where: { action: "HEALTH_RECORD_ACCESS_REFUSED", entityId: { in: [morgan.id, clubs.a] } } });
  assert(refusals.length === 2, "a Registrar's refused reads (one record, one list) are audited");
  for (const secret of SECRETS) assert(!JSON.stringify(refusals).includes(secret), "the refusal audit rows hold no health text");
  assert(!(await prisma.auditLog.count({ where: { action: "HEALTH_RECORD_VIEWED", entityId: entered.id } })), "a refused read is never a view");

  const entry = await repo.viewHealthEntryStatus(registrarA, clubs.a, morgan.id, now);
  assert(entry.exists && entry.status === "CURRENT", "the Registrar sees that a record exists and its status");
  for (const secret of SECRETS) assert(!JSON.stringify(entry).includes(secret), "the entry status holds no health text");
  const statuses = await repo.healthEntryStatusesForMembers(registrarA, clubs.a, [morgan.id], now);
  assert(JSON.stringify(statuses) === JSON.stringify({ [morgan.id]: { status: "CURRENT" } }), "the roster status for a Registrar is the status alone");

  // Only when none exists yet (owner decision of 2026-10-14): a Registrar's save over a record is refused.
  const fieldsBefore = JSON.stringify((await prisma.healthRecordField.findMany({ where: { recordId: entered.id }, orderBy: { fieldKey: "asc" } })));
  const refusedSave = await repo.saveHealthRecord(registrarA, clubs.a, morgan.id, { ...record, medications: "Verify replaced medication" }, now).then(() => null, (caught: unknown) => caught);
  assert(refusedSave instanceof Error && (refusedSave as { code?: string }).code === "RECORD_EXISTS", "a Registrar's save over an existing record is refused");
  assert(!(refusedSave as Error).message.includes("Verify") && !JSON.stringify(refusedSave).includes("Verify"), "the refusal message holds no value");
  assert(JSON.stringify(await prisma.healthRecordField.findMany({ where: { recordId: entered.id }, orderBy: { fieldKey: "asc" } })) === fieldsBefore, "the refused save changed nothing");
  const saveRefusals = await prisma.auditLog.findMany({ where: { action: "HEALTH_RECORD_SAVE_REFUSED", entityId: morgan.id } });
  assert(saveRefusals.length === 1, "the refused save is audited once");
  const refusalMetadata = saveRefusals[0]!.metadata as Record<string, unknown>;
  assert(refusalMetadata.reason === "RECORD_EXISTS" && refusalMetadata.rosterMemberId === morgan.id && refusalMetadata.viewerKind === "CLUB_REGISTRAR", "the refusal names who, which member and the reason");
  for (const secret of [...SECRETS, "Verify replaced medication"]) assert(!JSON.stringify(saveRefusals).includes(secret), "the save refusal audit row holds no health text");
  assert((await prisma.auditLog.count({ where: { action: "HEALTH_RECORD_UPDATED", entityId: entered.id } })) === 0, "a Registrar's refused save is never an update");
  await repo.saveHealthRecord(directorA, clubs.a, morgan.id, { ...record, medications: "Verify replaced medication" }, now);
  assert((await prisma.auditLog.count({ where: { action: "HEALTH_RECORD_UPDATED", entityId: entered.id } })) === 1, "the director's replacement is audited as an update");
  assert((await repo.viewHealthRecord(directorA, clubs.a, morgan.id, now)).values.medications === "Verify replaced medication", "the director reads what was saved");

  // Several Registrar saves for one member at once: exactly one creates the record, the rest are refused.
  await prisma.person.create({ data: { id: `${P}_quinn`, firstName: "Quinn", lastName: "Verify" } });
  const quinn = await prisma.clubRosterMember.create({
    data: { organizationId: clubs.a, clubYear, personId: `${P}_quinn`, attendeeType: "YOUTH", role: "Pathfinder", source: "DIRECTOR" },
  });
  const raceResults = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => repo.saveHealthRecord(registrarA, clubs.a, quinn.id, { ...record, medications: `Verify race entry ${index}` }, now)));
  const winners = raceResults.filter((result) => result.status === "fulfilled");
  const losers = raceResults.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  assert(winners.length === 1, `exactly one of eight racing Registrar saves creates the record (got ${winners.length})`);
  assert(losers.every((loser) => (loser.reason as { code?: string }).code === "RECORD_EXISTS"), "every losing racer is refused as 'record exists'");
  assert((await prisma.healthRecord.count({ where: { rosterMemberId: quinn.id } })) === 1, "the race leaves one record");
  assert((await prisma.auditLog.count({ where: { action: "HEALTH_RECORD_CREATED", entityId: (await prisma.healthRecord.findUniqueOrThrow({ where: { rosterMemberId: quinn.id } })).id } })) === 1, "the race writes one create audit row");
  assert((await prisma.auditLog.count({ where: { action: "HEALTH_RECORD_SAVE_REFUSED", entityId: quinn.id } })) === 7, "each losing racer is audited");

  // 7. The acknowledgment: per person and wording version (#923) ----------
  const version = acknowledgmentDomain.HEALTH_PRIVACY_ACK_VERSION;
  await expectCode(repo.viewHealthRecord(adminViewer, clubs.a, morgan.id, now), "ACKNOWLEDGMENT_REQUIRED", "a system administrator before acknowledging");
  await acknowledgment.recordHealthPrivacyAcknowledgment(adminViewer, now);
  await acknowledgment.recordHealthPrivacyAcknowledgment(adminViewer, now);
  assert((await prisma.healthPrivacyAcknowledgment.count({ where: { userId: adminUserId, version } })) === 1, "acknowledging twice stores one row, by user for staff");

  // 7b. A system administrator reads a live record only through break-glass (#929) -----
  const REASON = "Verify typed reason for a live record";
  const actingAdminViewer: Viewer = { kind: "SYSTEM_ADMIN", userId: adminUserId, actAsId: "verify-act-as" };
  await expectCode(repo.viewHealthRecord(adminViewer, clubs.a, morgan.id, now), "BREAK_GLASS_REQUIRED", "an acknowledged administrator without break-glass");
  await expectCode(repo.viewHealthRecord(actingAdminViewer, clubs.a, morgan.id, now), "BREAK_GLASS_REQUIRED", "an administrator acting as a director without break-glass");
  const breakGlassRefusals = await prisma.auditLog.findMany({ where: { action: "HEALTH_RECORD_ACCESS_REFUSED", actorUserId: adminUserId } });
  assert(breakGlassRefusals.length === 2, "each refused live read is audited");
  assert(breakGlassRefusals.some((row) => (row.metadata as { actAsId?: string }).actAsId === "verify-act-as"), "the refusal carries the act-as id");
  for (const row of breakGlassRefusals) {
    assert((row.metadata as { reason?: string }).reason === "BREAK_GLASS_REQUIRED", "the refusal names its reason");
    for (const secret of ["Verify allergy text only", "Verify replaced medication", "4 Verify Road", "515-555-0188"]) assert(!JSON.stringify(row).includes(secret), "a refusal holds no health value");
  }
  assert((await repo.healthSummariesForMembers(adminViewer, clubs.a, [morgan.id], now))[morgan.id]?.hasHealthNote === false, "the has-a-note flag is hidden from an administrator without a grant");
  await expectCode(breakGlass.startSnapshotBreakGlass(adminViewer, { personId: `${P}_morgan`, reason: "short" }, now), "VALIDATION_FAILED", "break-glass with no real reason");
  const liveGrant = await breakGlass.startSnapshotBreakGlass(adminViewer, { personId: `${P}_morgan`, reason: REASON }, now);
  assert(liveGrant.liveRecordCount === 1 && liveGrant.snapshotCount === 0, "break-glass for a person with only a live record");
  assert(liveGrant.expiresAt.getTime() - now.getTime() === 24 * 3_600_000, "a grant lasts 24 hours");
  assert((await repo.viewHealthRecord(adminViewer, clubs.a, morgan.id, now)).values.medications === "Verify replaced medication", "an administrator reads the live record during break-glass");
  assert((await repo.viewHealthRecord(actingAdminViewer, clubs.a, morgan.id, now)).status === "CURRENT", "acting as a director uses the administrator's own grant");
  assert((await repo.healthSummariesForMembers(adminViewer, clubs.a, [morgan.id], now))[morgan.id]?.hasHealthNote === true, "the has-a-note flag shows during break-glass");
  const liveUses = await prisma.healthBreakGlassUse.findMany({ where: { grantId: liveGrant.grantId } });
  assert(liveUses.length === 2 && liveUses.every((use) => use.kind === "LIVE_RECORD" && use.userId === adminUserId && use.personId === `${P}_morgan`), "each live read records a use");
  const viewAudit = await prisma.auditLog.findMany({ where: { action: "HEALTH_RECORD_VIEWED", actorUserId: adminUserId } });
  assert(viewAudit.length === 2 && viewAudit.every((row) => (row.metadata as { grantId?: string }).grantId === liveGrant.grantId), "each allowed read is audited with its grant");
  assert(viewAudit.some((row) => (row.metadata as { actAsId?: string }).actAsId === "verify-act-as"), "the allowed read carries the act-as id");
  assert(!JSON.stringify(viewAudit).includes("Verify replaced medication"), "an audit row holds no health value");
  const review = await breakGlass.listSnapshotBreakGlassGrants(adminViewer);
  const reviewed = review.find((row) => row.id === liveGrant.grantId);
  assert(reviewed && reviewed.personId === `${P}_morgan` && reviewed.reason === REASON && reviewed.userId === adminUserId, "the review list shows who, the reason and whose record");
  assert(reviewed.uses.total === 2 && reviewed.uses.byKind.LIVE_RECORD === 2 && reviewed.uses.lastUsedAt !== null, "the review list counts live-record uses");
  assert(!JSON.stringify(review).includes("Verify replaced medication"), "the review list holds no health value");
  await expectCode(repo.viewHealthRecord(adminViewer, clubs.a, morgan.id, new Date(liveGrant.expiresAt.getTime())), "BREAK_GLASS_REQUIRED", "an administrator after the grant's 24 hours");
  await expectCode(repo.viewHealthRecord(adminViewer, clubs.a, morgan.id, new Date(now.getTime() + 25 * 3_600_000)), "BREAK_GLASS_REQUIRED", "an administrator 25 hours later");
  const secondAdmin = `${P}_admin2_user`;
  await prisma.user.create({ data: { id: secondAdmin, email: `admin2@${emailDomain}`, displayName: "Verify Admin Two" } });
  await acknowledgment.recordHealthPrivacyAcknowledgment({ kind: "SYSTEM_ADMIN", userId: secondAdmin }, now);
  await expectCode(repo.viewHealthRecord({ kind: "SYSTEM_ADMIN", userId: secondAdmin }, clubs.a, morgan.id, now), "BREAK_GLASS_REQUIRED", "a second administrator is not let in by the first one's grant");
  assert((await repo.viewHealthRecord(directorA, clubs.a, morgan.id, now)).status === "CURRENT", "a director is not asked for break-glass");
  assert((await prisma.healthPrivacyAcknowledgment.count({ where: { attendeeAccountId: accounts.a, version } })) === 1, "a director is acknowledged by attendee account");
  assert((await prisma.healthPrivacyAcknowledgment.count({ where: { attendeeAccountId: accounts.reg, version } })) === 1, "a Registrar is acknowledged by attendee account");

  // A new wording version asks everyone again; the old row does not count.
  await prisma.healthPrivacyAcknowledgment.updateMany({ where: { userId: adminUserId }, data: { version: "health-privacy-ack-old" } });
  await prisma.healthPrivacyAcknowledgment.updateMany({ where: { attendeeAccountId: accounts.a }, data: { version: "health-privacy-ack-old" } });
  await expectCode(repo.viewHealthRecord(adminViewer, clubs.a, morgan.id, now), "ACKNOWLEDGMENT_REQUIRED", "staff after a wording change");
  await expectCode(repo.viewHealthRecord(directorA, clubs.a, morgan.id, now), "ACKNOWLEDGMENT_REQUIRED", "a director after a wording change");
  await acknowledgment.recordHealthPrivacyAcknowledgment(directorA, now);
  assert((await repo.viewHealthRecord(directorA, clubs.a, morgan.id, now)).status === "CURRENT", "acknowledging the new wording reopens access");
  assert((await prisma.healthPrivacyAcknowledgment.count({ where: { attendeeAccountId: accounts.a } })) === 2, "the old acknowledgment is kept beside the new one");

  const ackAudit = await prisma.auditLog.findMany({ where: { action: "HEALTH_PRIVACY_ACKNOWLEDGED" } , select: { metadata: true, actorUserId: true } });
  assert(ackAudit.length >= 4, "each acknowledgment is audited");
  for (const row of ackAudit) {
    const keys = Object.keys(row.metadata as object).sort().join(",");
    assert(keys === "actorAttendeeAccountId,version,viewerKind" || keys === "version,viewerKind", `an acknowledgment audit row holds only who and which wording (${keys})`);
  }

  // The database itself: exactly one person, one row per person and version, and nothing else referenced.
  await expectCode(prisma.healthPrivacyAcknowledgment.create({ data: { version } }).catch((error: unknown) => { throw Object.assign(new Error("refused"), { code: "REFUSED", cause: error }); }), "REFUSED", "an acknowledgment of no one");
  await expectCode(prisma.healthPrivacyAcknowledgment.create({ data: { version, userId: adminUserId, attendeeAccountId: accounts.a } }).catch((error: unknown) => { throw Object.assign(new Error("refused"), { code: "REFUSED", cause: error }); }), "REFUSED", "an acknowledgment of two people");
  await expectCode(prisma.healthPrivacyAcknowledgment.create({ data: { version: "health-privacy-ack-old", attendeeAccountId: accounts.a } }), "P2002", "a duplicate for the same person and version");
  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'HealthPrivacyAcknowledgment'`;
  assert(columns.map((column) => column.column_name).sort().join(",") === "acknowledgedAt,attendeeAccountId,id,userId,version", "the table refers to no event, club, roster row or person, so event and roster deletion never touch it");
  await prisma.healthPrivacyAcknowledgment.create({ data: { version, attendeeAccountId: accounts.temp } });
  await prisma.attendeeAccount.delete({ where: { id: accounts.temp } });
  assert((await prisma.healthPrivacyAcknowledgment.count({ where: { attendeeAccountId: accounts.temp } })) === 0, "an acknowledgment goes with the account that made it");

  await cleanup();
  console.log("Health record checks passed.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
