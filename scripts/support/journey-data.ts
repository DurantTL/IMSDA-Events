/**
 * Synthetic data for the role journeys (#1439): `scripts/verify-club-journeys.ts` and, later, the other roles.
 *
 * Every id starts with "journeycheck_<stamp>_", where the stamp is unique per run (and the shard is part of it), so
 * runs and shards on one database never collide and cleanup only touches this run's rows. Nothing here is real:
 * names, emails (@example.test) and phones ("(515) 555-0100") are invented.
 *
 * LOCAL USE ONLY: `guardLocal()` in browser-journeys.ts must have passed before anything here runs.
 *
 * Part B (area coordinator) adds its own accounts through `seedAccount()` and its own clubs through `seedClub()`
 * with the same `JourneyWorld`, so cleanup stays in one place.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

export const JOURNEY_PREFIX = "journeycheck";

export type Director = {
  key: string;
  clubId: string;
  clubName: string;
  accountId: string;
  email: string;
  password: string;
};

export type JourneyWorld = {
  stamp: string;
  prefix: string;
  churchId: string;
  /** The main club director (also exposed as clubId/directorEmail/... below for the common case). */
  main: Director;
  directors: Director[];
  clubId: string;
  clubName: string;
  directorAccountId: string;
  directorEmail: string;
  directorPassword: string;
  templateIds: string[];
  supplyItemIds: string[];
  /** Area coordinator journeys (part B), set by `seedCoordinatorWorld`. */
  coordinator?: { accountId: string; email: string; submittedMonths: string[]; clubs: { missing: Director; complete: Director; outside: Director } };
  eventId: string;
  eventName: string;
  eventSlug: string;
  formId: string;
  formVersionId: string;
  /** Account ids, organization ids and person-name patterns this run created, for cleanup. */
  accountIds: string[];
  organizationIds: string[];
  eventIds: string[];
  rosterNames: Array<readonly [string, string]>;
};

