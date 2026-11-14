/**
 * The synthetic data the visual check (#1774) needs on top of the seed: a church and club with a small roster, a director
 * and an Area Coordinator account, a plain attendee with one registration for the seeded Women's Retreat, and two filed
 * monthly records. Everything is fixed (ids start with "visualcheck_", names and dates are written out), so two runs on a
 * freshly seeded database give the same pictures. Idempotent: it upserts, so running it twice changes nothing.
 *
 * Then `normalizeTimestamps` pulls every time the database wrote with its own real clock back to the fixed time, because
 * a column default (`now()`) ignores the fixed clock of the app and would put today's real date on the pages.
 *
 * Local only: callers run assertLocalDatabase and assertSeededDatabase first. Synthetic data only: example.test emails
 * and 555-01xx phone numbers.
 */
import type { PrismaClient } from "@prisma/client";
import { VISUAL_FIXED_NOW, visualFixtureIds } from "../visual/pages";

export const visualAccounts = {
  director: "visualcheck_account_director",
  area: "visualcheck_account_area",
  attendee: "visualcheck_account_attendee",
} as const;

const { club, church, reportMonth, eventId } = visualFixtureIds;
const effectiveFrom = new Date("2026-01-01T00:00:00Z");
const filedAt = new Date("2026-09-02T15:00:00Z");

const roster = [
  { first: "Avery", last: "Lindqvist", type: "YOUTH", role: "Pathfinder", level: "FRIEND", age: 10, gender: "FEMALE" },
  { first: "Blake", last: "Okafor", type: "YOUTH", role: "Pathfinder", level: "COMPANION", age: 11, gender: "MALE" },
  { first: "Cameron", last: "Reyes", type: "YOUTH", role: "Pathfinder", level: "EXPLORER", age: 12, gender: "MALE" },
  { first: "Devon", last: "Hartwell", type: "YOUTH", role: "Pathfinder", level: "RANGER", age: 13, gender: "FEMALE" },
  { first: "Emerson", last: "Tanaka", type: "YOUTH", role: "Pathfinder", level: "VOYAGER", age: 14, gender: "FEMALE" },
  { first: "Parker", last: "Delacroix", type: "STAFF", role: "Counselor", level: null, age: 34, gender: "MALE" },
] as const;

