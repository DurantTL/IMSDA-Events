/**
 * Proves the sealed per-event copies of the health record (#924, ADR 0005
 * Addendum B) against a real PostgreSQL database, where the unit tests' fake
 * database can't:
 *
 * - with HEALTH_RECORDS_ENABLED off nothing is sealed, swept, held or opened;
 * - a copy is sealed at check-in (the same hook the check-in route calls) and,
 *   for a confirmed registrant, at the event's start; once per person per
 *   event, even when many attempts race; a person with no live record, or not
 *   on a club registration, gets none; every field is its own ciphertext under
 *   the snapshot's own key purpose, and no plaintext is in any column or audit row;
 * - the database refuses every UPDATE, every INSERT that would add to a copy,
 *   every incomplete copy, and every DELETE outside the retention job and event
 *   deletion;
 * - expiry is computed per copy from the birth date at the event (a minor: the
 *   26th birthday; an adult and an unknown birth date: see the retention rules) and
 *   stores no birth date;
 * - removing the live record leaves its copies, which then still open through
 *   break-glass; a person with a copy cannot be deleted;
 * - the daily job deletes expired copies, never one under a person or event
 *   hold, runs once a day, and audits ids and counts only;
 * - holds and lifts need a system administrator and a reason, and are audited;
 * - break-glass is the only way in: a system administrator, the privacy
 *   acknowledgment, a typed reason, 24 hours, audited with ids and counts and
 *   never a value; a director, the health role and an Area Coordinator are
 *   refused, and the refusal is audited;
 * - event deletion removes an event's copies, and refuses while a hold covers one.
 *
 * Uses fictitious rows it creates and removes itself, and a synthetic key.
 *
 *   npm run test:health-snapshots
 */
import { loadEnvConfig } from "@next/env";
import { assertLocalDatabase } from "./support/local-only-guard";
import { PrismaClient } from "@prisma/client";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";

loadEnvConfig(process.cwd());
// Local-only, before any Prisma client or connection exists.
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("RESEND_API_KEY", "verify-script-placeholder-never-sent");
fillBlankSyntheticEnv("ACCOUNT_EMAIL_SENDER_ADDRESS", "events@health.example.test");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-health-snapshots-synthetic-key-not-a-secret");
process.env.HEALTH_RECORDS_ENABLED = "false";

const prisma = new PrismaClient();
const P = "hs924";
const clubId = `${P}_club`;
const clubId2 = `${P}_club_2`;
const accounts = { director: `${P}_acct_dir`, coordinator: `${P}_acct_coord` };
const adminUserId = `${P}_admin_user`;
const healthUserId = `${P}_health_user`;
const emailDomain = "health.example.test";
const SECRETS = ["Verify allergy text only", "Verify medication text only", "Verify Mutual Insurer", "4 Verify Road", "515-555-0188", "Pat Verify"];
const REASON = "Verify typed reason for sealed copy access";
const DAY = 86_400_000;

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

async function caught(promise: Promise<unknown>) {
  return promise.then(() => null, (error: unknown) => error);
}

async function expectCode(promise: Promise<unknown>, code: string, message: string) {
  const error = await caught(promise);
  assert(
    error && typeof error === "object" && "code" in error && (error as { code: string }).code === code,
    `${message}: expected ${code}, got ${String(error)}`,
  );
}

/** The database must refuse this statement, with a message that names the rule. */
async function expectDatabaseRefusal(promise: Promise<unknown>, fragment: string, message: string) {
  const error = await caught(promise);
  assert(error !== null && String(error).includes(fragment), `${message}: expected a refusal mentioning "${fragment}", got ${String(error)}`);
}

const ids = {
  holder: `${P}_holder`,
  minor: `${P}_minor`,
  adult: `${P}_adult`,
  unknown: `${P}_unknown`,
  norecord: `${P}_norecord`,
  submitted: `${P}_submitted`,
  plain: `${P}_plain`,
  eventA: `${P}_event_a`,
  eventB: `${P}_event_b`,
  eventC: `${P}_event_c`,
};
const personIds = [ids.holder, ids.minor, ids.adult, ids.unknown, ids.norecord, ids.submitted, ids.plain];
const eventIds = [ids.eventA, ids.eventB, ids.eventC];

