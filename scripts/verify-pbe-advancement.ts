/**
 * Proves PBE team advancement inside one event (#945) against a real PostgreSQL database, where the unit tests'
 * in-memory stand-ins can't:
 *
 * - entering Area placements marks 1st and 2nd advancing in each Area, a tie advances both, and 3rd does not;
 * - a staff override either way beats the place, is audited with ids only, and survives a recompute;
 * - the Conference list, results CSV, roster CSV and printed forms hold exactly the advancing teams, with no new
 *   registration, and a team that did not advance never appears (nor can it be given a Conference result or checked in);
 * - entering placements, overrides and a recompute queue and send nothing; "Send notices" queues one notice per advancing
 *   team with the Conference date and place, a second press adds nothing, and the outbox rows are unique per team and level;
 * - team check-in for the Conference day: once per team, undoable, audited with ids only, and refused for a team that did not advance;
 * - a director may update an advanced team's people between levels under the team rules after the registration window
 *   has closed, while a team that did not advance stays closed;
 * - old free-text rows stay readable, are flagged for re-entry, keep their earlier decision through a recompute, and are
 *   replaced by a number when staff re-enter them;
 * - the table constraints on the new columns and table.
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:pbe-advancement
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrismaClient, RegistrationFormStatus } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-pbe-advancement-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `pbadv_${randomUUID().slice(0, 8)}`;
const S = P.replace(/_/g, "-");
const staffUserId = `${P}_staff`;
const actor = { userId: staffUserId, actAsId: `${P}_actas` };
const now = new Date("2026-10-20T15:00:00Z");
const clubOf = (key: string) => `${P}_club_${key}`;
const churchId = `${P}_church`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function caught(promise: Promise<unknown>) {
  return promise.then(() => null, (error: unknown) => error);
}

async function expectCode(promise: Promise<unknown>, code: string, message: string) {
  const error = await caught(promise);
  const found = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
  assert(found === code, `${message}: expected ${code}, got ${String(error)}`);
}

let templateIdsBefore = new Set<string>();

async function cleanup() {
  const events = await prisma.event.findMany({ where: { OR: [{ id: { startsWith: `${P}_` } }, { slug: { startsWith: `${S}-` } }] }, select: { id: true } });
  const eventIds = events.map((event) => event.id);
  const registrationIds = (await prisma.registration.findMany({ where: { eventId: { in: eventIds } }, select: { id: true } })).map((row) => row.id);
  await prisma.messageOutbox.deleteMany({ where: { OR: [{ registrationId: { in: registrationIds } }, { eventId: { in: eventIds } }] } });
  // Amendment records are immutable by trigger; this script's own synthetic rows are removed with the trigger off for that
  // one transaction, and it is back on before anything else can write.
  await prisma.$transaction([
    prisma.$executeRawUnsafe('ALTER TABLE "RegistrationOperation" DISABLE TRIGGER "RegistrationOperation_immutable"'),
    prisma.registrationOperation.deleteMany({ where: { eventId: { in: eventIds } } }),
    prisma.$executeRawUnsafe('ALTER TABLE "RegistrationOperation" ENABLE TRIGGER "RegistrationOperation_immutable"'),
  ]);
  await prisma.auditLog.deleteMany({ where: { OR: [{ eventId: { in: eventIds } }, { actorUserId: staffUserId }] } });
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
  await prisma.person.deleteMany({ where: { normalizedEmail: { startsWith: "pbadv-" } } });
  await prisma.person.deleteMany({ where: { firstName: { startsWith: "Pbadv" } } });
  await prisma.attendeeAccount.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.user.deleteMany({ where: { id: staffUserId } });
}

async function main() {
  const { sealBirthDate } = await import("../modules/club-rosters/birth-dates");
  const { clubAttendeeClientId } = await import("../modules/club-registrations/domain");
  const club = await import("../modules/club-registrations/repository");
  const { addStarterEventTemplates } = await import("../modules/event-templates/starter-repository");
  const { applyEventTemplate } = await import("../modules/event-templates/repository");
  const { saveTeamResult, listTeamResults, recomputeAdvancement } = await import("../modules/club-teams/results-repository");
  const { listLevelTeams, setTeamLevelCheckIn } = await import("../modules/club-teams/level-repository");
  const { previewAdvancementNotices, sendAdvancementNotices } = await import("../modules/club-teams/advancement-notices");
  const { teamResultsCsvRows, levelRosterCsvRows, teamsAtLevel } = await import("../modules/club-teams/results-domain");
  const { loadFilledTeamForm } = await import("../modules/club-teams/team-form-repository");
  const { TeamFormSheet } = await import("../components/team-form-sheet");

  templateIdsBefore = new Set((await prisma.eventTemplate.findMany({ select: { id: true } })).map((row) => row.id));
  await cleanup();
  await prisma.user.create({ data: { id: staffUserId, email: `${P}-staff@example.test`, displayName: "PBE Advancement Staff", globalRole: "SYSTEM_ADMIN" } });
  await prisma.organization.create({ data: { id: churchId, type: "CHURCH", name: `Pbadv Church ${P}`, normalizedName: `pbadv church ${P}` } });
  const clubKeys = ["a", "b", "c", "d", "e", "f"] as const;
  await prisma.organization.createMany({
    data: clubKeys.map((key) => ({ id: clubOf(key), type: "CLUB" as const, name: `Pbadv Club ${key} ${P}`, normalizedName: `pbadv club ${key} ${P}`, parentOrganizationId: churchId })),
  });
  const born = { youth: sealBirthDate("2013-06-01"), adult: sealBirthDate("1985-03-02") };
  const members = new Map<string, string>();
  async function addMember(clubKey: string, key: string, kind: keyof typeof born, type: "YOUTH" | "STAFF", first: string, last: string) {
    const person = await prisma.person.create({ data: { id: `${P}_${clubKey}_${key}`, firstName: first, lastName: last } });
    const member = await prisma.clubRosterMember.create({
      data: { organizationId: clubOf(clubKey), clubYear: "2026-27", personId: person.id, attendeeType: type, role: type === "STAFF" ? "Counselor" : "Pathfinder", sealedBirthDate: born[kind], source: "DIRECTOR" },
    });
    members.set(`${clubKey}:${key}`, member.id);
  }
  for (const key of clubKeys) {
    for (let index = 1; index <= 4; index += 1) await addMember(key, `y${index}`, "youth", "YOUTH", `Pbadv${key.toUpperCase()}`, `Kid${index}`);
    await addMember(key, "coach1", "adult", "STAFF", "PbadvCoach", `Of${key.toUpperCase()}`);
  }
  const clientId = (clubKey: string, key: string) => clubAttendeeClientId(members.get(`${clubKey}:${key}`)!);

  // 1. One event from the starter template, with its two Areas and its Conference and Union dates and places.
  await addStarterEventTemplates(staffUserId);
  const template = await prisma.eventTemplate.findFirstOrThrow({ where: { versions: { some: { payload: { path: ["starterKey"], equals: "pathfinder_bible_experience" } } } } });
  const applied = await applyEventTemplate(template.id, staffUserId, {
    name: `Pbadv check ${P}`, slug: `${S}-pbe`, startsOn: "2027-01-16", endsOn: "2027-01-16", requestKey: `${P}-apply-key-1`,
  });
  assert(applied.event, "the template creates an event");
  const eventId = applied.event.id;
  await prisma.eventTeamSettings.update({
    where: { eventId },
    data: { levelInfo: [{ level: "CONFERENCE", date: "2027-02-20", place: "Camp Synthetic" }, { level: "UNION", date: "2027-03-20", place: "Union Test Site" }] },
  });
  const form = await prisma.registrationForm.findFirstOrThrow({ where: { eventId }, include: { versions: true } });
  await prisma.registrationFormVersion.updateMany({ where: { formId: form.id }, data: { status: RegistrationFormStatus.PUBLISHED, publishedAt: new Date() } });
  await prisma.registrationForm.update({ where: { id: form.id }, data: { status: RegistrationFormStatus.PUBLISHED } });
  await prisma.event.update({ where: { id: eventId }, data: { isPublished: true } });
  const versionId = form.versions[0]!.id;
  const sites = await prisma.eventLocation.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" } });
  const [missouri, iowa] = sites;
  assert(missouri && iowa && missouri.name === "Missouri" && iowa.name === "Iowa", "the event has the Missouri and Iowa Areas");

  type Person = { client: string; role?: string };
  const input = (people: Person[]) => ({
    versionId,
    idempotencyKey: randomUUID(),
    responses: {
      director_name: "Pbadv Director", email: "pbadv-director@example.test", phone: "515-555-0100",
      coordinator_name: "Pbadv Coordinator", coordinator_address: "1 Synthetic Road", coordinator_city: "Testville", coordinator_state: "IA", coordinator_zip: "50000",
      coordinator_phone: "515-555-0101", coordinator_email: "pbadv-coordinator@example.test",
      director_confirmation: true, photo_video_release: "Yes",
    },
    attendees: people.map((entry) => ({ clientId: entry.client, responses: { attendee_type: entry.role ?? "Pathfinder" } })),
    website: "" as const,
  });
  const team = (clubKey: string): Person[] => [
    { client: clientId(clubKey, "y1") }, { client: clientId(clubKey, "y2") }, { client: clientId(clubKey, "y3") }, { client: clientId(clubKey, "coach1"), role: "Coach" },
  ];
  const draftKey = () => randomUUID().replaceAll("-", "");
  // Six teams, three in each Area. Each registers once, here, and never again.
  const plan: Array<[string, string, string]> = [["a", "Aces", missouri.id], ["b", "Bees", missouri.id], ["c", "Cubs", missouri.id], ["d", "Doves", iowa.id], ["e", "Eagles", iowa.id], ["f", "Foxes", iowa.id]];
  for (const [clubKey, teamName, locationId] of plan) {
    await club.submitClubRegistration(clubOf(clubKey), eventId, actor, input(team(clubKey)), now, { locationId, teamName, draftKey: draftKey() });
  }
  const rowOf = (teamName: string) => prisma.clubEventRegistration.findFirstOrThrow({ where: { eventId, teamName }, include: { registration: true } });
  const ids: Record<string, string> = {};
  for (const [, teamName] of plan) ids[teamName] = (await rowOf(teamName)).id;
  const registrationsBefore = await prisma.registration.count({ where: { eventId } });
  assert(registrationsBefore === 6, "six teams are registered");
  const outboxCount = () => prisma.messageOutbox.count({ where: { eventId, templateKey: "CLUB_TEAM_ADVANCEMENT_NOTICE" } });
  console.log("ok  one event, two Areas, six teams registered once each");

  // 2. Area placements: 1st and 2nd advance in each Area, a tie advances both, 3rd does not.
  await saveTeamResult(eventId, ids.Aces!, { level: "AREA", placementRank: 1 }, staffUserId);
  await saveTeamResult(eventId, ids.Bees!, { level: "AREA", placementRank: 2 }, staffUserId);
  await saveTeamResult(eventId, ids.Cubs!, { level: "AREA", placementRank: 3 }, staffUserId);
  await saveTeamResult(eventId, ids.Doves!, { level: "AREA", placementRank: 1 }, staffUserId);
  await saveTeamResult(eventId, ids.Eagles!, { level: "AREA", placementRank: 2 }, staffUserId);
  await saveTeamResult(eventId, ids.Foxes!, { level: "AREA", placementRank: 2, notes: "Tied for 2nd" }, staffUserId);
  const qualifiedOf = async () => Object.fromEntries((await listTeamResults(eventId)).map((row) => [row.teamName, row.results.AREA?.qualified]));
  let qualified = await qualifiedOf();
  assert(qualified.Aces === true && qualified.Bees === true && qualified.Cubs === false, "in Missouri 1st and 2nd advance and 3rd does not");
  assert(qualified.Doves === true && qualified.Eagles === true && qualified.Foxes === true, "in Iowa a tie for 2nd advances both teams");
  assert(await outboxCount() === 0, "entering placements queues no notice");
  console.log("ok  Area placements: 1st and 2nd advance per Area, a tie advances both, 3rd does not");

  // 3. Overrides either way, audited with ids only, and kept by a recompute.
  await saveTeamResult(eventId, ids.Cubs!, { level: "AREA", placementRank: 3, advanceOverride: true }, staffUserId);
  await saveTeamResult(eventId, ids.Doves!, { level: "AREA", placementRank: 1, advanceOverride: false }, staffUserId);
  qualified = await qualifiedOf();
  assert(qualified.Cubs === true && qualified.Doves === false, "an override beats the place, either way");
  const overrideAudits = await prisma.auditLog.findMany({ where: { eventId, action: "CLUB_TEAM_ADVANCEMENT_OVERRIDDEN" } });
  assert(overrideAudits.length === 2 && overrideAudits.every((row) => row.actorUserId === staffUserId), "each override is audited with the actor");
  for (const audit of overrideAudits) {
    const text = `${audit.summary} ${JSON.stringify(audit.metadata)}`;
    assert(!/Aces|Bees|Cubs|Doves|Eagles|Foxes|Pbadv/.test(text), `the override audit holds ids only, got ${text}`);
  }
  // A stale answer (written behind the app's back) is corrected by a recompute; overrides are not.
  await prisma.clubTeamResult.updateMany({ where: { clubEventRegistrationId: ids.Aces!, level: "AREA" }, data: { qualified: false } });
  await prisma.clubTeamResult.updateMany({ where: { clubEventRegistrationId: ids.Eagles!, level: "AREA" }, data: { qualified: false } });
  const recomputed = await recomputeAdvancement(eventId, "AREA", staffUserId);
  assert(recomputed.changed.length === 2 && recomputed.changed.includes(ids.Aces!) && recomputed.changed.includes(ids.Eagles!), "the recompute fixes only the stale answers");
  qualified = await qualifiedOf();
  assert(qualified.Cubs === true && qualified.Doves === false && qualified.Aces === true && qualified.Eagles === true, "overrides survive a recompute and the rule is restored elsewhere");
  const cubsResult = await prisma.clubTeamResult.findFirstOrThrow({ where: { clubEventRegistrationId: ids.Cubs!, level: "AREA" } });
  assert(cubsResult.advanceOverride === true && cubsResult.placementRank === 3, "the override flag and the place are kept");
  assert(await outboxCount() === 0, "overrides and a recompute queue no notice either");
  console.log("ok  overrides beat the place either way, are audited with ids only, and survive a recompute");

  // 4. The Conference list, exports and printouts: exactly the advancing teams, no new registration.
  const conference = await listLevelTeams(eventId, "CONFERENCE");
  const names = conference.map((row) => row.teamName).sort();
  assert(names.join() === "Aces,Bees,Cubs,Eagles,Foxes", `the Conference list is exactly the advancing teams, got ${names.join()}`);
  assert(!names.includes("Doves"), "a team staff kept from advancing is not on it");
  const aces = conference.find((row) => row.teamName === "Aces")!;
  assert(aces.areaName === "Missouri" && aces.members.length === 3 && aces.coaches.length === 1 && aces.clubName.includes("Pbadv Club a"), "each team shows its Area, club, members and coaches");
  assert((await listLevelTeams(eventId, "AREA")).length === 6, "the Area list is every registered team");
  assert((await listLevelTeams(eventId, "UNION")).length === 0, "nobody is at Union yet");
  const report = await listTeamResults(eventId);
  const csv = teamResultsCsvRows(report, "CONFERENCE");
  assert(csv.slice(1).map((row) => row[0]).sort().join() === "Aces,Bees,Cubs,Eagles,Foxes", "the Conference results CSV holds the same teams");
  const roster = levelRosterCsvRows(conference);
  assert(roster.slice(1).every((row) => row[0] !== "Doves") && roster.length === 1 + 5 * 4, "the roster CSV holds each advancing team's people");
  assert(teamsAtLevel(report, "CONFERENCE").length === 5, "the domain filter agrees");
  for (const team of conference) {
    const printed = await loadFilledTeamForm({ eventId, clubEventRegistrationId: team.clubEventRegistrationId });
    assert(printed && renderToStaticMarkup(createElement(TeamFormSheet, { model: printed.model })).includes(team.teamName), `the form prints for ${team.teamName}`);
  }
  assert(await prisma.registration.count({ where: { eventId } }) === registrationsBefore, "nobody registered again");
  console.log("ok  the Conference list, results CSV, roster CSV and printed forms are exactly the advancing teams");

  // 5. A team that did not advance never reaches Conference.
  await expectCode(saveTeamResult(eventId, ids.Doves!, { level: "CONFERENCE", placementRank: 1 }, staffUserId), "RESULT_INVALID", "a team that did not advance gets no Conference result");
  await expectCode(setTeamLevelCheckIn(eventId, ids.Doves!, "CONFERENCE", true, staffUserId), "RESULT_INVALID", "and cannot be checked in for Conference");
  await expectCode(saveTeamResult(eventId, ids.Aces!, { level: "UNION", placementRank: 1 }, staffUserId), "RESULT_INVALID", "a team that has not advanced from Conference gets no Union result");
  assert(await prisma.clubTeamResult.count({ where: { clubEventRegistrationId: ids.Doves!, level: { not: "AREA" } } }) === 0, "nothing was stored for it");
  console.log("ok  a team that did not advance gets no result and no check-in at the next level");

  // 6. Notices: nothing until staff press "Send notices"; then one per team and level, with the date and place.
  assert(await outboxCount() === 0, "nothing is queued before staff press Send notices");
  const preview = await previewAdvancementNotices(eventId, "CONFERENCE");
  assert(preview.toSend === 5 && preview.alreadyQueued === 0 && preview.noEmail === 0 && preview.date === "2027-02-20" && preview.place === "Camp Synthetic", "the preview counts the notices and shows the date and place");
  assert(await outboxCount() === 0, "the preview queues nothing");
  const sent = await sendAdvancementNotices(eventId, "CONFERENCE", staffUserId);
  assert(sent.queued === 5 && sent.alreadyQueued === 0, `five notices are queued, got ${sent.queued}`);
  const notices = await prisma.messageOutbox.findMany({ where: { eventId, templateKey: "CLUB_TEAM_ADVANCEMENT_NOTICE" } });
  assert(notices.length === 5 && new Set(notices.map((row) => row.idempotencyKey)).size === 5, "one outbox row per team");
  assert(notices.every((row) => row.bodyTextSnapshot.includes("February 20, 2027") && row.bodyTextSnapshot.includes("Camp Synthetic") && row.recipientEmail === "pbadv-director@example.test"), "each notice carries the Conference date and place");
  assert(!notices.some((row) => row.bodyTextSnapshot.includes("Doves")), "no notice for the team that did not advance");
  const again = await sendAdvancementNotices(eventId, "CONFERENCE", staffUserId);
  assert(again.queued === 0 && again.alreadyQueued === 5, "a second press queues nothing more");
  assert(await outboxCount() === 5, "still five rows");
  const racing = await Promise.allSettled([sendAdvancementNotices(eventId, "CONFERENCE", staffUserId), sendAdvancementNotices(eventId, "CONFERENCE", staffUserId)]);
  assert(racing.every((result) => result.status === "fulfilled" || /conflict|serializ|deadlock|P2034/i.test(String((result as PromiseRejectedResult).reason))), "two presses at once never fail in a way that duplicates");
  assert(await outboxCount() === 5, "two presses at once still leave five rows");
  const noticeAudit = await prisma.auditLog.findMany({ where: { eventId, action: "CLUB_TEAM_ADVANCEMENT_NOTICES_SENT" } });
  assert(noticeAudit.length === 1 && !JSON.stringify(noticeAudit[0]!.metadata).includes("@"), "the send is audited once, with counts and ids and no address");
  const conferenceAfter = await listLevelTeams(eventId, "CONFERENCE");
  assert(conferenceAfter.every((row) => row.noticeQueued), "the Conference list shows each notice as queued");
  console.log("ok  notices: nothing until staff press Send notices, then one per team and level with the date and place, never twice");

  // 7. Team check-in for the Conference day.
  const first = await setTeamLevelCheckIn(eventId, ids.Aces!, "CONFERENCE", true, staffUserId);
  assert(first.changed && first.checkedInAt, "a team checks in for Conference");
  assert(!(await setTeamLevelCheckIn(eventId, ids.Aces!, "CONFERENCE", true, staffUserId)).changed, "checking in again changes nothing");
  assert((await listLevelTeams(eventId, "CONFERENCE")).find((row) => row.teamName === "Aces")?.checkedInAt !== null, "the list shows the team checked in");
  assert(await prisma.clubTeamLevelCheckIn.count({ where: { eventId, level: "CONFERENCE" } }) === 1, "one check-in row for the team and level");
  const undone = await setTeamLevelCheckIn(eventId, ids.Aces!, "CONFERENCE", false, staffUserId);
  assert(undone.changed && undone.checkedInAt === null, "a check-in can be undone");
  const reChecked = await setTeamLevelCheckIn(eventId, ids.Aces!, "CONFERENCE", true, staffUserId);
  assert(reChecked.changed && await prisma.clubTeamLevelCheckIn.count({ where: { eventId, level: "CONFERENCE" } }) === 1, "and done again on the same row");
  await expectCode(setTeamLevelCheckIn(eventId, ids.Aces!, "AREA", true, staffUserId), "RESULT_INVALID", "the Area day uses the usual attendee check-in");
  const checkInAudits = await prisma.auditLog.findMany({ where: { eventId, action: { startsWith: "CLUB_TEAM_LEVEL_CHECK" } } });
  assert(checkInAudits.length === 3, `each change is audited (checked in, undone, checked in again), got ${checkInAudits.length}`);
  assert(checkInAudits.every((row) => JSON.stringify(row.metadata).includes(ids.Aces!)), "check-in audits carry the team's id");
  const dupCheckIn = await caught(prisma.clubTeamLevelCheckIn.create({ data: { eventId, clubEventRegistrationId: ids.Aces!, level: "CONFERENCE" } }));
  assert(dupCheckIn, "the table holds one row per team and level");
  console.log("ok  Conference check-in: once per team, undoable, audited, refused for a team that did not advance");

  // 8. A director updates an advanced team's people between levels, after the registration window has closed.
  const afterClose = new Date("2027-01-25T15:00:00Z");
  const editFor = (clubKey: string, keys: string[], teamKey: string, updatedAt: Date) => ({
    clientRequestId: randomUUID(), expectedUpdatedAt: updatedAt.toISOString(), selectedMemberIds: keys.map((key) => members.get(`${clubKey}:${key}`)!),
    keptGuestIds: [] as string[], keptOffRosterAttendeeIds: [] as string[], newGuests: [] as never[],
    attendeeResponses: Object.fromEntries(keys.map((key) => [clientId(clubKey, key), { attendee_type: key.startsWith("coach") ? "Coach" : "Pathfinder" }])),
    teamKey,
  });
  const acesRow = await rowOf("Aces");
  const dovesRow = await rowOf("Doves");
  const workspaceAfterClose = await club.getClubEventWorkspace(clubOf("a"), eventId, afterClose, { teamKey: "aces" });
  assert(workspaceAfterClose.event.edit.open && workspaceAfterClose.registration?.nextLevel?.level === "CONFERENCE" && workspaceAfterClose.registration.nextLevel.whenWhere.includes("Camp Synthetic"), "an advanced team's page is open for changes and says where Conference is");
  await club.amendClubRegistration(clubOf("a"), eventId, actor, editFor("a", ["y1", "y2", "y3", "y4", "coach1"], "aces", acesRow.registration.updatedAt), afterClose);
  assert(await prisma.registrationAttendee.count({ where: { registrationId: acesRow.registrationId } }) === 5, "the advanced team's change is saved after the registration deadline");
  const acesAfter = await rowOf("Aces");
  await expectCode(
    club.amendClubRegistration(clubOf("a"), eventId, actor, editFor("a", ["y1", "coach1"], "aces", acesAfter.registration.updatedAt), afterClose),
    "TEAM_RULES", "the team rules still apply between levels",
  );
  const closed = await club.getClubEventWorkspace(clubOf("d"), eventId, afterClose, { teamKey: "doves" });
  assert(!closed.event.edit.open && closed.registration?.nextLevel === null, "a team that did not advance stays closed");
  await expectCode(club.amendClubRegistration(clubOf("d"), eventId, actor, editFor("d", ["y1", "y2", "y3", "y4", "coach1"], "doves", dovesRow.registration.updatedAt), afterClose), "REGISTRATION_CLOSED", "and cannot change its people");
  const afterConferenceDate = new Date("2027-02-21T15:00:00Z");
  assert(!(await club.getClubEventWorkspace(clubOf("a"), eventId, afterConferenceDate, { teamKey: "aces" })).event.edit.open, "the window closes once Conference has been held");
  console.log("ok  between levels a director updates an advanced team under the team rules; a team that did not advance stays closed");

  // 9. Conference to Union: the same top-2 rule, with an override, and Union is the last level.
  await saveTeamResult(eventId, ids.Aces!, { level: "CONFERENCE", placementRank: 1 }, staffUserId);
  await saveTeamResult(eventId, ids.Bees!, { level: "CONFERENCE", placementRank: 2 }, staffUserId);
  await saveTeamResult(eventId, ids.Cubs!, { level: "CONFERENCE", placementRank: 3 }, staffUserId);
  await saveTeamResult(eventId, ids.Eagles!, { level: "CONFERENCE", placementRank: 4, advanceOverride: true }, staffUserId);
  const union = (await listLevelTeams(eventId, "UNION")).map((row) => row.teamName).sort();
  assert(union.join() === "Aces,Bees,Eagles", `Union holds the top 2 from Conference and the override, got ${union.join()}`);
  await expectCode(saveTeamResult(eventId, ids.Aces!, { level: "UNION", placementRank: 1, advanceOverride: true }, staffUserId), "RESULT_INVALID", "nothing advances from the last level");
  const unionNotices = await sendAdvancementNotices(eventId, "UNION", staffUserId);
  assert(unionNotices.queued === 3 && unionNotices.date === "2027-03-20" && unionNotices.place === "Union Test Site", "the Union notices carry the Union date and place");
  assert(await outboxCount() === 8, "the Union notices are separate rows from the Conference ones");
  console.log("ok  Conference to Union follows the same rule, with overrides, and its notices carry the Union date and place");

  // 10. Old free-text rows stay readable, are flagged, keep their decision through a recompute, and are replaced by a number.
  await prisma.$executeRawUnsafe(`UPDATE "ClubTeamResult" SET "placement" = '2nd place, 412 points', "placementRank" = NULL, "advanceOverride" = NULL, "qualified" = true WHERE "clubEventRegistrationId" = '${ids.Foxes}' AND "level" = 'AREA'`);
  const legacy = (await listTeamResults(eventId)).find((row) => row.teamName === "Foxes")!.results.AREA!;
  assert(legacy.needsReentry && legacy.placement === "2nd place, 412 points" && legacy.qualified, "an old free-text row is readable and flagged for re-entry");
  await recomputeAdvancement(eventId, "AREA", staffUserId);
  assert((await listTeamResults(eventId)).find((row) => row.teamName === "Foxes")!.results.AREA!.qualified, "a recompute keeps an old row's earlier decision");
  assert((await listLevelTeams(eventId, "CONFERENCE")).some((row) => row.teamName === "Foxes"), "so the team stays on the Conference list");
  await saveTeamResult(eventId, ids.Foxes!, { level: "AREA", placementRank: 2 }, staffUserId);
  const reentered = (await listTeamResults(eventId)).find((row) => row.teamName === "Foxes")!.results.AREA!;
  assert(!reentered.needsReentry && reentered.placement === "" && reentered.placementRank === 2 && reentered.qualified, "re-entering a number replaces the old text");
  console.log("ok  old free-text rows stay readable, are flagged, keep their decision, and are replaced by a number");

  // 11. The table constraints.
  const zero = await caught(prisma.$executeRawUnsafe(`UPDATE "ClubTeamResult" SET "placementRank" = 0 WHERE "clubEventRegistrationId" = '${ids.Aces}' AND "level" = 'AREA'`));
  assert(zero && /placementRank_positive/.test(String(zero)), `a place below 1 is refused by the check, got ${String(zero)}`);
  console.log("ok  the table constraints hold");
}

main()
  .then(async () => {
    await cleanup();
    console.log("PBE advancement verification passed.");
  })
  .catch(async (error: unknown) => {
    console.error(error);
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error("Cleanup also failed:", cleanupError);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
