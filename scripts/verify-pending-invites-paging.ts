/**
 * Proves the Pending invites list on People & access is paged in the database across its three sources (#1492), against a
 * real PostgreSQL database, with fictitious invites it creates and removes itself:
 *
 * - club role invites (from the import, an application, a club and People & access), Area Coordinator invites and not-yet-activated staff logins are merged into one list, newest first;
 * - the total is the true count of all three, not a cap;
 * - every invite is on exactly one page, and the pages joined are the whole list in the same order as the unpaged read;
 * - a page past the end is clamped to the last page;
 * - the search narrows all three sources, and a Clubs Administrator's scope never reads staff logins.
 *
 *   npm run test:pending-invites-paging
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");

const prisma = new PrismaClient();
const P = "pinv";
const orgId = `${P}_club`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function cleanup() {
  await prisma.clubInvite.deleteMany({ where: { organizationId: orgId } });
  await prisma.areaCoordinatorInvite.deleteMany({ where: { email: { startsWith: `${P}.` } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `${P}.` } } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

async function main() {
  const { listPendingInvites, listPendingInvitesPage, PENDING_INVITES_PAGE_SIZE } = await import("../modules/system-admin/pending-invites");
  await cleanup();
  await prisma.organization.create({ data: { id: orgId, type: "CLUB", name: `Pending Invites Check ${P}`, normalizedName: `pending invites check ${P}` } });
  const base = new Date("2026-09-01T12:00:00Z").getTime();
  const at = (minutes: number) => new Date(base + minutes * 60_000);
  // 60 club invites: sent ones by sentAt, unsent ones by createdAt, with some sharing a minute so ties are exercised.
  await prisma.clubInvite.createMany({
    data: Array.from({ length: 60 }, (_, index) => ({
      id: `${P}_ci_${index}`, organizationId: orgId, email: `${P}.club${String(index).padStart(2, "0")}@example.test`, name: `Pinv Club ${index}`, role: "DIRECTOR" as const,
      source: (["PEOPLE", "IMPORT", "APPLICATION", "CLUB"] as const)[index % 4], status: index % 3 === 0 ? ("PENDING" as const) : ("SENT" as const),
      createdAt: at(index * 2), sentAt: index % 3 === 0 ? null : at(index * 2 + 7 - (index % 5)),
    })),
  });
  // 40 Area Coordinator invites, interleaved with the club ones.
  await prisma.areaCoordinatorInvite.createMany({
    data: Array.from({ length: 40 }, (_, index) => ({
      id: `${P}_ai_${index}`, email: `${P}.area${String(index).padStart(2, "0")}@example.test`, name: `Pinv Area ${index}`,
      status: index % 4 === 0 ? ("PENDING" as const) : ("SENT" as const), createdAt: at(index * 3), sentAt: index % 4 === 0 ? null : at(index * 3 + 11),
    })),
  });
  // 5 staff logins that have not activated, each with a setup link sent at its own time.
  for (let index = 0; index < 5; index += 1) {
    const user = await prisma.user.create({
      data: { id: `${P}_user_${index}`, email: `${P}.staff${index}@example.test`, displayName: `Pinv Staff ${index}`, accountStatus: "PENDING_ACTIVATION", createdAt: at(index * 10) },
    });
    await prisma.authCredential.create({ data: { userId: user.id, passwordHash: "synthetic-not-a-real-hash" } });
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: `${P}-token-${index}`, expiresAt: new Date(base + 30 * 86_400_000), createdAt: at(index * 10 + 3 * index) } });
  }

  const now = new Date("2026-09-02T00:00:00Z");
  const everything = await listPendingInvites({ scope: "full", query: `${P}.` }, now);
  assert(everything.invites.length === 105, `the unpaged read finds all 105 invites (got ${everything.invites.length})`);
  const first = await listPendingInvitesPage({ scope: "full", query: `${P}.` }, 1, now);
  assert(first.total === 105 && first.pageSize === PENDING_INVITES_PAGE_SIZE && first.invites.length === PENDING_INVITES_PAGE_SIZE, "the first page holds a page of 105, with the true total");
  const pageCount = Math.ceil(105 / PENDING_INVITES_PAGE_SIZE);
  const joined: string[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const result = await listPendingInvitesPage({ scope: "full", query: `${P}.` }, page, now);
    assert(result.page === page && result.total === 105, `page ${page} reports itself and the true total`);
    joined.push(...result.invites.map((invite) => `${invite.kind}:${invite.id}`));
  }
  assert(new Set(joined).size === 105, "every invite is on exactly one page");
  assert(JSON.stringify(joined) === JSON.stringify(everything.invites.map((invite) => `${invite.kind}:${invite.id}`)), "the pages joined are the whole list, in the unpaged read's order");
  assert(new Set(joined.map((entry) => entry.split(":")[0])).size === 3, "all three sources appear");
  assert((await listPendingInvitesPage({ scope: "full", query: `${P}.` }, 999, now)).page === pageCount, "a page past the end is clamped to the last page");
  const search = await listPendingInvitesPage({ scope: "full", query: `${P}.staff` }, 1, now);
  assert(search.total === 5 && search.invites.every((invite) => invite.kind === "staff"), "the search narrows the staff source");
  const clubs = await listPendingInvitesPage({ scope: "clubs", query: `${P}.` }, 1, now);
  assert(clubs.total === 100 && clubs.invites.every((invite) => invite.kind !== "staff"), "a Clubs Administrator's scope never reads staff logins");
  assert(new Set(everything.invites.filter((invite) => invite.kind === "club").map((invite) => invite.from)).size === 4, "club invites from import, application, club and staff all appear with a from label");
  assert((await listPendingInvitesPage({ scope: "full", query: `${P}.`, emails: [] }, 1, now)).total === 0, "an empty email list lists nothing");

  console.log("pending invites paging: all checks passed");
}

main()
  .then(async () => { await cleanup(); await prisma.$disconnect(); })
  .catch(async (error) => {
    console.error(error);
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
