/**
 * Proves the Cognito health record import (#878) against a real PostgreSQL
 * database, where the unit tests' fake database can't:
 *
 * - with HEALTH_RECORDS_ENABLED off nothing is stored, even when asked to;
 * - only a system administrator who has acknowledged the privacy notice can
 *   preview or apply, and an administrator acting as a director cannot;
 * - the preview names clubs, members, results and section names, and no health
 *   value, and writes nothing but a counts-only audit row;
 * - apply writes one sealed record per matched member (each field its own
 *   ciphertext, no plaintext in any column or audit row), marked as imported
 *   and reading "Needs update" for the director, who sees the review notice
 *   until they confirm or save;
 * - a member who already has a record keeps it untouched, and running the same
 *   file again (CSV or Excel) imports nothing and changes nothing, even when
 *   two applies race;
 * - unmatched people are listed by name only and nothing is stored for them;
 * - removing the roster member erases an imported record like any other.
 *
 * Uses fictitious rows it creates and removes itself, and a synthetic key.
 *
 *   npm run test:health-import
 */
import { loadEnvConfig } from "@next/env";
import { assertLocalDatabase } from "./support/local-only-guard";
import { PrismaClient } from "@prisma/client";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { CARD_HEADERS, CONTACT_HEADERS, MAIN_HEADERS, cardRow, contactRow, csvBytes, importMarkers, mainRow, xlsxBytes } from "../tests/health-import-fixtures";

loadEnvConfig(process.cwd());
// Local-only, before any Prisma client or connection exists.
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("RESEND_API_KEY", "verify-script-placeholder-never-sent");
fillBlankSyntheticEnv("ACCOUNT_EMAIL_SENDER_ADDRESS", "events@health-import.example.test");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-health-import-synthetic-key-not-a-secret");
process.env.HEALTH_RECORDS_ENABLED = "false";

const prisma = new PrismaClient();
const P = "hi878";
const clubs = { a: `${P}_club_a`, b: `${P}_club_b` };
const adminUserId = `${P}_admin_user`;
const emailDomain = "health-import.example.test";

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

async function cleanup() {
  const records = await prisma.healthRecord.findMany({ where: { organizationId: { in: Object.values(clubs) } }, select: { id: true } });
  const members = await prisma.clubRosterMember.findMany({ where: { organizationId: { in: Object.values(clubs) } }, select: { id: true } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ entityId: { in: [...records, ...members].map((row) => row.id) } }, { entityId: { in: Object.values(clubs) } }, { actorUserId: adminUserId }] },
  });
  await prisma.healthRecord.deleteMany({ where: { organizationId: { in: Object.values(clubs) } } });
  await prisma.clubRosterMember.deleteMany({ where: { organizationId: { in: Object.values(clubs) } } });
  await prisma.person.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.healthPrivacyAcknowledgment.deleteMany({ where: { OR: [{ userId: adminUserId }, { attendeeAccountId: `${P}_acct` }] } });
  await prisma.attendeeAccount.deleteMany({ where: { id: `${P}_acct` } });
  await prisma.user.deleteMany({ where: { id: adminUserId } });
  await prisma.organization.deleteMany({ where: { id: { in: Object.values(clubs) } } });
}

