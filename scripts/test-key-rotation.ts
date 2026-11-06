/**
 * Proves key rotation (#1516) against a real PostgreSQL database:
 *
 * - values sealed under an old key (version 1) are all reported "older" by the
 *   key check scan, and none unreadable, once the new key is current and the
 *   old one is loaded as the previous key;
 * - a partial rotation (one column only, then one interrupted by a concurrent
 *   change) leaves the rest on the old key and every value still readable;
 * - running it again finishes the job, and running it once more changes nothing;
 * - afterwards the scan is clean, every value opens with the new key alone, and
 *   a calendar feed's address fingerprint and the fingerprint copied onto an
 *   item it left behind were recomputed together;
 * - a value sealed under a key that is not loaded is counted as unreadable and
 *   does not stop the run;
 * - every registered sealed column (all 11) has a synthetic row that is sealed under the old key and
 *   rotated, so a column missing from the rotation fails this script;
 * - rotation keeps each row's `updatedAt`, and a concurrent edit makes a write skip instead of being
 *   rolled back;
 * - the sealed health copy trigger still refuses every UPDATE except rotation's own (only "sealedValue",
 *   only with the rotation setting on, only on a copy's field row).
 *
 * Uses fictitious rows with a reserved id prefix, created and removed here, and
 * synthetic keys. Reads and writes nothing else. Seeding the rows (which have parents this check does not
 * create) switches foreign key and trigger checks off for that one transaction, so it needs a database
 * user allowed to do that (a superuser, as in local development and CI).
 *
 *   npm run test:key-rotation
 */
import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("RESEND_API_KEY", "verify-script-placeholder-never-sent");
fillBlankSyntheticEnv("ACCOUNT_EMAIL_SENDER_ADDRESS", "events@rotation.example.test");

const OLD_KEY = "verify-rotation-old-key-0123456789-abcdefghijkl";
const NEW_KEY = "verify-rotation-new-key-0123456789-abcdefghijkl";
const OTHER_KEY = "verify-rotation-lost-key-0123456789-abcdefghijk";

const P = "kr1516_";
const prisma = new PrismaClient();

function setKeys(keys: { current: string; version: number; previous?: { key: string; version: number } }) {
  for (const name of [
    "SECRET_ENCRYPTION_KEY_FILE",
    "SECRET_ENCRYPTION_PREVIOUS_KEY",
    "SECRET_ENCRYPTION_PREVIOUS_KEY_FILE",
    "SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION",
  ]) delete process.env[name];
  process.env.SECRET_ENCRYPTION_KEY = keys.current;
  process.env.SECRET_ENCRYPTION_KEY_VERSION = String(keys.version);
  if (keys.previous) {
    process.env.SECRET_ENCRYPTION_PREVIOUS_KEY = keys.previous.key;
    process.env.SECRET_ENCRYPTION_PREVIOUS_KEY_VERSION = String(keys.previous.version);
  }
  resetServerEnvCache();
}

let resetServerEnvCache: () => void;

const OWN = { id: { startsWith: P } };

/** Runs `work` with foreign key and trigger checks off for that transaction only. */
async function withoutChecks(work: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await work(tx);
  });
}

async function cleanup() {
  await withoutChecks(async (tx) => {
    await tx.calendarEntry.deleteMany({ where: OWN });
    await tx.calendarFeed.deleteMany({ where: OWN });
    await tx.securityCheckCode.deleteMany({ where: OWN });
    await tx.userMfaEnrollment.deleteMany({ where: OWN });
    await tx.attendeeMfaEnrollment.deleteMany({ where: OWN });
    await tx.attendeeAccountToken.deleteMany({ where: OWN });
    await tx.attendeeStepUpCode.deleteMany({ where: OWN });
    await tx.clubRosterMember.deleteMany({ where: OWN });
    await tx.backgroundCheckEntry.deleteMany({ where: OWN });
    await tx.clubFormSubmission.deleteMany({ where: OWN });
    await tx.healthRecordField.deleteMany({ where: OWN });
    await tx.healthRecordSnapshotField.deleteMany({ where: OWN });
    await tx.healthRecordSnapshot.deleteMany({ where: OWN });
  });
}