export function newStamp(shard: string) {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}${shard.slice(0, 1)}`;
}

/** Surname marker every person made by this run carries, so cleanup finds them (also people the UI adds). */
export const personMarker = (stamp: string) => `Journey${stamp}`;

export async function seedAccount(prisma: PrismaClient, world: JourneyWorld, input: { id: string; email: string; first: string; last: string; password: string }) {
  const { hashPassword } = await import("../../modules/access/passwords");
  const now = new Date();
  const passwordHash = await hashPassword(input.password);
  await prisma.attendeeAccount.create({
    data: {
      id: input.id, email: input.email, displayName: `${input.first} ${input.last}`, firstName: input.first, lastName: input.last,
      status: "ACTIVE", emailVerifiedAt: now, credential: { create: { passwordHash } },
    },
  });
  world.accountIds.push(input.id);
}

export async function seedClub(prisma: PrismaClient, world: JourneyWorld, input: { id: string; name: string; churchId: string }) {
  await prisma.organization.create({
    data: { id: input.id, type: "CLUB", name: input.name, normalizedName: input.name.toLowerCase(), parentOrganizationId: input.churchId, isActive: true },
  });
  await prisma.clubProfile.create({
    data: { organizationId: input.id, meetingPlace: "Fellowship hall", meetingSchedule: "Saturdays after lunch", contactEmail: `${input.id}@example.test`, contactPhone: "(515) 555-0100" },
  });
  world.organizationIds.push(input.id);
}

function rosterNamesFor(stamp: string) {
  const marker = personMarker(stamp);
  return [["Alma", `${marker}-Alder`], ["Beto", `${marker}-Bravo`], ["Cleo", `${marker}-Cedar`], ["Dario", `${marker}-Delta`], ["Elena", `${marker}-Echo`]] as Array<readonly [string, string]>;
}

/**
 * A club with its own director account (a known password and NO two-step: the journey sets it up) and a small roster.
 * `key` keeps ids apart ("main", "translate", "blockers", and later the coordinator's clubs).
 */
export async function seedDirector(prisma: PrismaClient, world: JourneyWorld, key: string, clubYear: string, rosterSize: number): Promise<Director> {
  const marker = personMarker(world.stamp);
  const director: Director = {
    key, clubId: `${world.prefix}_${key}_club`, clubName: `Journey ${key === "main" ? "Trailblazers" : `Trailblazers ${key}`} ${world.stamp}`,
    accountId: `${world.prefix}_${key}_director`, email: `${JOURNEY_PREFIX}.${world.stamp}.${key}@example.test`,
    // Long and unusual so the password rules (and the breach list) accept it.
    password: `Quartz-Meadow-${world.stamp}-${key}-Lantern-47`,
  };
  await seedClub(prisma, world, { id: director.clubId, name: director.clubName, churchId: world.churchId });
  await seedAccount(prisma, world, { id: director.accountId, email: director.email, first: "Dana", last: `${marker}-Director`, password: director.password });
  await prisma.clubDirectorGrant.create({
    data: { organizationId: director.clubId, attendeeAccountId: director.accountId, role: "DIRECTOR", effectiveFrom: new Date("2026-01-01T00:00:00Z"), reason: "Synthetic browser journey check" },
  });
  for (const [index, [firstName, lastName]] of world.rosterNames.slice(0, rosterSize).entries()) {
    const personId = `${world.prefix}_${key}_person_${index}`;
    await prisma.person.create({ data: { id: personId, firstName, lastName } });
    await prisma.clubRosterMember.create({
      data: {
        organizationId: director.clubId, clubYear, personId,
        attendeeType: index === 4 ? "STAFF" : "YOUTH", role: index === 4 ? "Counselor" : "Pathfinder",
        classLevel: index === 4 ? null : "FRIEND", reportedAge: index === 4 ? 34 : 11 + index, gender: index % 2 === 0 ? "FEMALE" : "MALE", source: "DIRECTOR",
      },
    });
  }
  return director;
}

/** What the conference does between two visits: turns on a yearly form the club fills in itself. Global, so it carries this run's id. */
export async function seedClubFormTemplate(prisma: PrismaClient, world: JourneyWorld) {
  const key = `${world.prefix}_form`;
  const id = `${world.prefix}_template`;
  const definition = {
    title: `Journey cans report ${world.stamp}`,
    description: "",
    confirmationMessage: "Received.",
    sections: [{
      id: `${world.prefix}_cans`, title: "Cans collected", description: "",
      fields: [
        { id: `${world.prefix}_cans_where`, key: "collection_place", type: "TEXT", label: "Where did the club collect?", scope: "REGISTRATION", options: [], helpText: "", required: true },
        { id: `${world.prefix}_cans_count`, key: "cans_collected", type: "NUMBER", label: "Cans collected", scope: "REGISTRATION", options: [], helpText: "", required: true },
      ],
    }],
  };
  const existing = await prisma.clubFormTemplate.findUnique({ where: { id }, select: { id: true } });
  if (existing) return { key, name: definition.title };
  await prisma.clubFormTemplate.create({
    data: { id, key, name: definition.title, description: "A synthetic form used only by the browser journey checks.", version: 1, definition, fillMode: "CLUB", enabled: true, enabledAt: new Date(), sortOrder: 9_999 },
  });
  world.templateIds.push(id);
  return { key, name: definition.title };
}

/** A supply catalog item, as conference staff would load it. Global, so it carries this run's stamp. */
export async function seedSupplyItem(prisma: PrismaClient, world: JourneyWorld) {
  const name = `Journey camporee patch ${world.stamp}`;
  const existing = await prisma.clubSupplyItem.findFirst({ where: { section: "CAMPOREES", normalizedName: name.toLowerCase() }, select: { id: true } });
  if (!existing) {
    const created = await prisma.clubSupplyItem.create({ data: { section: "CAMPOREES", name, normalizedName: name.toLowerCase(), catalogNumber: "990001" }, select: { id: true } });
    world.supplyItemIds.push(created.id);
  }
  return { name };
}

export async function seedJourneyWorld(prisma: PrismaClient, shard: string): Promise<JourneyWorld> {
  const { clubYearFor } = await import("../../modules/club-rosters/domain");
  const { registrationFormDefinitionSchema } = await import("../../modules/forms/definition");
  const stamp = newStamp(shard);
  const prefix = `${JOURNEY_PREFIX}_${stamp}`;
  const world: JourneyWorld = {
    stamp, prefix,
    churchId: `${prefix}_church`, main: undefined as unknown as Director, directors: [], templateIds: [], supplyItemIds: [],
    clubId: "", clubName: "", directorAccountId: "", directorEmail: "", directorPassword: "",
    eventId: `${prefix}_event`, eventName: `Journey Spring Camporee ${stamp}`, eventSlug: `${JOURNEY_PREFIX}-${stamp}-camporee`,
    formId: `${prefix}_form`, formVersionId: `${prefix}_formver`,
    accountIds: [], organizationIds: [], eventIds: [],
    rosterNames: rosterNamesFor(stamp),
  };
  const staff = await prisma.user.findUnique({ where: { email: "admin@imsda-events.test" }, select: { id: true } });
  if (!staff) throw new Error("This is not a seeded dev database (admin@imsda-events.test is missing). Run `npm run db:seed` first.");

  const clubYear = clubYearFor(new Date());
  await prisma.organization.create({
    data: { id: world.churchId, type: "CHURCH", name: `Journey Prairie Church ${stamp}`, normalizedName: `journey prairie church ${stamp}`, city: "Testville", state: "IA" },
  });
  world.organizationIds.push(world.churchId);
  world.main = await seedDirector(prisma, world, "main", clubYear, 5);
  world.directors.push(world.main);
  // Two more directors for the translated-page and blocked-request runs of the key journey (their own clubs, so the
  // two-step setup and the emailed code are not shared).
  for (const key of ["translate", "blockers"]) world.directors.push(await seedDirector(prisma, world, key, clubYear, 5));
  Object.assign(world, { clubId: world.main.clubId, clubName: world.main.clubName, directorAccountId: world.main.accountId, directorEmail: world.main.email, directorPassword: world.main.password });

  // A club event that is open now: a published form that collects a list of attendees, billed to the club afterwards.
  const day = 86_400_000;
  const now = Date.now();
  const iso = (offset: number) => new Date(now + offset * day).toISOString().slice(0, 10);
  await prisma.event.create({
    data: {
      id: world.eventId, slug: world.eventSlug, name: world.eventName, startsAt: new Date(now + 30 * day), endsAt: new Date(now + 32 * day),
      isPublished: true, audience: "CLUB", billingMode: "DEFERRED_ORGANIZATION_INVOICE", timezone: "America/Chicago", location: "Fictitious verification venue",
      registrationOpensOn: iso(-10), registrationClosesOn: iso(20), supportContact: "registration@imsda.org",
    },
  });
  world.eventIds.push(world.eventId);
  const definition = registrationFormDefinitionSchema.parse({
    title: "Journey camporee registration",
    description: "A synthetic form used only by the browser journey checks.",
    confirmationMessage: "Received.",
    attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 50, attendeeLabel: "Attendee", addButtonLabel: "Add another attendee" },
    sections: [
      {
        id: `${prefix}_contact`, title: "Contact", description: "", fields: [
          { id: `${prefix}_f_first`, key: "primary_contact_first_name", label: "First name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
          { id: `${prefix}_f_last`, key: "primary_contact_last_name", label: "Last name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
          { id: `${prefix}_f_email`, key: "email", label: "Email", helpText: "", type: "EMAIL", scope: "REGISTRATION", required: true, options: [] },
        ],
      },
      {
        id: `${prefix}_attendees`, title: "Attendees", description: "", fields: [
          { id: `${prefix}_a_first`, key: "first_name", label: "First name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
          { id: `${prefix}_a_last`, key: "last_name", label: "Last name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
        ],
      },
    ],
  });
  await prisma.registrationForm.create({
    data: {
      id: world.formId, eventId: world.eventId, createdByUserId: staff.id, name: definition.title, slug: `${JOURNEY_PREFIX}-${stamp}-registration`, status: "PUBLISHED",
      versions: { create: { id: world.formVersionId, createdByUserId: staff.id, versionNumber: 1, status: "PUBLISHED", publishedAt: new Date(), definition } },
    },
  });
  return world;
}

/* -------------------------------------------------------------- cleanup */

type ModelInfo = { name: string; fields: Array<{ name: string; kind: string; type: string }> };

/** Deletes rows whose `field` is in `ids` from every model that has that scalar field. Repeats until no more can go (foreign keys). */
async function sweepField(prisma: PrismaClient, field: string, ids: string[], skip: string[] = []) {
  if (ids.length === 0) return;
  const models = (Prisma.dmmf.datamodel.models as unknown as ModelInfo[]).filter(
    (model) => !skip.includes(model.name) && model.fields.some((f) => f.name === field && f.kind === "scalar" && f.type === "String"),
  );
  let pending = models.map((model) => model.name);
  for (let pass = 0; pass < 6 && pending.length > 0; pass += 1) {
    const next: string[] = [];
    for (const name of pending) {
      const delegate = (prisma as unknown as Record<string, { deleteMany(args: unknown): Promise<unknown> }>)[name.charAt(0).toLowerCase() + name.slice(1)];
      try {
        await delegate.deleteMany({ where: { [field]: { in: ids } } });
      } catch {
        next.push(name);
      }
    }
    if (next.length === pending.length) break;
    pending = next;
  }
}

/** Best effort: every step is tried, none stops the others. Only this run's rows (by id and by name marker) are removed. */
export async function cleanupJourneyWorld(prisma: PrismaClient, world: JourneyWorld) {
  const marker = personMarker(world.stamp);
  const run = async (name: string, step: () => Promise<unknown>) => {
    await step().catch((error: Error) => console.error(`cleanup (${name}): ${error.message.split("\n").slice(-2).join(" ").slice(0, 160)}`));
  };
  const registrations = (await prisma.registration.findMany({ where: { eventId: { in: world.eventIds } }, select: { id: true } }).catch(() => [])).map((row) => row.id);
  const people = (await prisma.person.findMany({ where: { OR: [{ id: { startsWith: `${world.prefix}_` } }, { lastName: { startsWith: marker } }] }, select: { id: true } }).catch(() => [])).map((row) => row.id);
  await run("messages", async () => {
    await prisma.messageOutbox.deleteMany({ where: { OR: [{ registrationId: { in: registrations } }, { recipientEmail: { contains: world.stamp } }] } });
  });
  await run("audit", () => prisma.auditLog.deleteMany({ where: { OR: [{ eventId: { in: world.eventIds } }, { entityId: { in: [...registrations, ...world.organizationIds, ...world.accountIds] } }] } }));
  await run("registrations", async () => {
    await sweepField(prisma, "registrationId", registrations, ["Registration"]);
    await sweepField(prisma, "eventId", world.eventIds, ["Event"]);
    await prisma.registration.deleteMany({ where: { id: { in: registrations } } });
  });
  await run("sessions", () => prisma.attendeeSession.deleteMany({ where: { accountId: { in: world.accountIds } } }));
  await run("by organization", async () => {
    const submissions = (await prisma.clubFormSubmission.findMany({ where: { organizationId: { in: world.organizationIds } }, select: { id: true } })).map((row) => row.id);
    await sweepField(prisma, "submissionId", submissions);
    await prisma.clubFormSubmission.deleteMany({ where: { id: { in: submissions } } });
    await sweepField(prisma, "organizationId", world.organizationIds, ["Organization"]);
    await sweepField(prisma, "attendeeAccountId", world.accountIds, ["AttendeeAccount"]);
    await sweepField(prisma, "accountId", world.accountIds, ["AttendeeAccount"]);
    await sweepField(prisma, "personId", people, ["Person"]);
  });
  await run("supply catalog", async () => {
    await sweepField(prisma, "itemId", world.supplyItemIds);
    await prisma.clubSupplyItem.deleteMany({ where: { id: { in: world.supplyItemIds } } });
  });
  await run("club form template", async () => {
    // A first submission records a frozen version row that restricts deleting the template.
    await sweepField(prisma, "templateId", world.templateIds, ["ClubFormTemplate"]);
    await prisma.clubFormTemplate.deleteMany({ where: { id: { in: world.templateIds } } });
  });
  await run("event", async () => {
    await prisma.registrationFormVersion.deleteMany({ where: { id: world.formVersionId } });
    await prisma.registrationForm.deleteMany({ where: { id: world.formId } });
    await prisma.event.deleteMany({ where: { id: { in: world.eventIds } } });
  });
  await run("people", () => prisma.person.deleteMany({ where: { id: { in: people } } }));
  await run("accounts", () => prisma.attendeeAccount.deleteMany({ where: { id: { in: world.accountIds } } }));
  await run("organizations", async () => {
    // The club first (it points at its church), then the church.
    await prisma.organization.deleteMany({ where: { id: { in: world.organizationIds }, type: "CLUB" } });
    await prisma.organization.deleteMany({ where: { id: { in: world.organizationIds } } });
  });
}

/**
 * The emailed-code budget is 20 per hour per address and 6 per hour per account (modules/rate-limit/service.ts). One
 * run uses a handful, but several local runs in an hour would hit it and the code email would never be sent. On the
 * local database only, this forgets the account sign-in budgets before a run (a real person is never affected).
 */
export async function resetSignInBudgets(prisma: PrismaClient) {
  await prisma.rateLimitBucket.deleteMany({ where: { policy: { startsWith: "attendee." } } });
}

/**
 * Area coordinator world (part B): a coordinator account (a placeholder two-step enrollment, so a minted session passes
 * the club gate; sign-in itself is covered by the director journey) and three more clubs with their own directors:
 * "missing" has no monthly record at all, "complete" has a submitted record for every month so far this club year,
 * and "outside" stands for a club the coordinator is not responsible for. Coordinators see every active club by design
 * (#387, modules/organizations/area-coordinators.ts), so "outside" is expected to be listed; the journey asserts that.
 */
export async function seedCoordinatorWorld(prisma: PrismaClient, world: JourneyWorld) {
  const { clubYearFor } = await import("../../modules/club-rosters/domain");
  const { clubYearMonths } = await import("../../modules/club-reports/domain");
  const now = new Date();
  const clubYear = clubYearFor(now);
  const clubs = {
    missing: await seedDirector(prisma, world, "areamissing", clubYear, 3),
    complete: await seedDirector(prisma, world, "areacomplete", clubYear, 4),
    outside: await seedDirector(prisma, world, "areaoutside", clubYear, 2),
  };
  const accountId = `${world.prefix}_coordinator`;
  const email = `${JOURNEY_PREFIX}.${world.stamp}.coordinator@example.test`;
  await seedAccount(prisma, world, { id: accountId, email, first: "Casey", last: `${personMarker(world.stamp)}-Coordinator`, password: `Quartz-Meadow-${world.stamp}-coordinator-Lantern-47` });
  await prisma.attendeeMfaEnrollment.create({ data: { accountId, method: "TOTP", status: "ACTIVE", sealedSecret: `${JOURNEY_PREFIX}-placeholder-not-a-secret`, confirmedAt: now } });
  await prisma.areaCoordinatorGrant.create({ data: { attendeeAccountId: accountId } });
  const current = now.toISOString().slice(0, 7);
  const submittedMonths = clubYearMonths(clubYear).filter((entry) => entry <= current);
  for (const month of submittedMonths) {
    await prisma.clubMonthlyReport.create({
      data: {
        organizationId: clubs.complete.clubId, clubYear, reportMonth: month, meetingPlace: "Fellowship hall", averageAttendance: 12, pathfinderCount: 8, tltCount: 1, staffCount: 3,
        points: {}, honors: [], onTimePoints: 25, totalPoints: 25, signatureName: "Dana Director", signedOn: now.toISOString().slice(0, 10), status: "SUBMITTED", submittedAt: now, firstSubmittedAt: now,
      },
    });
  }
  world.coordinator = { accountId, email, submittedMonths, clubs };
  return world.coordinator;
}
