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
 *   does not stop the run.
 *
 * Uses fictitious rows with a reserved id prefix, created and removed here, and
 * synthetic keys. Reads and writes nothing else.
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

async function cleanup() {
  await prisma.calendarEntry.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.calendarFeed.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.securityCheckCode.deleteMany({ where: { id: { startsWith: P } } });
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
        return store.replace(col, row, next);
      },
    };
    const raced = await rotateSealedColumns(interfering, { apply: true, columns: [feeds], batchSize: 2 });
    // The concurrent write was sealed with the current key, so it is already current; the stale write was refused.
    assert.deepEqual([raced[0].rotated, raced[0].skipped], [2, 1]);
    counts = await totals();
    assert.deepEqual([counts[feeds.label].current, counts[feeds.label].older, counts[feeds.label].unreadable], [3, 0, 0]);

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

    // With the previous key removed, everything still opens with the new key alone.
    setKeys({ current: NEW_KEY, version: 2 });
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
