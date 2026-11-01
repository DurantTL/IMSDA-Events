/**
 * Synthetic rows for `scripts/verify-privacy-browsers.ts` (#1445). Every id starts with "pbx". Nothing here is a real
 * person, club or card. Idempotent: `seedPrivacyBrowsers` removes what an earlier run left and writes it again.
 */
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export const P = "pbx";
export const PASSWORD = "synthetic-Passphrase-4-privacy";
export const ids = {
  church: `${P}_church`,
  club: `${P}_club`,
  /** No two-step sign-in: signs in with the emailed code. */
  codeAccount: `${P}_account_code`,
  /** Has an authenticator enrolled (placeholder); a minted session is already second-step verified. */
  directorAccount: `${P}_account_director`,
  event: `${P}_event`,
  form: `${P}_form`,
  formVersion: `${P}_formver`,
};
export const emails = {
  code: `${P}.code@example.test`,
  director: `${P}.director@example.test`,
};
export const eventSlug = `${P}-privacy-weekend`;
export const formSlug = "register";
export const promoCode = "PBXSAVE10";
/** Server numbers for the form below: Standard ticket $50.00 + 2 shirts at $15.00, with 10% off. */
export const expected = { subtotalCents: 8000, discountCents: 800, totalPayLaterCents: 7200 };

function formDefinition() {
  const field = (id: string, key: string, label: string, type: string, extra: Record<string, unknown> = {}) => ({
    id: `${P}_${id}`, key, label, helpText: "", type, scope: "REGISTRATION", required: false, options: [], ...extra,
  });
  return {
    title: "Privacy weekend registration",
    description: "Fictitious event for the privacy-browser check.",
    confirmationMessage: "Thank you. Your registration is received.",
    payment: {
      enabled: true,
      currency: "USD",
      paymentMethodFieldKey: "payment_method",
      cardOptionValue: "Credit / debit card",
      percentageBasisPoints: 290,
      fixedFeeCents: 30,
      passFeeToRegistrant: true,
    },
    sections: [
      { id: `${P}_s_contact`, title: "About you", description: "", fields: [
        field("f_first", "first_name", "First name", "TEXT", { required: true }),
        field("f_last", "last_name", "Last name", "TEXT", { required: true }),
        field("f_email", "email", "Email", "EMAIL", { required: true }),
      ] },
      { id: `${P}_s_pay`, title: "Choices and payment", description: "", fields: [
        field("f_ticket", "ticket", "Ticket", "RADIO", { required: true, options: ["Standard", "Premium"], choicePricesCents: { Standard: 5000, Premium: 9000 } }),
        field("f_shirts", "shirts", "Shirts", "NUMBER", { priceCents: 1500 }),
        field("f_promo", "promo_code", "Promo code", "TEXT"),
        field("f_method", "payment_method", "Payment method", "RADIO", { required: true, options: ["Pay later", "Credit / debit card"] }),
      ] },
    ],
  };
}

export async function cleanupPrivacyBrowsers(prisma: PrismaClient) {
  const startsWithP = { startsWith: `${P}_` };
  const accounts = [ids.codeAccount, ids.directorAccount];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    await tx.event.deleteMany({ where: { id: startsWithP } });
  });
  await prisma.attendeeStepUpCode.deleteMany({ where: { accountId: { in: accounts } } });
  await prisma.attendeeSession.deleteMany({ where: { accountId: { in: accounts } } });
  await prisma.clubDirectorGrant.deleteMany({ where: { attendeeAccountId: { in: accounts } } });
  await prisma.attendeeMfaEnrollment.deleteMany({ where: { accountId: { in: accounts } } });
  await prisma.attendeeCredential.deleteMany({ where: { accountId: { in: accounts } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { in: accounts } } });
  await prisma.clubRosterMember.deleteMany({ where: { organizationId: ids.club } });
  // The people the journeys' registrations created (their emails start "pbx.") go with the event's registrations above.
  await prisma.person.deleteMany({ where: { OR: [{ id: startsWithP }, { normalizedEmail: { startsWith: `${P}.` } }] } });
  await prisma.organization.deleteMany({ where: { id: ids.club } });
  await prisma.organization.deleteMany({ where: { id: ids.church } });
}

