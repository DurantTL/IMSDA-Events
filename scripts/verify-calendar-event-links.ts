/**
 * Proves calendar items and registration events being one thing (#445) against a
 * real PostgreSQL database, with fictitious data it creates and removes itself:
 *
 * - Add registration: an event created from a calendar item (blank and template
 *   flows) is linked to it in the same transaction, carries the item's location
 *   and a draft "About this event" section, and an item that can no longer be
 *   linked leaves no event behind;
 * - a linked pair shows once on the public calendar (the event, with Register);
 *   while the event is only a draft the item shows alone and says nothing about
 *   the event; unpublishing brings the item back; deleting the event restores
 *   it on its own;
 * - the link survives every Google refresh, a moved item, an item gone from the
 *   feed (never deleted, the event never cancelled) and the feed being deleted;
 * - a moved item never changes the event by itself: the banner data asks, Keep
 *   remembers exactly those dates, Update changes the event's dates only, a stale
 *   answer is refused, both are audited;
 * - link to an existing event / unlink; the database allows one item per event;
 *   two racing links of one event leave exactly one;
 * - possible matches are flagged (overlapping dates, similar title), never linked,
 *   and "Not the same" is permanent for that pair across refreshes;
 * - audit rows carry ids, never titles or locations.
 *
 *   npm run test:calendar-event-links
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
process.env.SECRET_ENCRYPTION_KEY ||= "verify-calendar-event-links-synthetic-key-not-a-secret";

const prisma = new PrismaClient();
const P = "evlink";
const userId = `${P}_admin`;
const feedUrl = "https://calendar.example.test/ical/evlink-synthetic/basic.ics";
const now = new Date("2026-10-01T12:00:00Z");
/** A minimal valid published form: Register shows only when an event has one (#1201). */
const formDefinition = {
  title: "Evlink registration",
  description: "Synthetic form.",
  confirmationMessage: "Received.",
  sections: [{
    id: "seminars",
    title: "Seminars",
    description: "",
    fields: [{
      id: "seminar_field",
      key: "seminar_preferences",
      label: "Seminar preferences",
      helpText: "",
      type: "RANKED_CHOICE",
      scope: "ATTENDEE",
      required: true,
      options: ["Prayer", "Service", "Music"],
      minSelections: 2,
      maxSelections: 2,
      availabilityMode: "RANKED_INTEREST",
      choiceLimits: {},
    }],
  }],
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function rejectsWith(promise: Promise<unknown>, code: string, message: string) {
  try {
    await promise;
  } catch (error) {
    assert((error as { code?: string }).code === code, `${message} (got ${String((error as Error).message)})`);
    return;
  }
  throw new Error(`FAILED: ${message} (it did not fail)`);
}

type Item = { uid: string; title: string; start: string; end: string; location?: string; description?: string };
/** DTEND is exclusive in iCalendar: `end` here is the last day shown, as the calendar shows it. */
const ics = (items: Item[]) => [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Synthetic//Event Links//EN",
  ...items.flatMap((item) => [
    "BEGIN:VEVENT", `UID:${item.uid}`, "DTSTAMP:20261001T000000Z",
    `DTSTART;VALUE=DATE:${item.start.replace(/-/g, "")}`,
    `DTEND;VALUE=DATE:${nextDay(item.end).replace(/-/g, "")}`,
    `SUMMARY:${item.title}`,
    ...(item.location ? [`LOCATION:${item.location}`] : []),
    ...(item.description ? [`DESCRIPTION:${item.description}`] : []),
    "END:VEVENT",
  ]),
  "END:VCALENDAR",
].join("\r\n");

function nextDay(date: string) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

const resolve = async () => ["93.184.216.34"];
let feedBody = "";
const transport = async () => ({ status: 200, location: null, body: feedBody });

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
  await prisma.eventTemplateApplication.deleteMany({ where: { actorUserId: userId } });
  await prisma.calendarEntry.deleteMany({ where: { createdByUserId: userId } });
  await prisma.calendarFeed.deleteMany({ where: { createdByUserId: userId } });
  await prisma.event.deleteMany({ where: { slug: { startsWith: `${P}-` } } });
  await prisma.person.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.eventTemplate.deleteMany({ where: { createdByUserId: userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

async function main() {
  const { createCalendarFeed, deleteCalendarFeed, syncCalendarFeed } = await import("../modules/calendar/feeds");
  const { listCalendarEntries, listCalendarEvents, listPublicCalendarItems } = await import("../modules/calendar/repository");
  const links = await import("../modules/calendar/event-links");
  const { createEvent, getEventSettings, updateEventSettings } = await import("../modules/events/repository");
  const { deleteEvent } = await import("../modules/events/deletion-repository");
  const { eventSettingsInputSchema } = await import("../modules/events/schemas");
  const { applyEventTemplate, createEventTemplate, publishEventTemplateVersion } = await import("../modules/event-templates/repository");

  await cleanup();
  await prisma.user.create({ data: { id: userId, email: `${P}-admin@example.test`, displayName: "Event Link Check", globalRole: "SYSTEM_ADMIN" } });

  const settings = (name: string, slug: string, startsOn: string, endsOn: string, location: string | null = null) => eventSettingsInputSchema.parse({
    name, slug, startsOn, endsOn, timezone: "America/Chicago", location, publicInfoUrl: null, supportContact: null,
    collectsShirtSizes: false, capacity: null, registrationOpensOn: null, registrationClosesOn: null, waitlistEnabled: false, autoPromoteWaitlist: false,
  });
  const entryRow = (id: string) => prisma.calendarEntry.findUniqueOrThrow({ where: { id } });
  const listed = async (id: string) => (await listCalendarEntries(now)).find((entry) => entry.id === id);
  const publicKeys = async (from: string, to: string) => (await listPublicCalendarItems(from, to, now)).map((item) => item.key).sort();

  // A feed with imported items: the retreat (looks like an event staff will make), a conference, and an unrelated one.
  const retreat: Item = { uid: "retreat@evlink.test", title: "Evlink Gathering", start: "2026-10-09", end: "2026-10-11", location: "Camp Example", description: "A weekend away." };
  const conference: Item = { uid: "conference@evlink.test", title: "Evlink Conference", start: "2026-11-07", end: "2026-11-09", location: "Hall Example" };
  const unrelated: Item = { uid: "picnic@evlink.test", title: "Evlink Picnic", start: "2026-10-09", end: "2026-10-09" };
  feedBody = ics([retreat, conference, unrelated]);
  await createCalendarFeed({ name: "Event link check feed", url: feedUrl, defaultCategory: "Conference", defaultEntryType: "STANDARD", publishNewItems: true, isEnabled: true, refreshMinutes: 60 }, userId);
  const feed = await prisma.calendarFeed.findFirstOrThrow({ where: { createdByUserId: userId } });
  const refresh = () => syncCalendarFeed(feed.id, { actorUserId: userId, transport, resolve });
  await refresh();
  const byUid = async (uid: string) => prisma.calendarEntry.findFirstOrThrow({ where: { sourceFeedId: feed.id, sourceUid: uid } });
  const retreatEntry = await byUid(retreat.uid);
  const conferenceEntry = await byUid(conference.uid);
  assert(retreatEntry.startsOn === "2026-10-09" && retreatEntry.endsOn === "2026-10-11" && retreatEntry.isPublished, "the retreat imported with its dates, published");

  // 1. Possible matches are flagged and never linked by themselves.
  const retreatEvent = await createEvent(settings("Evlink Gathering 2026", `${P}-womens-retreat-2026`, "2026-10-09", "2026-10-11", "Camp Example"), userId);
  assert(retreatEvent, "a registration event was made by hand");
  const flagged =await listed(retreatEntry.id);
  assert(flagged?.possibleMatch?.id === retreatEvent.id, "the retreat item is flagged as a possible match for the look-alike event");
  assert((await listed(conferenceEntry.id))?.possibleMatch === null, "an item with different dates and title is not flagged");
  assert((await listed((await byUid(unrelated.uid)).id))?.possibleMatch === null, "an item with overlapping dates but a different title is not flagged");
  assert((await entryRow(retreatEntry.id)).linkedEventId === null, "a possible match is never linked automatically");
  const unlinkedKeys = await publicKeys("2026-10-01", "2026-10-31");
  assert(unlinkedKeys.includes(`entry-${retreatEntry.id}`), "until staff choose, the item still shows on the public calendar");

  // 2. "Not the same" is permanent for that pair, across refreshes and edits to the title.
  await links.dismissPossibleMatch(retreatEntry.id, retreatEvent.id, userId);
  await links.dismissPossibleMatch(retreatEntry.id, retreatEvent.id, userId); // idempotent
  assert((await listed(retreatEntry.id))?.possibleMatch === null, "a dismissed pair is no longer flagged");
  feedBody = ics([{ ...retreat, title: "Evlink Gathering 2026" }, conference, unrelated]);
  await refresh();
  assert((await listed(retreatEntry.id))?.possibleMatch === null, "the dismissal survives a refresh that changed the title");
  assert(await prisma.calendarEventMatchDismissal.count({ where: { calendarEntryId: retreatEntry.id } }) === 1, "one dismissal row for the pair");
  feedBody = ics([retreat, conference, unrelated]);
  await refresh();
  console.log("ok  possible matches are flagged, never linked, and Not the same is permanent for that pair");

  // 3. Link to an existing event: the pair shows once; unlinking restores the item.
  await links.linkCalendarEntryToEvent(retreatEntry.id, retreatEvent.id, userId);
  assert((await entryRow(retreatEntry.id)).linkedEventId === retreatEvent.id, "the item is linked to the existing event");
  assert(await prisma.calendarEventMatchDismissal.count({ where: { calendarEntryId: retreatEntry.id, eventId: retreatEvent.id } }) === 0, "choosing to link clears an earlier Not the same for the pair");
  assert((await listCalendarEvents(now)).find((event) => event.id === retreatEvent.id)?.linkedEntries[0]?.id === retreatEntry.id, "the events list says which item is linked");
  await prisma.event.update({ where: { id: retreatEvent.id }, data: { isPublished: true } });
  const pairKeys = await publicKeys("2026-10-01", "2026-10-31");
  assert(pairKeys.includes(`event-${retreatEvent.id}`) && !pairKeys.includes(`entry-${retreatEntry.id}`), "the published pair shows once, as the event");
  const formless = (await listPublicCalendarItems("2026-10-01", "2026-10-31", now)).find((item) => item.key === `event-${retreatEvent.id}`);
  assert(formless?.registrationOpen === false, "with no published form the event's entry carries no Register (#1201)");
  const form = await prisma.registrationForm.create({ data: { eventId: retreatEvent.id, createdByUserId: userId, name: "Evlink form", slug: `${P}-form`, status: "PUBLISHED" } });
  await prisma.registrationFormVersion.create({ data: { formId: form.id, createdByUserId: userId, versionNumber: 1, status: "PUBLISHED", definition: formDefinition, publishedAt: now } });
  const pairItems = await listPublicCalendarItems("2026-10-01", "2026-10-31", now);
  const pairEvent = pairItems.find((item) => item.key === `event-${retreatEvent.id}`);
  assert(pairEvent?.registrationOpen === true && pairEvent.href === `/events/${retreatEvent.slug}`, "the event's entry carries Register");
  // A full event offers the waitlist or nothing, never Register (#1215). One active registration fills capacity 1.
  const fullPerson = await prisma.person.create({ data: { id: `${P}_full`, firstName: "Full", lastName: "Synthetic" } });
  const fullRegistration = await prisma.registration.create({ data: { eventId: retreatEvent.id, accountHolderPersonId: fullPerson.id, confirmationCode: `${P.toUpperCase()}FULL1`, status: "CONFIRMED", totalAmount: 0 } });
  await prisma.registrationAttendee.create({ data: { eventId: retreatEvent.id, registrationId: fullRegistration.id, personId: fullPerson.id, attendeeType: "ADULT", profileSnapshot: {} } });
  const stateWith = async (capacity: number | null, waitlistEnabled: boolean) => {
    await prisma.event.update({ where: { id: retreatEvent.id }, data: { capacity, waitlistEnabled } });
    const item = (await listPublicCalendarItems("2026-10-01", "2026-10-31", now)).find((candidate) => candidate.key === `event-${retreatEvent.id}`);
    return { registrationOpen: item?.registrationOpen, registrationStatus: item?.registrationStatus };
  };
  assert(JSON.stringify(await stateWith(1, false)) === JSON.stringify({ registrationOpen: false, registrationStatus: "FULL" }), "a full event with no waitlist offers no Register (#1215)");
  assert(JSON.stringify(await stateWith(1, true)) === JSON.stringify({ registrationOpen: true, registrationStatus: "WAITLIST" }), "a full event with a waitlist offers Join the waitlist (#1215)");
  assert(JSON.stringify(await stateWith(2, false)) === JSON.stringify({ registrationOpen: true, registrationStatus: "OPEN" }), "an event with seats left still offers Register (#1215)");
  await prisma.registration.update({ where: { id: fullRegistration.id }, data: { status: "CANCELLED" } });
  assert(JSON.stringify(await stateWith(1, false)) === JSON.stringify({ registrationOpen: true, registrationStatus: "OPEN" }), "a cancelled registration frees its seat (#1215)");
  await prisma.registration.delete({ where: { id: fullRegistration.id } });
  await prisma.event.update({ where: { id: retreatEvent.id }, data: { capacity: null, waitlistEnabled: false } });
  const feedKeys = (await listPublicCalendarItems("2026-09-01", "2027-03-31", now, { expandRepeats: false })).map((item) => item.key);
  assert(!feedKeys.includes(`entry-${retreatEntry.id}`) && feedKeys.includes(`event-${retreatEvent.id}`), "the feed (.ics) data shows the pair once too");
  await rejectsWith(links.linkCalendarEntryToEvent(retreatEntry.id, (await createEvent(settings("Other Retreat", `${P}-other-retreat`, "2026-10-09", "2026-10-11"), userId))!.id, userId), "ENTRY_ALREADY_LINKED", "an item already linked can't be linked to a second event");
  const spare = await prisma.calendarEntry.create({ data: { title: "Spare item", startsOn: "2026-10-09", endsOn: "2026-10-11", isPublished: true, createdByUserId: userId, updatedByUserId: userId } });
  // Several items can share one event (#1086): each shows on its own date with Register, and the event isn't shown twice.
  await links.linkCalendarEntryToEvent(spare.id, retreatEvent.id, userId);
  assert(await prisma.calendarEntry.count({ where: { linkedEventId: retreatEvent.id } }) === 2, "an event can take a second linked item");
  const sharedItems = await listPublicCalendarItems("2026-10-01", "2026-10-31", now);
  const sharedKeys = sharedItems.map((item) => item.key);
  assert(sharedKeys.includes(`entry-${retreatEntry.id}`) && sharedKeys.includes(`entry-${spare.id}`) && !sharedKeys.includes(`event-${retreatEvent.id}`), "with two linked items each shows on its own and the event does not show again");
  assert(sharedItems.filter((item) => item.href === `/events/${retreatEvent.slug}`).length === 2, "each linked item carries Register to the event");
  await links.unlinkCalendarEntry(spare.id, userId);
  assert((await entryRow(retreatEntry.id)).linkedEventId === retreatEvent.id, "unlinking one item leaves the other linked");
  await rejectsWith(links.unlinkCalendarEntry(spare.id, userId), "NOT_LINKED", "unlinking an unlinked item says so");
  await links.unlinkCalendarEntry(retreatEntry.id, userId);
  const restored = await publicKeys("2026-10-01", "2026-10-31");
  assert(restored.includes(`entry-${retreatEntry.id}`) && restored.includes(`event-${retreatEvent.id}`), "unlinking restores the item on its own, beside the event");
  assert((await entryRow(retreatEntry.id)).linkedEventId === null && (await entryRow(retreatEntry.id)).title === "Evlink Gathering", "an unlinked item is whole: nothing else about it changed");
  console.log("ok  link to existing event shows the pair once; unlink restores the item on its own");

  // 4. The database allows several items per event, and racing links both land.
  const racers = await Promise.allSettled([
    links.linkCalendarEntryToEvent(retreatEntry.id, retreatEvent.id, userId),
    links.linkCalendarEntryToEvent(spare.id, retreatEvent.id, userId),
  ]);
  assert(racers.every((racer) => racer.status === "fulfilled"), "two racing links to one event both succeed");
  assert(await prisma.calendarEntry.count({ where: { linkedEventId: retreatEvent.id } }) === 2, "both items are linked");
  await prisma.calendarEntry.updateMany({ where: { linkedEventId: retreatEvent.id }, data: { linkedEventId: null } });
  await prisma.calendarEntry.updateMany({ where: { id: spare.id }, data: { baselineStartsOn: null, baselineEndsOn: null } });
  let pairedRefused = false;
  try {
    await prisma.calendarEntry.update({ where: { id: spare.id }, data: { baselineStartsOn: "2026-10-09" } });
  } catch {
    pairedRefused = true;
  }
  assert(pairedRefused, "the database refuses a baseline start date without a baseline end date");
  console.log("ok  the database allows several items per event; racing links both land; baseline dates come as a pair");

  // 5. Add registration (blank flow): linked in the same transaction, location and description carried, draft only.
  const created = await createEvent(settings("Evlink Conference", `${P}-spring-conference`, conferenceEntry.startsOn, conferenceEntry.endsOn, conferenceEntry.location), userId, { calendarEntryId: conferenceEntry.id });
  assert(created && (await entryRow(conferenceEntry.id)).linkedEventId === created.id, "the event made from the item is linked to it");
  assert(created.location === "Hall Example" && !created.isPublished, "the event starts from the item's location, as a draft");
  assert(created.startsOn === "2026-11-07" && created.endsOn === "2026-11-09", "the event starts from the item's dates");
  const noDescription = await prisma.eventContentSection.count({ where: { eventId: created.id } });
  assert(noDescription === 0, "an item with no description adds no section");
  const withDescription = await createEvent(settings("Evlink Gathering Redo", `${P}-retreat-redo`, "2026-10-09", "2026-10-11"), userId, { calendarEntryId: retreatEntry.id });
  assert(withDescription, "an event was made from the retreat item");
  const section = await prisma.eventContentSection.findFirstOrThrow({ where: { eventId: withDescription.id } });
  assert(section.title === "About this event" && section.body === "A weekend away." && !section.isPublished && section.kind === "RICH_TEXT", "the item's description became a draft, unpublished section");
  await links.unlinkCalendarEntry(retreatEntry.id, userId);

  // An item that can't be linked leaves no event behind.
  const before = await prisma.event.count();
  await rejectsWith(createEvent(settings("Second Try", `${P}-second-try`, "2026-11-07", "2026-11-09"), userId, { calendarEntryId: conferenceEntry.id }), "ENTRY_ALREADY_LINKED", "an item that already has an event can't make another");
  await rejectsWith(createEvent(settings("Ghost", `${P}-ghost`, "2026-11-07", "2026-11-09"), userId, { calendarEntryId: "missing-entry" }), "ENTRY_NOT_FOUND", "a missing item can't make an event");
  const closure = await prisma.calendarEntry.create({ data: { title: "Office closed", startsOn: "2026-11-26", endsOn: "2026-11-27", entryType: "CLOSURE", createdByUserId: userId, updatedByUserId: userId } });
  await rejectsWith(createEvent(settings("Closure Event", `${P}-closure-event`, "2026-11-26", "2026-11-27"), userId, { calendarEntryId: closure.id }), "NOT_LINKABLE", "a closure can't become a registration event");
  const repeating = await prisma.calendarEntry.create({ data: { title: "Weekly prayer", startsOn: "2026-11-02", endsOn: "2026-11-02", repeatRule: "FREQ=WEEKLY;COUNT=4", createdByUserId: userId, updatedByUserId: userId } });
  await rejectsWith(links.linkCalendarEntryToEvent(repeating.id, created.id, userId), "NOT_LINKABLE", "a repeating item can't be linked");
  assert(await prisma.event.count() === before, "refused creations left no event behind");
  const prefill = await links.getCalendarEntryPrefill(conferenceEntry.id);
  assert(!prefill.ok && /already has/.test(prefill.reason), "the Create event flow refuses an item that already has an event");
  const open = await links.getCalendarEntryPrefill(spare.id);
  assert(open.ok && open.entry.title === "Spare item" && open.entry.startsOn === "2026-10-09", "the Create event flow starts from an open item's details");

  // Add registration (template flow).
  const template = await createEventTemplate(userId, { name: "Evlink Template", description: "", audience: "GENERAL" });
  await publishEventTemplateVersion(template.id, userId);
  const picnic = await byUid(unrelated.uid);
  const applied = await applyEventTemplate(template.id, userId, {
    name: "Evlink Picnic Registration", slug: `${P}-picnic`, startsOn: picnic.startsOn, endsOn: picnic.endsOn, requestKey: `${P}-key-picnic-1`, calendarEntryId: picnic.id,
  });
  assert((await entryRow(picnic.id)).linkedEventId === applied.event.id, "the template flow links the item to the event it created");
  const replay = await applyEventTemplate(template.id, userId, {
    name: "Evlink Picnic Registration", slug: `${P}-picnic`, startsOn: picnic.startsOn, endsOn: picnic.endsOn, requestKey: `${P}-key-picnic-1`, calendarEntryId: picnic.id,
  });
  assert(replay.alreadyApplied && replay.event.id === applied.event.id, "a retried apply returns the same event, still linked once");
  const eventsBefore = await prisma.event.count();
  await rejectsWith(applyEventTemplate(template.id, userId, {
    name: "Picnic Again", slug: `${P}-picnic-again`, startsOn: picnic.startsOn, endsOn: picnic.endsOn, requestKey: `${P}-key-picnic-2`, calendarEntryId: picnic.id,
  }), "ENTRY_ALREADY_LINKED", "an item that already has an event can't make another through a template");
  assert(await prisma.event.count() === eventsBefore, "the refused template apply left no event behind");
  await rejectsWith(applyEventTemplate(template.id, userId, {
    name: "Evlink Picnic Registration", slug: `${P}-picnic`, startsOn: picnic.startsOn, endsOn: picnic.endsOn, requestKey: `${P}-key-picnic-1`, calendarEntryId: spare.id,
  }), "REQUEST_KEY_REUSED", "the same request key with another calendar item is a reused key, not a replay");
  assert((await entryRow(spare.id)).linkedEventId === null, "and it linked nothing");
  console.log("ok  Add registration links the item in the creation transaction (blank and template flows); an item that can't be linked leaves no event behind");

  // 6. A draft event never leaks; the item stands in alone. Publishing shows the pair once; unpublishing brings the item back.
  const draftKeys = await listPublicCalendarItems("2026-11-01", "2026-11-30", now);
  assert(draftKeys.map((item) => item.key).join() === `entry-${conferenceEntry.id}`, "while the event is a draft, only the item shows");
  assert(!JSON.stringify(draftKeys).includes(created.slug) && !JSON.stringify(draftKeys).includes(created.id), "nothing about the draft event reaches the public calendar data");
  await prisma.event.update({ where: { id: created.id }, data: { isPublished: true } });
  assert((await publicKeys("2026-11-01", "2026-11-30")).join() === `event-${created.id}`, "published, the pair shows once, as the event");
  await prisma.event.update({ where: { id: created.id }, data: { isPublished: false } });
  assert((await publicKeys("2026-11-01", "2026-11-30")).join() === `entry-${conferenceEntry.id}`, "unpublishing the event brings the item back, alone");
  await prisma.event.update({ where: { id: created.id }, data: { isPublished: true } });

  // 7. The link survives every refresh. A moved item updates, the event does not, and staff are asked.
  assert(await links.getCalendarLinkNotice(created.id) === null, "nothing to ask while the dates agree");
  feedBody = ics([retreat, { ...conference, start: "2026-11-14", end: "2026-11-16" }, unrelated]);
  await refresh();
  const moved = await entryRow(conferenceEntry.id);
  assert(moved.linkedEventId === created.id, "the link survived the refresh");
  assert(moved.startsOn === "2026-11-14" && moved.endsOn === "2026-11-16" && moved.id === conferenceEntry.id, "the imported item moved with Google and kept its identity");
  const event = await prisma.event.findUniqueOrThrow({ where: { id: created.id } });
  assert(event.startsAt.toISOString().startsWith("2026-11-07") && event.endsAt.toISOString().startsWith("2026-11-09"), "the event's dates did not change by themselves");
  assert((await publicKeys("2026-11-01", "2026-11-30")).join() === `event-${created.id}`, "the public calendar still shows the pair once, on the event's dates");
  const notice = await links.getCalendarLinkNotice(created.id);
  assert(notice?.datePrompts[0]?.message === "Google Calendar moved this event to November 14–16, 2026. Update the registration dates?", `the banner asks the owner's question (${notice?.datePrompts[0]?.message})`);
  assert(notice.datePrompts[0]!.preview!.changes[0]?.from === "November 7–9, 2026" && notice.datePrompts[0]!.preview!.changes[0]?.to === "November 14–16, 2026", "the preview shows the old and new dates");
  assert((await listed(conferenceEntry.id))?.datesDifferFromEvent === true, "the calendar admin list shows the item's dates differ from its event's");

  // Stale answer refused; nothing applied.
  await rejectsWith(links.resolveCalendarDateChange(created.id, "update", { startsOn: "2026-11-10", endsOn: "2026-11-12" }, userId), "DATES_CHANGED", "an answer about dates the item no longer has is refused");
  assert((await prisma.event.findUniqueOrThrow({ where: { id: created.id } })).startsAt.toISOString().startsWith("2026-11-07"), "a refused answer changed nothing");

  // Keep: remembered for exactly those dates, across refreshes, until the item moves again.
  await links.resolveCalendarDateChange(created.id, "keep", { startsOn: "2026-11-14", endsOn: "2026-11-16" }, userId);
  assert(await links.getCalendarLinkNotice(created.id) === null, "after Keep the banner stays away");
  await refresh();
  assert(await links.getCalendarLinkNotice(created.id) === null, "and stays away after the next refresh with the same dates");
  feedBody = ics([retreat, { ...conference, start: "2026-11-21", end: "2026-11-23" }, unrelated]);
  await refresh();
  assert((await links.getCalendarLinkNotice(created.id))?.datePrompts[0]?.itemStartsOn === "2026-11-21", "the banner returns when the item moves again");
  const keptAudit = await prisma.auditLog.findMany({ where: { action: "CALENDAR_EVENT_DATES_KEPT", entityId: created.id } });
  assert(keptAudit.length === 1 && keptAudit[0]!.actorUserId === userId, "Keep is audited, once, by the staff member");

  // Update: the event's dates only, audited; dependent dates untouched.
  await prisma.event.update({ where: { id: created.id }, data: { registrationClosesOn: "2026-11-01" } });
  // The settings form was opened before Update: it holds the old dates and the old version.
  const openForm = (await getEventSettings(created.id))!;
  const staleInput = eventSettingsInputSchema.parse({ ...openForm, approvedPaymentInstructions: openForm.approvedPaymentInstructions ?? null });
  await links.resolveCalendarDateChange(created.id, "update", { startsOn: "2026-11-21", endsOn: "2026-11-23" }, userId);
  const updated = await prisma.event.findUniqueOrThrow({ where: { id: created.id } });
  assert(updated.startsAt.toISOString().startsWith("2026-11-21") && updated.endsAt.toISOString().startsWith("2026-11-23"), "Update changed the event's dates to the item's");
  assert(updated.registrationClosesOn === "2026-11-01", "Update left the registration close date exactly as staff set it");
  assert(await links.getCalendarLinkNotice(created.id) === null, "after Update the banner is gone");
  // A save from that stale form must not write the old dates back.
  await rejectsWith(updateEventSettings(created.id, { ...staleInput, name: "Evlink Conference (stale save)" }, userId, { expectedStartsOn: openForm.startsOn, expectedEndsOn: openForm.endsOn }), "EVENT_CHANGED", "a save from the form opened before Update is refused");
  const afterStale = await prisma.event.findUniqueOrThrow({ where: { id: created.id } });
  assert(afterStale.name === "Evlink Conference" && afterStale.startsAt.toISOString().startsWith("2026-11-21") && afterStale.endsAt.toISOString().startsWith("2026-11-23"), "the refused save changed nothing: the new dates stand");
  // The form loaded again (what the remount does) saves fine and keeps the new dates.
  const reloaded = (await getEventSettings(created.id))!;
  assert(reloaded.startsOn === "2026-11-21" && reloaded.endsOn === "2026-11-23", "the reloaded form carries the new dates");
  const fresh = eventSettingsInputSchema.parse({ ...reloaded, approvedPaymentInstructions: reloaded.approvedPaymentInstructions ?? null });
  // Another page writes the event meanwhile (the general registration link bumps `updatedAt`): no conflict, the dates are what the form has.
  const beforeOtherWrite = (await prisma.event.findUniqueOrThrow({ where: { id: created.id } })).updatedAt;
  await prisma.event.update({ where: { id: created.id }, data: { generalRegistrationLinkEnabled: true } });
  assert((await prisma.event.findUniqueOrThrow({ where: { id: created.id } })).updatedAt.getTime() !== beforeOtherWrite.getTime(), "the other write moved the event's updatedAt");
  await updateEventSettings(created.id, { ...fresh, location: "Hall Example Annex" }, userId, { expectedStartsOn: reloaded.startsOn, expectedEndsOn: reloaded.endsOn });
  const afterFresh = await prisma.event.findUniqueOrThrow({ where: { id: created.id } });
  assert(afterFresh.location === "Hall Example Annex" && afterFresh.startsAt.toISOString().startsWith("2026-11-21") && afterFresh.endsAt.toISOString().startsWith("2026-11-23"), "a save from the reloaded form keeps the new dates, even after another page wrote the event");
  await updateEventSettings(created.id, { ...fresh, location: "Hall Example Annex" }, userId);
  const updatedAudit = await prisma.auditLog.findMany({ where: { action: "CALENDAR_EVENT_DATES_UPDATED", entityId: created.id } });
  assert(updatedAudit.length === 1, "Update is audited, once");
  const updatedMeta = updatedAudit[0]!.metadata as { from: { startsOn: string }; to: { startsOn: string } };
  assert(updatedMeta.from.startsOn === "2026-11-07" && updatedMeta.to.startsOn === "2026-11-21", "the audit row records the old and new dates");

  // Update is refused when it would open registration after the event ends.
  await prisma.event.update({ where: { id: created.id }, data: { registrationOpensOn: "2026-11-25" } });
  feedBody = ics([retreat, { ...conference, start: "2026-11-23", end: "2026-11-24" }, unrelated]);
  await refresh();
  await rejectsWith(links.resolveCalendarDateChange(created.id, "update", { startsOn: "2026-11-23", endsOn: "2026-11-24" }, userId), "DATES_CONFLICT", "Update is refused when registration would open after the event");
  const conflict = await links.getCalendarLinkNotice(created.id);
  assert((conflict?.datePrompts[0]?.preview?.blockedReason ?? null) !== null, "the banner says why Update is unavailable");
  await prisma.event.update({ where: { id: created.id }, data: { registrationOpensOn: null } });
  console.log("ok  the link survives refreshes; a moved item never changes the event; Keep and Update are staff's choice, previewed, audited, and refuse stale or conflicting answers");

  // The baseline (#445): staff changing the event by hand while the item stays put is not a question for the calendar.
  const aside = await createEvent(settings("Evlink Aside", `${P}-aside`, "2026-12-05", "2026-12-07"), userId);
  assert(aside, "an event was made for the baseline checks");
  const asideItem = await prisma.calendarEntry.create({ data: { title: "Evlink Aside Item", startsOn: "2026-12-05", endsOn: "2026-12-07", isPublished: true, createdByUserId: userId, updatedByUserId: userId } });
  await links.linkCalendarEntryToEvent(asideItem.id, aside.id, userId);
  const asideLinked = await entryRow(asideItem.id);
  assert(asideLinked.baselineStartsOn === "2026-12-05" && asideLinked.baselineEndsOn === "2026-12-07", "linking an item that agrees with its event records the item's dates as the baseline");
  await prisma.event.update({ where: { id: aside.id }, data: { startsAt: new Date("2026-12-12T12:00:00Z"), endsAt: new Date("2026-12-14T12:00:00Z") } });
  assert(await links.getCalendarLinkNotice(aside.id) === null, "the event changed and the item didn't: no banner");
  await prisma.calendarEntry.update({ where: { id: asideItem.id }, data: { startsOn: "2026-12-19", endsOn: "2026-12-20" } });
  const asideMoved = await links.getCalendarLinkNotice(aside.id);
  assert(asideMoved?.datePrompts[0]?.message === "The calendar item for this event was moved to December 19–20, 2026. Update the registration dates?", `the item really moving brings the banner (${asideMoved?.datePrompts[0]?.message})`);

  // An item that already differs from its event when linked says "differs", not "moved", and the preview is complete.
  const differs = await createEvent(settings("Evlink Differs", `${P}-differs`, "2026-12-05", "2026-12-07"), userId);
  assert(differs, "an event was made for the differs checks");
  const differsItem = await prisma.calendarEntry.create({ data: { title: "Evlink Differs Item", startsOn: "2026-12-19", endsOn: "2026-12-20", isPublished: true, createdByUserId: userId, updatedByUserId: userId } });
  await links.linkCalendarEntryToEvent(differsItem.id, differs.id, userId);
  const differsLinked = await entryRow(differsItem.id);
  assert(differsLinked.baselineStartsOn === null && differsLinked.baselineEndsOn === null, "an item that differs from its event when linked has no baseline");
  await prisma.eventMealService.createMany({ data: [
    { eventId: differs.id, name: "Evlink Supper", mealType: "SUPPER", serviceDate: "2026-12-06", startTime: "18:00" },
    { eventId: differs.id, name: "Evlink Lunch", mealType: "LUNCH", serviceDate: "2026-12-19", startTime: "12:00" },
    { eventId: differs.id, name: "Evlink Cancelled Lunch", mealType: "LUNCH", serviceDate: "2026-12-08", startTime: "12:00", status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Synthetic check" },
  ] });
  await prisma.person.create({ data: { id: `${P}_person`, firstName: "Sample", lastName: "Person" } });
  await prisma.registration.create({ data: { eventId: differs.id, accountHolderPersonId: `${P}_person`, confirmationCode: `${P.toUpperCase()}-0001`, status: "CONFIRMED", totalAmount: 0 } });
  await prisma.registration.create({ data: { eventId: differs.id, accountHolderPersonId: `${P}_person`, confirmationCode: `${P.toUpperCase()}-0002`, status: "DRAFT", totalAmount: 0 } });
  const differsNotice = await links.getCalendarLinkNotice(differs.id);
  assert(differsNotice?.datePrompts[0]?.message === "The calendar item for this event shows December 19–20, 2026, which differs from the registration dates. Update the registration dates?", `a differing item is worded as differs (${differsNotice?.datePrompts[0]?.message})`);
  assert(!/moved/.test(differsNotice.datePrompts[0]!.message), "and never says moved");
  const meals = differsNotice.datePrompts[0]!.preview!.unchanged.find((row) => row.label === "Meal services");
  assert(meals?.value === "2 services" && meals.needsAttention && /1 fall outside/.test(meals.note), `the preview lists the active meal services, flagging the one outside the new dates (${meals?.value}; ${meals?.note})`);
  assert(differsNotice.datePrompts[0]!.preview!.notes.length === 1 && /has 1 registration\./.test(differsNotice.datePrompts[0]!.preview!.notes[0]!) && /minor/.test(differsNotice.datePrompts[0]!.preview!.notes[0]!), "the preview says the event has a registration (a draft doesn't count) and mentions minor status");
  await links.resolveCalendarDateChange(differs.id, "keep", { startsOn: "2026-12-19", endsOn: "2026-12-20" }, userId);
  const differsKept = await entryRow(differsItem.id);
  assert(differsKept.baselineStartsOn === "2026-12-19" && await links.getCalendarLinkNotice(differs.id) === null, "Keep records the baseline and ends the question");
  console.log("ok  baseline dates: an event edited by hand is no question; a moved item is; one that differed at linking says differs; the preview lists meals and registrations");

  // Archived events (#635): not suggested, can't be linked, no banner, and Update or Keep is refused.
  const archivable = await createEvent(settings("Evlink Archived", `${P}-archived`, "2026-12-05", "2026-12-07"), userId);
  assert(archivable, "an event was made for the archive checks");
  const archivedCandidate = await prisma.calendarEntry.create({ data: { title: "Evlink Archived", startsOn: "2026-12-05", endsOn: "2026-12-07", isPublished: true, sourceUid: "archived@evlink.test", createdByUserId: userId, updatedByUserId: userId } });
  assert((await listed(archivedCandidate.id))?.possibleMatch?.id === archivable.id, "before archiving, the look-alike event is suggested");
  assert((await listCalendarEvents(now)).some((row) => row.id === archivable.id), "and offered in the link picker");
  await prisma.event.update({ where: { id: archivable.id }, data: { archivedAt: new Date(), archivedByUserId: userId } });
  assert((await listed(archivedCandidate.id))?.possibleMatch === null, "an archived event is not suggested");
  assert(!(await listCalendarEvents(now)).some((row) => row.id === archivable.id), "an archived event is not in the link picker");
  await rejectsWith(links.linkCalendarEntryToEvent(archivedCandidate.id, archivable.id, userId), "EVENT_ARCHIVED", "an archived event can't be linked");
  assert((await entryRow(archivedCandidate.id)).linkedEventId === null, "and nothing was linked");
  // An event archived after it was linked: the link still shows, marked archived, with no banner and no way to answer.
  await prisma.event.update({ where: { id: archivable.id }, data: { archivedAt: null, archivedByUserId: null } });
  await prisma.calendarEntry.update({ where: { id: archivedCandidate.id }, data: { startsOn: "2026-12-12", endsOn: "2026-12-13" } });
  await links.linkCalendarEntryToEvent(archivedCandidate.id, archivable.id, userId);
  assert((await links.getCalendarLinkNotice(archivable.id))?.datePrompts[0]?.message.includes("differs"), "unarchived, the differing item asks");
  await prisma.event.update({ where: { id: archivable.id }, data: { archivedAt: new Date(), archivedByUserId: userId } });
  assert(await links.getCalendarLinkNotice(archivable.id) === null, "an archived event shows no date banner");
  assert((await listed(archivedCandidate.id))?.linkedEvent?.isArchived === true, "the calendar list still shows the link, marked archived");
  await rejectsWith(links.resolveCalendarDateChange(archivable.id, "update", { startsOn: "2026-12-12", endsOn: "2026-12-13" }, userId), "EVENT_ARCHIVED", "Update is refused for an archived event");
  await rejectsWith(links.resolveCalendarDateChange(archivable.id, "keep", { startsOn: "2026-12-12", endsOn: "2026-12-13" }, userId), "EVENT_ARCHIVED", "and so is Keep");
  const archivedRow = await prisma.event.findUniqueOrThrow({ where: { id: archivable.id } });
  assert(archivedRow.startsAt.toISOString().startsWith("2026-12-05"), "the archived event's dates did not change");
  await prisma.event.update({ where: { id: archivable.id }, data: { archivedAt: new Date("2026-10-15T00:00:00Z"), archivedByUserId: userId } });
  await prisma.event.update({ where: { id: archivable.id }, data: { isPublished: true } });
  const archivedKeys = await publicKeys("2026-12-01", "2026-12-31");
  assert(archivedKeys.includes(`entry-${archivedCandidate.id}`) && !archivedKeys.includes(`event-${archivable.id}`), "an archived published event is off the public calendar and its item shows on its own");
  await prisma.event.update({ where: { id: archivable.id }, data: { archivedAt: null, archivedByUserId: null } });
  assert(Boolean((await links.getCalendarLinkNotice(archivable.id))?.datePrompts[0]), "unarchived, the banner returns");
  console.log("ok  archived events: not suggested, not offered, can't be linked, no banner, Update and Keep refused, link still shown");

  // 8. Gone from Google: never deleted, the event never removed or cancelled; staff are warned. It comes back linked.
  feedBody = ics([retreat, unrelated]);
  await refresh();
  const gone = await entryRow(conferenceEntry.id);
  assert(gone.sourceRemovedAt !== null && gone.linkedEventId === created.id, "an item removed in Google is kept, still linked");
  const afterGone = await prisma.event.findUniqueOrThrow({ where: { id: created.id } });
  assert(afterGone.isPublished, "the registration event was not unpublished or cancelled");
  const goneNotice = await links.getCalendarLinkNotice(created.id);
  assert(goneNotice?.sourceRemoved.length === 1 && goneNotice.datePrompts.length === 0, "staff get a warning, not a date question about a ghost");
  assert((await publicKeys("2026-11-01", "2026-11-30")).join() === `event-${created.id}`, "the public calendar still shows the event");
  feedBody = ics([retreat, { ...conference, start: "2026-11-21", end: "2026-11-23" }, unrelated]);
  await refresh();
  const back = await entryRow(conferenceEntry.id);
  assert(back.sourceRemovedAt === null && back.linkedEventId === created.id, "when it comes back it is the same item, still linked");

  // 9. The link survives the feed being deleted (the item stays, detached).
  await deleteCalendarFeed(feed.id, userId);
  const detached = await entryRow(conferenceEntry.id);
  assert(detached.sourceFeedId === null && detached.linkedEventId === created.id, "deleting the feed keeps the item and its link");
  const detachedEntry = await listed(conferenceEntry.id);
  assert(detachedEntry?.linkedEvent?.id === created.id, "the admin list still shows the link");

  // 10. Audit rows carry ids, never titles or locations. (Read before the event is deleted: its own history goes with it.)
  const audit = await prisma.auditLog.findMany({
    where: { actorUserId: userId, action: { in: ["CALENDAR_ENTRY_LINKED_TO_EVENT", "CALENDAR_ENTRY_UNLINKED_FROM_EVENT", "CALENDAR_MATCH_DISMISSED", "CALENDAR_EVENT_DATES_KEPT", "CALENDAR_EVENT_DATES_UPDATED"] } },
  });
  assert(audit.length >= 8, `the link, unlink, dismissal and date decisions were audited (${audit.length})`);
  const text = JSON.stringify(audit.map((row) => [row.summary, row.metadata]));
  for (const secret of ["Evlink Gathering", "Evlink Conference", "Camp Example", "Hall Example", "A weekend away", "Evlink Picnic", "Spare item", "Evlink Gathering"]) {
    assert(!text.includes(secret), `no audit row carries "${secret}"`);
  }
  assert(audit.every((row) => row.actorUserId === userId), "every row names the staff member");
  const linkedAudit = audit.find((row) => row.action === "CALENDAR_ENTRY_LINKED_TO_EVENT");
  assert(linkedAudit && (linkedAudit.metadata as { calendarEntryId?: string; eventId?: string }).calendarEntryId && linkedAudit.eventId, "a link row carries the item id and event id");
  console.log("ok  audit rows record ids only");

  // 11. Deleting the event restores the item on its own; the link is cleared by the database.
  await deleteEvent({ eventId: created.id, actor: { userId, globalRole: "SYSTEM_ADMIN" }, confirmName: "Evlink Conference" });
  const orphan = await entryRow(conferenceEntry.id);
  assert(orphan.linkedEventId === null, "deleting the event cleared the link");
  assert((await publicKeys("2026-11-01", "2026-11-30")).includes(`entry-${conferenceEntry.id}`), "the item shows on its own again");
  console.log("ok  an item gone from Google or from its feed stays linked; deleting the event restores the item on its own");
}

main()
  .then(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.log("Calendar event links verified.");
  })
  .catch(async (error) => {
    console.error(error);
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
