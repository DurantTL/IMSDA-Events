/**
 * Synthetic fixtures for the Help walkthroughs (#1482). Every id starts with `walkthrough`, every name is an obvious
 * sample ("Alex Sample"), every email is `@example.test`, every phone is "(515) 555-01xx". Nothing here is a real
 * person, club or record.
 *
 * `resetWalkthroughFixtures` removes everything a previous run (or a walkthrough step that added a roster member, sent
 * an invite, registered the club or ordered a supply) left behind and creates the fixtures again, so every run starts from
 * the same state and gives the same pictures. LOCAL USE ONLY: callers run `assertWalkthroughSafety` first.
 */
import type { ClubFormRequirement, Prisma, PrismaClient } from "@prisma/client";
import { assertLocalDatabase, assertLocalUrl } from "./local-only-guard";

export const W = "walkthrough";

export const walkthroughIds = {
  church: `${W}_church`,
  club: `${W}_club`,
  /** The director account that has NOT set up two-step sign-in. */
  director: `${W}_account_director`,
  event: `${W}_club_event`,
  eventSlug: `${W}-club-weekend`,
  form: `${W}_form`,
} as const;

export const walkthroughDirector = {
  email: `${W}.director@example.test`,
  password: "Sample-Walkthrough-Pass-2026!",
  displayName: "Dana Sample",
  firstName: "Dana",
  lastName: "Sample",
  clubName: "Sample Trail Pathfinders",
  churchName: "Sample Valley Church",
} as const;

/** Names of the people added, edited and removed while the roster walkthrough runs. */
export const walkthroughRosterPerson = {
  firstName: "Casey",
  lastName: "Example",
  editedRole: "Counselor",
} as const;

/**
 * The person the leaders walkthrough adds. They already have a verified account, so the role is given right away: the
 * local app has no email set up (that is how the sign-in code is read), and an invite to a new address needs email.
 */
export const walkthroughInvitee = { id: `${W}_account_invitee`, name: "Robin Sample", email: `${W}.registrar@example.test` } as const;

/** The synthetic supply the orders walkthrough adds to the list. */
export const walkthroughSupplyName = "Sample Pathfinder Neckerchief";

/** Refuses a non-local database or app URL and production, before anything is written. */
export function assertWalkthroughSafety(baseUrl: string, env: Record<string, string | undefined> = process.env) {
  assertLocalDatabase(env, "write synthetic clubs and accounts for the help walkthroughs");
  assertLocalUrl(baseUrl, "HELP_SHOTS_BASE_URL");
}

/** Refuses a database that is not a seeded dev or CI one (the same guard as the mobile layout audit). */
export async function assertSeededDatabase(prisma: PrismaClient) {
  const wanted = [
    { where: { email: "admin@imsda-events.test" }, name: "admin@imsda-events.test" },
    { where: { email: "system@imsda-events.test" }, name: "system@imsda-events.test" },
    { where: { id: "usr_system_admin" }, name: "usr_system_admin" },
  ];
  const missing: string[] = [];
  for (const item of wanted) {
    if (!(await prisma.user.findFirst({ where: item.where, select: { id: true } }))) missing.push(item.name);
  }
  if (missing.length > 0) {
    throw new Error(`Refusing to write synthetic rows: this is not a seeded dev or CI database (missing ${missing.join(", ")}). Run \`npm run db:seed\` on a local database first.`);
  }
}

/** The form templates the walkthroughs switch on, remembered so the script can put them back. */
export type TemplateState = { key: string; enabled: boolean; requirement: ClubFormRequirement; requiredRoles: string[] };
const walkthroughTemplateKeys = ["pathfinder_membership_application", "off_premises_permission_slip", "club_tlt_application", "can_collecting_report"];

const fixtureAccountIds = [walkthroughIds.director, walkthroughInvitee.id];
const supplyNames = [walkthroughSupplyName, "Sample Pathfinder Scarf Slide", "Sample Club Patch"];

