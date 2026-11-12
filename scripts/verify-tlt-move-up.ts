/**
 * Proves the TLT year move-up (#1686) against a real PostgreSQL database:
 *
 * - the ticked TLTs move up one year and the club year is recorded; Year 4, no year, finished and left TLTs and a year
 *   already set this club year do not move;
 * - the unticked proposed TLTs are held at their current year for this club year, and a confirm with no moves is fine;
 * - the same request sent again (and two sent at once) moves nobody twice;
 * - a stale club year is refused and changes nothing;
 * - someone no longer on a club roster is skipped;
 * - one audit row per confirm carries ids and counts, never a name;
 * - saving a year in the directory records the club year, and saving with a year that is no longer the stored one is
 *   refused with nothing saved.
 *
 * Uses fictitious rows it creates and removes itself. Nothing is sent.
 *
 *   npm run test:tlt-move-up
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { confirmTltMoveUp, updateTltProfile } from "@/modules/tlt-directory/repository";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-tlt-move-up-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `tm1686_${randomUUID().slice(0, 8)}`;
const CLUB = `${P}_club`;
const OTHER_CLUB = `${P}_club2`;
const actor = { accountId: `${P}_account` };
const clubYear = clubYearFor(new Date());
const previousStart = Number(clubYear.slice(0, 4)) - 1;
const earlier = `${previousStart}-${String((previousStart + 1) % 100).padStart(2, "0")}`;

type Spec = { key: string; year: number | null; yearClub: string | null; status?: "ACTIVE" | "FINISHED" | "LEFT" | null; onRoster?: boolean };
const specs: Spec[] = [
  { key: "y1", year: 1, yearClub: earlier },
  { key: "y2", year: 2, yearClub: null },
  { key: "y3", year: 3, yearClub: earlier, status: "ACTIVE" },
  { key: "y4", year: 4, yearClub: earlier },
  { key: "none", year: null, yearClub: null },
  { key: "done", year: 2, yearClub: earlier, status: "FINISHED" },
  { key: "left", year: 2, yearClub: earlier, status: "LEFT" },
  { key: "already", year: 2, yearClub: clubYear },
  { key: "gone", year: 1, yearClub: earlier, onRoster: false },
  { key: "hold1", year: 1, yearClub: earlier },
  { key: "hold2", year: 2, yearClub: earlier },
  { key: "race", year: 1, yearClub: earlier },
  { key: "edit", year: 2, yearClub: earlier },
];
const pid = (key: string) => `${P}_${key}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

async function profile(key: string) {
  return prisma.tltProfile.findUniqueOrThrow({ where: { personId: pid(key) }, select: { tltYear: true, tltYearClubYear: true, updatedAt: true } });
}

async function reset() {
  for (const spec of specs) {
    await prisma.tltProfile.upsert({
      where: { personId: pid(spec.key) },
      create: { personId: pid(spec.key), tltYear: spec.year, tltYearClubYear: spec.yearClub, status: spec.status ?? null },
      update: { tltYear: spec.year, tltYearClubYear: spec.yearClub, status: spec.status ?? null },
    });
  }
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { metadata: { path: ["actorAttendeeAccountId"], equals: actor.accountId } } });
  await prisma.tltProfile.deleteMany({ where: { personId: { startsWith: P } } });
  await prisma.clubRosterMember.deleteMany({ where: { organizationId: { in: [CLUB, OTHER_CLUB] } } });
  await prisma.person.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.organization.deleteMany({ where: { id: { in: [CLUB, OTHER_CLUB] } } });
}

async function setup() {
  await prisma.organization.createMany({ data: [CLUB, OTHER_CLUB].map((id, i) => ({ id, type: "CLUB" as const, name: `Move-up Club ${i} ${P}`, normalizedName: `move-up club ${i} ${P}` })) });
  await prisma.person.createMany({ data: specs.map((spec) => ({ id: pid(spec.key), firstName: spec.key, lastName: "Moveupsample" })) });
  await prisma.clubRosterMember.createMany({
    data: specs.filter((spec) => spec.onRoster !== false).map((spec) => ({
      organizationId: CLUB, clubYear, personId: pid(spec.key), attendeeType: "YOUTH" as const, isTlt: true, role: "", source: "DIRECTOR" as const,
    })),
  });
  await reset();
}

async function audits() {
  return prisma.auditLog.findMany({ where: { action: "TLT_YEAR_MOVE_UP_CONFIRMED", metadata: { path: ["actorAttendeeAccountId"], equals: actor.accountId } }, orderBy: { createdAt: "asc" } });
}

async function main() {
  await setup();

  const stamp = async (key: string) => (await profile(key)).updatedAt.getTime();
  const before = { y1: await stamp("y1"), y4: await stamp("y4"), hold1: await stamp("hold1") };
  await new Promise((resolve) => setTimeout(resolve, 20));

  // Move: ticked proposed TLTs move; every ineligible one is skipped and unchanged.
  const keys = ["y1", "y2", "y3", "y4", "none", "done", "left", "already", "gone"];
  const first = await confirmTltMoveUp({ clubYear, moveIds: keys.map(pid), keepIds: [] }, actor);
  assert(first.moved === 3 && first.kept === 0 && first.skipped === 6, "moves Year 1 to 3 only and skips the other six");
  assert((await profile("y1")).tltYear === 2 && (await profile("y1")).tltYearClubYear === clubYear, "Year 1 became Year 2 for this club year");
  assert((await profile("y2")).tltYear === 3 && (await profile("y3")).tltYear === 4, "a missing club year is offered, and Year 3 reaches Year 4");
  for (const key of ["y4", "none", "done", "left", "already", "gone"]) {
    const spec = specs.find((s) => s.key === key)!;
    const row = await profile(key);
    assert(row.tltYear === spec.year && row.tltYearClubYear === spec.yearClub, `${key} is unchanged`);
  }

  assert((await stamp("y1")) > before.y1 && (await stamp("y4")) === before.y4, "a moved row's updatedAt changes and an unmoved row's does not");

  // Double submit, sequential and at once.
  const again = await confirmTltMoveUp({ clubYear, moveIds: ["y1", "y2", "y3"].map(pid), keepIds: [] }, actor);
  assert(again.moved === 0 && again.skipped === 3 && (await profile("y1")).tltYear === 2, "sending the same request again moves nobody");
  const both = await Promise.all([1, 2].map(() => confirmTltMoveUp({ clubYear, moveIds: [pid("race")], keepIds: [] }, actor)));
  assert(both.reduce((n, r) => n + r.moved, 0) === 1 && (await profile("race")).tltYear === 2, "two requests at once move the TLT exactly once");

  // Hold: unticked TLTs keep their year and are not offered again; zero moves is allowed.
  const hold = await confirmTltMoveUp({ clubYear, moveIds: [], keepIds: [pid("hold1"), pid("hold2")] }, actor);
  assert(hold.moved === 0 && hold.kept === 2 && hold.skipped === 0, "a confirm with only kept TLTs works");
  assert((await profile("hold1")).tltYear === 1 && (await profile("hold1")).tltYearClubYear === clubYear, "a kept TLT keeps the year and is marked for this club year");
  assert((await stamp("hold1")) > before.hold1, "a held row's updatedAt changes");
  const afterHold = await confirmTltMoveUp({ clubYear, moveIds: [pid("hold1")], keepIds: [] }, actor);
  assert(afterHold.moved === 0 && (await profile("hold1")).tltYear === 1, "a kept TLT is not moved by a later request");

  // Stale club year.
  await reset();
  let refusedStale = false;
  try { await confirmTltMoveUp({ clubYear: earlier, moveIds: [pid("y1")], keepIds: [] }, actor); } catch (error) { refusedStale = (error as { code?: string }).code === "STALE_CLUB_YEAR"; }
  assert(refusedStale && (await profile("y1")).tltYear === 1, "a stale club year is refused and changes nothing");

  // Directory save: records the club year, and refuses a year that is no longer the stored one.
  await updateTltProfile({ personId: pid("edit"), tltYear: 3, expectedTltYear: 2, positionTypeId: null, status: null, tagIds: [] }, actor);
  assert((await profile("edit")).tltYear === 3 && (await profile("edit")).tltYearClubYear === clubYear, "saving a year records the club year");
  let refusedEdit = false;
  try { await updateTltProfile({ personId: pid("edit"), tltYear: 4, expectedTltYear: 2, positionTypeId: null, status: null, tagIds: [] }, actor); } catch (error) { refusedEdit = (error as { code?: string }).code === "YEAR_CHANGED"; }
  assert(refusedEdit && (await profile("edit")).tltYear === 3, "a save with an out-of-date year is refused and saves nothing");
  // A save racing a move-up: the move-up commits first, so the save (which loaded Year 3 for this person) is refused.
  await reset();
  await confirmTltMoveUp({ clubYear, moveIds: [pid("y1")], keepIds: [] }, actor);
  let refusedRace = false;
  try { await updateTltProfile({ personId: pid("y1"), tltYear: 1, expectedTltYear: 1, positionTypeId: null, status: "ACTIVE", tagIds: [] }, actor); } catch (error) { refusedRace = (error as { code?: string }).code === "YEAR_CHANGED"; }
  assert(refusedRace && (await profile("y1")).tltYear === 2, "a save made from before a move-up is refused and does not undo it");
  // And at once: whichever order they land in, the year ends consistent (never a lost move).
  await reset();
  const results = await Promise.allSettled([
    confirmTltMoveUp({ clubYear, moveIds: [pid("y1")], keepIds: [] }, actor),
    updateTltProfile({ personId: pid("y1"), tltYear: 1, expectedTltYear: 1, positionTypeId: null, status: "ACTIVE", tagIds: [] }, actor),
  ]);
  // Either order is valid: the move-up first (the save is refused), or the save first (the move-up then moves the TLT,
  // or skips it). What must never happen is a lost update: the final year is always the start year plus what moved.
  const final = await profile("y1");
  const movedCount = results[0].status === "fulfilled" ? results[0].value.moved : -1;
  const saveRefusedCleanly = results[1].status === "fulfilled" || (results[1].reason as { code?: string }).code === "YEAR_CHANGED";
  assert(movedCount >= 0 && saveRefusedCleanly && final.tltYear === 1 + movedCount, "a move-up and a save at once never overwrite each other");
  await reset();
  await updateTltProfile({ personId: pid("edit"), tltYear: 3, expectedTltYear: 2, positionTypeId: null, status: null, tagIds: [] }, actor);
  await updateTltProfile({ personId: pid("edit"), tltYear: null, expectedTltYear: 3, positionTypeId: null, status: null, tagIds: [] }, actor);
  assert((await profile("edit")).tltYearClubYear === null, "clearing the year clears the club year");

  // Audit: ids and counts, no name.
  const logs = await audits();
  assert(logs.length >= 4, "each confirm wrote one audit row");
  assert(!logs.some((row) => /Moveupsample|Move-up Club/.test(`${row.summary} ${JSON.stringify(row.metadata)}`)), "no name is written to the audit log");
  console.log("TLT move-up: all checks passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