export async function seedPrivacyBrowsers(prisma: PrismaClient) {
  const { hashPassword } = await import("../../modules/access/passwords");
  const { clubYearFor } = await import("../../modules/club-rosters/domain");
  const { registrationFormDefinitionSchema } = await import("../../modules/forms/definition");
  await cleanupPrivacyBrowsers(prisma);
  const now = new Date();
  const clubYear = clubYearFor(now);

  await prisma.organization.create({ data: { id: ids.church, type: "CHURCH", name: "Pbx Prairie Church", normalizedName: "pbx prairie church", city: "Testville", state: "IA" } });
  await prisma.organization.create({ data: { id: ids.club, type: "CLUB", name: "Pbx Eagles Club", normalizedName: "pbx eagles club", parentOrganizationId: ids.church } });
  await prisma.clubProfile.create({ data: { organizationId: ids.club, meetingPlace: "Fellowship hall", meetingSchedule: "Saturdays", contactEmail: `${ids.club}@example.test`, contactPhone: "(515) 555-0100" } });

  const passwordHash = await hashPassword(PASSWORD);
  for (const [id, email, displayName, firstName, lastName] of [
    [ids.codeAccount, emails.code, "Casey Pbx-Code", "Casey", "Pbx-Code"],
    [ids.directorAccount, emails.director, "Dana Pbx-Director", "Dana", "Pbx-Director"],
  ] as const) {
    await prisma.attendeeAccount.create({ data: { id, email, displayName, firstName, lastName, status: "ACTIVE", emailVerifiedAt: now } });
    await prisma.attendeeCredential.create({ data: { accountId: id, passwordHash } });
    await prisma.clubDirectorGrant.create({
      data: { organizationId: ids.club, attendeeAccountId: id, role: "DIRECTOR", effectiveFrom: new Date("2026-01-01T00:00:00Z"), reason: "Synthetic privacy-browser check" },
    });
  }
  await prisma.attendeeMfaEnrollment.create({
    data: { accountId: ids.directorAccount, method: "TOTP", status: "ACTIVE", sealedSecret: `${P}-placeholder-not-a-secret`, confirmedAt: now },
  });

  const levels = ["FRIEND", "COMPANION", "EXPLORER"] as const;
  for (let index = 0; index < 3; index += 1) {
    const person = await prisma.person.create({ data: { id: `${P}_person_${index}`, firstName: `Pathy${index}`, lastName: "Pbx-Member" } });
    await prisma.clubRosterMember.create({
      data: {
        organizationId: ids.club, clubYear, personId: person.id, attendeeType: "YOUTH", role: "Pathfinder",
        classLevel: levels[index], reportedAge: 10 + index, gender: index % 2 === 0 ? "FEMALE" : "MALE", source: "DIRECTOR",
      },
    });
  }

  const definition = registrationFormDefinitionSchema.parse(formDefinition());
  const start = new Date(now.getTime() + 60 * 86_400_000);
  await prisma.event.create({
    data: {
      id: ids.event, slug: eventSlug, name: "Pbx Privacy Weekend",
      startsAt: start, endsAt: new Date(start.getTime() + 2 * 86_400_000), timezone: "America/Chicago",
      isPublished: true, registrationOpensOn: "2026-01-01", registrationClosesOn: "2099-01-01",
      billingMode: "ATTENDEE_PAY", audience: "GENERAL",
    },
  });
  await prisma.registrationForm.create({
    data: {
      id: ids.form, eventId: ids.event, createdByUserId: "usr_system_admin", name: definition.title, slug: formSlug, status: "PUBLISHED",
      versions: { create: { id: ids.formVersion, createdByUserId: "usr_system_admin", versionNumber: 1, status: "PUBLISHED", publishedAt: now, definition } },
    },
  });
  await prisma.promoCode.create({
    data: { eventId: ids.event, code: promoCode, normalizedCode: promoCode, discountType: "PERCENT_BPS", discountValue: 1000, isActive: true },
  });
}

/**
 * Makes the emailed sign-in code known: the real one is only minted when the email is delivered, which a check must
 * not do (the app here has a placeholder mail key, so delivery fails and may retire the pending row first). The newest
 * sign-in code row of the account is set to a code this script knows and made live.
 */
export async function planSignInCode(prisma: PrismaClient, accountId: string) {
  const { hashOneTimeCode } = await import("../../modules/attendee-accounts/codes");
  const code = String(100000 + (randomBytes(4).readUInt32BE() % 900000));
  const row = await prisma.attendeeStepUpCode.findFirst({ where: { accountId, purpose: "SIGN_IN" }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!row) throw new Error("No sign-in code row exists for this account: the sign-in did not ask for one.");
  await prisma.attendeeStepUpCode.update({
    where: { id: row.id },
    data: { codeHash: hashOneTimeCode(code), codeExpiresAt: new Date(Date.now() + 10 * 60_000), consumedAt: null, attempts: 0 },
  });
  return code;
}

/** A signed-in director browser: the session is already second-step verified, so club pages open. */
export async function directorCookie() {
  const attendeeSession = await import("../../modules/attendee-accounts/session-store");
  const { attendeeSessionCookie } = await import("../../modules/security/session-cookies");
  const session = await attendeeSession.createAttendeeSession(ids.directorAccount, null, { secondFactorVerifiedAt: new Date() });
  return { name: attendeeSessionCookie.legacyName, value: session.token, expires: Math.floor(session.expiresAt.getTime() / 1000) };
}