/** Deletes every walkthrough row, newest dependents first. Safe to run when nothing exists. */
export async function deleteWalkthroughFixtures(prisma: PrismaClient) {
  const mine = { startsWith: `${W}_` };
  const orgs = { organizationId: walkthroughIds.club };
  const rosterPeople = await prisma.clubRosterMember.findMany({ where: orgs, select: { personId: true } });
  const personIds = [
    ...(await prisma.person.findMany({ where: { id: mine }, select: { id: true } })).map((person) => person.id),
    ...rosterPeople.flatMap((member) => (member.personId ? [member.personId] : [])),
  ];
  await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`,
    prisma.attendeeSession.deleteMany({ where: { accountId: { in: fixtureAccountIds } } }),
    prisma.clubOrderNeed.deleteMany({ where: { OR: [orgs, { personId: { in: personIds } }] } }),
    prisma.clubSupplyStock.deleteMany({ where: orgs }),
    prisma.clubOrderListLine.deleteMany({ where: orgs }),
    prisma.memberClassCompletion.deleteMany({ where: { OR: [orgs, { personId: { in: personIds } }] } }),
    prisma.memberHonorEntry.deleteMany({ where: { OR: [orgs, { personId: { in: personIds } }] } }),
    prisma.clubSupplyItem.deleteMany({ where: { id: mine } }),
    prisma.clubFormSubmission.deleteMany({ where: orgs }),
    prisma.clubRosterMember.deleteMany({ where: orgs }),
    prisma.person.deleteMany({ where: { id: { in: personIds } } }),
    prisma.clubInvite.deleteMany({ where: { OR: [orgs, { email: walkthroughInvitee.email }] } }),
    prisma.clubMonthlyReport.deleteMany({ where: orgs }),
    prisma.clubYearEndReport.deleteMany({ where: orgs }),
    prisma.clubDirectorGrant.deleteMany({ where: { attendeeAccountId: { in: fixtureAccountIds } } }),
    prisma.attendeeMfaEnrollment.deleteMany({ where: { accountId: { in: fixtureAccountIds } } }),
    prisma.attendeePasskey.deleteMany({ where: { accountId: { in: fixtureAccountIds } } }),
    prisma.messageOutbox.deleteMany({ where: { OR: [{ accountAttendeeId: { in: fixtureAccountIds } }, { recipientEmail: { endsWith: "@example.test", startsWith: `${W}.` } }] } }),
  ]);
  // The club's event registrations and the event itself, then the account, profile and organizations.
  const registrations = await prisma.clubEventRegistration.findMany({ where: orgs, select: { id: true } }).catch(() => []);
  if (registrations.length > 0) await prisma.clubEventRegistration.deleteMany({ where: { id: { in: registrations.map((row) => row.id) } } });
  await prisma.registrationAttendee.deleteMany({ where: { registration: { eventId: walkthroughIds.event } } });
  await prisma.registration.deleteMany({ where: { eventId: walkthroughIds.event } });
  await prisma.auditLog.deleteMany({ where: { eventId: walkthroughIds.event } });
  await prisma.registrationFormVersion.deleteMany({ where: { id: mine } });
  await prisma.registrationForm.deleteMany({ where: { id: mine } });
  await prisma.event.deleteMany({ where: { id: walkthroughIds.event } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { in: fixtureAccountIds } } });
  await prisma.clubProfile.deleteMany({ where: orgs });
  await prisma.organization.deleteMany({ where: { id: walkthroughIds.club } });
  await prisma.organization.deleteMany({ where: { id: walkthroughIds.church } });
}

export async function readTemplateStates(prisma: PrismaClient): Promise<TemplateState[]> {
  const rows = await prisma.clubFormTemplate.findMany({ where: { key: { in: walkthroughTemplateKeys } }, select: { key: true, enabled: true, requirement: true, requiredRoles: true } });
  return rows.map((row) => ({ ...row, requiredRoles: row.requiredRoles as string[] }));
}

export async function restoreTemplateStates(prisma: PrismaClient, states: TemplateState[]) {
  for (const state of states) {
    await prisma.clubFormTemplate.updateMany({ where: { key: state.key }, data: { enabled: state.enabled, requirement: state.requirement, requiredRoles: state.requiredRoles as never } });
  }
}

/** Creates the club, its director account (no two-step sign-in), roster, open event, supplies and months to file. */
export async function createWalkthroughFixtures(prisma: PrismaClient) {
  const { clubYearFor } = await import("../../modules/club-rosters/domain");
  const { hashPassword } = await import("../../modules/access/passwords");
  const { registrationFormDefinitionSchema } = await import("../../modules/forms/definition");
  const now = new Date();
  const clubYear = clubYearFor(now);
  const day = 86_400_000;
  const iso = (offsetDays: number) => new Date(now.getTime() + offsetDays * day).toISOString().slice(0, 10);

  await prisma.organization.create({
    data: { id: walkthroughIds.church, type: "CHURCH", name: walkthroughDirector.churchName, normalizedName: walkthroughDirector.churchName.toLowerCase(), city: "Exampleville", state: "IA" },
  });
  await prisma.organization.create({
    data: { id: walkthroughIds.club, type: "CLUB", name: walkthroughDirector.clubName, normalizedName: walkthroughDirector.clubName.toLowerCase(), parentOrganizationId: walkthroughIds.church },
  });
  await prisma.clubProfile.create({
    data: { organizationId: walkthroughIds.club, meetingPlace: "Fellowship hall", meetingSchedule: "Sundays at 4 pm", contactEmail: `${W}.club@example.test`, contactPhone: "(515) 555-0100" },
  });

  // The director: a verified account with a password and NO two-step sign-in, so the first sign-in asks for the emailed code.
  await prisma.attendeeAccount.create({
    data: {
      id: walkthroughIds.director,
      email: walkthroughDirector.email,
      displayName: walkthroughDirector.displayName,
      firstName: walkthroughDirector.firstName,
      lastName: walkthroughDirector.lastName,
      status: "ACTIVE",
      emailVerifiedAt: now,
      credential: { create: { passwordHash: await hashPassword(walkthroughDirector.password) } },
    },
  });
  await prisma.attendeeAccount.create({
    data: { id: walkthroughInvitee.id, email: walkthroughInvitee.email, displayName: walkthroughInvitee.name, firstName: "Robin", lastName: "Sample", status: "ACTIVE", emailVerifiedAt: now },
  });
  await prisma.clubDirectorGrant.create({
    data: { organizationId: walkthroughIds.club, attendeeAccountId: walkthroughIds.director, role: "DIRECTOR", effectiveFrom: new Date("2026-01-01T00:00:00Z"), reason: "Synthetic help walkthrough" },
  });

  // Roster: a few clearly sample people.
  const levels = ["FRIEND", "COMPANION", "EXPLORER", "RANGER"] as const;
  const people = [
    ["Alex", "Sample"], ["Jamie", "Example"], ["Morgan", "Placeholder"], ["Riley", "Demo"], ["Quinn", "Testperson"], ["Sky", "Sampleton"], ["Drew", "Exampleson"], ["Kai", "Mockup"],
  ] as const;
  for (const [index, [firstName, lastName]] of people.entries()) {
    const staff = index >= 6;
    const person = await prisma.person.create({ data: { id: `${W}_person_${index + 1}`, firstName, lastName } });
    await prisma.clubRosterMember.create({
      data: {
        organizationId: walkthroughIds.club, clubYear, personId: person.id,
        attendeeType: staff ? "STAFF" : "YOUTH", role: staff ? "Counselor" : "Pathfinder", classLevel: staff ? null : levels[index % levels.length],
        reportedAge: staff ? 34 : 10 + (index % 5), gender: index % 2 === 0 ? "FEMALE" : "MALE", source: "DIRECTOR",
      },
    });
  }

  // Club forms: switch on a few templates for the new year (the script puts them back afterwards).
  await prisma.clubFormTemplate.updateMany({ where: { key: { in: ["pathfinder_membership_application", "off_premises_permission_slip", "club_tlt_application"] } }, data: { enabled: true } });
  await prisma.clubFormTemplate.updateMany({ where: { key: "can_collecting_report" }, data: { enabled: true, requirement: "ONCE_PER_CLUB_YEAR", requiredRoles: [] } });

  // An open club event with a one-section registration form.
  await prisma.event.create({
    data: {
      id: walkthroughIds.event, slug: walkthroughIds.eventSlug, name: "Sample Club Weekend",
      startsAt: new Date(`${iso(40)}T15:00:00Z`), endsAt: new Date(`${iso(41)}T22:00:00Z`), timezone: "America/Chicago",
      isPublished: true, registrationOpensOn: iso(-20), registrationClosesOn: iso(30),
      billingMode: "DEFERRED_ORGANIZATION_INVOICE", audience: "CLUB",
    },
  });
  const field = (id: string, key: string, label: string, type: string, scope: "ATTENDEE" | "REGISTRATION", required = false) =>
    ({ id: `${W}_${id}`, key, label, helpText: "", type, scope, required, options: [] });
  const definition = registrationFormDefinitionSchema.parse({
    title: "Sample club registration",
    description: "Sample form for the help walkthroughs.",
    confirmationMessage: "Your club is registered.",
    attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 50, attendeeLabel: "Club member", addButtonLabel: "Add" },
    sections: [
      { id: `${W}_contact`, title: "Contact", description: "", fields: [
        field("c_first", "primary_contact_first_name", "First name", "TEXT", "REGISTRATION", true),
        field("c_last", "primary_contact_last_name", "Last name", "TEXT", "REGISTRATION", true),
        field("c_email", "email", "Email", "EMAIL", "REGISTRATION", true),
      ] },
      { id: `${W}_roster`, title: "Roster", description: "", fields: [
        field("a_first", "first_name", "First name", "TEXT", "ATTENDEE", true),
        field("a_last", "last_name", "Last name", "TEXT", "ATTENDEE", true),
        field("a_age", "attendee_age", "Age", "NUMBER", "ATTENDEE", true),
      ] },
    ],
  });
  await prisma.registrationForm.create({
    data: {
      id: walkthroughIds.form, eventId: walkthroughIds.event, createdByUserId: "usr_system_admin", name: definition.title, slug: "club", status: "PUBLISHED",
      versions: { create: { id: `${W}_formver`, createdByUserId: "usr_system_admin", versionNumber: 1, status: "PUBLISHED", publishedAt: new Date(), definition } },
    },
  });

  // Supplies: a few sample catalog items, so the Orders page has something to pick.
  for (const [index, name] of supplyNames.entries()) {
    await prisma.clubSupplyItem.create({
      data: { id: `${W}_item_${index + 1}`, section: "INVESTITURE", name, normalizedName: name.toLowerCase(), catalogNumber: `9${String(index + 1).padStart(3, "0")}` },
    });
  }

  // Monthly Records: one filed month, the rest of the ended months left to file.
  const { pickedTotal, ON_TIME_POINTS, clubYearMonths } = await import("../../modules/club-reports/domain");
  const reportPoints = { staffMeeting: 25, meetingsOutings: 50, ratio: 25, uniformMeetings: 20, uniformOutside: 40, devotions: 50, exercise: 0, outreach: 50, guest: 0, honors: 25, classLevel: 25, bonus: 0 };
  const firstMonth = clubYearMonths(clubYear)[0];
  const filed: Prisma.ClubMonthlyReportUncheckedCreateInput = {
    organizationId: walkthroughIds.club, clubYear, reportMonth: firstMonth, meetingPlace: "Fellowship hall", meetingSchedule: "Sundays at 4 pm",
    averageAttendance: 8, pathfinderCount: 6, tltCount: 0, staffCount: 2, classLevels: ["FRIEND"], points: reportPoints, honors: [],
    onTimePoints: ON_TIME_POINTS, totalPoints: ON_TIME_POINTS + pickedTotal(reportPoints), signatureName: walkthroughDirector.displayName, signedOn: `${firstMonth}-10`,
    status: "SUBMITTED", submittedAt: new Date(`${firstMonth}-10T15:00:00Z`), firstSubmittedAt: new Date(`${firstMonth}-10T15:00:00Z`),
  };
  await prisma.clubMonthlyReport.create({ data: filed });
}

/**
 * Gives the director a placeholder authenticator enrolment, the way the mobile layout audit does. No code is ever checked:
 * the walkthrough session that follows is minted already second-step verified. Used for the walkthroughs that start
 * after two-step sign-in is set up. It is removed again with the rest of the fixtures.
 */
export async function enrolPlaceholderTwoStep(prisma: PrismaClient) {
  await prisma.attendeeMfaEnrollment.upsert({
    where: { accountId: walkthroughIds.director },
    update: { status: "ACTIVE" },
    create: { accountId: walkthroughIds.director, method: "TOTP", status: "ACTIVE", sealedSecret: `${W}-placeholder-not-a-secret`, confirmedAt: new Date() },
  });
}

/**
 * Switches passkeys on for the local app (the setting is a platform row, off by default). Returns what was there, so the
 * caller puts it back.
 */
export async function enablePasskeys(prisma: PrismaClient): Promise<string | null> {
  const row = await prisma.platformSettings.findUnique({ where: { id: "platform" }, select: { passkeyRpId: true } });
  if (!row) throw new Error("The platform settings row is missing. Run `npm run db:seed` on a local database first.");
  if (row.passkeyRpId !== "localhost") await prisma.platformSettings.update({ where: { id: "platform" }, data: { passkeyRpId: "localhost" } });
  return row.passkeyRpId;
}

export async function restorePasskeys(prisma: PrismaClient, before: string | null) {
  await prisma.platformSettings.update({ where: { id: "platform" }, data: { passkeyRpId: before } });
}

/** Clears the local sign-in and code-send budgets, so repeated runs are not rate limited. Local database only. */
export async function clearSignInRateLimits(prisma: PrismaClient) {
  await prisma.rateLimitBucket.deleteMany({ where: { policy: { contains: "sign-in" } } });
}
