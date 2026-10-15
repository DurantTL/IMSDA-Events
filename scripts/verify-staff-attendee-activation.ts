/**
 * Proves slice (b) of one account per person (#554, ADR 0013) against a real
 * PostgreSQL database, with the one-sign-in switch both OFF and ON:
 *
 * - switch OFF: activating a new staff user creates and links nothing (behaviour as before);
 * - switch ON: activating a new staff user with no attendee account creates a VERIFIED, ACTIVE
 *   account linked to them, with an audit entry carrying ids only;
 * - switch ON: an existing account is reused only when verified, active, unlinked and with the same
 *   email; an unverified account, or one linked to someone else, is NOT linked and NOT verified
 *   (a needs-review audit entry instead), and activation still succeeds;
 * - a previously active user (re-added, or promoted by create-admin with a printed URL) is flagged for review and never linked at activation;
 * - activation never creates a staff session, and a password reset of an ACTIVE user links nothing;
 * - no attendee-grade method (attendee password, Google sign-in, email verification code) yields a
 *   staff session for a linked person, and the resolver never reports a staff side from an attendee session;
 * - the attendee-passkey-as-second-factor decision refuses without the staff password, without user
 *   verification, with the switch off, and for another person's passkey.
 * Uses fictitious rows it creates and removes itself, and restores the switch afterwards.
 *
 *   npm run test:staff-attendee-activation
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { issueAccountTokenForUser, resetPassword } from "../modules/access/auth-service";
import { hashPassword } from "../modules/access/passwords";
import { hashOpaqueToken } from "../modules/access/tokens";
import { resolvePersonFrom } from "../modules/account-merge/person";
import { attendeePasskeyCountsAsStaffSecondFactor } from "../modules/account-merge/staff-elevation";
import { authenticateAttendee, verifyAttendeeEmail } from "../modules/attendee-accounts/account-service";
import { createOneTimeCode, hashOneTimeCode } from "../modules/attendee-accounts/codes";
import { signInWithGoogle } from "../modules/attendee-accounts/federated-sign-in";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");

const prisma = new PrismaClient();
const P = `sau_${randomUUID().slice(0, 8)}`;
const email = (key: string) => `${P}.${key}@example.test`;
const PASSWORD = "synthetic-Passphrase-4-verify";
const keys = ["off", "new", "reuse", "unverified", "taken", "reset", "readd", "promote", "bootstrap", "grade"] as const;
type Key = (typeof keys)[number];
const userId = (k: Key) => `${P}_user_${k}`;

let settingsBefore: { existed: boolean; enabled: boolean } = { existed: false, enabled: false };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function setSwitch(enabled: boolean) {
  await prisma.platformSettings.upsert({
    where: { id: "platform" },
    create: { id: "platform", unifiedSignInEnabled: enabled },
    update: { unifiedSignInEnabled: enabled },
  });
}

async function cleanup() {
  const ids = keys.map(userId).concat(`${P}_user_holder`);
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.attendeeAccount.deleteMany({ where: { email: { startsWith: `${P}.` } } });
}

async function pendingStaff(k: Key, accountStatus: "PENDING_ACTIVATION" | "ACTIVE" = "PENDING_ACTIVATION") {
  return prisma.user.create({
    data: {
      id: userId(k),
      email: email(k),
      displayName: `Activation Synthetic ${k}`,
      accountStatus,
      credential: { create: { passwordHash: await hashPassword(`${randomUUID()}-pending`) } },
    },
  });
}

async function activate(k: Key) {
  const sessionsBefore = await prisma.userSession.count({ where: { userId: userId(k) } });
  const issued = await issueAccountTokenForUser(userId(k), { purpose: "ACCOUNT_ACTIVATION" });
  assert(await resetPassword(issued.token, PASSWORD), `activation of ${k} succeeds`);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId(k) } });
  assert(user.accountStatus === "ACTIVE" && user.activatedAt !== null, `${k} is ACTIVE after activation`);
  assert((await prisma.userSession.count({ where: { userId: userId(k) } })) === sessionsBefore, `activating ${k} issues no staff session`);
  return user;
}

const accountsFor = (k: Key) => prisma.attendeeAccount.findMany({
  where: { email: email(k) },
  select: { id: true, emailVerifiedAt: true, status: true, disabledAt: true },
});

async function main() {
  const row = await prisma.platformSettings.findUnique({ where: { id: "platform" }, select: { unifiedSignInEnabled: true } });
  settingsBefore = { existed: row !== null, enabled: row?.unifiedSignInEnabled === true };
  await cleanup();

  // ---- Switch OFF: exactly as before. ----
  await setSwitch(false);
  await pendingStaff("off");
  const off = await activate("off");
  assert(off.attendeeAccountId === null, "switch off: activation links nothing");
  assert((await accountsFor("off")).length === 0, "switch off: activation creates no attendee account");
  assert(
    (await prisma.auditLog.count({ where: { entityId: userId("off"), action: { startsWith: "STAFF_ATTENDEE" } } })) === 0,
    "switch off: no link audit entry",
  );

  // ---- Switch ON. ----
  await setSwitch(true);

  // A staff user with no attendee account gets a verified linked one.
  await pendingStaff("new");
  const created = await activate("new");
  const createdAccounts = await accountsFor("new");
  assert(createdAccounts.length === 1, "switch on: exactly one attendee account exists for the new staff email");
  const account = createdAccounts[0];
  assert(account.emailVerifiedAt !== null && account.status === "ACTIVE" && account.disabledAt === null, "the created account is verified and ACTIVE");
  assert(created.attendeeAccountId === account.id, "the new staff user is linked to the created account");
  const createdAudit = await prisma.auditLog.findFirst({ where: { entityId: userId("new"), action: "STAFF_ATTENDEE_ACCOUNT_CREATED" } });
  assert(createdAudit !== null && !JSON.stringify(createdAudit.metadata).includes("@"), "a creation audit entry exists and carries no email");

  // An existing verified, active, unlinked account with the same email is reused.
  const reusable = await prisma.attendeeAccount.create({
    data: { email: email("reuse"), displayName: "Reuse Synthetic", status: "ACTIVE", emailVerifiedAt: new Date() },
    select: { id: true },
  });
  await pendingStaff("reuse");
  const reused = await activate("reuse");
  assert(reused.attendeeAccountId === reusable.id, "an existing verified account is reused");
  assert((await accountsFor("reuse")).length === 1, "no second account is created when one is reused");

  // An unverified account is neither linked nor verified.
  const unverified = await prisma.attendeeAccount.create({
    data: { email: email("unverified"), displayName: "Unverified Synthetic" },
    select: { id: true },
  });
  await pendingStaff("unverified");
  const notLinked = await activate("unverified");
  assert(notLinked.attendeeAccountId === null, "an unverified account is not linked");
  const stillUnverified = await prisma.attendeeAccount.findUniqueOrThrow({
    where: { id: unverified.id },
    select: { emailVerifiedAt: true, status: true },
  });
  assert(stillUnverified.emailVerifiedAt === null && stillUnverified.status === "PENDING_VERIFICATION", "activation does not verify someone else's account");
  assert(
    (await prisma.auditLog.count({ where: { entityId: userId("unverified"), action: "STAFF_ATTENDEE_LINK_NEEDS_REVIEW" } })) === 1,
    "an unverified account is flagged for review",
  );

  // An account already linked to someone else is not taken over.
  const taken = await prisma.attendeeAccount.create({
    data: { email: email("taken"), displayName: "Taken Synthetic", status: "ACTIVE", emailVerifiedAt: new Date() },
    select: { id: true },
  });
  await prisma.user.create({
    data: { id: `${P}_user_holder`, email: email("holder"), displayName: "Holder Synthetic", attendeeAccountId: taken.id },
  });
  await pendingStaff("taken");
  const notTaken = await activate("taken");
  assert(notTaken.attendeeAccountId === null, "an account linked to another user is not taken");
  const holder = await prisma.user.findUniqueOrThrow({ where: { id: `${P}_user_holder` } });
  assert(holder.attendeeAccountId === taken.id, "the other user's link is untouched");

  // A password reset of an already active user is not an activation: nothing links.
  await pendingStaff("reset", "ACTIVE");
  const resetToken = await issueAccountTokenForUser(userId("reset"), { purpose: "PASSWORD_RESET" });
  assert(await resetPassword(resetToken.token, PASSWORD), "password reset succeeds");
  assert((await prisma.user.findUniqueOrThrow({ where: { id: userId("reset") } })).attendeeAccountId === null, "a password reset links nothing");
  assert((await accountsFor("reset")).length === 0, "a password reset creates no attendee account");

  // Re-add then activate: an existing person (they have a revoked session) is never linked,
  // even though a re-add cleared activatedAt. A matching verified account would otherwise qualify.
  await prisma.attendeeAccount.create({
    data: { email: email("readd"), displayName: "Readd Synthetic", status: "ACTIVE", emailVerifiedAt: new Date() },
    select: { id: true },
  });
  await pendingStaff("readd");
  await prisma.userSession.create({
    data: { userId: userId("readd"), tokenHash: `${P}-old-session`, expiresAt: new Date(Date.now() + 3600_000), revokedAt: new Date() },
  });
  assert((await activate("readd")).attendeeAccountId === null, "a previously active user (re-added) is not linked at activation");
  const readdAudit = await prisma.auditLog.findFirst({ where: { entityId: userId("readd"), action: "STAFF_ATTENDEE_LINK_NEEDS_REVIEW" } });
  assert(JSON.stringify(readdAudit?.metadata).includes("PREVIOUSLY_ACTIVE"), "re-add: flagged PREVIOUSLY_ACTIVE");

  // Promote-existing without a password (create-admin prints the URL): not linked, not emailed.
  await prisma.attendeeAccount.create({
    data: { email: email("promote"), displayName: "Promote Synthetic", status: "ACTIVE", emailVerifiedAt: new Date() },
    select: { id: true },
  });
  await pendingStaff("promote");
  await prisma.auditLog.create({
    data: {
      actorUserId: userId("promote"), action: "SYSTEM_ADMIN_PROMOTED", entityType: "User", entityId: userId("promote"),
      correlationId: randomUUID(), summary: "synthetic", metadata: { viaBootstrapScript: true, passwordSetDirectly: false },
    },
  });
  assert((await activate("promote")).attendeeAccountId === null, "promote-existing then activate does not link");
  const promoteAudit = await prisma.auditLog.findFirst({ where: { entityId: userId("promote"), action: "STAFF_ATTENDEE_LINK_NEEDS_REVIEW" } });
  assert(JSON.stringify(promoteAudit?.metadata).includes("TOKEN_NOT_EMAILED"), "promote-existing: flagged TOKEN_NOT_EMAILED");

  // A brand-new administrator bootstrapped with a printed URL is not linked either.
  await pendingStaff("bootstrap");
  await prisma.auditLog.create({
    data: {
      actorUserId: userId("bootstrap"), action: "SYSTEM_ADMIN_BOOTSTRAPPED", entityType: "User", entityId: userId("bootstrap"),
      correlationId: randomUUID(), summary: "synthetic", metadata: { viaBootstrapScript: true, passwordSetDirectly: false },
    },
  });
  assert((await activate("bootstrap")).attendeeAccountId === null, "a create-admin bootstrapped admin is not linked at activation");
  assert((await accountsFor("bootstrap")).length === 0, "and no attendee account is created for them");

  // ---- No attendee-grade method yields a staff session for a linked person. ----
  const gradeUser = await pendingStaff("grade");
  const gradeAccount = await prisma.attendeeAccount.create({
    data: { email: email("grade"), displayName: "Grade Synthetic", status: "ACTIVE", emailVerifiedAt: new Date() },
    select: { id: true, email: true, displayName: true },
  });
  await prisma.user.update({ where: { id: gradeUser.id }, data: { accountStatus: "ACTIVE", attendeeAccountId: gradeAccount.id } });
  await prisma.attendeeCredential.create({ data: { accountId: gradeAccount.id, passwordHash: await hashPassword(PASSWORD) } });

  async function assertNoStaffElevation(method: string, token: string) {
    assert((await prisma.userSession.count({ where: { userId: gradeUser.id } })) === 0, `${method}: no staff session row was created`);
    assert(
      (await prisma.userSession.findUnique({ where: { tokenHash: hashOpaqueToken(token) } })) === null,
      `${method}: the attendee token is not a staff session token`,
    );
    for (const enabled of [true, false]) {
      await setSwitch(enabled);
      const person = await resolvePersonFrom({
        staff: null,
        attendee: {
          account: { id: gradeAccount.id, verifiedEmail: gradeAccount.email, displayName: gradeAccount.displayName },
          via: "attendee",
          sessionId: null,
        },
      }, prisma);
      assert(person.staff === null, `${method}: the resolver reports no staff side from an attendee session (switch ${enabled ? "on" : "off"})`);
    }
    await setSwitch(true);
  }

  const password = await authenticateAttendee(email("grade"), PASSWORD, null);
  assert(password !== null, "attendee password sign-in works");
  await assertNoStaffElevation("attendee password", password.session.token);

  await prisma.attendeeIdentity.create({
    data: { accountId: gradeAccount.id, provider: "GOOGLE", subject: `${P}-google-subject`, email: gradeAccount.email },
  });
  const google = await signInWithGoogle(
    { subject: `${P}-google-subject`, email: gradeAccount.email, emailVerified: true, name: null },
    null,
  );
  assert(google.outcome === "signed-in", "Google sign-in works");
  await assertNoStaffElevation("Google", google.session.token);

  const code = createOneTimeCode();
  const pendingToken = `${P}-pending-token`;
  await prisma.attendeeAccountToken.create({
    data: {
      accountId: gradeAccount.id,
      tokenHash: hashOpaqueToken(pendingToken),
      codeHash: hashOneTimeCode(code),
      codeExpiresAt: new Date(Date.now() + 10 * 60_000),
      purpose: "EMAIL_VERIFICATION",
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  const verified = await verifyAttendeeEmail({ pendingToken, code, userAgent: null });
  assert(verified.outcome === "verified", "email verification code sign-in works");
  await assertNoStaffElevation("email verification code", verified.session.token);

  // The resolver reports the link as a display hint only, and only with the switch on.
  const hint = await resolvePersonFrom({
    staff: null,
    attendee: { account: { id: gradeAccount.id, verifiedEmail: gradeAccount.email, displayName: "x" }, via: "attendee", sessionId: null },
  }, prisma);
  assert(hint.staff === null && hint.linkedUserId === gradeUser.id, "switch on: linkedUserId is a hint and staff stays null");
  await setSwitch(false);
  const noHint = await resolvePersonFrom({
    staff: { id: gradeUser.id, email: gradeUser.email, displayName: "x", globalRole: null },
    attendee: { account: null, via: null, sessionId: null },
  }, prisma);
  assert(noHint.link === null && noHint.linkedUserId === null, "switch off: the resolver does not read the link");
  await setSwitch(true);
  const withLink = await resolvePersonFrom({
    staff: { id: gradeUser.id, email: gradeUser.email, displayName: "x", globalRole: null },
    attendee: { account: null, via: null, sessionId: null },
  }, prisma);
  assert(withLink.link?.attendeeAccountId === gradeAccount.id, "switch on: a staff session resolves its linked account");

  // Attendee passkey as a staff second factor: decision 5.
  const base = { switchEnabled: true, staffPasswordVerified: true, passkeyAccountId: gradeAccount.id, linkedAttendeeAccountId: gradeAccount.id, assertionUserVerified: true };
  assert(attendeePasskeyCountsAsStaffSecondFactor(base).counts === true, "a user-verified linked passkey after the staff password counts");
  assert(attendeePasskeyCountsAsStaffSecondFactor({ ...base, assertionUserVerified: false }).counts === false, "a passkey without user verification is refused");
  assert(attendeePasskeyCountsAsStaffSecondFactor({ ...base, staffPasswordVerified: false }).counts === false, "a passkey without the staff password first is refused");
  assert(attendeePasskeyCountsAsStaffSecondFactor({ ...base, switchEnabled: false }).counts === false, "switch off: the passkey never counts");
  assert(attendeePasskeyCountsAsStaffSecondFactor({ ...base, passkeyAccountId: "someone-else" }).counts === false, "another person's passkey is refused");

  console.log("Staff/attendee activation verification passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    if (settingsBefore.existed) await setSwitch(settingsBefore.enabled).catch(() => undefined);
    else await prisma.platformSettings.deleteMany({ where: { id: "platform", unifiedSignInEnabled: true } }).catch(() => undefined);
    await prisma.$disconnect();
  });