/** Writes the fixture. Safe to run again. */
export async function seedVisualFixture(prisma: PrismaClient) {
  const { clubYearFor } = await import("../../modules/club-rosters/domain");
  const clubYear = clubYearFor(new Date(VISUAL_FIXED_NOW));
  const verifiedAt = new Date("2026-01-15T12:00:00Z");

  await prisma.organization.upsert({
    where: { id: church },
    update: {},
    create: { id: church, type: "CHURCH", name: "Elm Ridge Church", normalizedName: "elm ridge church", city: "Testville", state: "IA" },
  });
  await prisma.organization.upsert({
    where: { id: club },
    update: {},
    create: { id: club, type: "CLUB", name: "Elm Ridge Pathfinders", normalizedName: "elm ridge pathfinders", parentOrganizationId: church },
  });
  await prisma.clubProfile.upsert({
    where: { organizationId: club },
    update: {},
    create: { organizationId: club, meetingPlace: "Fellowship hall", meetingSchedule: "Sundays at 4 pm", contactEmail: "elm.ridge@example.test", contactPhone: "(515) 555-0101" },
  });

  const accounts = [
    { id: visualAccounts.director, email: "visualcheck.director@example.test", displayName: "Dana Whitfield", firstName: "Dana", lastName: "Whitfield" },
    { id: visualAccounts.area, email: "visualcheck.area@example.test", displayName: "Morgan Ellsworth", firstName: "Morgan", lastName: "Ellsworth" },
    { id: visualAccounts.attendee, email: "visualcheck.attendee@example.test", displayName: "Casey Visualcheck", firstName: "Casey", lastName: "Visualcheck" },
  ];
  for (const account of accounts) {
    await prisma.attendeeAccount.upsert({
      where: { id: account.id },
      update: { status: "ACTIVE", disabledAt: null },
      create: { ...account, status: "ACTIVE", emailVerifiedAt: verifiedAt },
    });
    // Minted sessions skip the second step; an enrolled authenticator (a placeholder secret, never checked) opens the pages that need one.
    await prisma.attendeeMfaEnrollment.upsert({
      where: { accountId: account.id },
      update: { status: "ACTIVE" },
      create: { accountId: account.id, method: "TOTP", status: "ACTIVE", sealedSecret: "visualcheck-placeholder-not-a-secret", confirmedAt: verifiedAt },
    });
  }
  if (!(await prisma.clubDirectorGrant.findFirst({ where: { organizationId: club, attendeeAccountId: visualAccounts.director, revokedAt: null } }))) {
    await prisma.clubDirectorGrant.create({
      data: { organizationId: club, attendeeAccountId: visualAccounts.director, role: "DIRECTOR", effectiveFrom, reason: "Synthetic visual check" },
    });
  }
  await prisma.areaCoordinatorGrant.upsert({
    where: { attendeeAccountId: visualAccounts.area },
    update: { revokedAt: null, expiresAt: null },
    create: { attendeeAccountId: visualAccounts.area, grantedAt: effectiveFrom },
  });

  for (const [index, member] of roster.entries()) {
    const personId = `visualcheck_person_${index + 1}`;
    await prisma.person.upsert({
      where: { id: personId },
      update: {},
      create: { id: personId, firstName: member.first, lastName: member.last },
    });
    await prisma.clubRosterMember.upsert({
      where: { organizationId_clubYear_personId: { organizationId: club, clubYear, personId } },
      update: {},
      create: {
        organizationId: club, clubYear, personId, attendeeType: member.type, role: member.role,
        classLevel: member.level, reportedAge: member.age, gender: member.gender, source: "DIRECTOR",
      },
    });
  }

  // Two filed monthly records. The saved answers add up to the stored total, as the form would save them.
  const { pickedTotal, ON_TIME_POINTS } = await import("../../modules/club-reports/domain");
  const points = { staffMeeting: 25, meetingsOutings: 50, ratio: 25, uniformMeetings: 20, uniformOutside: 40, devotions: 50, exercise: 0, outreach: 50, guest: 0, honors: 25, classLevel: 25, bonus: 0 };
  for (const [month, submittedAt, signedOn] of [[reportMonth, filedAt, "2026-09-02"], ["2026-07", new Date("2026-08-03T15:00:00Z"), "2026-08-03"]] as const) {
    const data = {
      organizationId: club, clubYear, reportMonth: month, meetingPlace: "Fellowship hall", meetingSchedule: "Sundays at 4 pm",
      averageAttendance: 5, pathfinderCount: 5, tltCount: 0, staffCount: 1, classLevels: ["FRIEND" as const], points,
      honors: [{ name: "Camping Skills I", participants: 3 }],
      onTimePoints: ON_TIME_POINTS, totalPoints: ON_TIME_POINTS + pickedTotal(points), signatureName: "Dana Whitfield", signedOn,
      status: "SUBMITTED" as const, submittedAt, firstSubmittedAt: submittedAt,
    };
    await prisma.clubMonthlyReport.upsert({
      where: { organizationId_reportMonth: { organizationId: club, reportMonth: month } },
      update: data,
      create: data,
    });
  }

  // The seeded Women's Retreat form is a draft in the seed; publish it so the registration form step shows the form.
  await prisma.registrationForm.updateMany({ where: { id: "form_wr26_registration" }, data: { status: "PUBLISHED" } });
  await prisma.registrationFormVersion.updateMany({ where: { id: "formver_wr26_registration_1" }, data: { status: "PUBLISHED", publishedAt: new Date("2026-06-04T15:00:00Z") } });

  // The attendee holds one confirmed registration for the seeded Women's Retreat. The account finds it by the holder's email.
  const email = "visualcheck.attendee@example.test";
  await prisma.person.upsert({
    where: { id: "visualcheck_person_holder" },
    update: {},
    create: { id: "visualcheck_person_holder", firstName: "Casey", lastName: "Visualcheck", normalizedEmail: email, phone: "(515) 555-0102" },
  });
  await prisma.registration.upsert({
    where: { id: "visualcheck_registration" },
    update: {},
    create: {
      id: "visualcheck_registration", eventId, accountHolderPersonId: "visualcheck_person_holder", confirmationCode: "VISUAL-0001",
      status: "CONFIRMED", totalAmount: 175, submittedAt: new Date("2026-08-20T15:00:00Z"),
      contactSnapshot: { firstName: "Casey", lastName: "Visualcheck", email, phone: "(515) 555-0102" },
    },
  });
  await prisma.registrationAttendee.upsert({
    where: { registrationId_personId: { registrationId: "visualcheck_registration", personId: "visualcheck_person_holder" } },
    update: {},
    create: {
      id: "visualcheck_registration_attendee", eventId, registrationId: "visualcheck_registration", personId: "visualcheck_person_holder",
      attendeeType: "ADULT", position: 0, profileSnapshot: { firstName: "Casey", lastName: "Visualcheck", email, phone: "(515) 555-0102" },
    },
  });
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

/**
 * Sets every time column the database fills in by itself (a `now()` default, or `updatedAt`) back to the fixed time when it
 * is later than it. The app's own clock is fixed, but the database's is not, so without this the pages would show the real
 * date of the run. Returns how many rows it moved and which columns it could not change.
 */
export async function normalizeTimestamps(prisma: PrismaClient) {
  const columns = await prisma.$queryRawUnsafe<Array<{ table_schema: string; table_name: string; column_name: string; data_type: string }>>(`
    SELECT c.table_schema, c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE'
      AND c.table_name <> '_prisma_migrations'
      AND c.data_type IN ('timestamp without time zone', 'timestamp with time zone')
      AND (c.column_default ILIKE '%CURRENT_TIMESTAMP%' OR c.column_default ILIKE '%now()%' OR c.column_name = 'updatedAt')
    ORDER BY c.table_name, c.column_name`);
  // The fixed time as a UTC instant. A plain timestamp holds UTC wall-clock time (Prisma writes UTC); a timestamptz is compared
  // and set as an instant, so the session's time zone never matters.
  const fixed = new Date(VISUAL_FIXED_NOW).toISOString();
  let moved = 0;
  const skipped: string[] = [];
  for (const column of columns) {
    const table = `${quote(column.table_schema)}.${quote(column.table_name)}`;
    const name = quote(column.column_name);
    const value = column.data_type === "timestamp with time zone" ? "$1::timestamptz" : "($1::timestamptz AT TIME ZONE 'UTC')";
    try {
      moved += await prisma.$executeRawUnsafe(`UPDATE ${table} SET ${name} = ${value} WHERE ${name} > ${value}`, fixed);
    } catch {
      skipped.push(`${column.table_name}.${column.column_name}`);
    }
  }
  return { columns: columns.length, moved, skipped };
}