async function refused(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    return /immutable/i.test(error instanceof Error ? error.message : "");
  }
  return false;
}

async function main() {
  ({ resetServerEnvCache } = await import("../lib/env"));
  const secretBox = await import("../lib/secret-box");
  const { SEALED_COLUMNS } = await import("../modules/security/sealed-columns");
  const { rotateSealedColumns, scanSealedColumns } = await import("../modules/security/key-rotation");
  const { createPrismaSealedColumnStore } = await import("../modules/security/sealed-column-store");
  const store = createPrismaSealedColumnStore({ idPrefix: P });
  const column = (label: string) => {
    const found = SEALED_COLUMNS.find((entry) => entry.label === label);
    assert.ok(found, `${label} is in the registry`);
    return found;
  };
  const codes = column("SecurityCheckCode.sealedCode");
  const feeds = column("CalendarFeed.sealedUrl");
  const both = [codes, feeds];
  const totals = async () => {
    const scans = await scanSealedColumns(store, { columns: both, batchSize: 2 });
    return Object.fromEntries(scans.map((scan) => [scan.label, scan]));
  };

  await cleanup();
  try {
    // Seal with the old key, as the application did before the rotation.
    setKeys({ current: OLD_KEY, version: 1 });
    const expires = new Date(Date.now() + 3_600_000);
    const feedUrls = [1, 2, 3].map((n) => `https://calendar.example.test/private/feed-${n}.ics`);
    for (let n = 0; n < 5; n += 1) {
      await prisma.securityCheckCode.create({
        data: {
          id: `${P}code_${n}`,
          action: "attendee-sign-in",
          emailHash: `hash-${n}`,
          sealedCode: secretBox.sealSecret(`12345${n}`, "security-check-code"),
          expiresAt: expires,
        },
      });
    }
    for (const [n, url] of feedUrls.entries()) {
      await prisma.calendarFeed.create({
        data: {
          id: `${P}feed_${n}`,
          name: `Rotation feed ${n}`,
          sealedUrl: secretBox.sealSecret(url, "calendar-feed-url"),
          urlHint: "calendar.example.test",
          urlFingerprint: secretBox.fingerprintSecret(url, "calendar-feed-url"),
          createdByUserId: "rotation-check",
          updatedByUserId: "rotation-check",
        },
      });
    }
    const oldFingerprint0 = secretBox.fingerprintSecret(feedUrls[0], "calendar-feed-url");
    await prisma.calendarEntry.create({
      data: {
        id: `${P}entry_0`,
        title: "Left behind by a deleted feed",
        startsOn: "2027-01-10",
        endsOn: "2027-01-10",
        sourceUrlFingerprint: oldFingerprint0,
        createdByUserId: "rotation-check",
        updatedByUserId: "rotation-check",
      },
    });
    // One synthetic row in every other registered column, sealed under the old key with the owning module's own helper.
    const { sealBirthDate } = await import("../modules/club-rosters/birth-dates");
    const { sealSensitiveAnswers } = await import("../modules/club-forms/sealed-answers");
    const { sealHealthField, sealSnapshotField } = await import("../modules/health-records/crypto");
    const soon = new Date(Date.now() + 86_400_000);
    await withoutChecks(async (tx) => {
      await tx.userMfaEnrollment.create({
        data: { id: `${P}user_mfa`, userId: `${P}user`, sealedSecret: secretBox.sealSecret("JBSWY3DPEHPK3PXP", "mfa-totp-secret") },
      });
      await tx.attendeeMfaEnrollment.create({
        data: { id: `${P}att_mfa`, accountId: `${P}acct`, sealedSecret: secretBox.sealSecret("JBSWY3DPEHPK3PXP", "attendee-mfa-totp-secret") },
      });
      await tx.attendeeAccountToken.create({
        data: {
          id: `${P}token`, accountId: `${P}acct`, tokenHash: `${P}token-hash`, purpose: "EMAIL_VERIFICATION", expiresAt: soon,
          sealedCode: secretBox.sealSecret("246810", "attendee-email-code"),
        },
      });
      const stepUps = [
        ["REGISTRATION_EDIT", "attendee-step-up-code"],
        ["SIGN_IN", "attendee-sign-in-code"],
        ["TWO_STEP_RECOVERY", "attendee-two-step-recovery"],
      ] as const;
      for (const [purpose, sealPurpose] of stepUps) {
        await tx.attendeeStepUpCode.create({
          data: { id: `${P}step_${purpose}`, accountId: `${P}acct`, sessionId: `${P}session`, purpose, expiresAt: soon, sealedCode: secretBox.sealSecret("135790", sealPurpose) },
        });
      }
      await tx.clubRosterMember.create({
        data: { id: `${P}roster`, organizationId: `${P}club`, clubYear: "2026-2027", attendeeType: "YOUTH", source: "DIRECTOR", sealedBirthDate: sealBirthDate("2012-05-17") },
      });
      await tx.backgroundCheckEntry.create({
        data: {
          id: `${P}bgc`, uploadId: `${P}upload`, line: 1, firstName: "Sample", lastName: "Person", identityKey: `${P}identity`,
          sealedBirthDate: sealBirthDate("1980-01-02"),
        },
      });
      await tx.clubFormSubmission.create({
        data: {
          id: `${P}form`, templateId: `${P}template`, clubYear: "2026-2027", templateVersion: 1, enteredVia: "STAFF_ACTING", hasSensitiveAnswers: true,
          sealedSensitiveAnswers: sealSensitiveAnswers(`${P}form`, { note: "synthetic" }),
        },
      });
      await tx.healthRecordField.create({
        data: { id: `${P}hfield`, recordId: `${P}record`, fieldKey: "allergies", sealedValue: sealHealthField(`${P}record`, "allergies", "synthetic") },
      });
      await tx.healthRecordSnapshot.create({
        data: {
          id: `${P}snap`, personId: `${P}person`, eventId: `${P}event`, trigger: "CHECK_IN", eventDate: "2027-01-10", ageBasis: "ADULT",
          expiresAt: soon, fieldCount: 1,
        },
      });
      await tx.healthRecordSnapshotField.create({
        data: { id: `${P}sfield`, snapshotId: `${P}snap`, fieldKey: "allergies", sealedValue: sealSnapshotField(`${P}snap`, "allergies", "synthetic") },
      });
    });
    const feedBefore = await prisma.calendarFeed.findMany({ where: OWN, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } });
    const entryBefore = await prisma.calendarEntry.findUniqueOrThrow({ where: { id: `${P}entry_0` }, select: { updatedAt: true } });
    const formBefore = await prisma.clubFormSubmission.findUniqueOrThrow({ where: { id: `${P}form` }, select: { updatedAt: true } });

    // The sealed health copy trigger: nothing but rotation's own write gets through.
    const fieldValue = (await prisma.healthRecordSnapshotField.findUniqueOrThrow({ where: { id: `${P}sfield` } })).sealedValue;
    assert.ok(
      await refused(() => prisma.$executeRaw`UPDATE "HealthRecordSnapshotField" SET "sealedValue" = 'x' WHERE "id" = ${`${P}sfield`}`),
      "a plain UPDATE of a sealed copy is still refused",
    );
    assert.ok(
      await refused(() => prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('imsda.key_rotation', 'on', true)`;
        await tx.$executeRaw`UPDATE "HealthRecordSnapshotField" SET "fieldKey" = 'other', "sealedValue" = 'x' WHERE "id" = ${`${P}sfield`}`;
      })),
      "with the rotation setting on, changing another column is refused",
    );
    assert.ok(
      await refused(() => prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('imsda.key_rotation', 'on', true)`;
        await tx.$executeRaw`UPDATE "HealthRecordSnapshot" SET "eventDate" = '2027-02-02' WHERE "id" = ${`${P}snap`}`;
      })),
      "the copy itself stays fully immutable",
    );
    assert.equal((await prisma.healthRecordSnapshotField.findUniqueOrThrow({ where: { id: `${P}sfield` } })).sealedValue, fieldValue);

    // One value sealed under a key that will not be loaded: unreadable, never fatal.
    setKeys({ current: OTHER_KEY, version: 7 });
    await prisma.securityCheckCode.create({
      data: {
        id: `${P}code_lost`,
        action: "attendee-sign-in",
        emailHash: "hash-lost",
        sealedCode: secretBox.sealSecret("999999", "security-check-code"),
        expiresAt: expires,
      },
    });

    // Rotation begins: new key current at version 2, old key loaded as previous.
    setKeys({ current: NEW_KEY, version: 2, previous: { key: OLD_KEY, version: 1 } });
    let counts = await totals();
    assert.deepEqual(
      [counts[codes.label].current, counts[codes.label].older, counts[codes.label].unreadable],
      [0, 5, 1],
      "security codes: all older, the lost one unreadable",
    );
    assert.deepEqual([counts[feeds.label].current, counts[feeds.label].older, counts[feeds.label].unreadable], [0, 3, 0]);

    // Every registered column has a row that is readable and still on the old key.
    const everyColumn = await scanSealedColumns(store, { batchSize: 2 });
    assert.equal(everyColumn.length, 11);
    for (const scan of everyColumn) assert.ok(scan.older >= 1, `${scan.label} has a synthetic row on the old key`);

    const dry = await rotateSealedColumns(store, { apply: false, columns: both, batchSize: 2 });
    assert.equal(dry.reduce((sum, row) => sum + row.rotated, 0), 0, "a dry run rotates nothing");
    assert.equal(dry.reduce((sum, row) => sum + row.wouldRotate, 0), 8);
    counts = await totals();
    assert.equal(counts[codes.label].older, 5, "a dry run writes nothing");

    // A partial run: only the security codes.
    const partial = await rotateSealedColumns(store, { apply: true, columns: [codes], batchSize: 2 });
    assert.deepEqual([partial[0].rotated, partial[0].unreadable, partial[0].skipped], [5, 1, 0]);
    counts = await totals();
    assert.deepEqual([counts[codes.label].current, counts[codes.label].older], [5, 0]);
    assert.deepEqual([counts[feeds.label].current, counts[feeds.label].older], [0, 3], "the calendar feeds are still on the old key");

    // A change that lands between the read and the write is left alone (compare-and-set).
    let interfered = false;
    let editedName = false;
    const interfering = {
      readBatch: store.readBatch.bind(store),
      async replace(col: typeof feeds, row: Parameters<typeof store.replace>[1], next: Parameters<typeof store.replace>[2]) {
        if (!interfered && row.id === `${P}feed_1`) {
          interfered = true;
          await prisma.calendarFeed.update({
            where: { id: row.id },
            data: { sealedUrl: secretBox.sealSecret(feedUrls[1], "calendar-feed-url") },
          });
        }
        if (!editedName && row.id === `${P}feed_2`) {
          editedName = true;
          // An edit to another column moves updatedAt, so the stale write must not roll it back.
          await prisma.calendarFeed.update({ where: { id: row.id }, data: { name: "Renamed meanwhile" } });
        }
        return store.replace(col, row, next);
      },
    };
    const raced = await rotateSealedColumns(interfering, { apply: true, columns: [feeds], batchSize: 2 });
    // The concurrent write was sealed with the current key, so it is already current; the stale write was refused.
    assert.deepEqual([raced[0].rotated, raced[0].skipped], [1, 2]);
    counts = await totals();
    assert.deepEqual([counts[feeds.label].current, counts[feeds.label].older, counts[feeds.label].unreadable], [2, 1, 0]);
    const renamed = await prisma.calendarFeed.findUniqueOrThrow({ where: { id: `${P}feed_2` } });
    assert.equal(renamed.name, "Renamed meanwhile", "the concurrent edit survives");
    const renamedStamp = renamed.updatedAt.getTime();

    // The next run picks up what was skipped.
    const finishing = await rotateSealedColumns(store, { apply: true, columns: both, batchSize: 2 });
    assert.deepEqual([finishing[1].rotated, finishing[1].skipped], [1, 0]);
    counts = await totals();
    assert.deepEqual([counts[feeds.label].current, counts[feeds.label].older, counts[feeds.label].unreadable], [3, 0, 0]);
    assert.equal((await prisma.calendarFeed.findUniqueOrThrow({ where: { id: `${P}feed_2` } })).updatedAt.getTime(), renamedStamp);

    // The rest: a rerun is a no-op.
    const rerun = await rotateSealedColumns(store, { apply: true, columns: both, batchSize: 2 });
    assert.equal(rerun.reduce((sum, row) => sum + row.rotated, 0), 0, "a rerun changes nothing");
    assert.equal(rerun.reduce((sum, row) => sum + row.skipped, 0), 0);

    // Fingerprints were recomputed with the rotation, together with the copy on the left-behind item.
    const feed0 = await prisma.calendarFeed.findUniqueOrThrow({ where: { id: `${P}feed_0` } });
    const newFingerprint0 = secretBox.fingerprintSecret(feedUrls[0], "calendar-feed-url");
    assert.equal(feed0.urlFingerprint, newFingerprint0);
    assert.notEqual(newFingerprint0, oldFingerprint0);
    const entry0 = await prisma.calendarEntry.findUniqueOrThrow({ where: { id: `${P}entry_0` } });
    assert.equal(entry0.sourceUrlFingerprint, newFingerprint0);
    assert.equal(entry0.updatedAt.getTime(), entryBefore.updatedAt.getTime(), "the left-behind item's updatedAt is unchanged");
    const feedsAfter = await prisma.calendarFeed.findMany({ where: OWN, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } });
    for (const [index, feed] of feedsAfter.entries()) {
      // feed_1 and feed_2 were edited by the concurrent writes; feed_0 keeps its updatedAt through rotation.
      if (feed.id === `${P}feed_0`) assert.equal(feed.updatedAt.getTime(), feedBefore[index].updatedAt.getTime(), `${feed.id} updatedAt is unchanged`);
    }

    // Everything else rotates in one run, including the sealed health copy through the trigger's one exception.
    const all = await rotateSealedColumns(store, { apply: true, batchSize: 2 });
    for (const result of all) {
      assert.equal(result.skipped, 0, `${result.label}: nothing skipped`);
      assert.equal(result.unreadable, result.label === codes.label ? 1 : 0, `${result.label}: unreadable`);
    }
    assert.equal(all.find((result) => result.label === "HealthRecordSnapshotField.sealedValue")?.alreadyCurrent, 0);
    assert.equal(all.find((result) => result.label === "HealthRecordSnapshotField.sealedValue")?.rotated, 1);
    assert.equal(
      (await prisma.clubFormSubmission.findUniqueOrThrow({ where: { id: `${P}form` } })).updatedAt.getTime(),
      formBefore.updatedAt.getTime(),
      "a form submission's updatedAt is unchanged",
    );
    assert.notEqual((await prisma.healthRecordSnapshotField.findUniqueOrThrow({ where: { id: `${P}sfield` } })).sealedValue, fieldValue);

    // With the previous key removed, everything still opens with the new key alone.
    setKeys({ current: NEW_KEY, version: 2 });
    const everything = await scanSealedColumns(store, { batchSize: 2 });
    for (const scan of everything) {
      assert.equal(scan.older, 0, `${scan.label}: nothing left on the old key`);
      assert.equal(scan.unreadable, scan.label === codes.label ? 1 : 0, `${scan.label}: unreadable`);
      assert.ok(scan.current >= 1, `${scan.label}: rotated rows open with the new key alone`);
    }
    const after = await scanSealedColumns(store, { columns: both, batchSize: 2 });
    const byLabel = Object.fromEntries(after.map((scan) => [scan.label, scan]));
    assert.deepEqual(
      [byLabel[codes.label].current, byLabel[codes.label].older, byLabel[codes.label].unreadable],
      [5, 0, 1],
      "only the value sealed under the lost key remains unreadable",
    );
    assert.deepEqual([byLabel[feeds.label].current, byLabel[feeds.label].older, byLabel[feeds.label].unreadable], [3, 0, 0]);
    const feed2 = await prisma.calendarFeed.findUniqueOrThrow({ where: { id: `${P}feed_2` } });
    assert.equal(secretBox.openSecret(feed2.sealedUrl, "calendar-feed-url"), feedUrls[2]);
    assert.ok(feed2.sealedUrl.startsWith("v2.2."), "rotated values are v2 with the current version");

    console.log("key rotation checks passed");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "key rotation check failed");
  process.exit(1);
});
