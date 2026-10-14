/**
 * Proves the general registration link (#931) against a real PostgreSQL database: a club director with no account registers a
 * Pathfinder Bible Experience team through one public link, and the team is matched to the club they pick.
 *
 * - the PBE starter turns the link on, and the setting can be turned off and on (only for a club event billed to the church);
 * - the submitted director email, in any case, matching a current director or deputy of the picked club attaches the team at
 *   once as an ordinary club registration (church-billed, reports, check-in, print form, the director's portal view), its
 *   people recorded as extra people; a registrar, a revoked or expired role, a disabled account, another club's director, or
 *   "Not listed" does not match;
 * - an unmatched team waits as a pending submission that is in no club count, invoice, report or check-in list, notifies staff and
 *   the director, and then staff confirm it, attach it to another club, or reject it; every outcome is audited with ids only;
 * - confirm, reassign and reject are safe under concurrency (one winner, one registration), and a repeated click is harmless;
 * - the team rules (2 to 7 members, 1 alternate, age on 2026-01-01, a unique team name) are enforced on the server, a waiting
 *   team's name is reserved, and racing submissions for one name give one winner;
 * - two teams of one club go through one link; the generic public route refuses a club form; the honeypot, the rate limit and the
 *   idempotency key hold; the director can link an extra person to the roster without changing the registration.
 * - the screen never says which path was taken: a matching and a non-matching email get identical answers, and every refusal that
 *   does not depend on the email (bad site, closed, full, duplicate team name, team rules, the hourly cap) is identical for both;
 *   a waiting team's name is reserved against the club portal too; staff see the members' names, not the audit; one email goes to a
 *   matched director, staff get a digest; old waiting teams are expired 30 days after the event.
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:general-link-registration
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient, RegistrationFormStatus } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-general-link-synthetic-key-not-a-secret");
fillBlankSyntheticEnv("RATE_LIMIT_HASH_SECRET", "verify-general-link-synthetic-rate-limit-hash-secret");

const prisma = new PrismaClient();
const P = `gl_${randomUUID().slice(0, 8)}`;
const S = P.replace(/_/g, "-");
const staffUserId = `${P}_staff`;
const otherStaffId = `${P}_staff2`;
const generalEventId = `${P}_general_event`;
const clubOf = (key: string) => `${P}_club_${key}`;
const churchId = `${P}_church`;
const accountOf = (key: string) => `${P}_acct_${key}`;
const emailOf = (key: string) => `gl-${key}-${P.slice(3)}@example.test`;
const now = new Date("2026-10-20T15:00:00Z");
const staffNoticeEmail = `gl-staff-${P.slice(3)}@example.test`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function caught(promise: Promise<unknown>) {
  return promise.then(() => null, (error: unknown) => error);
}

async function expectCode(promise: Promise<unknown>, code: string, message: string, includes: string[] = []) {
  const error = await caught(promise);
  const found = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
  assert(found === code, `${message}: expected ${code}, got ${String(error)}`);
  for (const text of includes) assert(String((error as Error).message).includes(text), `${message}: the message should say "${text}", got "${(error as Error).message}"`);
}

const dbError = (error: unknown) => (error instanceof Error ? error.message : String(error));

let templateIdsBefore = new Set<string>();

async function cleanup() {
  const events = await prisma.event.findMany({ where: { OR: [{ id: { startsWith: `${P}_` } }, { slug: { startsWith: `${S}-` } }] }, select: { id: true } });
  const eventIds = [...new Set([...events.map((event) => event.id), generalEventId])];
  const registrationIds = (await prisma.registration.findMany({ where: { eventId: { in: eventIds } }, select: { id: true } })).map((row) => row.id);
  await prisma.messageOutbox.deleteMany({ where: { OR: [{ registrationId: { in: registrationIds } }, { eventId: { in: eventIds } }] } });
  // Amendment records are immutable by trigger; this script's own synthetic rows are removed with the trigger off for that
  // one transaction, and it is back on before anything else can write.
  await prisma.$transaction([
    prisma.$executeRawUnsafe('ALTER TABLE "RegistrationOperation" DISABLE TRIGGER "RegistrationOperation_immutable"'),
    prisma.registrationOperation.deleteMany({ where: { eventId: { in: eventIds } } }),
    prisma.$executeRawUnsafe('ALTER TABLE "RegistrationOperation" ENABLE TRIGGER "RegistrationOperation_immutable"'),
  ]);
  await prisma.auditLog.deleteMany({ where: { OR: [{ eventId: { in: eventIds } }, { actorUserId: { in: [staffUserId, otherStaffId] } }] } });
  await prisma.generalLinkSubmission.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.clubRegistrationDraft.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.clubEventRegistration.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.registration.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventTemplateApplication.deleteMany({ where: { actorUserId: staffUserId } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  const templates = await prisma.eventTemplate.findMany({ where: { createdByUserId: staffUserId }, select: { id: true } });
  const created = templates.map((template) => template.id).filter((id) => !templateIdsBefore.has(id));
  await prisma.eventTemplateVersion.deleteMany({ where: { templateId: { in: created } } });
  await prisma.eventTemplate.deleteMany({ where: { id: { in: created } } });
  await prisma.clubRosterMember.deleteMany({ where: { organizationId: { startsWith: `${P}_` } } });
  await prisma.clubDirectorGrant.deleteMany({ where: { organizationId: { startsWith: `${P}_club_` } } });
  await prisma.organization.deleteMany({ where: { id: { startsWith: `${P}_club_` } } });
  await prisma.organization.deleteMany({ where: { id: churchId } });
  await prisma.person.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.person.deleteMany({ where: { normalizedEmail: { contains: P.slice(3) } } });
  await prisma.person.deleteMany({ where: { firstName: { startsWith: "Gl" } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.user.deleteMany({ where: { id: { in: [staffUserId, otherStaffId] } } });
}

async function main() {
  const club = await import("../modules/club-registrations/repository");
  const link = await import("../modules/general-link-registrations/repository");
  const { linkExtraPersonToRoster } = await import("../modules/general-link-registrations/roster-link");
  const { addStarterEventTemplates } = await import("../modules/event-templates/starter-repository");
  const { applyEventTemplate } = await import("../modules/event-templates/repository");
  const { loadFilledTeamForm } = await import("../modules/club-teams/team-form-repository");
  const { sealBirthDate } = await import("../modules/club-rosters/birth-dates");
  const { submitPublicRegistration } = await import("../modules/forms/public-repository");
  const { generalLinkPath } = await import("../modules/general-link-registrations/domain");
  const { getPublicEventLanding } = await import("../modules/events/public-repository");

  templateIdsBefore = new Set((await prisma.eventTemplate.findMany({ select: { id: true } })).map((row) => row.id));
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: staffUserId, email: `${P}-staff@example.test`, displayName: "GL Check Staff", globalRole: "SYSTEM_ADMIN" },
      { id: otherStaffId, email: `${P}-staff2@example.test`, displayName: "GL Check Staff Two", globalRole: "SYSTEM_ADMIN" },
    ],
  });
  await prisma.organization.create({ data: { id: churchId, type: "CHURCH", name: `Gl Church ${P}`, normalizedName: `gl church ${P}` } });
  const clubKeys = ["a", "b", "c", "d", "e", "f", "g"] as const;
  await prisma.organization.createMany({
    data: clubKeys.map((key) => ({ id: clubOf(key), type: "CLUB" as const, name: `Gl Club ${key} ${P}`, normalizedName: `gl club ${key} ${P}`, parentOrganizationId: churchId })),
  });
  const clubName = (key: string) => `Gl Club ${key} ${P}`;

  // Directors and deputies on file. The match is by the picked club and a current DIRECTOR or DEPUTY grant on an account that
  // is not shut out. Emails are stored lowercase; the submitted one is compared case-insensitively.
  const day = 24 * 60 * 60 * 1000;
  const account = (key: string, extra: { disabledAt?: Date } = {}) => prisma.attendeeAccount.create({
    data: { id: accountOf(key), email: emailOf(key), displayName: `Gl ${key}`, status: "ACTIVE", emailVerifiedAt: new Date(), ...extra },
    select: { id: true },
  });
  const grant = (key: string, organization: string, role: "DIRECTOR" | "DEPUTY" | "REGISTRAR" | "REPORTER", extra: { revokedAt?: Date; effectiveTo?: Date; effectiveFrom?: Date } = {}) => prisma.clubDirectorGrant.create({
    data: { organizationId: clubOf(organization), attendeeAccountId: accountOf(key), role, reason: "Synthetic grant for the general link check.", effectiveFrom: new Date(now.getTime() - 30 * day), ...extra },
  });
  for (const key of ["dira", "depb", "regc", "revd", "expe", "disf", "both"]) {
    await account(key, key === "disf" ? { disabledAt: new Date(now.getTime() - day) } : {});
  }
  await grant("dira", "a", "DIRECTOR");
  await grant("depb", "b", "DEPUTY");
  await grant("regc", "c", "REGISTRAR");
  await grant("revd", "d", "DIRECTOR", { revokedAt: new Date(now.getTime() - day) });
  await grant("expe", "e", "DIRECTOR", { effectiveTo: new Date(now.getTime() - day) });
  await grant("disf", "f", "DIRECTOR");
  // One person directs club g and is a deputy of club b: their email matches either club, but only the club they pick.
  await grant("both", "g", "DIRECTOR");
  await grant("both", "b", "DEPUTY");

  // 1. The PBE starter creates the event with the link on.
  await addStarterEventTemplates(staffUserId);
  const template = await prisma.eventTemplate.findFirstOrThrow({ where: { versions: { some: { payload: { path: ["starterKey"], equals: "pathfinder_bible_experience" } } } } });
  const applied = await applyEventTemplate(template.id, staffUserId, {
    name: `Gl check ${P}`, slug: `${S}-pbe`, startsOn: "2027-01-16", endsOn: "2027-01-16", requestKey: `${P}-apply-key-1`,
  });
  assert(applied.event, "the template creates an event");
  const eventId = applied.event.id;
  const eventSlug = `${S}-pbe`;
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  assert(event.generalRegistrationLinkEnabled, "the PBE starter turns the general registration link on");
  const form = await prisma.registrationForm.findFirstOrThrow({ where: { eventId }, include: { versions: true } });
  await prisma.registrationFormVersion.updateMany({ where: { formId: form.id }, data: { status: RegistrationFormStatus.PUBLISHED, publishedAt: new Date() } });
  await prisma.registrationForm.update({ where: { id: form.id }, data: { status: RegistrationFormStatus.PUBLISHED } });
  await prisma.event.update({ where: { id: eventId }, data: { isPublished: true } });
  const versionId = form.versions[0]!.id;
  const [missouri, iowa] = await prisma.eventLocation.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" } });
  await prisma.eventMessageSettings.create({ data: { eventId, senderName: "GL Check", internalNotificationEmails: [staffNoticeEmail] } });
  console.log("ok  the starter turns the general registration link on for the new event");

  // 2. The setting: on and off, only for a club event billed to the church; the public page and card follow it.
  const settingsOn = await link.getGeneralLinkSettings(eventId);
  assert(settingsOn?.enabled && settingsOn.eligible && settingsOn.problem === null, `the settings report the link on and usable, got ${JSON.stringify(settingsOn)}`);
  const landing = await getPublicEventLanding(eventSlug);
  assert(landing?.generalLink?.href === generalLinkPath(eventSlug) && landing.generalLink.href === `/register/${eventSlug}/general`, "the public event page offers the link while it is on");
  await link.setGeneralRegistrationLink(eventId, false, staffUserId);
  assert((await link.getGeneralLinkSettings(eventId))?.enabled === false, "staff turn the link off");
  await expectCode(link.getGeneralLinkExperience(eventSlug), "EVENT_NOT_FOUND", "a link that is off has no page");
  await expectCode(link.submitGeneralLinkRegistration(eventSlug, { versionId, idempotencyKey: randomUUID(), responses: {}, website: "" }, {}, now), "EVENT_NOT_FOUND", "nothing is registered through a link that is off");
  assert((await getPublicEventLanding(eventSlug))?.generalLink === null, "the event page stops offering it");
  await link.setGeneralRegistrationLink(eventId, true, staffUserId);
  await link.setGeneralRegistrationLink(eventId, true, staffUserId);
  assert(await prisma.auditLog.count({ where: { eventId, action: "GENERAL_LINK_SETTING_CHANGED" } }) === 2, "each change of the setting is audited once, a repeat is not");
  await prisma.event.create({
    data: {
      id: generalEventId, slug: `${S}-general`, name: `Gl general ${P}`, startsAt: new Date("2026-12-05T15:00:00Z"), endsAt: new Date("2026-12-06T22:00:00Z"),
      isPublished: true, billingMode: "ATTENDEE_PAY", audience: "GENERAL",
    },
  });
  await expectCode(link.setGeneralRegistrationLink(generalEventId, true, staffUserId), "LINK_NOT_AVAILABLE", "the link is for a club event billed to the church");
  const experience = await link.getGeneralLinkExperience(eventSlug, now);
  assert(experience.experience && experience.problem === null && experience.team.named && experience.locations.length === 2, "the public page loads the PBE form, the team rule in words and the two sites");
  assert(!JSON.stringify(experience.locations).includes("remaining") && !JSON.stringify(experience.locations).includes("capacity"), "the public page shows no seat counts");
  console.log("ok  the setting: on and off, club events billed to the church only, audited; the public page follows it");

  // Request builders. The people are typed in; the club is picked from the directory by name.
  const typedMember = (first: string, last: string, age: number, role = "Pathfinder", alternate = false) => ({
    clientId: `c${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    responses: { first_name: first, last_name: last, attendee_age: age, attendee_type: role, ...(alternate ? { alternate: true } : {}) } as Record<string, unknown>,
  });
  const request = (members: Array<ReturnType<typeof typedMember>>, answers: Record<string, unknown> = {}, key = randomUUID()) => ({
    versionId,
    idempotencyKey: key,
    responses: {
      club_name: clubName("a"), director_name: "Gl Director", email: emailOf("dira"), phone: "515-555-0100",
      coordinator_name: "Gl Coordinator", coordinator_address: "1 Synthetic Road", coordinator_city: "Testville", coordinator_state: "IA", coordinator_zip: "50000",
      coordinator_phone: "515-555-0101", coordinator_email: "gl-coordinator@example.test",
      director_confirmation: true, photo_video_release: "Yes", ...answers,
    },
    attendees: members,
    website: "" as const,
  });
  const youth = (tag: string, count = 2) => Array.from({ length: count }, (_, index) => typedMember(`Gl${tag}`, `Kid${index + 1}`, 13 + index));
  const submit = (members: Array<ReturnType<typeof typedMember>>, teamName: string, answers: Record<string, unknown> = {}, site = missouri!.id, key = randomUUID()) =>
    link.submitGeneralLinkRegistration(eventSlug, request(members, answers, key), { locationId: site, teamName }, now);
  const registrationCount = () => prisma.clubEventRegistration.count({ where: { eventId } });
  const mailsTo = (email: string) => prisma.messageOutbox.findMany({ where: { eventId, recipientEmail: email }, select: { id: true, recipientKind: true, subjectSnapshot: true, bodyTextSnapshot: true, bodyHtmlSnapshot: true } });
  // The public answer never says which path a team took; the database does.
  const kind = async (result: { confirmationCode: string }) => (await prisma.generalLinkSubmission.findUniqueOrThrow({ where: { confirmationCode: result.confirmationCode } })).status === "CONFIRMED" ? "ATTACHED" : "PENDING";
  const pendingCount = () => prisma.generalLinkSubmission.count({ where: { eventId, status: "PENDING" } });
  const submissionOf = (teamName: string) => prisma.generalLinkSubmission.findFirstOrThrow({ where: { eventId, teamName }, orderBy: { createdAt: "desc" } });
  const teamRow = (clubKey: string, teamName: string) => prisma.clubEventRegistration.findFirstOrThrow({
    where: { eventId, organizationId: clubOf(clubKey), teamName }, include: { registration: { include: { attendees: true } } },
  });

  // 3. A matching director email attaches the team at once as an ordinary club registration.
  const members1 = [typedMember("GlAlex", "Alpha", 14), typedMember("GlBlake", "Bravo", 15, "TLT", true), typedMember("GlCoach", "Charlie", 40, "Coach")];
  const attached = await submit(members1, "  Bible   Bees ", { email: emailOf("dira").toUpperCase().replace("@", "@") });
  assert(await kind(attached) === "ATTACHED", "a matching email attaches the team");
  assert(attached.outcome === "RECEIVED" && attached.clubName === null && !attached.message.includes(clubName("a")) && /^PBE-[0-9A-F]{10}$/.test(attached.confirmationCode), "the screen says only that the team was received, with no club and a PBE reference");
  assert(attached.managePath === null && attached.manageLinkExpiresAt === null && attached.waitlistPosition === null && attached.registrationStatus === "SUBMITTED", "and no manage link, no waitlist place");
  const bees = await teamRow("a", "Bible Bees");
  assert(bees.teamKey === "bible bees" && Number(bees.registration.totalAmount) === 0 && bees.registration.status === "SUBMITTED", "an ordinary free club registration with a cleaned team name");
  assert(bees.registration.locationId === missouri!.id, "at the site the director picked");
  const snapshots = bees.registration.attendees.map((attendee) => attendee.profileSnapshot as { temporary?: boolean; clubGuestId?: string; clubOrganizationId?: string; teamRole?: string; clubRosterMemberId?: string });
  assert(snapshots.every((snapshot) => snapshot.temporary === true && snapshot.clubOrganizationId === clubOf("a") && /^[a-z0-9]{16}$/.test(snapshot.clubGuestId ?? "") && !snapshot.clubRosterMemberId), "the people are extra people of the club, not roster members");
  assert(snapshots.map((snapshot) => snapshot.teamRole).sort().join() === "COACH,MEMBER,MEMBER", "each person's team role is kept");
  const beesSubmission = await prisma.generalLinkSubmission.findFirstOrThrow({ where: { eventId, registrationId: bees.registrationId } });
  assert(beesSubmission.status === "CONFIRMED" && beesSubmission.resolution === "AUTO_EMAIL_MATCH" && beesSubmission.organizationId === clubOf("a") && beesSubmission.payload === null, "the record of how it was attached: auto match, confirmed, no typed answers kept");
  const registered = await prisma.auditLog.findFirstOrThrow({ where: { eventId, action: "CLUB_REGISTRATION_SUBMITTED", entityId: bees.registrationId } });
  const attachedAudit = await prisma.auditLog.findFirstOrThrow({ where: { eventId, action: "GENERAL_LINK_TEAM_ATTACHED", entityId: beesSubmission.id } });
  for (const entry of [registered, attachedAudit]) {
    const text = JSON.stringify(entry.metadata);
    assert(!/GlAlex|GlBlake|GlCoach|Alpha|Bravo|Charlie/.test(text), "the audit holds ids only, never a team member's name");
  }
  assert((registered.metadata as { generalLinkSubmissionId?: string; matchBasis?: string }).generalLinkSubmissionId === beesSubmission.id, "the registration's audit entry names the link submission");
  const owed = await club.listChurchAmountsOwed(eventId);
  assert(owed.some((row) => row.organizationId === clubOf("a") && row.teamName === "Bible Bees"), "the attached team is on the church invoice list like a portal registration");
  const checkIn = await club.listClubCheckInInfo(eventId);
  assert(checkIn.some((row) => row.organizationId === clubOf("a")), "and in the check-in list");
  const filled = await loadFilledTeamForm({ eventId, organizationId: clubOf("a"), teamKey: "bible bees" });
  assert(filled, "and its print form loads");
  const portal = await club.getClubEventWorkspace(clubOf("a"), eventId, now, { teamKey: "bible bees" });
  assert(portal.registration?.teamName === "Bible Bees" && portal.registration.attendees.length === 3 && portal.registration.attendees.every((attendee) => attendee.temporary), "the director's club portal shows the attached team with its people");
  const otherPortal = await club.getClubEventWorkspace(clubOf("b"), eventId, now, { teamKey: "bible bees" });
  assert(otherPortal.registration === null, "another club's portal does not");
  const messages = await prisma.messageOutbox.findMany({ where: { eventId }, select: { recipientEmail: true, recipientKind: true, subjectSnapshot: true, status: true, bodyTextSnapshot: true } });
  const toDirector = messages.filter((message) => message.recipientEmail === emailOf("dira"));
  assert(toDirector.length === 1 && toDirector[0]!.recipientKind === "REGISTRANT" && !/attached to/.test(toDirector[0]!.subjectSnapshot), `the matched director gets ONE email, the ordinary confirmation, got ${toDirector.length}`);
  assert(/^Your team "Bible Bees" is attached to Gl Club a/.test(toDirector[0]!.bodyTextSnapshot) && toDirector[0]!.bodyTextSnapshot.includes(attached.confirmationCode), "whose first line says the team is attached to the club, with the reference");
  assert(messages.some((message) => message.recipientEmail === staffNoticeEmail && message.recipientKind === "INTERNAL"), "the event's registration staff address is told of the new registration as for any registration");
  console.log("ok  a matching director email attaches the team as an ordinary club registration, church-billed, with its people as extra people");

  // 4. Matching: a deputy matches; a registrar, a revoked or expired role, a disabled account, another club's director and
  // "Not listed" do not. The email must belong to the club picked, not just to some club.
  const deputy = await submit(youth("Dep"), "Deputy Team", { club_name: clubName("b"), email: emailOf("depb") }, iowa!.id);
  assert(await kind(deputy) === "ATTACHED" && (await submissionOf("Deputy Team")).organizationId === clubOf("b"), "a deputy's email attaches the team");
  const waiting: Record<string, Awaited<ReturnType<typeof submit>>> = {};
  const cases: Array<[string, string, string]> = [
    ["registrar", "c", "regc"], ["revoked", "d", "revd"], ["expired", "e", "expe"], ["disabled", "f", "disf"], ["wrong club", "c", "dira"],
  ];
  for (const [label, clubKey, emailKey] of cases) {
    waiting[label] = await submit(youth(label.slice(0, 3)), `Waiting ${label}`, { club_name: clubName(clubKey), email: emailOf(emailKey) });
    assert(await kind(waiting[label]!) === "PENDING", `${label}: the team waits for staff`);
  }
  const both = await submit(youth("Both"), "Both Clubs", { club_name: clubName("g"), email: emailOf("both") });
  assert(await kind(both) === "ATTACHED" && (await submissionOf("Both Clubs")).organizationId === clubOf("g"), "a person who directs one club and is deputy of another is matched to the club they pick");
  assert(await registrationCount() === 3, `only the three matched teams are registered, got ${await registrationCount()}`);
  assert(await pendingCount() === 5, "the five unmatched teams wait");
  console.log("ok  a deputy matches; a registrar, a revoked or expired role, a disabled account and another club's director do not");

  // 5. A waiting team is in no club count, invoice, report or check-in list, and holds no registration, seat or person record.
  const registrationsBefore = await prisma.registration.count({ where: { eventId } });
  const noted = await prisma.generalLinkSubmission.findMany({ where: { eventId, status: "PENDING" } });
  assert(noted.every((row) => row.payload !== null && row.registrationId === null && row.organizationId === null), "a waiting team keeps its typed answers and no club, no registration");
  const waitingRegistered = await prisma.registration.count({ where: { eventId, confirmationCode: { in: Object.values(waiting).map((entry) => entry.confirmationCode) } } });
  assert(waitingRegistered === 0 && registrationsBefore === 3, "no Registration exists for a waiting team");
  const owedNow = await club.listChurchAmountsOwed(eventId);
  assert(owedNow.length === 3 && !owedNow.some((row) => /Waiting/.test(row.teamName ?? "")), "the invoice list holds only registered teams");
  assert((await club.listClubCheckInInfo(eventId)).length === 3, "and so does check-in");
  assert((await prisma.registrationAttendee.count({ where: { eventId, profileSnapshot: { path: ["firstName"], string_contains: "Reg" } } })) === 0, "no person record exists for a waiting team's members");
  const pendingMessages = await prisma.messageOutbox.findMany({ where: { eventId, templateKey: "CUSTOM_MESSAGE" } });
  const staffDigests = pendingMessages.filter((message) => message.recipientEmail === staffNoticeEmail && /waiting for club confirmation/.test(message.subjectSnapshot));
  assert(staffDigests.length === 1, `staff get ONE digest for the five teams that waited in the same 15 minutes, got ${staffDigests.length}`);
  assert(/1 team is waiting|teams are waiting/.test(staffDigests[0]!.bodyTextSnapshot) && !/Waiting|Gl Club|Kid/.test(staffDigests[0]!.bodyTextSnapshot), "the digest holds the count and the review link, nothing the submitters typed");
  const regcPending = pendingMessages.filter((message) => message.recipientEmail === emailOf("regc"));
  assert(regcPending.length === 1 && /We have your team registration/.test(regcPending[0]!.subjectSnapshot) && /will confirm which club/.test(regcPending[0]!.bodyTextSnapshot), "the submitter gets one email saying the team waits for staff confirmation");
  const pendingAudit = await prisma.auditLog.findMany({ where: { eventId, action: "GENERAL_LINK_TEAM_PENDING" } });
  assert(pendingAudit.length === 5 && !pendingAudit.some((entry) => /Gl(reg|rev|exp|dis|wro)|Kid/i.test(JSON.stringify(entry.metadata))), "each waiting team is audited with ids and counts only");
  const list = await link.listPendingTeams(eventId, now);
  const registrarRow = list.find((row) => row.teamName === "Waiting registrar")!;
  assert(list.length === 5 && registrarRow.members.map((member) => `${member.firstName} ${member.lastName}`).sort().join() === "Glreg Kid1,Glreg Kid2" && registrarRow.members.every((member) => member.role === "MEMBER" && !member.alternate) && registrarRow.coaches.length === 0, "the staff list shows the members' names and roles with the director's contact");
  assert(!/"age"|birth/i.test(JSON.stringify(list)), "but no ages");
  assert(registrarRow.suggestedClub?.id === clubOf("c") && registrarRow.attendeeCount === 2 && registrarRow.locationName === "Missouri", "the list names the club picked, the people counted and the site");
  const wrongClubRow = list.find((row) => row.teamName === "Waiting wrong club")!;
  assert(wrongClubRow.emailClubs.map((entry) => entry.id).join() === clubOf("a"), "and the clubs the director's email is a director of, to choose from");
  console.log("ok  a waiting team is in no club count, invoice or check-in list; staff and the director are told; it is audited with ids only");

  // 6. Staff confirm: one click makes it an ordinary club registration for the club picked.
  const registrarSubmission = await submissionOf("Waiting registrar");
  // The team was received on a day before the closing date: confirmation runs as of that day, whenever staff get to it.
  const receivedOn = new Date("2026-12-10T15:00:00Z");
  await prisma.generalLinkSubmission.update({ where: { id: registrarSubmission.id }, data: { createdAt: receivedOn } });
  // A team "received" after the December 18 deadline is refused at confirmation although the clock now is before it, which
  // proves the confirmation is judged on the submit date and not on the day staff click.
  const lateSubmission = await submissionOf("Waiting expired");
  await prisma.generalLinkSubmission.update({ where: { id: lateSubmission.id }, data: { createdAt: new Date("2026-12-19T15:00:00Z") } });
  await expectCode(link.resolvePendingTeam(eventId, lateSubmission.id, staffUserId, { action: "CONFIRM", organizationId: clubOf("e") }), "REGISTRATION_CLOSED", "a team received after the deadline is not attached");
  assert((await prisma.generalLinkSubmission.findUniqueOrThrow({ where: { id: lateSubmission.id } })).status === "PENDING", "and stays waiting, nothing registered");
  const mailsBeforeConfirm = new Set((await mailsTo(emailOf("regc"))).map((mail) => mail.id));
  const confirmed = await link.resolvePendingTeam(eventId, registrarSubmission.id, staffUserId, { action: "CONFIRM", organizationId: clubOf("c") });
  assert(confirmed.status === "CONFIRMED" && !confirmed.alreadyDone && confirmed.registrationId, "staff confirm the club picked");
  const confirmedRow = await prisma.generalLinkSubmission.findUniqueOrThrow({ where: { id: registrarSubmission.id } });
  assert(confirmedRow.status === "CONFIRMED" && confirmedRow.resolution === "STAFF_CONFIRMED" && confirmedRow.payload === null && confirmedRow.resolvedByUserId === staffUserId && confirmedRow.organizationId === clubOf("c"), "the submission records who confirmed what, and keeps no typed answers");
  const waitingTeam = await teamRow("c", "Waiting registrar");
  assert(waitingTeam.registrationId === confirmed.registrationId && waitingTeam.registration.attendees.length === 2 && Number(waitingTeam.registration.totalAmount) === 0, "now an ordinary club registration for that club");
  assert(waitingTeam.registration.submittedAt?.getTime() === receivedOn.getTime(), `the registration keeps the day the director submitted (${receivedOn.toISOString()}), got ${waitingTeam.registration.submittedAt?.toISOString()}`);
  assert((await club.listChurchAmountsOwed(eventId)).some((row) => row.organizationId === clubOf("c") && row.teamName === "Waiting registrar"), "on the church invoice list from now on");
  const staffAudit = await prisma.auditLog.findFirstOrThrow({ where: { eventId, action: "GENERAL_LINK_TEAM_CONFIRMED", entityId: registrarSubmission.id } });
  const clubAudit = await prisma.auditLog.findFirstOrThrow({ where: { eventId, action: "CLUB_REGISTRATION_SUBMITTED", entityId: confirmed.registrationId! } });
  assert(staffAudit.actorUserId === staffUserId && clubAudit.actorUserId === staffUserId, "both audit entries name the staff member");
  assert(!/Gl(Reg|Kid)|Kid/.test(JSON.stringify([staffAudit.metadata, clubAudit.metadata])), "and hold ids only");
  const confirmMails = (await mailsTo(emailOf("regc"))).filter((mail) => !mailsBeforeConfirm.has(mail.id));
  assert(confirmMails.length === 1 && confirmMails[0]!.recipientKind === "REGISTRANT" && /^Your team "Waiting registrar" is attached to Gl Club c/.test(confirmMails[0]!.bodyTextSnapshot), `staff confirming sends the director exactly ONE message, the ordinary confirmation led by the club, got ${JSON.stringify(confirmMails.map((mail) => [mail.recipientKind, mail.subjectSnapshot]))}`);
  const again = await link.resolvePendingTeam(eventId, registrarSubmission.id, otherStaffId, { action: "CONFIRM", organizationId: clubOf("c") });
  assert(again.alreadyDone && await registrationCount() === 4, "confirming again changes nothing");
  await expectCode(link.resolvePendingTeam(eventId, registrarSubmission.id, otherStaffId, { action: "REASSIGN", organizationId: clubOf("e") }), "ALREADY_RESOLVED", "an attached team cannot be moved by a second action");
  await expectCode(link.resolvePendingTeam(eventId, registrarSubmission.id, otherStaffId, { action: "REJECT", reason: "Too late" }), "ALREADY_RESOLVED", "or rejected");
  console.log("ok  a mismatch waits, then staff confirm it into an ordinary club registration, audited, repeat-safe");

  // 7. Staff reassign: to the right club, whatever the director picked; the club question becomes the club's own.
  const revokedSubmission = await submissionOf("Waiting revoked");
  const reassigned = await link.resolvePendingTeam(eventId, revokedSubmission.id, staffUserId, { action: "REASSIGN", organizationId: clubOf("e") });
  assert(reassigned.status === "CONFIRMED" && reassigned.clubName === clubName("e"), "staff attach it to another club");
  const movedRow = await prisma.generalLinkSubmission.findUniqueOrThrow({ where: { id: revokedSubmission.id } });
  assert(movedRow.resolution === "STAFF_REASSIGNED" && movedRow.organizationId === clubOf("e") && movedRow.suggestedOrganizationId === clubOf("d"), "recorded as a reassignment, with the club the director picked");
  const movedTeam = await teamRow("e", "Waiting revoked");
  const movedAnswers = await prisma.publicRegistrationSubmission.findUniqueOrThrow({ where: { registrationId: movedTeam.registrationId } });
  assert((movedAnswers.responses as { club_name?: string }).club_name === clubName("e"), "the club question holds the club it was attached to, not the one picked");
  assert(!(await prisma.clubEventRegistration.findFirst({ where: { eventId, organizationId: clubOf("d") } })), "and nothing is registered for the club first picked");
  const reassignAudit = await prisma.auditLog.findFirstOrThrow({ where: { eventId, action: "GENERAL_LINK_TEAM_REASSIGNED", entityId: revokedSubmission.id } });
  assert((reassignAudit.metadata as { suggestedOrganizationId?: string; organizationId?: string }).suggestedOrganizationId === clubOf("d") && (reassignAudit.metadata as { organizationId?: string }).organizationId === clubOf("e"), "the audit entry names both clubs by id");
  await expectCode(link.resolvePendingTeam(eventId, (await submissionOf("Waiting expired")).id, staffUserId, { action: "REASSIGN", organizationId: `${P}_no_such_club` }), "CLUB_INVALID", "only an active club can be chosen");
  console.log("ok  staff reassign a team to the right club");

  // 8. "Not listed": the typed name is kept for staff; confirmation has no club to confirm, so staff choose one.
  const notListed = await submit(youth("Nol"), "Typed Club Team", { club_name: "Not listed", club_name_other: "The Typed Name Pathfinders", email: emailOf("dira") });
  assert(await kind(notListed) === "PENDING", "\"Not listed\" waits for staff, whatever the email");
  const notListedRow = await submissionOf("Typed Club Team");
  assert(notListedRow.suggestedOrganizationId === null && notListedRow.clubNameAsEntered === "The Typed Name Pathfinders", "the club as typed is kept for staff");
  const reviewRow = (await link.listPendingTeams(eventId, now)).find((row) => row.id === notListedRow.id)!;
  assert(reviewRow.suggestedClub === null && reviewRow.clubNameAsEntered === "The Typed Name Pathfinders" && reviewRow.emailClubs.some((entry) => entry.id === clubOf("a")), "the staff list shows the typed name and where the email is a director");
  const notListedDone = await link.resolvePendingTeam(eventId, notListedRow.id, staffUserId, { action: "REASSIGN", organizationId: clubOf("a") });
  assert(notListedDone.status === "CONFIRMED" && (await teamRow("a", "Typed Club Team")), "staff choose the club for a team that was not listed");
  console.log("ok  \"Not listed\" waits with the typed name, then staff choose the club");

  // 9. Reject: needs a reason, tells the director, removes the typed answers, frees the team name.
  const wrongSubmission = await submissionOf("Waiting wrong club");
  await expectCode(link.resolvePendingTeam(eventId, wrongSubmission.id, staffUserId, { action: "REJECT", reason: "   " }), "REASON_REQUIRED", "a rejection needs a reason");
  const rejected = await link.resolvePendingTeam(eventId, wrongSubmission.id, staffUserId, { action: "REJECT", reason: "This is not a club of the conference." });
  assert(rejected.status === "REJECTED" && !rejected.alreadyDone, "staff reject it with a reason");
  const rejectedRow = await prisma.generalLinkSubmission.findUniqueOrThrow({ where: { id: wrongSubmission.id } });
  assert(rejectedRow.status === "REJECTED" && rejectedRow.resolution === "STAFF_REJECTED" && rejectedRow.payload === null && rejectedRow.rejectReason === "This is not a club of the conference." && !rejectedRow.registrationId, "the reason is kept, the typed answers are removed, and nothing is registered");
  const rejectAudit = await prisma.auditLog.findFirstOrThrow({ where: { eventId, action: "GENERAL_LINK_TEAM_REJECTED", entityId: wrongSubmission.id } });
  assert(!JSON.stringify(rejectAudit.metadata).includes("not a club") && rejectAudit.actorUserId === staffUserId, "the audit holds ids only: the reason stays on the submission");
  assert((await prisma.messageOutbox.count({ where: { eventId, recipientEmail: emailOf("dira"), subjectSnapshot: { contains: "was not accepted" } } })) === 1, "the director is told, with the reason");
  assert((await link.resolvePendingTeam(eventId, wrongSubmission.id, otherStaffId, { action: "REJECT", reason: "Again" })).alreadyDone, "rejecting again changes nothing");
  await expectCode(link.resolvePendingTeam(eventId, wrongSubmission.id, otherStaffId, { action: "CONFIRM", organizationId: clubOf("c") }), "ALREADY_RESOLVED", "a rejected team cannot be attached");
  const reused = await submit(youth("Rej"), "Waiting wrong club", { club_name: clubName("c"), email: emailOf("regc") });
  assert(await kind(reused) === "PENDING", "a rejected team's name can be used again");
  console.log("ok  staff reject a team with a reason: audited with ids only, the typed answers removed, the name freed");

  // 10. Two teams from one club through the same link.
  const second = await submit(youth("Two"), "Sword Drill", { email: emailOf("dira") }, iowa!.id);
  assert(await kind(second) === "ATTACHED" && (await prisma.clubEventRegistration.count({ where: { eventId, organizationId: clubOf("a"), teamName: { in: ["Bible Bees", "Sword Drill"] } } })) === 2, "a club registers a second team through the same link");
  const teamsOfA = await club.getClubEventWorkspace(clubOf("a"), eventId, now, {});
  assert(teamsOfA.teams.registered.length >= 3, "the director's portal lists the club's teams");
  console.log("ok  two teams from one club go through one link");

  // 11. Team rules are the server's: size, alternate, age on 2026-01-01; a waiting team is held to them too.
  const refuseCount = async (label: string, members: Array<ReturnType<typeof typedMember>>, includes: string[], answers: Record<string, unknown> = {}, code = "TEAM_RULES") => {
    const before = [await registrationCount(), await pendingCount(), await prisma.generalLinkSubmission.count({ where: { eventId } })];
    await expectCode(submit(members, `Refused ${label}`, answers), code, label, includes);
    const after = [await registrationCount(), await pendingCount(), await prisma.generalLinkSubmission.count({ where: { eventId } })];
    assert(before.join() === after.join(), `${label}: nothing was stored`);
  };
  // The form itself asks for at least two people, so one is refused there; the team rules below are what hold the rest.
  await refuseCount("one person", [typedMember("GlSolo", "Only", 14)], [], {}, "INVALID_SUBMISSION");
  await refuseCount("one member and coaches", [typedMember("GlSolo", "Only", 14), typedMember("GlCoach", "A", 40, "Coach"), typedMember("GlCoach", "B", 41, "Coach")], ["this one has 1", "Coaches don't count"]);
  await refuseCount("eight members", Array.from({ length: 8 }, (_, index) => typedMember("GlEight", `N${index}`, 14)), ["at most 7 team members", "this one has 8"]);
  await refuseCount("two alternates", [typedMember("GlAlt", "One", 14, "Pathfinder", true), typedMember("GlAlt", "Two", 14, "Pathfinder", true), typedMember("GlAlt", "Three", 14)], ["Only 1 team member can be the alternate"]);
  await refuseCount("a coach as alternate", [typedMember("GlAlt", "Four", 14), typedMember("GlAlt", "Five", 14), typedMember("GlCoach", "C", 40, "Coach", true)], ["is a coach, so can't be the alternate"]);
  await refuseCount("too old", [typedMember("GlOld", "Twenty", 20), typedMember("GlOld", "Fifteen", 15)], ["this one has 1"], { club_name: clubName("c"), email: emailOf("regc") });
  const seven = Array.from({ length: 7 }, (_, index) => typedMember("GlSeven", `M${index}`, 14, "Pathfinder", index === 6));
  const sevenTeam = await submit([...seven, typedMember("GlCoach", "D", 41, "Coach"), typedMember("GlCoach", "E", 42, "Coach")], "Seven Plus Coaches");
  assert(await kind(sevenTeam) === "ATTACHED" && (await teamRow("a", "Seven Plus Coaches")).registration.attendees.length === 9, "seven members with an alternate and two coaches are accepted");
  const edge = await submit([typedMember("GlEdge", "Nineteen", 19), typedMember("GlEdge", "Fourteen", 14)], "Edge Team", { club_name: clubName("c"), email: emailOf("regc") });
  assert(await kind(edge) === "PENDING", "a member of 19 on 2026-01-01 is allowed (the pending team passed the same rules)");
  await expectCode(link.submitGeneralLinkRegistration(eventSlug, { ...request([typedMember("GlNoAge", "X", 14), { clientId: "cnoage000001", responses: { first_name: "GlNoAge", last_name: "Y", attendee_type: "Pathfinder" } }]) }, { locationId: missouri!.id, teamName: "No Age" }, now), "INVALID_SUBMISSION", "a missing age is the form's own required-field error");
  await expectCode(link.submitGeneralLinkRegistration(eventSlug, request(youth("Nod"), { director_confirmation: false }), { locationId: missouri!.id, teamName: "No Confirm" }, now), "INVALID_SUBMISSION", "the director's confirmation is required");
  await expectCode(link.submitGeneralLinkRegistration(eventSlug, request(youth("Nor"), { photo_video_release: undefined }), { locationId: missouri!.id, teamName: "No Release" }, now), "INVALID_SUBMISSION", "the release is required");
  await expectCode(link.submitGeneralLinkRegistration(eventSlug, request(youth("Nos")), { locationId: null, teamName: "No Site" }, now), "LOCATION_REQUIRED", "a site is required");
  await expectCode(link.submitGeneralLinkRegistration(eventSlug, request(youth("Nom"), { club_name: "Gl Club That Is Not In The Directory" }), { locationId: missouri!.id, teamName: "Made Up" }, now), "INVALID_SUBMISSION", "a club that is neither in the directory nor \"Not listed\" is refused");
  await expectCode(link.submitGeneralLinkRegistration(eventSlug, request(youth("Non")), { locationId: missouri!.id, teamName: "   " }, now), "TEAM_INVALID", "a team needs a name");
  await expectCode(link.submitGeneralLinkRegistration(eventSlug, { ...request(youth("Noq")), versionId: "not-the-live-version" }, { locationId: missouri!.id, teamName: "Old Form" }, now), "FORM_VERSION_CHANGED", "a form that changed while open is refused");
  const afterClose = new Date("2026-12-19T15:00:00Z");
  await expectCode(link.submitGeneralLinkRegistration(eventSlug, request(youth("Clo")), { locationId: missouri!.id, teamName: "Too Late" }, afterClose), "REGISTRATION_CLOSED", "after December 18 a matched team is refused");
  await expectCode(link.submitGeneralLinkRegistration(eventSlug, request(youth("Clp"), { club_name: clubName("c"), email: emailOf("regc") }), { locationId: missouri!.id, teamName: "Too Late Two" }, afterClose), "REGISTRATION_CLOSED", "and a waiting one");
  console.log("ok  team rules, the form's required answers, the site and the deadline are enforced on the server");

  // 12. A unique team name: registered or waiting, in any case or spacing; racing submissions give one winner.
  await expectCode(submit(youth("Dup"), "BIBLE bees", { club_name: clubName("b"), email: emailOf("depb") }), "CLUB_TEAM_NAME_TAKEN", "a registered team's name is taken for another club", ["already registered for this event"]);
  await expectCode(submit(youth("Dup"), "bible  BEES", { club_name: clubName("c"), email: emailOf("regc") }), "CLUB_TEAM_NAME_TAKEN", "and for a waiting team");
  await expectCode(submit(youth("Dup"), "  waiting   Registrar ", { club_name: clubName("a"), email: emailOf("dira") }), "CLUB_TEAM_NAME_TAKEN", "a waiting team's name is reserved against a matched one");
  const reservedKey = await prisma.generalLinkSubmission.findFirstOrThrow({ where: { eventId, teamName: "Waiting wrong club", status: "PENDING" } });
  await expectCode(submit(youth("Dup"), "waiting WRONG club", { club_name: clubName("c"), email: emailOf("regc") }), "CLUB_TEAM_NAME_TAKEN", "and against another waiting team", ["is already registered for this event"]);
  assert(reservedKey.teamKey === "waiting wrong club", "the waiting team's key is normalized");
  const raceBefore = await prisma.generalLinkSubmission.count({ where: { eventId } });
  const races: Array<[string, Array<() => Promise<unknown>>]> = [
    ["matched and matched", [
      () => submit(youth("Ra1"), "Photo Finish One", { club_name: clubName("a"), email: emailOf("dira") }),
      () => submit(youth("Ra2"), "photo  FINISH one", { club_name: clubName("b"), email: emailOf("depb") }, iowa!.id),
    ]],
    ["matched and waiting", [
      () => submit(youth("Rb1"), "Photo Finish Two", { club_name: clubName("a"), email: emailOf("dira") }),
      () => submit(youth("Rb2"), "PHOTO FINISH TWO", { club_name: clubName("c"), email: emailOf("regc") }, iowa!.id),
    ]],
    ["waiting and waiting", [
      () => submit(youth("Rc1"), "Photo Finish Three", { club_name: clubName("c"), email: emailOf("regc") }),
      () => submit(youth("Rc2"), "photo finish  three", { club_name: clubName("d"), email: emailOf("revd") }, iowa!.id),
    ]],
  ];
  for (const [label, jobs] of races) {
    const results = await Promise.allSettled(jobs.map((job) => job()));
    const winners = results.filter((result) => result.status === "fulfilled").length;
    const losers = results.flatMap((result) => (result.status === "rejected" ? [result.reason as { code?: string }] : []));
    assert(winners === 1 && losers.length === 1 && losers[0]!.code === "CLUB_TEAM_NAME_TAKEN", `${label}: exactly one of two same-name submissions wins, got ${winners} (${losers.map((loser) => String(loser.code))})`);
  }
  assert(await prisma.generalLinkSubmission.count({ where: { eventId } }) === raceBefore + 3, "each race left exactly one submission");
  for (const name of ["photo finish one", "photo finish two", "photo finish three"]) {
    const holders = (await prisma.clubEventRegistration.count({ where: { eventId, teamKey: name } })) + (await prisma.generalLinkSubmission.count({ where: { eventId, teamKey: name, status: "PENDING" } }));
    assert(holders === 1, `exactly one team holds "${name}"`);
  }
  console.log("ok  a unique team name: registered and waiting teams reserve it; racing submissions give exactly one winner");

  // 13. Confirm, reassign and reject under concurrency: one winner, one registration.
  const raceConfirm = await submit(youth("Rcf"), "Confirm Race", { club_name: clubName("c"), email: emailOf("regc") });
  const raceConfirmId = (await submissionOf("Confirm Race")).id;
  const twice = await Promise.allSettled([
    link.resolvePendingTeam(eventId, raceConfirmId, staffUserId, { action: "CONFIRM", organizationId: clubOf("c") }),
    link.resolvePendingTeam(eventId, raceConfirmId, otherStaffId, { action: "CONFIRM", organizationId: clubOf("c") }),
    link.resolvePendingTeam(eventId, raceConfirmId, staffUserId, { action: "CONFIRM", organizationId: clubOf("c") }),
  ]);
  assert(twice.every((result) => result.status === "fulfilled"), `three confirmations of the same club all see it done, got ${twice.map((entry) => (entry.status === "rejected" ? String(entry.reason) : "ok")).join(" | ")}`);
  assert(await prisma.clubEventRegistration.count({ where: { eventId, teamKey: "confirm race" } }) === 1 && await prisma.registration.count({ where: { eventId, confirmationCode: raceConfirm.confirmationCode } }) === 0, "exactly one registration came of them");
  assert(await prisma.auditLog.count({ where: { eventId, action: "GENERAL_LINK_TEAM_CONFIRMED", entityId: raceConfirmId } }) === 1, "and one audit entry");
  await submit(youth("Rmx"), "Mixed Race", { club_name: clubName("c"), email: emailOf("regc") });
  const mixedId = (await submissionOf("Mixed Race")).id;
  const mixed = await Promise.allSettled([
    link.resolvePendingTeam(eventId, mixedId, staffUserId, { action: "CONFIRM", organizationId: clubOf("c") }),
    link.resolvePendingTeam(eventId, mixedId, otherStaffId, { action: "REASSIGN", organizationId: clubOf("e") }),
    link.resolvePendingTeam(eventId, mixedId, otherStaffId, { action: "REJECT", reason: "Racing" }),
  ]);
  const mixedWinners = mixed.filter((result) => result.status === "fulfilled" && !result.value.alreadyDone);
  assert(mixedWinners.length === 1, `exactly one of a confirm, a reassign and a reject wins, got ${mixedWinners.length} (${mixed.map((entry) => (entry.status === "rejected" ? String((entry.reason as { code?: string }).code) : (entry.value as { status: string }).status)).join(",")})`);
  assert(mixed.filter((result) => result.status === "rejected").every((result) => (result as PromiseRejectedResult).reason?.code === "ALREADY_RESOLVED"), "the others are told it was handled");
  const mixedRow = await prisma.generalLinkSubmission.findUniqueOrThrow({ where: { id: mixedId } });
  const mixedRegistrations = await prisma.clubEventRegistration.count({ where: { eventId, teamKey: "mixed race" } });
  assert(mixedRow.status !== "PENDING" && mixedRegistrations === (mixedRow.status === "CONFIRMED" ? 1 : 0), "one registration if it was attached, none if it was rejected, never two");
  assert((mixedRow.status === "CONFIRMED") === (mixedRow.registrationId !== null) && (mixedRow.payload === null), "the row agrees with what happened");
  console.log("ok  confirm, reassign and reject racing: one winner, never two registrations");

  // 14. The generic public route refuses a club form; the new route holds the honeypot, the rate limit and the idempotency key.
  const generic = await import("../app/api/public/events/[eventSlug]/forms/[formSlug]/registrations/route");
  const general = await import("../app/api/public/events/[eventSlug]/general-registrations/route");
  const origin = "http://localhost:3000";
  // Outside production a client is told apart by its user agent, so each group of requests here is its own client and the
  // counts left by other runs or other checks never reach it.
  const post = (handler: (request: Request, context: { params: Promise<never> }) => Promise<Response>, url: string, params: unknown, body: unknown, agent = `gl-check-${P}`) => handler(
    new Request(`${origin}${url}`, { method: "POST", headers: { origin, "content-type": "application/json", "user-agent": agent }, body: JSON.stringify(body) }),
    { params: Promise.resolve(params as never) },
  );
  const registrationsBeforeGeneric = await prisma.registration.count({ where: { eventId } });
  const genericResponse = await post(generic.POST as never, `/api/public/events/${eventSlug}/forms/${form.slug}/registrations`, { eventSlug, formSlug: form.slug }, request(youth("Gen"), { club_name: clubName("a"), email: emailOf("dira") }));
  const genericBody = await genericResponse.json() as { error?: string };
  assert(genericResponse.status === 403 && genericBody.error === "CLUB_ENTRY_REQUIRED", `the generic public route refuses a club event's form, got ${genericResponse.status} ${genericBody.error}`);
  assert(await prisma.registration.count({ where: { eventId } }) === registrationsBeforeGeneric && await prisma.person.count({ where: { firstName: "GlGen" } }) === 0, "and creates nothing");
  await expectCode(submitPublicRegistration(eventSlug, form.slug, request(youth("Gen2")) as never, now), "CLUB_ENTRY_REQUIRED", "the same at the repository, for any caller without a club context");
  const honeypot = await post(general.POST as never, `/api/public/events/${eventSlug}/general-registrations`, { eventSlug }, { ...request(youth("Hny"), {}), website: "http://spam.example", locationId: missouri!.id, teamName: "Honey Pot" });
  assert(honeypot.status === 400 && (await honeypot.json() as { error?: string }).error === "INVALID_REQUEST", "a filled honeypot is refused");
  assert(!(await prisma.generalLinkSubmission.findFirst({ where: { eventId, teamName: "Honey Pot" } })) && !(await prisma.clubEventRegistration.findFirst({ where: { eventId, teamName: "Honey Pot" } })), "and nothing is stored");
  const crossOrigin = await general.POST(new Request(`${origin}/api/public/events/${eventSlug}/general-registrations`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }), { params: Promise.resolve({ eventSlug }) });
  assert(crossOrigin.status === 403, "a request from another site is refused");
  // Idempotency through the route: a retried POST with the same key is the same registration, matched or waiting.
  const keyed = request(youth("Idm"), { club_name: clubName("a"), email: emailOf("dira") });
  const routeBody = { ...keyed, locationId: missouri!.id, teamName: "Idempotent Team" };
  const first = await post(general.POST as never, `/api/public/events/${eventSlug}/general-registrations`, { eventSlug }, routeBody);
  const firstBody = await first.json() as { confirmation?: { confirmationCode: string; outcome: string } };
  assert(first.status === 201 && firstBody.confirmation?.outcome === "RECEIVED" && await kind(firstBody.confirmation) === "ATTACHED", `the route registers a matched team, got ${first.status}`);
  assert(JSON.stringify(firstBody.confirmation).includes('"managePath":null') && JSON.stringify(firstBody.confirmation).includes('"manageLinkExpiresAt":null'), "and its body carries no manage link");
  const retry = await post(general.POST as never, `/api/public/events/${eventSlug}/general-registrations`, { eventSlug }, routeBody);
  const retryBody = await retry.json() as { confirmation?: { confirmationCode: string; outcome: string } };
  assert(retry.status === 201 && retryBody.confirmation?.confirmationCode === firstBody.confirmation?.confirmationCode, "a retried POST returns the same confirmation");
  assert(await prisma.clubEventRegistration.count({ where: { eventId, teamName: "Idempotent Team" } }) === 1 && await prisma.generalLinkSubmission.count({ where: { eventId, teamName: "Idempotent Team" } }) === 1, "and creates nothing new");
  const keyedWaiting = { ...request(youth("Idw"), { club_name: clubName("c"), email: emailOf("regc") }), locationId: missouri!.id, teamName: "Idempotent Waiting" };
  const waitFirst = await (await post(general.POST as never, `/api/public/events/${eventSlug}/general-registrations`, { eventSlug }, keyedWaiting)).json() as { confirmation?: { confirmationCode: string; outcome: string } };
  const waitRetry = await (await post(general.POST as never, `/api/public/events/${eventSlug}/general-registrations`, { eventSlug }, keyedWaiting)).json() as { confirmation?: { confirmationCode: string; outcome: string } };
  assert(waitFirst.confirmation && await kind(waitFirst.confirmation) === "PENDING" && waitRetry.confirmation?.confirmationCode === waitFirst.confirmation.confirmationCode, `a retried POST of a waiting team returns the same confirmation, got ${JSON.stringify(waitFirst)} then ${JSON.stringify(waitRetry)}`);
  assert(await prisma.generalLinkSubmission.count({ where: { eventId, teamName: "Idempotent Waiting" } }) === 1, "with one submission");
  const reused2 = await post(general.POST as never, `/api/public/events/${eventSlug}/general-registrations`, { eventSlug }, { ...keyedWaiting, responses: { ...keyedWaiting.responses, director_name: "Someone Else" } });
  assert(reused2.status === 409 && (await reused2.json() as { error?: string }).error === "IDEMPOTENCY_CONFLICT", "the same key with different answers is refused");
  // The rate limit: the form key is the link's own, 15 attempts from one client in 15 minutes.
  let limited = 0;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const response = await post(general.POST as never, `/api/public/events/${S}-rate-limit-probe/general-registrations`, { eventSlug: `${S}-rate-limit-probe` }, {}, `gl-probe-${P}`);
    if (response.status === 429) limited += 1;
  }
  assert(limited >= 3, `the route is rate limited, got ${limited} refusals of 18 attempts`);
  console.log("ok  the generic public route refuses a club form; the honeypot, rate limit and idempotency key hold on the link's own route");

  // 15. The director links a typed-in person to the roster, optionally, without changing the registration.
  const born = sealBirthDate("2013-06-01");
  const rosterPerson = await prisma.person.create({ data: { id: `${P}_roster_a`, firstName: "GlRoster", lastName: "Member" } });
  const rosterMember = await prisma.clubRosterMember.create({ data: { organizationId: clubOf("a"), clubYear: "2026-27", personId: rosterPerson.id, attendeeType: "YOUTH", role: "Pathfinder", sealedBirthDate: born, source: "DIRECTOR" } });
  const otherPerson = await prisma.person.create({ data: { id: `${P}_roster_b`, firstName: "GlOther", lastName: "Member" } });
  const otherMember = await prisma.clubRosterMember.create({ data: { organizationId: clubOf("b"), clubYear: "2026-27", personId: otherPerson.id, attendeeType: "YOUTH", role: "Pathfinder", sealedBirthDate: born, source: "DIRECTOR" } });
  const beforeLink = await teamRow("a", "Bible Bees");
  const typedAttendee = beforeLink.registration.attendees.find((attendee) => (attendee.profileSnapshot as { firstName?: string }).firstName === "GlAlex")!;
  const actor = { accountId: accountOf("dira") };
  const linked = await linkExtraPersonToRoster({ organizationId: clubOf("a"), eventId, attendeeId: typedAttendee.id, rosterMemberId: rosterMember.id, actor });
  assert(linked.linkedRosterMemberId === rosterMember.id, "a typed-in team member is linked to a roster member");
  const afterLink = await teamRow("a", "Bible Bees");
  const linkedAttendee = afterLink.registration.attendees.find((attendee) => attendee.id === typedAttendee.id)!;
  assert((linkedAttendee.profileSnapshot as { linkedRosterMemberId?: string }).linkedRosterMemberId === rosterMember.id, "the link is recorded on the attendee");
  assert(afterLink.registration.updatedAt.getTime() === beforeLink.registration.updatedAt.getTime() && linkedAttendee.personId === typedAttendee.personId
    && JSON.stringify(linkedAttendee.formResponses) === JSON.stringify(typedAttendee.formResponses) && Number(afterLink.registration.totalAmount) === 0 && afterLink.registration.attendees.length === 3, "the registration, the person, the answers and the price do not change");
  const linkAudit = await prisma.auditLog.findFirstOrThrow({ where: { eventId, action: "CLUB_EXTRA_PERSON_ROSTER_LINKED" } });
  assert(!/GlAlex|GlRoster/.test(JSON.stringify(linkAudit.metadata)), "the audit holds ids only");
  const portalLinked = await club.getClubEventWorkspace(clubOf("a"), eventId, now, { teamKey: "bible bees" });
  assert(portalLinked.registration?.attendees.find((attendee) => attendee.attendeeId === typedAttendee.id)?.linkedRosterMemberId === rosterMember.id, "the director's portal shows the link");
  await expectCode(linkExtraPersonToRoster({ organizationId: clubOf("a"), eventId, attendeeId: typedAttendee.id, rosterMemberId: otherMember.id, actor }), "CLUB_INVALID", "only a member of the same club's roster can be linked");
  await expectCode(linkExtraPersonToRoster({ organizationId: clubOf("b"), eventId, attendeeId: typedAttendee.id, rosterMemberId: otherMember.id, actor: { accountId: accountOf("depb") } }), "SUBMISSION_NOT_FOUND", "another club cannot link this club's people");
  const unlinked = await linkExtraPersonToRoster({ organizationId: clubOf("a"), eventId, attendeeId: typedAttendee.id, rosterMemberId: null, actor });
  assert(unlinked.linkedRosterMemberId === null && (await teamRow("a", "Bible Bees")).registration.attendees.every((attendee) => !("linkedRosterMemberId" in (attendee.profileSnapshot as object))), "and the link can be removed");
  console.log("ok  a typed-in person can be linked to the roster, optionally, without changing the registration");

  // 15b. A waiting team's name is reserved against the club portal too, case-insensitively; staff confirming it are exempt.
  const { clubAttendeeClientId } = await import("../modules/club-registrations/domain");
  const portalMembers: string[] = [];
  for (const index of [1, 2, 3]) {
    const portalPerson = await prisma.person.create({ data: { id: `${P}_portal_${index}`, firstName: `GlPortal${index}`, lastName: "Member" } });
    portalMembers.push((await prisma.clubRosterMember.create({ data: { organizationId: clubOf("b"), clubYear: "2026-27", personId: portalPerson.id, attendeeType: "YOUTH", role: "Pathfinder", sealedBirthDate: born, source: "DIRECTOR" } })).id);
  }
  const portalActor = { accountId: accountOf("depb") };
  const portalInput = (ids: string[]) => ({
    versionId,
    idempotencyKey: randomUUID(),
    responses: {
      director_name: "Gl Portal Director", email: emailOf("depb"), phone: "515-555-0100",
      coordinator_name: "Gl Coordinator", coordinator_address: "1 Synthetic Road", coordinator_city: "Testville", coordinator_state: "IA", coordinator_zip: "50000",
      coordinator_phone: "515-555-0101", coordinator_email: "gl-coordinator@example.test",
      director_confirmation: true, photo_video_release: "Yes",
    },
    attendees: ids.map((id) => ({ clientId: clubAttendeeClientId(id), responses: { attendee_type: "Pathfinder" } })),
    website: "" as const,
  });
  const portalSubmit = (ids: string[], teamName: string) => club.submitClubRegistration(clubOf("b"), eventId, portalActor, portalInput(ids), now, { locationId: missouri!.id, teamName, draftKey: randomUUID().replaceAll("-", "") });
  const reservedPending = await submit(youth("Prs"), "Portal Reserved", { club_name: clubName("c"), email: emailOf("regc") });
  assert(await kind(reservedPending) === "PENDING", "a team waits under the name Portal Reserved");
  await expectCode(portalSubmit(portalMembers.slice(0, 2), "  portal   RESERVED "), "CLUB_TEAM_NAME_TAKEN", "the club portal cannot take a waiting team's name, in any case or spacing", ["already registered for this event"]);
  assert(await prisma.clubEventRegistration.count({ where: { eventId, teamKey: "portal reserved" } }) === 0, "and nothing was registered");
  await link.resolvePendingTeam(eventId, (await submissionOf("Portal Reserved")).id, staffUserId, { action: "REJECT", reason: "Synthetic reason." });
  await portalSubmit(portalMembers.slice(0, 2), "PORTAL reserved");
  assert(await prisma.clubEventRegistration.count({ where: { eventId, organizationId: clubOf("b"), teamKey: "portal reserved" } }) === 1, "once the waiting team is rejected the name is free to the portal");
  const exemptPending = await submit(youth("Pex"), "Portal Exempt", { club_name: clubName("c"), email: emailOf("regc") });
  assert(await kind(exemptPending) === "PENDING", "another waiting team");
  const exemptDone = await link.resolvePendingTeam(eventId, (await submissionOf("Portal Exempt")).id, staffUserId, { action: "CONFIRM", organizationId: clubOf("c") });
  assert(exemptDone.status === "CONFIRMED" && await prisma.clubEventRegistration.count({ where: { eventId, teamKey: "portal exempt" } }) === 1, "staff confirming a waiting team are not blocked by its own reserved name");
  console.log("ok  a waiting team's name is reserved against the club portal, and released by its own confirmation or rejection");

  // 15c. The answer never tells a director from anyone else: the same refusals and the same success, whatever the email.
  const bodyFor = (matching: boolean, members: Array<ReturnType<typeof typedMember>>, teamName: string, site: string | null, label: string) => ({
    ...request(members, { club_name: clubName("a"), email: matching ? emailOf("dira") : emailOf("regc") }),
    locationId: site,
    teamName,
    label,
  });
  let probe = 0;
  const route = async (body: ReturnType<typeof bodyFor>) => {
    const { label, ...payload } = body;
    void label;
    const response = await post(general.POST as never, `/api/public/events/${eventSlug}/general-registrations`, { eventSlug }, payload, `gl-oracle-${P}-${probe += 1}`);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const sameForBoth = async (label: string, make: (matching: boolean) => ReturnType<typeof bodyFor>) => {
    const [matched, other] = [await route(make(true)), await route(make(false))];
    assert(matched.status !== 201 && matched.status === other.status && JSON.stringify(matched.body) === JSON.stringify(other.body), `${label}: a matching and a non-matching email get the same refusal, got ${matched.status} ${JSON.stringify(matched.body)} and ${other.status} ${JSON.stringify(other.body)}`);
    assert(!/deputy|club a|match(es|ed)? (a|the) (director|club)|not a director/i.test(JSON.stringify(matched.body)), `${label}: and the refusal says nothing about directors or clubs`);
    return matched;
  };
  const holdersBefore = [await registrationCount(), await prisma.generalLinkSubmission.count({ where: { eventId } })];
  await sameForBoth("a site that does not exist", (matching) => bodyFor(matching, youth("Or1"), "Oracle One", "no-such-location", "bad location"));
  await sameForBoth("no site", (matching) => bodyFor(matching, youth("Or2"), "Oracle Two", null, "no location"));
  await sameForBoth("a registered team's name", (matching) => bodyFor(matching, youth("Or3"), "bible BEES", missouri!.id, "registered name"));
  await sameForBoth("a waiting team's name", (matching) => bodyFor(matching, youth("Or4"), "WAITING wrong CLUB", missouri!.id, "waiting name"));
  await sameForBoth("a team that breaks the rules", (matching) => bodyFor(matching, Array.from({ length: 8 }, (_, index) => typedMember("GlOr", `N${index}`, 14)), "Oracle Rules", missouri!.id, "rules"));
  await sameForBoth("a person already on another team of the club", (matching) => bodyFor(matching, [typedMember("GlAlex", "Alpha", 14), typedMember("GlOr5", "Two", 14)], "Oracle Other Team", missouri!.id, "other team"));
  await sameForBoth("a form missing its confirmation", (matching) => ({ ...bodyFor(matching, youth("Or6"), "Oracle Six", missouri!.id, "form"), responses: { ...bodyFor(matching, youth("Or6"), "x", missouri!.id, "x").responses, director_confirmation: false } }));
  // Fields only the matched path used to refuse: lodging, responsible adults, promo codes, a choice that just became full.
  await sameForBoth("a lodging step", (matching) => ({ ...bodyFor(matching, youth("Lg1"), "Oracle Lodging", missouri!.id, "lodging"), lodging: { category: null } }) as ReturnType<typeof bodyFor>);
  await sameForBoth("responsible adults", (matching) => ({ ...bodyFor(matching, youth("Ra3"), "Oracle Adults", missouri!.id, "adults"), responsibleAdults: { someone: "someone" } }) as ReturnType<typeof bodyFor>);
  const originalDefinition = (await prisma.registrationFormVersion.findUniqueOrThrow({ where: { id: versionId } })).definition as { sections: Array<{ fields: Array<Record<string, unknown>> }> };
  const patched = JSON.parse(JSON.stringify(originalDefinition)) as typeof originalDefinition;
  patched.sections[0]!.fields.push({ id: "promo_probe", key: "promo_code", label: "Promo code", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] });
  for (const section of patched.sections) for (const field of section.fields) if (field.id === "pbe_release") field.choiceLimits = { Yes: 1 };
  await prisma.registrationFormVersion.update({ where: { id: versionId }, data: { definition: patched as never } });
  await sameForBoth("a promo code", (matching) => ({ ...bodyFor(matching, youth("Pr1"), "Oracle Promo", missouri!.id, "promo"), responses: { ...bodyFor(matching, youth("Pr1"), "x", missouri!.id, "x").responses, promo_code: "NOSUCHCODE", photo_video_release: "No" } }) as ReturnType<typeof bodyFor>);
  const reservation = await prisma.registrationCapacityReservation.create({ data: { eventId, formId: form.id, formVersionId: versionId, registrationId: bees.registrationId, fieldId: "pbe_release", fieldKey: "photo_video_release", optionValue: "Yes" } });
  const fullChoice = await sameForBoth("a choice that just became full", (matching) => bodyFor(matching, youth("Fc1"), "Oracle Choice", missouri!.id, "choice"));
  assert(fullChoice.body.error === "CAPACITY_REACHED", `the full choice is refused as full, got ${JSON.stringify(fullChoice.body)}`);
  await prisma.registrationCapacityReservation.delete({ where: { id: reservation.id } });
  await prisma.registrationFormVersion.update({ where: { id: versionId }, data: { definition: originalDefinition as never } });
  // A closed site and a full site, changed for these checks and put back.
  const closedBefore = missouri!.registrationClosesOn;
  await prisma.eventLocation.update({ where: { id: missouri!.id }, data: { registrationClosesOn: "2020-01-01" } });
  const closedRefusal = await sameForBoth("a closed site", (matching) => bodyFor(matching, youth("Or7"), "Oracle Closed", missouri!.id, "closed"));
  assert(closedRefusal.status === 410 && closedRefusal.body.error === "REGISTRATION_CLOSED", `the closed site is refused as closed, got ${JSON.stringify(closedRefusal.body)}`);
  await prisma.eventLocation.update({ where: { id: missouri!.id }, data: { registrationClosesOn: closedBefore } });
  const capacityBefore = { capacity: missouri!.capacity, waitlist: event.waitlistEnabled };
  await prisma.event.update({ where: { id: eventId }, data: { waitlistEnabled: false } });
  await prisma.eventLocation.update({ where: { id: missouri!.id }, data: { capacity: 1 } });
  const fullRefusal = await sameForBoth("a full site with no waitlist", (matching) => bodyFor(matching, youth("Or8"), "Oracle Full", missouri!.id, "full"));
  assert(fullRefusal.body.error === "LOCATION_FULL", `the full site is refused as full, got ${JSON.stringify(fullRefusal.body)}`);
  await prisma.eventLocation.update({ where: { id: missouri!.id }, data: { capacity: capacityBefore.capacity } });
  await prisma.event.update({ where: { id: eventId }, data: { waitlistEnabled: capacityBefore.waitlist } });
  assert([await registrationCount(), await prisma.generalLinkSubmission.count({ where: { eventId } })].join() === holdersBefore.join(), "none of the refusals stored anything");
  // The success is the same too: status, fields and words.
  const okMatched = await route(bodyFor(true, youth("Ok1"), "Oracle Ok One", missouri!.id, "ok"));
  const okOther = await route(bodyFor(false, youth("Ok2"), "Oracle Ok Two", missouri!.id, "ok"));
  const shape = (value: Record<string, unknown>) => {
    const confirmation = { ...(value.confirmation as Record<string, unknown>) };
    return { keys: Object.keys(confirmation).join(), message: confirmation.message, outcome: confirmation.outcome, clubName: confirmation.clubName, managePath: confirmation.managePath, expires: confirmation.manageLinkExpiresAt, code: /^PBE-[0-9A-F]{10}$/.test(String(confirmation.confirmationCode)), lines: confirmation.lineItems, status: confirmation.registrationStatus, place: confirmation.waitlistPosition, capacity: confirmation.capacityDecision, emailSent: confirmation.emailSent, notificationStatus: confirmation.notificationStatus, notificationQueued: confirmation.notificationQueued, paymentCollected: confirmation.paymentCollected };
  };
  assert(okMatched.status === 201 && okOther.status === 201 && JSON.stringify(shape(okMatched.body)) === JSON.stringify(shape(okOther.body)), `a matched and a waiting team get the same answer, got ${JSON.stringify(shape(okMatched.body))} and ${JSON.stringify(shape(okOther.body))}`);
  assert(await kind(okMatched.body.confirmation as { confirmationCode: string }) === "ATTACHED" && await kind(okOther.body.confirmation as { confirmationCode: string }) === "PENDING", "although one was attached and the other waits");
  console.log("ok  a matching and a non-matching email get identical refusals (site, closed, full, name, rules, form) and identical answers");

  // 15d. A team that lands on the event's waitlist is told it is waitlisted, never attached; the staff digest comes once a window.
  await prisma.eventLocation.update({ where: { id: iowa!.id }, data: { capacity: 1 } });
  await prisma.event.update({ where: { id: eventId }, data: { waitlistEnabled: true } });
  const fullPending = await submit(youth("Wl1"), "Waitlist Candidate", { club_name: clubName("c"), email: emailOf("regc") }, iowa!.id);
  assert(await kind(fullPending) === "PENDING", "a waiting team for a site with no room");
  const mailsBeforeWaitlist = new Set((await mailsTo(emailOf("regc"))).map((mail) => mail.id));
  const waitlisted = await link.resolvePendingTeam(eventId, (await submissionOf("Waitlist Candidate")).id, staffUserId, { action: "CONFIRM", organizationId: clubOf("c") });
  const waitlistedRegistration = await prisma.registration.findUniqueOrThrow({ where: { id: waitlisted.registrationId! } });
  assert(waitlistedRegistration.status === "WAITLISTED", `the confirmed team landed on the waitlist, got ${waitlistedRegistration.status}`);
  const waitlistMail = (await mailsTo(emailOf("regc"))).filter((mail) => !mailsBeforeWaitlist.has(mail.id));
  assert(waitlistMail.length === 1 && waitlistMail[0]!.recipientKind === "REGISTRANT" && /^Your team "Waitlist Candidate" was matched to Gl Club c/.test(waitlistMail[0]!.bodyTextSnapshot) && /on the waitlist/.test(waitlistMail[0]!.bodyTextSnapshot) && /not a confirmed registration/.test(waitlistMail[0]!.bodyTextSnapshot) && !/is attached to/i.test(`${waitlistMail[0]!.subjectSnapshot} ${waitlistMail[0]!.bodyTextSnapshot}`), `a waitlisted confirmation sends exactly ONE message, which says waitlisted, got ${JSON.stringify(waitlistMail.map((mail) => [mail.recipientKind, mail.subjectSnapshot, mail.bodyTextSnapshot.slice(0, 160)]))}`);
  await prisma.eventLocation.update({ where: { id: iowa!.id }, data: { capacity: iowa!.capacity } });
  await prisma.event.update({ where: { id: eventId }, data: { waitlistEnabled: false } });
  const digestCount = () => prisma.messageOutbox.count({ where: { eventId, recipientEmail: staffNoticeEmail, subjectSnapshot: { contains: "waiting for club confirmation" } } });
  const digestsNow = await digestCount();
  await link.submitGeneralLinkRegistration(eventSlug, request(youth("Dg1"), { club_name: clubName("c"), email: emailOf("regc") }), { locationId: missouri!.id, teamName: "Digest Same Window" }, new Date(now.getTime() + 5 * 60 * 1000));
  assert(await digestCount() === digestsNow, "a team waiting in the same 15 minutes sends staff no new email");
  await link.submitGeneralLinkRegistration(eventSlug, request(youth("Dg2"), { club_name: clubName("c"), email: emailOf("regc") }), { locationId: missouri!.id, teamName: "Digest Next Window" }, new Date(now.getTime() + 20 * 60 * 1000));
  assert(await digestCount() === digestsNow + 1, "the next window sends one more");
  console.log("ok  a waitlisted team is told it is waitlisted; staff get one digest per 15 minutes");

  // 15d2. A team name typed by a visitor is text in every email, never markup: no link or image comes of it.
  const noMarkup = (html: string | null) => !/<a\s[^>]*a\.test|<img[^>]*a\.test/i.test(html ?? "");
  const linkName = "[Invoice due - pay here](https://a.test)";
  const mailsBeforeInjection = new Set((await mailsTo(emailOf("dira"))).map((mail) => mail.id));
  const injected = await submit(youth("Inj"), linkName, { email: emailOf("dira") });
  assert(await kind(injected) === "ATTACHED", "a team named like a link, with a director's email, is attached");
  const injectedMail = (await mailsTo(emailOf("dira"))).filter((mail) => !mailsBeforeInjection.has(mail.id));
  assert(injectedMail.length === 1 && injectedMail[0]!.bodyHtmlSnapshot !== null && noMarkup(injectedMail[0]!.bodyHtmlSnapshot), `the matched confirmation holds no link or image for the typed team name, got ${injectedMail[0]?.bodyHtmlSnapshot?.slice(0, 400)}`);
  assert(injectedMail[0]!.bodyTextSnapshot.includes(linkName) && injectedMail[0]!.bodyHtmlSnapshot!.includes("Invoice due - pay here"), "and the name still reads, as plain text, in both parts");
  const imageName = "![](https://a.test/p.png)";
  const imagePending = await submit(youth("Img"), imageName, { club_name: clubName("c"), email: emailOf("regc") });
  assert(await kind(imagePending) === "PENDING", "a team named like an image waits");
  const pendingMail = (await mailsTo(emailOf("regc"))).find((mail) => mail.bodyTextSnapshot.includes(imageName));
  assert(pendingMail && noMarkup(pendingMail.bodyHtmlSnapshot) && !/[\r\n]/.test(pendingMail.subjectSnapshot), "the waiting email holds no image or link, and its subject is one line");
  const htmlName = '<a href="https://a.test">x</a>';
  await prisma.eventLocation.update({ where: { id: iowa!.id }, data: { capacity: 1 } });
  await prisma.event.update({ where: { id: eventId }, data: { waitlistEnabled: true } });
  await submit(youth("Htm"), htmlName, { club_name: clubName("c"), email: emailOf("regc") }, iowa!.id);
  const mailsBeforeHtml = new Set((await mailsTo(emailOf("regc"))).map((mail) => mail.id));
  const htmlConfirm = await link.resolvePendingTeam(eventId, (await submissionOf(htmlName)).id, staffUserId, { action: "CONFIRM", organizationId: clubOf("c") });
  assert((await prisma.registration.findUniqueOrThrow({ where: { id: htmlConfirm.registrationId! } })).status === "WAITLISTED", "the confirmed team landed on the waitlist");
  const htmlMail = (await mailsTo(emailOf("regc"))).filter((mail) => !mailsBeforeHtml.has(mail.id));
  assert(htmlMail.length === 1 && htmlMail[0]!.bodyHtmlSnapshot !== null && noMarkup(htmlMail[0]!.bodyHtmlSnapshot) && htmlMail[0]!.bodyHtmlSnapshot!.includes("&lt;a href"), `the waitlisted staff confirmation shows the name escaped, as text, got ${htmlMail[0]?.bodyHtmlSnapshot?.slice(0, 400)}`);
  await prisma.eventLocation.update({ where: { id: iowa!.id }, data: { capacity: iowa!.capacity } });
  await prisma.event.update({ where: { id: eventId }, data: { waitlistEnabled: false } });
  console.log("ok  a team name typed as a link, an image or HTML is plain text in every email");

  // 15e. The cap on waiting teams per rolling hour: over it, a matching and a non-matching email are refused alike.
  const capRows = Array.from({ length: 60 }, (_, index) => ({
    eventId, confirmationCode: `PBE-CAP${P.slice(3)}${index}`.slice(0, 40), idempotencyKey: `${P}-cap-${index}`, requestHash: "x", clubNameAsEntered: "x", directorEmail: "cap@example.test",
    directorName: "x", teamName: "", teamKey: "", attendeeCount: 1, payload: {}, createdAt: new Date(now.getTime() - 5 * 60 * 1000),
  }));
  await prisma.generalLinkSubmission.createMany({ data: capRows });
  const capped = await Promise.all([true, false].map((matching) => caught(link.submitGeneralLinkRegistration(eventSlug, request(youth("Cap"), { club_name: clubName("a"), email: matching ? emailOf("dira") : emailOf("regc") }), { locationId: missouri!.id, teamName: "Cap Team" }, now))));
  assert(capped.every((error) => (error as { code?: string } | null)?.code === "TOO_MANY_PENDING" && (error as Error).message === "Too many registrations right now; please try again later."), `over the hourly cap both are refused with the same generic message, got ${capped.map(String).join(" | ")}`);
  const cappedRoute = await Promise.all([true, false].map((matching) => route(bodyFor(matching, youth("Cap"), "Cap Team", missouri!.id, "cap"))));
  assert(cappedRoute[0]!.status === 429 && cappedRoute[1]!.status === 429 && JSON.stringify(cappedRoute[0]!.body) === JSON.stringify(cappedRoute[1]!.body), "through the route: the same 429 and body");
  await prisma.generalLinkSubmission.deleteMany({ where: { eventId, idempotencyKey: { startsWith: `${P}-cap-` } } });
  console.log("ok  the hourly cap on waiting teams refuses every request alike");

  // 15f. Retention: a waiting team is expired 30 days after the event ends, its answers removed, the table's check holding.
  const stale = await prisma.generalLinkSubmission.findFirstOrThrow({ where: { eventId, status: "PENDING", teamName: "Digest Next Window" } });
  const eventEnds = (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).endsAt;
  const tooEarly = await link.expireStalePendingTeams(new Date(eventEnds.getTime() + 29 * 24 * 60 * 60 * 1000), { eventId });
  assert((await prisma.generalLinkSubmission.findUniqueOrThrow({ where: { id: stale.id } })).status === "PENDING" && tooEarly.expired === 0, "29 days after the event nothing expires");
  const sweptAt = new Date(eventEnds.getTime() + 31 * 24 * 60 * 60 * 1000);
  const waitingBefore = await prisma.generalLinkSubmission.count({ where: { eventId, status: "PENDING" } });
  const swept = await link.expireStalePendingTeams(sweptAt, { eventId });
  assert(swept.expired === waitingBefore && swept.events === 1, `31 days after, every waiting team of the event expires, got ${JSON.stringify(swept)} for ${waitingBefore}`);
  const expiredRow = await prisma.generalLinkSubmission.findUniqueOrThrow({ where: { id: stale.id } });
  assert(expiredRow.status === "EXPIRED" && expiredRow.resolution === "RETENTION_EXPIRED" && expiredRow.payload === null && expiredRow.resolvedAt !== null && expiredRow.resolvedByUserId === null, "marked EXPIRED with the answers removed");
  assert(!expiredRow.directorName && !expiredRow.directorEmail && !expiredRow.teamName && !expiredRow.clubNameAsEntered && !expiredRow.teamKey && expiredRow.id === stale.id && expiredRow.eventId === eventId, "its contact details, team name and club as entered are blanked, ids and status kept");
  const rejectedAfter = await prisma.generalLinkSubmission.findUniqueOrThrow({ where: { id: wrongSubmission.id } });
  assert(rejectedAfter.status === "REJECTED" && !rejectedAfter.directorName && !rejectedAfter.directorEmail && !rejectedAfter.teamName && !rejectedAfter.clubNameAsEntered && swept.blanked >= 1, `a team rejected earlier is blanked by the same sweep, got ${JSON.stringify(swept)}`);
  assert(await prisma.auditLog.count({ where: { eventId, action: "GENERAL_LINK_TEAMS_BLANKED" } }) === 1 && !/@|Gl[A-Za-z]+/.test(JSON.stringify((await prisma.auditLog.findFirstOrThrow({ where: { eventId, action: "GENERAL_LINK_TEAMS_BLANKED" } })).metadata).replace(new RegExp(P, "g"), "")), "audited with ids and a count");
  assert(await prisma.generalLinkSubmission.count({ where: { eventId, status: "PENDING" } }) === 0 && (await link.listPendingTeams(eventId, now)).length === 0, "nothing is left waiting");
  const expiryAudit = await prisma.auditLog.findFirstOrThrow({ where: { eventId, action: "GENERAL_LINK_TEAMS_EXPIRED" } });
  const expiryMeta = expiryAudit.metadata as { generalLinkSubmissionIds?: string[]; count?: number };
  assert(expiryMeta.count === waitingBefore && expiryMeta.generalLinkSubmissionIds?.length === waitingBefore && !/Gl[A-Za-z]+|Kid|@/.test(JSON.stringify(expiryMeta).replace(new RegExp(P, "g"), "")), "audited with the ids and a count, never an answer");
  const secondSweep = await link.expireStalePendingTeams(sweptAt, { eventId });
  assert(secondSweep.expired === 0 && secondSweep.blanked === 0, "a second sweep changes nothing");
  assert(await prisma.clubEventRegistration.count({ where: { eventId, teamKey: "digest next window" } }) === 0, "and an expired team holds no registration");
  console.log("ok  retention: waiting teams expire 30 days after the event, answers removed, audited with ids and a count");

  // 16. The table constraints (the sweep above left nothing waiting, so one more team waits first).
  await submit(youth("Con"), "Constraint Row", { club_name: clubName("c"), email: emailOf("regc") });
  const constraintRow = await prisma.generalLinkSubmission.findFirstOrThrow({ where: { eventId, status: "PENDING" } });
  const noPayload = await caught(prisma.$executeRawUnsafe(`UPDATE "GeneralLinkSubmission" SET "payload" = NULL WHERE "id" = '${constraintRow.id}'`));
  assert(noPayload && /GeneralLinkSubmission_payload_check/.test(dbError(noPayload)), `a waiting submission must keep its answers, got ${dbError(noPayload)}`);
  const keptPayload = await caught(prisma.$executeRawUnsafe(`UPDATE "GeneralLinkSubmission" SET "status" = 'REJECTED', "resolution" = 'STAFF_REJECTED', "resolvedAt" = now() WHERE "id" = '${constraintRow.id}'`));
  assert(keptPayload && /GeneralLinkSubmission_payload_check/.test(dbError(keptPayload)), `a resolved submission must not keep its answers, got ${dbError(keptPayload)}`);
  const sameName = await caught(prisma.generalLinkSubmission.create({
    data: { eventId, confirmationCode: `PBE-${randomUUID().slice(0, 8)}`, idempotencyKey: randomUUID(), requestHash: "x", clubNameAsEntered: "x", directorEmail: "x@example.test", directorName: "x", teamName: constraintRow.teamName, teamKey: constraintRow.teamKey, attendeeCount: 1, payload: {} },
  }));
  assert(sameName && /pending_team_name|Unique constraint/.test(dbError(sameName)), `two waiting teams cannot share a name key, got ${dbError(sameName)}`);
  console.log("ok  the table constraints: answers exist only while waiting, a waiting name is unique in the event");

  console.log("ok  all general registration link checks passed");
}

main()
  .then(async () => {
    await cleanup();
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await cleanup().catch((cleanupError: unknown) => console.error("cleanup failed", cleanupError));
    await prisma.$disconnect();
    process.exit(1);
  });