async function cleanup() {
  const registrations = await prisma.registration.findMany({ where: { eventId: { in: eventIds } }, select: { id: true } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: [adminUserId, healthUserId] } },
        { eventId: { in: eventIds } },
        { action: { startsWith: "HEALTH_SNAPSHOT" } },
        { entityId: { startsWith: P } },
      ],
    },
  });
  // The one place a sealed copy is deleted outside the retention job and event deletion: this script's own cleanup, on the same switch.
  await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('imsda.health_snapshot_retention', 'on', true)`,
    prisma.healthRecordSnapshot.deleteMany({ where: { personId: { in: personIds } } }),
  ]);
  await prisma.healthSnapshotHold.deleteMany({ where: { OR: [{ personId: { in: personIds } }, { eventId: { in: eventIds } }] } });
  await prisma.healthSnapshotBreakGlass.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.healthRecord.deleteMany({ where: { organizationId: { in: [clubId, clubId2] } } });
  await prisma.checkIn.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.clubEventRegistration.deleteMany({ where: { registrationId: { in: registrations.map((row) => row.id) } } });
  await prisma.registration.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.clubRosterMember.deleteMany({ where: { organizationId: { in: [clubId, clubId2] } } });
  await prisma.healthPrivacyAcknowledgment.deleteMany({ where: { OR: [{ userId: { in: [adminUserId, healthUserId] } }, { attendeeAccountId: { in: Object.values(accounts) } }] } });
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { in: Object.values(accounts) } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, healthUserId] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [clubId, clubId2] } } });
}

function ymd(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function main() {
  const repo = await import("../modules/health-records/repository");
  const snapshots = await import("../modules/health-records/snapshot-repository");
  const access = await import("../modules/health-records/snapshot-access-repository");
  const hooks = await import("../modules/health-records/snapshot-hooks");
  const retention = await import("../modules/health-records/snapshot-retention");
  const crypto = await import("../modules/health-records/crypto");
  const acknowledgment = await import("../modules/health-records/acknowledgment");
  const rosterDomain = await import("../modules/club-rosters/domain");
  const rosterRepo = await import("../modules/club-rosters/repository");
  const birthDates = await import("../modules/club-rosters/birth-dates");
  const checkIn = await import("../modules/checkin/repository");
  const lifecycle = await import("../modules/events/lifecycle");
  const eventDeletion = await import("../modules/events/deletion-repository");
  const envModule = await import("../lib/env");
  type Viewer = import("../modules/health-records/domain").HealthViewer;
  const directorA: Viewer = { kind: "CLUB_LEADER", organizationId: clubId, accountId: accounts.director };
  const directorB: Viewer = { kind: "CLUB_LEADER", organizationId: clubId2, accountId: accounts.director };
  const coordinator: Viewer = { kind: "AREA_COORDINATOR", accountId: accounts.coordinator };
  const healthRole: Viewer = { kind: "HEALTH_ROLE", userId: healthUserId, eventIds: [ids.eventA] };
  const admin: Viewer = { kind: "SYSTEM_ADMIN", userId: adminUserId };
  const sysAdminActor = { userId: adminUserId, globalRole: "SYSTEM_ADMIN" as const };
  const now = new Date();
  const clubYear = rosterDomain.clubYearFor(now);

  await cleanup();
  await prisma.organization.create({ data: { id: clubId, type: "CLUB", name: "Verify Snapshot Club", normalizedName: "verify snapshot club" } });
  await prisma.organization.create({ data: { id: clubId2, type: "CLUB", name: "Verify Snapshot Club Two", normalizedName: "verify snapshot club two" } });
  for (const [key, id] of Object.entries(accounts)) {
    await prisma.attendeeAccount.create({ data: { id, email: `account-${key}@${emailDomain}`, displayName: `Verify ${key}`, status: "ACTIVE" } });
  }
  await prisma.user.create({ data: { id: adminUserId, email: `admin@${emailDomain}`, displayName: "Verify Admin", globalRole: "SYSTEM_ADMIN" } });
  await prisma.user.create({ data: { id: healthUserId, email: `health@${emailDomain}`, displayName: "Verify Health Staff" } });
  for (const [key, id] of Object.entries(ids)) {
    if (key.startsWith("event")) continue;
    await prisma.person.create({ data: { id, firstName: key[0]!.toUpperCase() + key.slice(1), lastName: "Verify" } });
  }

  // Three events: A started an hour ago (the main one), B and C only for holds and deletion.
  const when = (hoursFromNow: number, days: number) => ({ startsAt: new Date(now.getTime() + hoursFromNow * 3_600_000), endsAt: new Date(now.getTime() + hoursFromNow * 3_600_000 + days * DAY), timezone: "America/Chicago" });
  await prisma.event.create({ data: { id: ids.eventA, slug: `${P}-a`, name: "Synthetic Snapshot Camporee A", ...when(-1, 3) } });
  await prisma.event.create({ data: { id: ids.eventB, slug: `${P}-b`, name: "Synthetic Snapshot Camporee B", ...when(-1, 3) } });
  await prisma.event.create({ data: { id: ids.eventC, slug: `${P}-c`, name: "Synthetic Snapshot Camporee C", ...when(-1, 3) } });

  let counter = 0;
  async function register(eventId: string, status: "CONFIRMED" | "SUBMITTED" | "WAITLISTED", people: string[], viaClub: string | false = clubId) {
    counter += 1;
    const created = await prisma.registration.create({
      data: { eventId, accountHolderPersonId: ids.holder, confirmationCode: `${P}-${counter}`, status, totalAmount: "50.00", submittedAt: now },
      select: { id: true },
    });
    if (viaClub) await prisma.clubEventRegistration.create({ data: { eventId, organizationId: viaClub, registrationId: created.id } });
    const attendeeIds: Record<string, string> = {};
    for (const [position, personId] of people.entries()) {
      const attendee = await prisma.registrationAttendee.create({
        data: { eventId, registrationId: created.id, personId, attendeeType: "YOUTH", position, profileSnapshot: { firstName: "Verify", lastName: "Verify" } },
        select: { id: true },
      });
      attendeeIds[personId] = attendee.id;
    }
    return { registrationId: created.id, attendeeIds };
  }

  // Birth dates: the minor was 12 a few months ago; the adult is well over 18.
  const minorBirth = ymd(new Date(Date.UTC(now.getUTCFullYear() - 12, now.getUTCMonth(), now.getUTCDate() - 100)));
  const adultBirth = "1980-05-05";
  async function rosterMember(personId: string, extra: { birthDate?: string; reportedAge?: number; type?: "YOUTH" | "ADULT" | "STAFF"; club?: string }) {
    return prisma.clubRosterMember.create({
      data: {
        organizationId: extra.club ?? clubId,
        clubYear,
        personId,
        attendeeType: extra.type ?? "YOUTH",
        role: "Pathfinder",
        source: "DIRECTOR",
        ...(extra.birthDate ? { sealedBirthDate: birthDates.sealBirthDate(extra.birthDate) } : {}),
        ...(extra.reportedAge !== undefined ? { reportedAge: extra.reportedAge } : {}),
      },
    });
  }
  const minorMember = await rosterMember(ids.minor, { birthDate: minorBirth });
  const adultMember = await rosterMember(ids.adult, { birthDate: adultBirth, type: "ADULT" });
  const unknownMember = await rosterMember(ids.unknown, { reportedAge: 12 });
  await rosterMember(ids.norecord, { birthDate: minorBirth });
  const submittedMember = await rosterMember(ids.submitted, { birthDate: minorBirth, club: clubId2 });
  const plainMember = await rosterMember(ids.plain, { birthDate: adultBirth, type: "ADULT" });

  const confirmed = await register(ids.eventA, "CONFIRMED", [ids.minor, ids.adult, ids.unknown, ids.norecord]);
  const submittedReg = await register(ids.eventA, "SUBMITTED", [ids.submitted], clubId2);
  const individual = await register(ids.eventC, "CONFIRMED", [ids.plain], false);

  // 1. Switched off: nothing is sealed, swept, held or opened ---------------
  assert((await snapshots.sealHealthSnapshot({ eventId: ids.eventA, personId: ids.minor, trigger: "CHECK_IN" })).outcome === "DISABLED", "sealing with the flag off");
  await hooks.sealHealthSnapshotAfterCheckIn(ids.eventA, confirmed.attendeeIds[ids.minor]!);
  assert((await hooks.runHealthSnapshotSweep()) === null, "the sweep with the flag off");
  assert((await snapshots.deleteExpiredHealthSnapshots(now, { force: true })).ran === false, "the retention job with the flag off");
  await expectCode(access.viewSealedSnapshots(admin, ids.minor), "NOT_FOUND", "opening with the flag off");
  await expectCode(access.placeSnapshotHold(admin, { scope: "PERSON", personId: ids.minor }, REASON), "NOT_FOUND", "a hold with the flag off");
  assert((await prisma.healthRecordSnapshot.count({ where: { personId: { in: personIds } } })) === 0, "nothing is stored with the flag off");

  // 2. Switched on: records for the people -----------------------------------
  process.env.HEALTH_RECORDS_ENABLED = "true";
  envModule.resetServerEnvCache();
  await acknowledgment.recordHealthPrivacyAcknowledgment(directorA, now);
  for (const member of [minorMember, adultMember, unknownMember, plainMember]) {
    await repo.saveHealthRecord(directorA, clubId, member.id, record, now);
  }
  await repo.saveHealthRecord(directorB, clubId2, submittedMember.id, record, now);
  const liveMinor = await prisma.healthRecord.findUniqueOrThrow({ where: { rosterMemberId: minorMember.id }, include: { fields: true } });
  const liveView = await repo.viewHealthRecord(directorA, clubId, minorMember.id, now);

  // 3. A copy at check-in ------------------------------------------------------
  const checkedIn = await checkIn.checkInAttendee(ids.eventA, confirmed.attendeeIds[ids.minor]!, adminUserId, `${P}-key-1`);
  assert(checkedIn.checkedIn, "the person is checked in");
  await hooks.sealHealthSnapshotAfterCheckIn(ids.eventA, confirmed.attendeeIds[ids.minor]!);
  const minorCopy = await prisma.healthRecordSnapshot.findUniqueOrThrow({ where: { personId_eventId: { personId: ids.minor, eventId: ids.eventA } }, include: { fields: true } });
  assert(minorCopy.trigger === "CHECK_IN" && minorCopy.fieldCount === liveMinor.fields.length && minorCopy.fields.length === liveMinor.fields.length, "a copy of every live field is sealed at check-in");
  assert(minorCopy.consentVersion === (await import("../modules/health-records/domain")).HEALTH_CONSENT_VERSION && minorCopy.signedOn === ymd(now), "the copy records the consent version and the signature date");
  assert(minorCopy.eventDate === lifecycle.calendarDateInEventTimeZone(now, "America/Chicago") || minorCopy.eventDate === lifecycle.calendarDateInEventTimeZone(new Date(now.getTime() - 3_600_000), "America/Chicago"), "the event's first day is recorded");
  const liveCipher = new Set(liveMinor.fields.map((field) => field.sealedValue));
  assert(minorCopy.fields.every((field) => !liveCipher.has(field.sealedValue)), "a copy shares no ciphertext with the live record");
  assert(new Set(minorCopy.fields.map((field) => field.sealedValue)).size === minorCopy.fields.length, "no two fields of a copy share a ciphertext");
  const firstField = minorCopy.fields[0]!;
  // The key purpose names the snapshot: a copy's value cannot be opened as a record's field or as another copy's.
  await expectCode(Promise.resolve().then(() => crypto.openHealthField(liveMinor.id, firstField.fieldKey, firstField.sealedValue)), "UNREADABLE", "a copy opened as a live field");
  await expectCode(Promise.resolve().then(() => crypto.openSnapshotField("other-snapshot", firstField.fieldKey, firstField.sealedValue)), "UNREADABLE", "a copy opened as another copy");
  const everything = JSON.stringify(await prisma.healthRecordSnapshot.findMany({ include: { fields: true } })) + JSON.stringify(await prisma.auditLog.findMany({ where: { action: { startsWith: "HEALTH_SNAPSHOT" } } }));
  for (const secret of [...SECRETS, minorBirth, adultBirth]) assert(!everything.includes(secret), `"${secret}" is in no snapshot column or audit row`);
  const sealedAudit = await prisma.auditLog.findMany({ where: { action: "HEALTH_SNAPSHOT_SEALED", entityId: minorCopy.id } });
  assert(sealedAudit.length === 1 && sealedAudit[0]!.eventId === null, "one audit row for the copy, kept out of the event staff audit log");
  const sealedMeta = sealedAudit[0]!.metadata as Record<string, unknown>;
  assert(sealedMeta.fieldCount === minorCopy.fieldCount && sealedMeta.trigger === "CHECK_IN" && sealedMeta.ageBasis === "MINOR", "the audit row holds the count, trigger and basis");

  // Idempotent: again, and many at once.
  assert((await snapshots.sealHealthSnapshot({ eventId: ids.eventA, personId: ids.minor, trigger: "CHECK_IN" })).outcome === "ALREADY_TAKEN", "a second attempt is a no-op");
  const racing = await Promise.all(Array.from({ length: 8 }, () => snapshots.sealHealthSnapshot({ eventId: ids.eventA, personId: ids.adult, trigger: "CHECK_IN" })));
  assert(racing.filter((result) => result.outcome === "TAKEN").length === 1 && racing.every((result) => result.outcome === "TAKEN" || result.outcome === "ALREADY_TAKEN"), "eight racing attempts seal exactly one copy");
  assert((await prisma.healthRecordSnapshot.count({ where: { eventId: ids.eventA, personId: { in: [ids.minor, ids.adult] } } })) === 2, "one copy per person per event");
  assert((await prisma.auditLog.count({ where: { action: "HEALTH_SNAPSHOT_SEALED", entityId: { in: (await prisma.healthRecordSnapshot.findMany({ where: { personId: { in: [ids.minor, ids.adult] } }, select: { id: true } })).map((row) => row.id) } } })) === 2, "one audit row per copy");

  // Who gets one.
  assert((await snapshots.sealHealthSnapshot({ eventId: ids.eventA, personId: ids.norecord, trigger: "CHECK_IN" })).outcome === "NO_RECORD", "no live record, no copy");
  assert((await snapshots.sealHealthSnapshot({ eventId: ids.eventC, personId: ids.plain, trigger: "CHECK_IN" })).outcome === "NOT_ELIGIBLE", "not on a club registration, no copy");
  assert((await snapshots.sealHealthSnapshot({ eventId: ids.eventB, personId: ids.minor, trigger: "CHECK_IN" })).outcome === "NOT_ELIGIBLE", "not registered for that event, no copy");
  assert((await snapshots.sealHealthSnapshot({ eventId: ids.eventA, personId: ids.submitted, trigger: "EVENT_START" })).outcome === "NOT_ELIGIBLE", "a submitted (not confirmed) registrant gets no event-start copy");
  assert(individual.registrationId.length > 0 && submittedReg.registrationId.length > 0, "fixtures exist");

  // 4. The event-start trigger: confirmed registrants with a record and no copy.
  const started = await snapshots.sealStartedEventSnapshots(now);
  assert(started.taken === 1 && started.failed === 0, `the event-start sweep seals the confirmed member with no copy yet (taken=${started.taken})`);
  const unknownCopy = await prisma.healthRecordSnapshot.findUniqueOrThrow({ where: { personId_eventId: { personId: ids.unknown, eventId: ids.eventA } } });
  assert(unknownCopy.trigger === "EVENT_START", "the event-start copy says so");
  assert((await prisma.healthRecordSnapshot.count({ where: { personId: ids.norecord } })) === 0 && (await prisma.healthRecordSnapshot.count({ where: { personId: ids.submitted } })) === 0, "the sweep seals nothing for no record or an unconfirmed registration");
  const again = await snapshots.sealStartedEventSnapshots(now);
  assert(again.taken === 0, "a second sweep seals nothing more");
  const sweep = await hooks.runHealthSnapshotSweep(now);
  assert(sweep !== null && sweep.started?.taken === 0 && sweep.retention?.ran === true && sweep.retention.deleted === 0, "the scheduled sweep seals nothing more and deletes nothing that has not expired");
  // A check-in for the submitted registrant seals at check-in (submitted or confirmed registrations are eligible there).
  await hooks.sealHealthSnapshotAfterCheckIn(ids.eventA, submittedReg.attendeeIds[ids.submitted]!);
  assert((await prisma.healthRecordSnapshot.count({ where: { personId: ids.submitted, eventId: ids.eventA } })) === 1, "a submitted registrant who is checked in gets a copy at check-in");

  // 5. Expiry, computed per copy -----------------------------------------------
  const adultCopy = await prisma.healthRecordSnapshot.findUniqueOrThrow({ where: { personId_eventId: { personId: ids.adult, eventId: ids.eventA } } });
  const endDate = lifecycle.calendarDateInEventTimeZone(new Date(now.getTime() - 3_600_000 + 3 * DAY), "America/Chicago");
  const [endY, endM, endD] = endDate.split("-").map(Number) as [number, number, number];
  const [birthY, birthM, birthD] = minorBirth.split("-").map(Number) as [number, number, number];
  assert(minorCopy.ageBasis === "MINOR" && minorCopy.expiresAt.getTime() === Date.UTC(birthY + 26, birthM - 1, birthD), "a minor's copy expires on their 26th birthday");
  assert(adultCopy.ageBasis === "ADULT" && adultCopy.expiresAt.getTime() === Date.UTC(endY + 5, endM - 1, endD), "an adult's copy expires 5 years after the event's last day");
  assert(unknownCopy.ageBasis === "UNKNOWN" && unknownCopy.expiresAt.getTime() > adultCopy.expiresAt.getTime(), "with no birth date the longer reading applies (reported age 12: the 26th birthday on the latest reading)");
  assert(unknownCopy.expiresAt.getTime() === Date.UTC(Number(unknownCopy.eventDate.slice(0, 4)) - 12 + 26, Number(unknownCopy.eventDate.slice(5, 7)) - 1, Number(unknownCopy.eventDate.slice(8, 10))), "the unknown reading is the event day plus 26 minus the reported age");
  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'HealthRecordSnapshot'`;
  assert(!columns.some((column) => /birth|name|phone|email|address/i.test(column.column_name)), "the copy's table has no birth date, name or contact column");

  // 6. Immutable, in the database ------------------------------------------------
  await expectDatabaseRefusal(prisma.$executeRaw`UPDATE "HealthRecordSnapshot" SET "expiresAt" = "expiresAt" + interval '1 year' WHERE "id" = ${minorCopy.id}`, "immutable", "updating a copy");
  await expectDatabaseRefusal(prisma.healthRecordSnapshot.update({ where: { id: minorCopy.id }, data: { signedOn: "2000-01-01" } }), "immutable", "updating a copy through Prisma");
  await expectDatabaseRefusal(prisma.$executeRaw`UPDATE "HealthRecordSnapshotField" SET "sealedValue" = 'x' WHERE "id" = ${firstField.id}`, "immutable", "updating a sealed field");
  await expectDatabaseRefusal(prisma.healthRecordSnapshot.delete({ where: { id: minorCopy.id } }), "only by the retention job", "deleting a copy");
  await expectDatabaseRefusal(prisma.healthRecordSnapshot.deleteMany({}), "only by the retention job", "deleting every copy");
  await expectDatabaseRefusal(prisma.healthRecordSnapshotField.delete({ where: { id: firstField.id } }), "only by the retention job", "deleting a sealed field");
  await expectDatabaseRefusal(prisma.healthRecordSnapshotField.create({ data: { snapshotId: minorCopy.id, fieldKey: "extra", sealedValue: "x" } }), "cannot be added to", "adding a field to a copy");
  await expectDatabaseRefusal(
    prisma.$transaction(async (tx) => {
      await tx.healthRecordSnapshot.create({ data: { personId: ids.norecord, eventId: ids.eventC, trigger: "CHECK_IN", eventDate: ymd(now), ageBasis: "ADULT", expiresAt: new Date(now.getTime() + 400 * DAY), fieldCount: 2 } });
    }),
    "must be created with all of its fields",
    "an incomplete copy",
  );
  assert((await prisma.healthRecordSnapshot.count({ where: { personId: ids.norecord } })) === 0, "the incomplete copy was not kept");
  assert(
    (await prisma.healthRecordSnapshot.findUniqueOrThrow({ where: { id: minorCopy.id } })).expiresAt.getTime() === minorCopy.expiresAt.getTime(),
    "every refused change left the copy as it was",
  );

  // 7. Removing the live record leaves the copy ----------------------------------
  const copiesBefore = await prisma.healthRecordSnapshot.count({ where: { personId: ids.minor } });
  await prisma.$transaction((tx) => rosterRepo.eraseRosterRow(tx, minorMember.id, now));
  assert((await prisma.healthRecord.count({ where: { rosterMemberId: minorMember.id } })) === 0, "removal erases the live record");
  assert((await prisma.healthRecordSnapshot.count({ where: { personId: ids.minor } })) === copiesBefore && copiesBefore === 1, "the copy is still there");
  await expectCode(prisma.person.delete({ where: { id: ids.minor } }), "P2003", "deleting a person who has a copy");
  assert((await prisma.person.count({ where: { id: ids.minor } })) === 1, "the person with a copy is kept");

  // 8. Break-glass is the only way in --------------------------------------------
  await expectCode(access.viewSealedSnapshots(directorA, ids.minor), "FORBIDDEN", "a director opening a copy");
  await expectCode(access.viewSealedSnapshots(healthRole, ids.minor), "FORBIDDEN", "the health role opening a copy");
  await expectCode(access.viewSealedSnapshots(coordinator, ids.minor), "FORBIDDEN", "an Area Coordinator opening a copy");
  await expectCode(access.startSnapshotBreakGlass(directorA, { personId: ids.minor, reason: REASON }), "FORBIDDEN", "a director starting break-glass");
  await expectCode(access.placeSnapshotHold(directorA, { scope: "PERSON", personId: ids.minor }, REASON), "FORBIDDEN", "a director placing a hold");
  const refusals = await prisma.auditLog.findMany({ where: { action: "HEALTH_SNAPSHOT_ACCESS_REFUSED" } });
  assert(refusals.length === 5 && refusals.every((row) => (row.metadata as { reason?: string }).reason === "NOT_SYSTEM_ADMIN"), "each refusal of a non-administrator is audited");
  await expectCode(access.viewSealedSnapshots(admin, ids.minor), "ACKNOWLEDGMENT_REQUIRED", "an administrator before the privacy acknowledgment");
  await acknowledgment.recordHealthPrivacyAcknowledgment(admin, now);
  await expectCode(access.viewSealedSnapshots(admin, ids.minor, now), "BREAK_GLASS_REQUIRED", "an administrator without break-glass");
  assert((await prisma.auditLog.count({ where: { action: "HEALTH_SNAPSHOT_ACCESS_REFUSED", actorUserId: adminUserId } })) === 1, "the missing break-glass is audited");
  await expectCode(access.startSnapshotBreakGlass(admin, { personId: ids.minor, reason: "short" }, now), "VALIDATION_FAILED", "break-glass with no real reason");
  await expectCode(access.startSnapshotBreakGlass(admin, { personId: ids.norecord, reason: REASON }, now), "MEMBER_NOT_FOUND", "break-glass for a person with no copy");
  assert((await prisma.healthSnapshotBreakGlass.count()) === 0, "a refused request creates no grant");
  const grant = await access.startSnapshotBreakGlass(admin, { personId: ids.minor, reason: REASON }, now);
  assert(grant.expiresAt.getTime() === now.getTime() + 24 * 3_600_000 && grant.snapshotCount === 1, "access lasts 24 hours");
  const grantAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "HEALTH_SNAPSHOT_BREAK_GLASS_STARTED", entityId: grant.grantId } });
  const grantMeta = grantAudit.metadata as Record<string, unknown>;
  assert(grantMeta.reason === REASON && grantMeta.personId === ids.minor && grantMeta.snapshotCount === 1 && grantAudit.actorUserId === adminUserId, "the grant is audited with who, whose, how many and the typed reason");
  const opened = await access.viewSealedSnapshots(admin, ids.minor, new Date(now.getTime() + 3_600_000));
  assert(opened.snapshots.length === 1 && opened.snapshots[0]!.eventId === ids.eventA, "the administrator opens the person's copies");
  assert(JSON.stringify(opened.snapshots[0]!.values) === JSON.stringify(liveView.values), "the copy holds exactly what the live record held, still readable after the live record is gone");
  const viewAudit = await prisma.auditLog.findMany({ where: { action: "HEALTH_SNAPSHOT_VIEWED" } });
  const viewMeta = viewAudit[0]!.metadata as Record<string, unknown>;
  assert(viewAudit.length === 1 && viewMeta.grantId === grant.grantId && viewMeta.snapshotCount === 1 && (viewMeta.snapshotIds as string[])[0] === minorCopy.id && viewMeta.fieldCount === minorCopy.fieldCount, "the view is audited with the grant, the ids and the counts");
  for (const secret of [...SECRETS, minorBirth, adultBirth]) assert(!JSON.stringify(await prisma.auditLog.findMany({ where: { action: { startsWith: "HEALTH_SNAPSHOT" } } })).includes(secret), "no health value is in any sealed-copy audit row");
  await expectCode(access.viewSealedSnapshots(admin, ids.adult, new Date(now.getTime() + 3_600_000)), "BREAK_GLASS_REQUIRED", "a grant for one person does not open another's copies");
  await expectCode(access.viewSealedSnapshots(admin, ids.minor, new Date(now.getTime() + 25 * 3_600_000)), "BREAK_GLASS_REQUIRED", "the grant has ended after 24 hours");

  // 9. Legal holds and the daily deletion job -------------------------------------
  const farFuture = new Date(Date.UTC(2032, 0, 1));
  assert(adultCopy.expiresAt.getTime() < farFuture.getTime() && unknownCopy.expiresAt.getTime() > farFuture.getTime() && minorCopy.expiresAt.getTime() > farFuture.getTime(), "on 2032-01-01 only the adult's copy has expired");
  await expectCode(access.placeSnapshotHold(admin, { scope: "PERSON", personId: ids.adult }, "short", now), "VALIDATION_FAILED", "a hold with no real reason");
  await expectCode(access.placeSnapshotHold(admin, { scope: "PERSON", personId: "no-such-person" }, REASON, now), "MEMBER_NOT_FOUND", "a hold on no one");
  const hold = await access.placeSnapshotHold(admin, { scope: "PERSON", personId: ids.adult }, REASON, now);
  assert(!hold.alreadyHeld && hold.snapshotsCovered === 1, "a person hold covers the person's copies");
  assert((await access.placeSnapshotHold(admin, { scope: "PERSON", personId: ids.adult }, REASON, now)).alreadyHeld, "placing a hold twice changes nothing");
  assert((await prisma.healthSnapshotHold.count({ where: { personId: ids.adult, liftedAt: null } })) === 1, "one active hold per person");
  const holdAudit = await prisma.auditLog.findMany({ where: { action: "HEALTH_SNAPSHOT_HOLD_PLACED" } });
  assert(holdAudit.length === 1 && (holdAudit[0]!.metadata as Record<string, unknown>).reason === REASON && (holdAudit[0]!.metadata as Record<string, unknown>).snapshotsCovered === 1, "a hold is audited with its reason and count");
  const held = await snapshots.deleteExpiredHealthSnapshots(farFuture, { force: true });
  assert(held.ran && held.deleted === 0 && held.heldSkipped === 1, "a hold blocks the deletion");
  assert((await prisma.healthRecordSnapshot.count({ where: { id: adultCopy.id } })) === 1, "the held copy is still there");
  await expectCode(access.liftSnapshotHold(directorA, hold.holdId, REASON, now), "FORBIDDEN", "a director lifting a hold");
  await expectCode(access.liftSnapshotHold(admin, hold.holdId, "short", now), "VALIDATION_FAILED", "lifting with no reason");
  await access.liftSnapshotHold(admin, hold.holdId, REASON, now);
  await expectCode(access.liftSnapshotHold(admin, hold.holdId, REASON, now), "NOT_FOUND", "lifting a hold twice");
  const liftAudit = await prisma.auditLog.findMany({ where: { action: "HEALTH_SNAPSHOT_HOLD_LIFTED" } });
  assert(liftAudit.length === 1 && (liftAudit[0]!.metadata as Record<string, unknown>).reason === REASON, "a lift is audited with its reason");
  assert((await access.listSnapshotHolds(admin)).some((row) => row.id === hold.holdId && row.liftedAt !== null), "a lifted hold is kept in the list");

  // An event hold blocks too.
  const eventHold = await access.placeSnapshotHold(admin, { scope: "EVENT", eventId: ids.eventA }, REASON, now);
  assert(eventHold.snapshotsCovered === 4, "an event hold covers the event's copies");
  assert((await snapshots.deleteExpiredHealthSnapshots(farFuture, { force: true })).deleted === 0, "an event hold blocks the deletion");
  await access.liftSnapshotHold(admin, eventHold.holdId, REASON, now);

  const ran = await snapshots.deleteExpiredHealthSnapshots(farFuture, { force: true });
  assert(ran.deleted === 1 && ran.heldSkipped === 0, "with no hold the expired copy is deleted");
  assert((await prisma.healthRecordSnapshot.count({ where: { personId: ids.adult } })) === 0 && (await prisma.healthRecordSnapshot.count({ where: { personId: { in: [ids.minor, ids.unknown] } } })) === 2, "only the expired copy went");
  assert((await prisma.healthRecordSnapshotField.count({ where: { snapshotId: adultCopy.id } })) === 0, "its sealed fields went with it");
  const retentionAudit = await prisma.auditLog.findMany({ where: { action: "HEALTH_SNAPSHOT_RETENTION_RUN" }, orderBy: { createdAt: "desc" } });
  const latestRun = retentionAudit[0]!.metadata as Record<string, unknown>;
  assert(latestRun.deleted === 1 && (latestRun.snapshotIds as string[])[0] === adultCopy.id && JSON.stringify(retentionAudit).indexOf(SECRETS[0]!) < 0, "the deletion is audited with ids and counts");
  // Once a day.
  assert((await snapshots.deleteExpiredHealthSnapshots(new Date())).ran === false, "the job does not run twice within a day");
  assert((await snapshots.deleteExpiredHealthSnapshots(new Date(now.getTime() + 2 * DAY))).ran === true, "the job runs again the next day");
  // The transaction-local setting does not leak: a plain delete is refused afterwards.
  await expectDatabaseRefusal(prisma.healthRecordSnapshot.deleteMany({ where: { id: minorCopy.id } }), "only by the retention job", "deleting after the job ran");
  assert(retention.HEALTH_SNAPSHOT_RETENTION.nightlyBackupsKept === 30, "the backup rule is a constant");

  // 10. Event deletion --------------------------------------------------------------
  const eventBReg = await register(ids.eventB, "CONFIRMED", [ids.unknown]);
  assert((await snapshots.sealHealthSnapshot({ eventId: ids.eventB, personId: ids.unknown, trigger: "CHECK_IN" })).outcome === "TAKEN", "a copy for event B");
  await prisma.registration.delete({ where: { id: eventBReg.registrationId } });
  const personHold = await access.placeSnapshotHold(admin, { scope: "PERSON", personId: ids.unknown }, REASON, now);
  const preview = await eventDeletion.getEventDeletionPreview(ids.eventB, sysAdminActor);
  assert(preview && preview.counts.healthSnapshots === 1 && preview.counts.heldHealthSnapshots === 1 && !preview.decision.allowed, "a copy under a person hold blocks deleting its event");
  assert(!preview.decision.allowed && /sealed health copy under a legal hold/.test(preview.decision.reason), "the refusal names the hold");
  await expectCode(eventDeletion.deleteEvent({ eventId: ids.eventB, actor: sysAdminActor, confirmName: "Synthetic Snapshot Camporee B" }), "EVENT_DELETE_FORBIDDEN", "deleting an event with a held copy");
  assert((await prisma.healthRecordSnapshot.count({ where: { eventId: ids.eventB } })) === 1, "the held copy survived the refused deletion");
  await access.liftSnapshotHold(admin, personHold.holdId, REASON, now);
  const result = await eventDeletion.deleteEvent({ eventId: ids.eventB, actor: sysAdminActor, confirmName: "Synthetic Snapshot Camporee B" });
  assert(result.counts.healthSnapshots === 1, "the deletion reports the copy count");
  assert((await prisma.healthRecordSnapshot.count({ where: { eventId: ids.eventB } })) === 0, "deleting the event deletes its copies");
  { const left = await prisma.healthRecordSnapshot.findMany({ where: { eventId: ids.eventA }, select: { personId: true } }); assert(left.length === 3, `another event copies are untouched: ${left.map((row) => row.personId).join(",")}`); }
  const deletionAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "EVENT_DELETED", entityId: ids.eventB } });
  assert((deletionAudit.metadata as { counts: Record<string, number> }).counts.healthSnapshots === 1, "the deletion audit row counts the copies");
  await prisma.auditLog.deleteMany({ where: { action: "EVENT_DELETED", entityId: ids.eventB } });

  // 11. Back off: nothing more happens ------------------------------------------------
  process.env.HEALTH_RECORDS_ENABLED = "false";
  envModule.resetServerEnvCache();
  await expectCode(access.viewSealedSnapshots(admin, ids.minor), "NOT_FOUND", "opening after the flag goes off");
  assert((await snapshots.sealStartedEventSnapshots(now)).taken === 0, "no copies after the flag goes off");
  process.env.HEALTH_RECORDS_ENABLED = "true";
  envModule.resetServerEnvCache();

  await cleanup();
  console.log("Health snapshot checks passed.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error: unknown) => {
      console.error("Cleanup failed:", error);
    });
    await prisma.$disconnect();
  });
