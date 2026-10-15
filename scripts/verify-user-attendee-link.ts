/**
 * Proves the staff `User` <-> `AttendeeAccount` link constraints (#554, ADR 0013, slice (a))
 * against a real PostgreSQL database:
 *
 * - the column is nullable and starts NULL (no seeded or new user is linked by default);
 * - it is unique: one attendee account cannot be linked to two users (PostgreSQL P2002);
 * - both sides must exist: linking to an account that does not exist is refused (P2003);
 * - ON DELETE SET NULL: deleting the attendee account unlinks the user and keeps the user;
 *   deleting the user leaves the attendee account alone;
 * - the read helpers return ids for a link and null for none;
 * - the one-sign-in switch defaults to off, in the column and in the seeded settings row.
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:user-attendee-link
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import {
  getAccountLinkForAttendeeAccount,
  getAttendeeAccountLinkForUser,
  isUnifiedSignInEnabled,
} from "../modules/account-merge/account-link";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");

const prisma = new PrismaClient();
const P = `ual_${randomUUID().slice(0, 8)}`;
const userIds = ["a", "b", "c"].map((k) => `${P}_user_${k}`);
const accountIds = ["a", "b"].map((k) => `${P}_acct_${k}`);
const email = (key: string) => `${P}.${key}@example.test`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function prismaCode(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
    throw error;
  }
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { in: accountIds } } });
}

async function main() {
  await cleanup();

  const column = await prisma.$queryRaw<Array<{ is_nullable: string; column_default: string | null }>>`
    SELECT is_nullable, column_default FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'attendeeAccountId'`;
  assert(column.length === 1 && column[0].is_nullable === "YES", "User.attendeeAccountId exists and is nullable");
  assert(column[0].column_default === null, "User.attendeeAccountId has no default");

  const linkedBefore = await prisma.user.count({ where: { attendeeAccountId: { not: null } } });
  assert(linkedBefore === 0, `no existing user is linked (found ${linkedBefore})`);

  await prisma.attendeeAccount.createMany({
    data: accountIds.map((id, i) => ({ id, email: email(`acct${i}`), displayName: `Link Synthetic ${i}` })),
  });
  await prisma.user.createMany({
    data: userIds.map((id, i) => ({ id, email: email(`user${i}`), displayName: `Link Staff ${i}` })),
  });

  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userIds[0] } });
  assert(fresh.attendeeAccountId === null, "a new user starts unlinked");
  assert((await getAttendeeAccountLinkForUser(userIds[0])) === null, "unlinked user reads as null");
  assert((await getAccountLinkForAttendeeAccount(accountIds[0])) === null, "unlinked account reads as null");

  // Both sides must exist.
  const missing = await prismaCode(
    prisma.user.update({ where: { id: userIds[0] }, data: { attendeeAccountId: `${P}_no_such_account` } }),
  );
  assert(missing === "P2003", `linking a missing account is refused by the foreign key (got ${missing})`);

  // A real link, read back through the module.
  await prisma.user.update({ where: { id: userIds[0] }, data: { attendeeAccountId: accountIds[0] } });
  const forUser = await getAttendeeAccountLinkForUser(userIds[0]);
  assert(
    forUser?.userId === userIds[0] && forUser.attendeeAccountId === accountIds[0],
    "the link reads from the user side",
  );
  const forAccount = await getAccountLinkForAttendeeAccount(accountIds[0]);
  assert(
    forAccount?.userId === userIds[0] && forAccount.attendeeAccountId === accountIds[0],
    "the link reads from the account side",
  );
  assert((await getAccountLinkForAttendeeAccount(accountIds[1])) === null, "an unlinked account stays unlinked");

  // 1:1: a second user cannot take the same account, and a user may still move to a free one.
  const dup = await prismaCode(
    prisma.user.update({ where: { id: userIds[1] }, data: { attendeeAccountId: accountIds[0] } }),
  );
  assert(dup === "P2002", `one account cannot be linked to two users (got ${dup})`);
  const dupCreate = await prismaCode(
    prisma.user.create({ data: { id: `${P}_user_dup`, email: email("dup"), displayName: "Dup", attendeeAccountId: accountIds[0] } }),
  );
  assert(dupCreate === "P2002", `a new user cannot take a linked account either (got ${dupCreate})`);
  await prisma.user.update({ where: { id: userIds[1] }, data: { attendeeAccountId: accountIds[1] } });

  // ON DELETE SET NULL: deleting the attendee account unlinks and keeps the user.
  await prisma.attendeeAccount.delete({ where: { id: accountIds[1] } });
  const unlinked = await prisma.user.findUnique({ where: { id: userIds[1] } });
  assert(unlinked !== null, "deleting the attendee account keeps the staff user");
  assert(unlinked.attendeeAccountId === null, "deleting the attendee account unlinks the staff user");
  assert((await getAttendeeAccountLinkForUser(userIds[1])) === null, "the helper sees the unlink");

  // Deleting the user leaves the attendee account alone.
  await prisma.user.delete({ where: { id: userIds[0] } });
  const account = await prisma.attendeeAccount.findUnique({ where: { id: accountIds[0] }, select: { id: true } });
  assert(account !== null, "deleting the staff user keeps the attendee account");
  assert((await getAccountLinkForAttendeeAccount(accountIds[0])) === null, "the account is free to link again");

  // The one-sign-in switch is off by default.
  const settingsColumn = await prisma.$queryRaw<Array<{ column_default: string | null; is_nullable: string }>>`
    SELECT column_default, is_nullable FROM information_schema.columns
    WHERE table_name = 'PlatformSettings' AND column_name = 'unifiedSignInEnabled'`;
  assert(
    settingsColumn.length === 1 && settingsColumn[0].column_default === "false" && settingsColumn[0].is_nullable === "NO",
    "PlatformSettings.unifiedSignInEnabled is NOT NULL DEFAULT false",
  );
  assert((await isUnifiedSignInEnabled()) === false, "the one-sign-in switch reads off on a fresh database");

  console.log("User/attendee link verification passed.");
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
