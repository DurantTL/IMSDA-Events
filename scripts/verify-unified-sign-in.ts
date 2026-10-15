/**
 * Proves slice (c) of one account per person (#554, ADR 0013) against a real
 * PostgreSQL database, with the one-sign-in switch both ON and OFF:
 *
 * - switch ON, the single password sign-in (`unifiedPasswordSignIn`, the function behind /api/sign-in):
 *   a staff person gets the staff session and the linked attendee session; an attendee-only person gets
 *   one session; an attendee password never yields a staff session or a staff challenge (and a valid
 *   staff authenticator code cannot finish a sign-in that has no staff challenge); the staff and attendee
 *   credentials are checked independently; a staff password that needs a second step gets a challenge
 *   and no session, and an attendee session earned by the same password is revoked;
 * - the refusal is the same for an unknown address, a wrong password, a locked credential and a disabled
 *   account, and takes about the same time (real scrypt, medians of three);
 * - switch OFF: no linked attendee session is issued, and the old staff and attendee sign-ins behave as before;
 * - a system administrator's attendee email change clears the account's email verification, with the
 *   switch on or off, for an unlinked account and for a linked pair; the person re-verifies through a
 *   password reset code or Google sign-in for the new address;
 * - hand-linking and unlinking by a system administrator: reason required, refuses when either side is
 *   linked, audit entries carry ids only, no staff session is ever created, works with the switch off;
 * - sign-up, password reset and Google sign-in answer the same for an existing, an unknown and a staff
 *   address, and none of them reads or creates anything on the staff side.
 * Uses fictitious rows it creates and removes itself, and restores the switch afterwards.
 *
 *   npm run test:unified-sign-in
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { hashPassword } from "../modules/access/passwords";
import { MfaError, beginMfaEnrollment, completeMfaChallenge, confirmMfaEnrollment } from "../modules/access/mfa-service";
import { hashOpaqueToken } from "../modules/access/tokens";
import { totpCode } from "../modules/access/totp";
import { issueLinkedAttendeeSession, unifiedPasswordSignIn } from "../modules/account-merge/unified-sign-in";
import { isUnifiedSignInEnabled } from "../modules/account-merge/account-link";
import { HandLinkError, linkStaffAndAttendeeByHand, unlinkStaffAndAttendee } from "../modules/account-merge/hand-link";
import {
  beginAttendeePasswordReset,
  beginAttendeeSignUp,
  completeAttendeePasswordReset,
} from "../modules/attendee-accounts/account-service";
import { createOneTimeCode, hashOneTimeCode } from "../modules/attendee-accounts/codes";
import { signInWithGoogle } from "../modules/attendee-accounts/federated-sign-in";
import { changeAttendeeEmail, changeStaffEmail } from "../modules/system-admin/user-admin";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
// The authenticator secret is sealed with this key; a synthetic value for this run only.
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-unified-sign-in-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `usi_${randomUUID().slice(0, 8)}`;
const email = (key: string) => `${P}.${key}@example.test`;
const PASSWORD = "synthetic-Passphrase-4-verify";
const OTHER_PASSWORD = "another-Synthetic-Phrase-9-verify";
const id = (key: string) => `${P}_${key}`;

let settingsBefore: { existed: boolean; enabled: boolean } = { existed: false, enabled: false };
const createdUserIds: string[] = [];

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
  const ids = createdUserIds.slice();
  await prisma.userSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.mfaChallenge.deleteMany({ where: { userId: { in: ids } } });
  const accounts = await prisma.attendeeAccount.findMany({ where: { email: { startsWith: `${P}.` } }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids.concat(accounts.map((account) => account.id)) } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.attendeeAccount.deleteMany({ where: { email: { startsWith: `${P}.` } } });
}

async function staffUser(key: string, extra: { globalRole?: "SYSTEM_ADMIN"; attendeeAccountId?: string; password?: string } = {}) {
  createdUserIds.push(id(key));
  return prisma.user.create({
    data: {
      id: id(key),
      email: email(key),
      displayName: `Sign-in Synthetic ${key}`,
      accountStatus: "ACTIVE",
      activatedAt: new Date(),
      ...(extra.globalRole ? { globalRole: extra.globalRole } : {}),
      ...(extra.attendeeAccountId ? { attendeeAccountId: extra.attendeeAccountId } : {}),
      credential: { create: { passwordHash: await hashPassword(extra.password ?? PASSWORD) } },
    },
  });
}

async function attendee(key: string, options: { password?: string | null; emailKey?: string; verified?: boolean } = {}) {
  const password = options.password === undefined ? PASSWORD : options.password;
  return prisma.attendeeAccount.create({
    data: {
      email: email(options.emailKey ?? key),
      displayName: `Account Synthetic ${key}`,
      status: "ACTIVE",
      emailVerifiedAt: options.verified === false ? null : new Date(),
      ...(password ? { credential: { create: { passwordHash: await hashPassword(password) } } } : {}),
    },
    select: { id: true, email: true },
  });
}

const staffSessions = (userId: string) => prisma.userSession.count({ where: { userId } });
const attendeeSessions = (accountId: string) => prisma.attendeeSession.count({ where: { accountId, revokedAt: null } });

async function median(times: number[]) {
  return [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
}

async function main() {
  const row = await prisma.platformSettings.findUnique({ where: { id: "platform" }, select: { unifiedSignInEnabled: true } });
  settingsBefore = { existed: row !== null, enabled: row?.unifiedSignInEnabled === true };
  await cleanup();
  await setSwitch(true);
  assert(await isUnifiedSignInEnabled(), "switch is on for the sign-in checks");

  // ---- A staff person: staff session + linked attendee session. ----
  const linkedAccount = await attendee("both", { password: OTHER_PASSWORD });
  const both = await staffUser("both", { attendeeAccountId: linkedAccount.id });
  const staffSignIn = await unifiedPasswordSignIn(email("both"), PASSWORD, null);
  assert(staffSignIn.kind === "signed_in" && staffSignIn.staff !== null && staffSignIn.attendee !== null, "staff password: both sessions");
  assert(staffSignIn.kind === "signed_in" && staffSignIn.attendee?.accountId === linkedAccount.id, "the attendee session is the linked account's");
  assert((await staffSessions(both.id)) === 1 && (await attendeeSessions(linkedAccount.id)) === 1, "one staff and one attendee session row exist");
  const linkedSession = await prisma.attendeeSession.findFirstOrThrow({ where: { accountId: linkedAccount.id }, select: { secondFactorVerifiedAt: true } });
  assert(linkedSession.secondFactorVerifiedAt === null, "a sign-in with no second step does not claim one");

  // ---- Independent checks: the attendee password alone opens the attendee side only. ----
  const sessionsBefore = await staffSessions(both.id);
  const attendeeOnly = await unifiedPasswordSignIn(email("both"), OTHER_PASSWORD, null);
  assert(attendeeOnly.kind === "signed_in" && attendeeOnly.staff === null && attendeeOnly.attendee?.accountId === linkedAccount.id, "attendee password: attendee session only");
  assert((await staffSessions(both.id)) === sessionsBefore, "attendee password: no staff session row");
  const staffFails = await prisma.authCredential.findUniqueOrThrow({ where: { userId: both.id }, select: { failedAttempts: true } });
  assert(staffFails.failedAttempts === 1, "the staff credential is checked independently (and counts the miss, as it always has)");
  // Reset the counter so this check does not drift toward a lock.
  await prisma.authCredential.update({ where: { userId: both.id }, data: { failedAttempts: 0 } });

  // ---- An attendee-only person gets one session. ----
  const solo = await attendee("solo");
  const soloSignIn = await unifiedPasswordSignIn(email("solo"), PASSWORD, null);
  assert(soloSignIn.kind === "signed_in" && soloSignIn.staff === null && soloSignIn.attendee?.accountId === solo.id, "attendee-only: one session");
  assert((await prisma.userSession.count({ where: { user: { email: email("solo") } } })) === 0, "attendee-only: no staff session");

  // ---- Attendee password + a VALID staff authenticator code: no staff session, no staff challenge. ----
  const mfaAccount = await attendee("mfa", { password: OTHER_PASSWORD });
  const mfaUser = await staffUser("mfa", { globalRole: "SYSTEM_ADMIN", attendeeAccountId: mfaAccount.id });
  const offer = await beginMfaEnrollment(mfaUser.id);
  await confirmMfaEnrollment(mfaUser.id, totpCode(offer.secret, new Date()));
  const attendeePasswordOnly = await unifiedPasswordSignIn(email("mfa"), OTHER_PASSWORD, null);
  assert(attendeePasswordOnly.kind === "signed_in" && attendeePasswordOnly.staff === null, "attendee password: never a staff session, never a staff challenge");
  const validCode = totpCode(offer.secret, new Date(Date.now() + 30_000));
  let rejected: unknown = null;
  try {
    await completeMfaChallenge(`${P}-forged-challenge-token-${"x".repeat(20)}`, validCode);
  } catch (error) {
    rejected = error;
  }
  assert(rejected instanceof MfaError, "a valid staff code with no staff challenge is refused");
  assert((await staffSessions(mfaUser.id)) === 0, "attendee password plus a valid staff code gives no staff session");
  assert((await prisma.mfaChallenge.count({ where: { userId: mfaUser.id } })) === 0, "no staff challenge was issued for the attendee password");

  // ---- Staff password that needs a second step: challenge, no session; the attendee session the same password earned is revoked. ----
  const sameAccount = await attendee("mfasame", { password: PASSWORD });
  const sameUser = await staffUser("mfasame", { globalRole: "SYSTEM_ADMIN", attendeeAccountId: sameAccount.id });
  const sameOffer = await beginMfaEnrollment(sameUser.id);
  await confirmMfaEnrollment(sameUser.id, totpCode(sameOffer.secret, new Date()));
  const challenged = await unifiedPasswordSignIn(email("mfasame"), PASSWORD, null);
  assert(challenged.kind === "mfa" && challenged.userId === sameUser.id && challenged.gate === "challenge", "a staff password with a second step gets a challenge");
  assert((await staffSessions(sameUser.id)) === 0, "no staff session before the second step");
  assert((await attendeeSessions(sameAccount.id)) === 0, "the attendee session earned by the same password is revoked, not left behind");
  const staffOnlyChallenge = await unifiedPasswordSignIn(email("mfa"), PASSWORD, null);
  assert(staffOnlyChallenge.kind === "mfa", "the staff password alone also gets the staff challenge");
  assert((await attendeeSessions(mfaAccount.id)) === 1, "the attendee session from the attendee-password sign-in is untouched");

  // ---- One refusal for every failure, with the same work and about the same time. ----
  const lockedStaff = await staffUser("locked");
  await prisma.authCredential.update({ where: { userId: lockedStaff.id }, data: { lockedUntil: new Date(Date.now() + 3_600_000) } });
  const lockedAccount = await attendee("locked");
  await prisma.attendeeCredential.update({ where: { accountId: lockedAccount.id }, data: { lockedUntil: new Date(Date.now() + 3_600_000) } });
  const disabledStaff = await staffUser("disabled");
  await prisma.authCredential.update({ where: { userId: disabledStaff.id }, data: { disabledAt: new Date() } });
  const disabledAccount = await attendee("disabled");
  await prisma.attendeeAccount.update({ where: { id: disabledAccount.id }, data: { disabledAt: new Date() } });
  await staffUser("wrong");
  await attendee("wrong");

  const cases: Array<[string, string, string]> = [
    ["unknown address", email("nobody"), PASSWORD],
    ["wrong password", email("wrong"), "definitely-not-the-password-1"],
    ["locked credentials", email("locked"), PASSWORD],
    ["disabled accounts", email("disabled"), PASSWORD],
  ];
  const medians: number[] = [];
  for (const [name, address, typed] of cases) {
    const times: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = performance.now();
      const outcome = await unifiedPasswordSignIn(address, typed, null);
      times.push(performance.now() - started);
      assert(outcome.kind === "refused", `${name}: refused`);
    }
    medians.push(await median(times));
  }
  // The wrong-password case counts misses against a live credential; keep the others' timing comparable.
  const fastest = Math.min(...medians);
  const slowest = Math.max(...medians);
  assert(slowest / fastest < 2.5, `refusal timing is equalised (medians ms: ${medians.map((value) => Math.round(value)).join(", ")})`);

  // ---- Switch OFF: no linked attendee session; old sign-ins untouched. ----
  await setSwitch(false);
  assert(!(await isUnifiedSignInEnabled()), "switch is off");
  assert((await issueLinkedAttendeeSession(both.id, null, { secondFactorVerified: true })) === null, "switch off: no linked attendee session");
  const attendeesBefore = await attendeeSessions(linkedAccount.id);
  const { authenticateWithPassword } = await import("../modules/access/auth-service");
  const { authenticateAttendee } = await import("../modules/attendee-accounts/account-service");
  const oldStaff = await authenticateWithPassword(email("both"), PASSWORD, null);
  assert(oldStaff?.outcome === "session", "switch off: the staff sign-in still works as before");
  assert((await attendeeSessions(linkedAccount.id)) === attendeesBefore, "switch off: the staff sign-in does not create an attendee session");
  assert((await authenticateAttendee(email("solo"), PASSWORD, null)) !== null, "switch off: the attendee sign-in still works as before");

  // ---- Admin email change clears verification: switch off, then on. ----
  const adminUser = await staffUser("admin", { globalRole: "SYSTEM_ADMIN" });
  const plain = await attendee("plain");
  assert((await prisma.attendeeAccount.findUniqueOrThrow({ where: { id: plain.id } })).emailVerifiedAt !== null, "starts verified");
  await changeAttendeeEmail(plain.id, email("plain-new"), adminUser.id);
  const plainAfter = await prisma.attendeeAccount.findUniqueOrThrow({ where: { id: plain.id } });
  assert(plainAfter.email === email("plain-new") && plainAfter.emailVerifiedAt === null, "switch off: an admin email change clears the verification");

  // Re-verification: a password reset code for the new address.
  const pendingToken = `${P}-reset-pending`;
  const code = createOneTimeCode();
  await prisma.attendeeAccountToken.create({
    data: {
      accountId: plain.id,
      tokenHash: hashOpaqueToken(pendingToken),
      codeHash: hashOneTimeCode(code),
      codeExpiresAt: new Date(Date.now() + 10 * 60_000),
      purpose: "PASSWORD_RESET",
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  const reset = await completeAttendeePasswordReset({ pendingToken, code, passwordHash: await hashPassword(PASSWORD), userAgent: null });
  assert(reset.outcome === "reset", "the reset code for the new address works");
  assert((await prisma.attendeeAccount.findUniqueOrThrow({ where: { id: plain.id } })).emailVerifiedAt !== null, "a reset code to the new address verifies it again");

  // Google sign-in for the new address verifies it again too.
  await changeAttendeeEmail(plain.id, email("plain-newer"), adminUser.id);
  assert((await prisma.attendeeAccount.findUniqueOrThrow({ where: { id: plain.id } })).emailVerifiedAt === null, "cleared again");
  const google = await signInWithGoogle({ subject: `${P}-g-plain`, email: email("plain-newer"), emailVerified: true, name: null }, null);
  assert(google.outcome === "signed-in", "Google sign-in for the new address works");
  assert((await prisma.attendeeAccount.findUniqueOrThrow({ where: { id: plain.id } })).emailVerifiedAt !== null, "Google for the new address verifies it again");

  await setSwitch(true);
  const pairAccount = await attendee("pair");
  const pairUser = await staffUser("pair", { attendeeAccountId: pairAccount.id });
  await changeStaffEmail(pairUser.id, email("pair-new"), adminUser.id);
  const pairAfter = await prisma.attendeeAccount.findUniqueOrThrow({ where: { id: pairAccount.id } });
  assert(pairAfter.email === email("pair-new") && pairAfter.emailVerifiedAt === null, "switch on, linked pair: both emails change and the attendee verification is cleared");
  assert((await prisma.user.findUniqueOrThrow({ where: { id: pairUser.id } })).email === email("pair-new"), "switch on, linked pair: the staff email changed with it");

  // ---- Hand-linking different emails (an admin tool: works with the switch off too). ----
  for (const enabled of [false, true]) {
    await setSwitch(enabled);
    const key = enabled ? "hl-on" : "hl-off";
    const person = await staffUser(`${key}-staff`);
    const personal = await attendee(`${key}-attendee`);
    const noAdmin = await staffUser(`${key}-notadmin`);
    const sessionRows = await staffSessions(person.id);
    const input = { userId: person.id, attendeeAccountId: personal.id, reason: "Same person; personal address on file" };

    for (const [who, actorId] of [["a non-admin", noAdmin.id], ["a missing actor", id("nobody")]] as const) {
      let refused: unknown = null;
      try { await linkStaffAndAttendeeByHand(input, actorId); } catch (error) { refused = error; }
      assert(refused instanceof HandLinkError && refused.code === "NOT_SYSTEM_ADMIN", `${who} cannot link (switch ${enabled ? "on" : "off"})`);
    }
    let noReason: unknown = null;
    try { await linkStaffAndAttendeeByHand({ ...input, reason: " " }, adminUser.id); } catch (error) { noReason = error; }
    assert(noReason instanceof HandLinkError && noReason.code === "REASON_REQUIRED", "a reason is required");
    assert((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).attendeeAccountId === null, "nothing linked yet");

    await linkStaffAndAttendeeByHand(input, adminUser.id);
    assert((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).attendeeAccountId === personal.id, `linked by hand with different emails (switch ${enabled ? "on" : "off"})`);
    assert((await staffSessions(person.id)) === sessionRows, "linking never creates a staff session");

    const audits = await prisma.auditLog.findMany({ where: { action: "STAFF_ATTENDEE_HAND_LINKED", entityId: { in: [person.id, personal.id] } } });
    assert(audits.length === 2, "two audit entries");
    for (const audit of audits) {
      const text = JSON.stringify({ metadata: audit.metadata, summary: audit.summary });
      assert(!text.includes("@") && !text.includes(email(`${key}-staff`)), "the audit entry carries ids only, no email");
      assert(audit.actorUserId === adminUser.id, "the audit entry names the actor");
    }

    // Either side already linked is refused.
    const otherAccount = await attendee(`${key}-other`);
    const otherUser = await staffUser(`${key}-otheruser`);
    let userLinked: unknown = null;
    try { await linkStaffAndAttendeeByHand({ ...input, attendeeAccountId: otherAccount.id }, adminUser.id); } catch (error) { userLinked = error; }
    assert(userLinked instanceof HandLinkError && userLinked.code === "USER_ALREADY_LINKED", "a linked staff user is refused");
    let accountLinked: unknown = null;
    try { await linkStaffAndAttendeeByHand({ ...input, userId: otherUser.id }, adminUser.id); } catch (error) { accountLinked = error; }
    assert(accountLinked instanceof HandLinkError && accountLinked.code === "ACCOUNT_ALREADY_LINKED", "a linked attendee account is refused");

    // The link grants nothing by itself: a sign-in with the attendee password is still attendee-only.
    if (enabled) {
      const viaAttendeePassword = await unifiedPasswordSignIn(email(`${key}-attendee`), PASSWORD, null);
      assert(viaAttendeePassword.kind === "signed_in" && viaAttendeePassword.staff === null, "a hand-linked person still gets no staff session from the attendee password");
    }

    await unlinkStaffAndAttendee({ attendeeAccountId: personal.id, reason: "Linked in error during verification" }, adminUser.id);
    assert((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).attendeeAccountId === null, "unlinked");
    let notLinked: unknown = null;
    try { await unlinkStaffAndAttendee({ attendeeAccountId: personal.id, reason: "Linked in error during verification" }, adminUser.id); } catch (error) { notLinked = error; }
    assert(notLinked instanceof HandLinkError && notLinked.code === "NOT_LINKED", "unlinking an unlinked account is refused");
  }

  // ---- No account enumeration at the service level. ----
  await setSwitch(true);
  const existingAccount = await attendee("enum-existing");
  const enumStaff = await staffUser("enum-staff");
  const shape = (value: object) => Object.keys(value).sort().join(",");
  const staffUsersBefore = await prisma.user.count();
  const staffSessionsBefore = await prisma.userSession.count();
  const signUps: Awaited<ReturnType<typeof beginAttendeeSignUp>>[] = [];
  for (const key of ["enum-existing", "enum-unknown", "enum-staff"]) {
    signUps.push(await beginAttendeeSignUp({ email: email(key), displayName: "Synthetic Person", password: PASSWORD }));
  }
  assert(signUps.every((result) => shape(result) === shape(signUps[0]) && typeof result.pendingToken === "string"), "sign-up: one shape for existing, unknown and staff addresses");
  const resets: Awaited<ReturnType<typeof beginAttendeePasswordReset>>[] = [];
  for (const key of ["enum-existing", "enum-unknown", "enum-staff"]) resets.push(await beginAttendeePasswordReset({ email: email(key) }));
  assert(resets.every((result) => shape(result) === shape(resets[0]) && typeof result.pendingToken === "string"), "password reset: one shape for existing, unknown and staff addresses");
  const googleResults: Awaited<ReturnType<typeof signInWithGoogle>>[] = [];
  for (const key of ["enum-existing", "enum-unknown2", "enum-staff"]) {
    googleResults.push(await signInWithGoogle({ subject: `${P}-g-${key}`, email: email(key), emailVerified: true, name: "Synthetic Person" }, null));
  }
  assert(googleResults.every((result) => result.outcome === "signed-in" && typeof result.session.token === "string"), "Google: existing, unknown and staff addresses all land signed in on the attendee side");
  assert((await prisma.user.count()) === staffUsersBefore, "none of them created a staff user");
  assert((await prisma.userSession.count()) === staffSessionsBefore, "none of them created a staff session");
  assert((await staffSessions(enumStaff.id)) === 0, "the staff address got no staff session from Google");
  assert(existingAccount.id.length > 0, "synthetic existing account present");

  console.log("Unified sign-in verification passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    if (settingsBefore.existed) await setSwitch(settingsBefore.enabled).catch(() => undefined);
    else await prisma.platformSettings.deleteMany({ where: { id: "platform", unifiedSignInEnabled: true } }).catch(() => undefined);
    await prisma.$disconnect();
  });