async function main() {
  const importer = await import("../modules/health-records/import-repository");
  const repo = await import("../modules/health-records/repository");
  const acknowledgment = await import("../modules/health-records/acknowledgment");
  const rosterDomain = await import("../modules/club-rosters/domain");
  const rosterRepo = await import("../modules/club-rosters/repository");
  const birthDates = await import("../modules/club-rosters/birth-dates");
  type Viewer = import("../modules/health-records/domain").HealthViewer;
  const admin: Viewer = { kind: "SYSTEM_ADMIN", userId: adminUserId };
  const director: Viewer = { kind: "CLUB_LEADER", organizationId: clubs.a, accountId: `${P}_acct` };
  const now = new Date();
  const clubYear = rosterDomain.clubYearFor(now);

  await cleanup();
  await prisma.organization.createMany({
    data: [
      { id: clubs.a, type: "CLUB", name: "Verify Import Pathfinders", normalizedName: "verify import pathfinders" },
      { id: clubs.b, type: "CLUB", name: "Verify Other Pathfinders", normalizedName: "verify other pathfinders" },
    ],
  });
  await prisma.attendeeAccount.create({ data: { id: `${P}_acct`, email: `director@${emailDomain}`, displayName: "Verify Director", status: "ACTIVE" } });
  await prisma.user.create({ data: { id: adminUserId, email: `admin@${emailDomain}`, displayName: "Verify Admin" } });
  async function addMember(key: string, firstName: string, birthDate: string | null, organizationId = clubs.a, guardianEmail?: string) {
    await prisma.person.create({ data: { id: `${P}_${key}`, firstName, lastName: "Verify" } });
    return prisma.clubRosterMember.create({
      data: {
        organizationId,
        clubYear,
        personId: `${P}_${key}`,
        attendeeType: "YOUTH",
        role: "Pathfinder",
        source: "DIRECTOR",
        sealedBirthDate: birthDate ? birthDates.sealBirthDate(birthDate) : null,
        ...(guardianEmail ? { guardians: { create: { position: 1, name: "Pat Verify", email: guardianEmail } } } : {}),
      },
    });
  }
  const riley = await addMember("riley", "Riley", "2012-04-09");
  const morgan = await addMember("morgan", "Morgan", null, clubs.a, `parent@${emailDomain}`);
  const casey = await addMember("casey", "Casey", "2011-02-03");
  const drew = await addMember("drew", "Drew", "2010-06-07", clubs.b);

  const club = { ChurchAndClubName_First: "Verify Import", ChurchAndClubName_Last: "Pathfinders" };
  const rows = [
    mainRow({ PathfinderHealthRecord_Id: "9001", Name_First: "Riley", Name_Last: "Verify", DateOfBirth: "2012-04-09", ...club }),
    mainRow({ PathfinderHealthRecord_Id: "9002", Name_First: "Morgan", Name_Last: "Verify", DateOfBirth: "", GuardianEmail: `Parent@${emailDomain}`, Phone: "call after school", ...club }),
    mainRow({ PathfinderHealthRecord_Id: "9003", Name_First: "Casey", Name_Last: "Verify", DateOfBirth: "2011-02-03", ...club }),
    mainRow({ PathfinderHealthRecord_Id: "9004", Name_First: "Nobody", Name_Last: "Listed", ...club }),
    mainRow({ PathfinderHealthRecord_Id: "9005", Name_First: "Drew", Name_Last: "Verify", DateOfBirth: "2010-06-07", ChurchAndClubName_First: "Verify Other", ChurchAndClubName_Last: "Pathfinders" }),
    mainRow({ PathfinderHealthRecord_Id: "9006", Name_First: "Riley", Name_Last: "Verify", DateOfBirth: "2012-04-09", Entry_Status: "Incomplete", ...club }),
  ];
  const contacts = [contactRow("9001", "e1", "Alex", "Verify", "515-555-0180", "Aunt"), contactRow("9002", "e2", "Sam", "Verify", "515-555-0181", "Uncle")];
  const upload = () => [{ bytes: csvBytes(MAIN_HEADERS, rows) }, { bytes: csvBytes(CONTACT_HEADERS, contacts) }, { bytes: csvBytes(CARD_HEADERS, [cardRow("9001")]) }];

  // 1. Switched off: nothing is stored -----------------------------------
  await expectCode(importer.applyHealthImport(admin, upload(), {}, now), "NOT_FOUND", "applying with the flag off");
  await expectCode(importer.previewHealthImport(admin, upload(), now), "NOT_FOUND", "previewing with the flag off");
  assert((await prisma.healthRecord.count({ where: { organizationId: { in: Object.values(clubs) } } })) === 0, "nothing is stored with the flag off");

  // 2. Switched on: who may import ---------------------------------------
  process.env.HEALTH_RECORDS_ENABLED = "true";
  const envModule = await import("../lib/env");
  envModule.resetServerEnvCache();
  assert((await import("../modules/health-records/flag")).healthRecordsEnabled(), "the flag is on for the rest of this script");

  await expectCode(importer.previewHealthImport(director, upload(), now), "FORBIDDEN", "a director previewing");
  await expectCode(importer.applyHealthImport(director, upload(), {}, now), "FORBIDDEN", "a director applying");
  await expectCode(importer.applyHealthImport({ kind: "SYSTEM_ADMIN", userId: adminUserId, actAsId: "someone" }, upload(), {}, now), "FORBIDDEN", "an administrator acting as a director");
  await expectCode(importer.previewHealthImport(admin, upload(), now), "ACKNOWLEDGMENT_REQUIRED", "previewing before the privacy acknowledgment");
  await expectCode(importer.applyHealthImport(admin, upload(), {}, now), "ACKNOWLEDGMENT_REQUIRED", "applying before the privacy acknowledgment");
  assert((await prisma.healthRecord.count({ where: { organizationId: { in: Object.values(clubs) } } })) === 0, "nothing is stored before the acknowledgment");
  await acknowledgment.recordHealthPrivacyAcknowledgment(admin, now);

  // 3. The preview shows no health value and stores nothing ---------------
  const auditBefore = await prisma.auditLog.count({ where: { actorUserId: adminUserId } });
  const preview = await importer.previewHealthImport(admin, upload(), now);
  // What an administrator ticks in the preview: sourceId:memberId pairs, exactly as the preview showed them.
  const pick = (ids: string[]) => preview.rows.filter((row) => ids.includes(row.sourceId) && row.memberId).map((row) => ({ sourceId: row.sourceId, memberId: row.memberId! }));
  const outcomeOf = (id: string) => preview.rows.find((row) => row.sourceId === id)?.outcome;
  assert(outcomeOf("9001") === "MATCHED" && outcomeOf("9002") === "MATCHED" && outcomeOf("9003") === "MATCHED", "name and birth date, and name and parent email, match");
  assert(outcomeOf("9004") === "UNMATCHED", "an unknown person is not matched");
  assert(outcomeOf("9005") === "MATCHED", "a second club's row matches that club's member");
  assert(outcomeOf("9006") === "INCOMPLETE", "an incomplete form is never imported");
  const previewDump = JSON.stringify(preview);
  for (const marker of importMarkers) assert(!previewDump.includes(marker), `"${marker}" is not in the preview`);
  assert(!/Alex|Uncle|2012/.test(previewDump), "no contact name or birth date is in the preview");
  assert((await prisma.healthRecord.count({ where: { organizationId: { in: Object.values(clubs) } } })) === 0, "the preview stores nothing");
  const previewAudit = await prisma.auditLog.findMany({ where: { actorUserId: adminUserId, action: "HEALTH_IMPORT_PREVIEWED" } });
  assert(previewAudit.length === 1 && (await prisma.auditLog.count({ where: { actorUserId: adminUserId } })) === auditBefore + 1, "the preview writes one audit row");

  // 4. Apply: sealed, flagged, one record per matched member -------------
  const result = await importer.applyHealthImport(admin, upload(), { include: pick(["9001", "9002", "9004", "9005"]) }, now);
  assert(result.imported === 3 && result.counts.NOT_SELECTED === 1 && result.counts.UNMATCHED === 1, "three selected rows are imported; the unselected and unmatched are not");
  const stored = await prisma.healthRecord.findMany({ where: { organizationId: { in: Object.values(clubs) } }, include: { fields: true } });
  assert(stored.length === 3, "one record per imported member");
  for (const record of stored) {
    assert(record.importedAt !== null && record.confirmedClubYear === null && record.lastConfirmedAt === null && record.lastEnteredVia === null, "an imported record is marked and not confirmed");
    assert(record.fields.length >= 10 && new Set(record.fields.map((field) => field.sealedValue)).size === record.fields.length, "each field is its own ciphertext");
  }
  assert(!stored.some((record) => record.rosterMemberId === casey.id), "an unselected member has no record");
  assert(!stored.some((record) => record.fields.some((field) => field.fieldKey === "consent" || field.fieldKey === "signature")), "no consent and no signature is imported");
  const dump = JSON.stringify(stored) + JSON.stringify(await prisma.auditLog.findMany({ where: { actorUserId: adminUserId } }));
  for (const marker of importMarkers) assert(!dump.includes(marker), `"${marker}" is in no stored column or audit row`);
  assert(!/Riley|Morgan|Nobody|Verify Import/.test(JSON.stringify(await prisma.auditLog.findMany({ where: { actorUserId: adminUserId } }))), "no name is in any audit row");
  const applied = await prisma.auditLog.findMany({ where: { actorUserId: adminUserId, action: { in: ["HEALTH_RECORD_IMPORTED", "HEALTH_IMPORT_CLUB_APPLIED", "HEALTH_IMPORT_APPLIED"] } } });
  assert(applied.filter((row) => row.action === "HEALTH_RECORD_IMPORTED").length === 3, "one audit row per record");
  assert(applied.filter((row) => row.action === "HEALTH_IMPORT_CLUB_APPLIED").length === 2, "one audit row per club");
  assert(applied.filter((row) => row.action === "HEALTH_IMPORT_APPLIED").length === 1, "one audit row per run");

  // 5. The director sees it flagged, with the values, until they confirm -
  await acknowledgment.recordHealthPrivacyAcknowledgment(director, now);
  const directorView = await repo.viewHealthRecord(director, clubs.a, riley.id, now);
  assert(directorView.status === "NEEDS_UPDATE" && directorView.importedForReview === true, "the director sees an unreviewed import as Needs update");
  assert(directorView.values.allergyDetails === "Synthetic peanut reaction, mild, synthetic remedy", "the director reads the imported value");
  assert(directorView.values.insuranceCardInCognito === true, "the card-on-file note is kept, without a link");
  await repo.confirmHealthRecord(director, clubs.a, riley.id, now);
  const confirmed = await repo.viewHealthRecord(director, clubs.a, riley.id, now);
  assert(confirmed.status === "CURRENT" && confirmed.importedForReview === false, "confirming clears the review notice");
  const morganFields = (await prisma.healthRecord.findUniqueOrThrow({ where: { rosterMemberId: morgan.id }, include: { fields: true } })).fields.map((field) => field.fieldKey);
  assert(morganFields.includes("phone") && morganFields.includes("emergencyContacts"), "a phone that fails the check is kept as entered, not dropped");

  const forged = await importer.applyHealthImport(admin, upload(), { include: [{ sourceId: "9003", memberId: riley.id }] }, now);
  assert(forged.imported === 0 && forged.counts.CHANGED === 1, "a pair that is not what the preview showed is refused as changed");

  // 6. Re-running changes nothing, and a record is never overwritten ------
  const snapshot = async () => JSON.stringify(await prisma.healthRecord.findMany({ where: { organizationId: { in: Object.values(clubs) } }, include: { fields: { orderBy: { fieldKey: "asc" } } }, orderBy: { id: "asc" } }));
  const before = await snapshot();
  const again = await importer.applyHealthImport(admin, upload(), { include: pick(["9001", "9002", "9004", "9005"]) }, now);
  assert(again.imported === 0 && again.counts.ALREADY_HAS_RECORD === 3, "running the same file again imports nothing");
  assert((await snapshot()) === before, "running the same file again changes nothing");

  // 7. Excel gives the same answer, and racing applies write one record ---
  const workbook = xlsxBytes([
    { name: "PathfinderHealthRecord", headers: MAIN_HEADERS, rows },
    { name: "EmergencyContactsAndAuthorizedP", headers: CONTACT_HEADERS, rows: contacts },
    { name: "CopyOfInsuranceCard", headers: CARD_HEADERS, rows: [cardRow("9001")] },
  ]);
  const viaExcel = await importer.applyHealthImport(admin, [{ bytes: workbook }], { include: pick(["9001", "9002", "9005"]) }, now);
  assert(viaExcel.imported === 0 && viaExcel.counts.ALREADY_HAS_RECORD === 3, "an Excel upload of the same entries is recognised as already imported");
  const races = await Promise.allSettled(Array.from({ length: 4 }, () => importer.applyHealthImport(admin, [{ bytes: workbook }], { include: pick(["9003"]) }, now)));
  assert(races.every((race) => race.status === "fulfilled"), "racing applies all finish");
  assert((await prisma.healthRecord.count({ where: { rosterMemberId: casey.id } })) === 1, "four racing applies for one member write exactly one record");
  const raced = races.flatMap((race) => (race.status === "fulfilled" ? [race.value.imported] : []));
  assert(raced.reduce((sum, value) => sum + value, 0) === 1, "exactly one of the racing applies imported it");

  // 8. A director's own record is never replaced -------------------------
  await prisma.healthRecord.deleteMany({ where: { rosterMemberId: drew.id } });
  const own = await prisma.healthRecord.create({ data: { organizationId: clubs.b, rosterMemberId: drew.id, confirmedClubYear: clubYear, hasHealthNote: false, lastEnteredVia: "DIRECTOR", lastConfirmedAt: now } });
  const skipped = await importer.applyHealthImport(admin, upload(), { include: pick(["9005"]) }, now);
  const after = await prisma.healthRecord.findUniqueOrThrow({ where: { id: own.id }, include: { fields: true } });
  assert(skipped.imported === 0 && after.importedAt === null && after.fields.length === 0 && after.lastEnteredVia === "DIRECTOR", "an existing record is left exactly as it was");

  // 9. Removing the member erases an imported record ----------------------
  await prisma.$transaction((tx) => rosterRepo.eraseRosterRow(tx, riley.id, now));
  assert((await prisma.healthRecord.count({ where: { rosterMemberId: riley.id } })) === 0, "removal erases the imported record");

  console.log("Health record import verification passed.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "The verification failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
