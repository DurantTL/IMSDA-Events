/**
 * Proves who the People & access list holds for each kind of viewer (#1788) against a real PostgreSQL database: a
 * Clubs Administrator lists club people only (a current or scheduled club role in a club, a current Area Coordinator,
 * a current Clubs Administrator), with or without a search, and a system administrator still lists everyone. Uses
 * fictitious rows it creates and removes itself.
 *
 *   npm run test:people-club-scope
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { findPeople } from "../modules/system-admin/people-directory";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const P = "pcscope";
const id = (name: string) => `${P}_${name}`;
const email = (name: string) => `${P}.${name}@example.test`;
const now = new Date();
const days = (count: number) => new Date(now.getTime() + count * 86_400_000);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function cleanup() {
  await prisma.clubDirectorGrant.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.areaCoordinatorGrant.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.clubsAdministratorGrant.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.organization.deleteMany({ where: { id: { startsWith: P } } });
}

const accounts = ["director", "scheduled", "ended", "revoked", "church", "coordinator", "coordinatorrevoked", "coordinatorexpired", "plain"];
const users = ["clubsadmin", "clubsadminrevoked", "sysadmin", "eventstaff", "linked"];

async function main() {
  await cleanup();
  await prisma.organization.create({ data: { id: id("club"), type: "CLUB", name: "People Scope Test Club", normalizedName: "people scope test club" } });
  await prisma.organization.create({ data: { id: id("church"), type: "CHURCH", name: "People Scope Test Church", normalizedName: "people scope test church" } });
  for (const name of accounts) {
    await prisma.attendeeAccount.create({ data: { id: id(name), email: email(name), displayName: `Pcscope ${name}` } });
  }
  const grant = (name: string, data: { organizationId?: string; role: "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER"; effectiveFrom?: Date; effectiveTo?: Date; revokedAt?: Date }) =>
    prisma.clubDirectorGrant.create({ data: { id: id(`grant_${name}`), attendeeAccountId: id(name), organizationId: id("club"), reason: "People scope check", effectiveFrom: days(-30), ...data } });
  await grant("director", { role: "DIRECTOR" });
  await grant("scheduled", { role: "DEPUTY", effectiveFrom: days(10) });
  await grant("ended", { role: "REGISTRAR", effectiveTo: days(-1) });
  await grant("revoked", { role: "REPORTER", revokedAt: days(-1) });
  await grant("church", { role: "DIRECTOR", organizationId: id("church") });
  await prisma.areaCoordinatorGrant.create({ data: { id: id("ac"), attendeeAccountId: id("coordinator") } });
  await prisma.areaCoordinatorGrant.create({ data: { id: id("ac_revoked"), attendeeAccountId: id("coordinatorrevoked"), revokedAt: days(-1) } });
  await prisma.areaCoordinatorGrant.create({ data: { id: id("ac_expired"), attendeeAccountId: id("coordinatorexpired"), expiresAt: days(-1) } });
  for (const name of users) {
    await prisma.user.create({
      data: {
        id: id(name),
        email: email(`staff.${name}`),
        displayName: `Pcscope staff ${name}`,
        ...(name === "sysadmin" ? { globalRole: "SYSTEM_ADMIN" as const } : {}),
        ...(name === "linked" ? { attendeeAccountId: id("director") } : {}),
      },
    });
  }
  await prisma.clubsAdministratorGrant.create({ data: { id: id("ca"), userId: id("clubsadmin") } });
  await prisma.clubsAdministratorGrant.create({ data: { id: id("ca_revoked"), userId: id("clubsadminrevoked"), revokedAt: days(-1) } });

  const mine = (people: Awaited<ReturnType<typeof findPeople>>) =>
    people.filter((person) => person.key.startsWith(P)).map((person) => person.key.slice(P.length + 1)).sort();

  // 1. A Clubs Administrator: club people only. The director's linked staff login is the same person (one row, its key).
  const clubs = mine(await findPeople("", "clubs", now));
  assert(JSON.stringify(clubs) === JSON.stringify(["clubsadmin", "coordinator", "linked", "scheduled"]), `Clubs Administrator list was ${clubs.join(", ")}`);
  console.log("ok  a Clubs Administrator lists only club people");

  // 2. The same limit holds inside a search, for a name and for an email.
  for (const name of ["ended", "revoked", "church", "coordinatorrevoked", "coordinatorexpired", "plain"]) {
    assert(mine(await findPeople(email(name), "clubs", now)).length === 0, `a Clubs Administrator's search found ${name}`);
  }
  for (const name of ["clubsadminrevoked", "sysadmin", "eventstaff"]) {
    assert(mine(await findPeople(email(`staff.${name}`), "clubs", now)).length === 0, `a Clubs Administrator's search found staff ${name}`);
  }
  assert(JSON.stringify(mine(await findPeople("Pcscope", "clubs", now))) === JSON.stringify(clubs), "a Clubs Administrator's name search should match the unsearched list");
  assert(JSON.stringify(mine(await findPeople(email("coordinator"), "clubs", now))) === JSON.stringify(["coordinator"]), "a Clubs Administrator can still find a club person by email");
  console.log("ok  a Clubs Administrator's search stays inside club people");

  // 3. A system administrator still lists everyone.
  const full = mine(await findPeople("", "full", now));
  const everyone = [...accounts.filter((name) => name !== "director"), ...users].sort();
  assert(JSON.stringify(full) === JSON.stringify(everyone), `system administrator list was ${full.join(", ")}`);
  assert(mine(await findPeople(email("plain"), "full", now)).length === 1, "a system administrator's search finds anyone");
  console.log("ok  a system administrator still lists everyone");
}

main()
  .then(() => console.log("People club scope verification passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
