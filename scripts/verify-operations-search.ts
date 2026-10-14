/**
 * Proves the event-scoped operations search (#180) against a real PostgreSQL
 * database: lookup by an attendee who is not the payer, words that must match
 * the same person, duplicate names with a deterministic order, restricted and
 * staff note text that no search can reach, filters that are refused (and
 * indistinguishable from missing ones) for a viewer without the permission,
 * stale and sensitive form keys reported instead of reinterpreted, answers that
 * survive a form relabel across versions, another event that is never
 * reachable, results/counts/facets/suggestions that agree, canonical paging over
 * a large event with identical timestamps, and the bounds and indexes.
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:operations-search
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient, RegistrationFormStatus, type RegistrationStatus } from "@prisma/client";
import type { EventPermission } from "../modules/access/permissions";
import type { SearchViewer } from "../modules/registrations/operations-search-domain";

loadEnvConfig(process.cwd());

// Only ever runs against a local or CI database, never a shared or production one.
const databaseHost = (() => {
  try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; }
})();
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost)) {
  console.error(`Refusing to run: DATABASE_URL points at "${databaseHost || "nothing"}", not a local or CI database.`);
  process.exit(1);
}

const prisma = new PrismaClient();
const P = "ops";
const eventA = `${P}_event_a`;
const eventB = `${P}_event_b`;
const staffId = `${P}_staff`;
const formA = `${P}_form_a`;
const versionOne = `${P}_formver_1`;
const versionTwo = `${P}_formver_2`;
const BULK = 1500;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function cleanup() {
  const events = [eventA, eventB];
  await prisma.publicRegistrationSubmission.deleteMany({ where: { eventId: { in: events } } });
  await prisma.event.deleteMany({ where: { id: { in: events } } });
  await prisma.person.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.user.deleteMany({ where: { id: staffId } });
}

const field = (
  id: string,
  key: string,
  label: string,
  type: string,
  scope: "ATTENDEE" | "REGISTRATION",
  options: string[] = [],
  extra: Record<string, unknown> = {},
) => ({ id: `${P}_${id}`, key, label, helpText: "", type, scope, required: false, options, ...extra });

async function main() {
  const { registrationFormDefinitionSchema } = await import("../modules/forms/definition");
  const search = await import("../modules/registrations/operations-search-repository");
  const domain = await import("../modules/registrations/operations-search-domain");

  await cleanup();
  await prisma.user.create({ data: { id: staffId, email: `${P}-staff@example.test`, displayName: "Search Check Staff", globalRole: "SYSTEM_ADMIN" } });
  const eventData = {
    startsAt: new Date("2026-12-05T15:00:00Z"), endsAt: new Date("2026-12-06T22:00:00Z"), timezone: "America/Chicago", isPublished: true,
    registrationOpensOn: "2026-10-01", registrationClosesOn: "2026-11-30", audience: "GENERAL" as const,
  };
  await prisma.event.create({ data: { id: eventA, slug: `${P}-event-a`, name: "Search check A", waitlistEnabled: true, ...eventData } });
  await prisma.event.create({ data: { id: eventB, slug: `${P}-event-b`, name: "Search check B (another event)", ...eventData } });
  await prisma.eventAttendeeType.createMany({
    data: [
      { id: `${P}_type_adult`, eventId: eventA, code: "ADULT", label: "Adult" },
      { id: `${P}_type_youth`, eventId: eventA, code: "YOUTH", label: "Youth" },
    ],
  });

  // Form version 1 labels the meal question "Meal preference"; version 2 relabels it and its choice. The key does not change.
  const definitionOne = registrationFormDefinitionSchema.parse({
    title: "Search check form", description: "Fictitious form.", confirmationMessage: "Thanks.",
    sections: [{ id: `${P}_s1`, title: "Details", description: "", fields: [
      field("f_meal", "meal", "Meal preference", "SELECT", "ATTENDEE", ["plain", "vegan", "vegetarian"]),
      field("f_ride", "transport", "How are you travelling", "RADIO", "REGISTRATION", ["bus", "car"]),
      field("f_allergy", "food_allergies", "Food allergies", "SELECT", "ATTENDEE", ["peanut", "none"]),
    ] }],
  });
  const definitionTwo = registrationFormDefinitionSchema.parse({
    ...definitionOne,
    sections: [{ id: `${P}_s1`, title: "Details", description: "", fields: [
      field("f_meal", "meal", "Dinner choice", "SELECT", "ATTENDEE", ["plain", "vegan", "vegetarian", "kosher"], { optionLabels: { vegan: "Plant based" } }),
      field("f_ride", "transport", "How are you travelling", "RADIO", "REGISTRATION", ["bus", "car"]),
      field("f_allergy", "food_allergies", "Food allergies", "SELECT", "ATTENDEE", ["peanut", "none"]),
    ] }],
  });
  await prisma.registrationForm.create({
    data: {
      id: formA, eventId: eventA, createdByUserId: staffId, name: "Search check form", slug: `${P}-form`, status: RegistrationFormStatus.PUBLISHED,
      versions: { create: [
        { id: versionOne, createdByUserId: staffId, versionNumber: 1, status: RegistrationFormStatus.ARCHIVED, publishedAt: new Date("2026-09-01T00:00:00Z"), definition: definitionOne },
        { id: versionTwo, createdByUserId: staffId, versionNumber: 2, status: RegistrationFormStatus.PUBLISHED, publishedAt: new Date("2026-09-15T00:00:00Z"), definition: definitionTwo },
      ] },
    },
  });
  const tagVip = await prisma.eventTag.create({ data: { id: `${P}_tag_vip`, eventId: eventA, name: "VIP", normalizedName: "vip", color: "#336699" } });
  const tagOld = await prisma.eventTag.create({ data: { id: `${P}_tag_old`, eventId: eventA, name: "Old", normalizedName: "old", color: "#996633", isActive: false } });

  let seq = 0;
  type Seed = {
    key: string; code: string; status?: RegistrationStatus; totalCents?: number; submittedAt?: Date | null; createdAt?: Date;
    holder: [string, string, string?, string?];
    attendees: Array<{ first: string; last: string; email?: string; typeCode?: "ADULT" | "YOUTH"; meal?: string; allergy?: string }>;
    transport?: string; version?: string; event?: string; submission?: boolean;
  };
  async function seed(spec: Seed) {
    seq += 1;
    const event = spec.event ?? eventA;
    const holderId = `${P}_p_${spec.key}_h`;
    await prisma.person.create({ data: { id: holderId, firstName: spec.holder[0], lastName: spec.holder[1], normalizedEmail: spec.holder[2] ?? null, phone: spec.holder[3] ?? null } });
    const registration = await prisma.registration.create({
      data: {
        id: `${P}_r_${spec.key}`, eventId: event, accountHolderPersonId: holderId, confirmationCode: spec.code, status: spec.status ?? "CONFIRMED",
        totalAmount: (spec.totalCents ?? 0) / 100,
        contactSnapshot: { firstName: spec.holder[0], lastName: spec.holder[1], email: spec.holder[2] ?? "", phone: spec.holder[3] ?? "" },
        submittedAt: spec.submittedAt === undefined ? new Date(Date.UTC(2026, 9, 1, 12, seq)) : spec.submittedAt,
        createdAt: spec.createdAt ?? new Date(Date.UTC(2026, 9, 1, 12, seq)),
      },
    });
    const attendeeIds: string[] = [];
    for (const [index, attendee] of spec.attendees.entries()) {
      const personId = `${P}_p_${spec.key}_a${index}`;
      await prisma.person.create({ data: { id: personId, firstName: attendee.first, lastName: attendee.last, normalizedEmail: attendee.email ?? null } });
      const row = await prisma.registrationAttendee.create({
        data: {
          id: `${P}_a_${spec.key}_${index}`, eventId: event, registrationId: registration.id, personId, attendeeType: "ATTENDEE", position: index,
          attendeeTypeDefinitionId: attendee.typeCode ? `${P}_type_${attendee.typeCode.toLowerCase()}` : null,
          profileSnapshot: { firstName: attendee.first, lastName: attendee.last, email: attendee.email ?? "", phone: "", source: "PUBLIC_REGISTRATION" },
          formResponses: { ...(attendee.meal ? { meal: attendee.meal } : {}), ...(attendee.allergy ? { food_allergies: attendee.allergy } : {}) },
        },
      });
      attendeeIds.push(row.id);
    }
    if (spec.submission !== false && event === eventA) {
      await prisma.publicRegistrationSubmission.create({
        data: {
          id: `${P}_sub_${spec.key}`, eventId: event, formVersionId: spec.version ?? versionTwo, registrationId: registration.id,
          idempotencyKey: `${P}-${spec.key}`, requestHash: `${P}-${spec.key}`, responses: spec.transport ? { transport: spec.transport } : {},
          attendeeResponses: [], pricingSnapshot: {},
        },
      });
    }
    return { registrationId: registration.id, attendeeIds };
  }
  const pay = (key: string, cents: number, status: "SUCCEEDED" | "PENDING" = "SUCCEEDED") => prisma.payment.create({
    data: { id: `${P}_pay_${key}`, eventId: eventA, registrationId: `${P}_r_${key}`, amount: cents / 100, status, method: "CASH" },
  });

  // ---- named fixtures -------------------------------------------------------
  const r1 = await seed({ key: "marta", code: "OPS-1001", totalCents: 10000, holder: ["Marta", "Alvarez", "marta.alvarez@example.test", "555-0101"], transport: "bus", version: versionOne,
    attendees: [{ first: "Marta", last: "Alvarez", typeCode: "ADULT", meal: "plain" }, { first: "Diego", last: "Alvarez", email: "diego.alvarez@example.test", typeCode: "YOUTH", meal: "vegan", allergy: "peanut" }] });
  await pay("marta", 10000);
  const r2 = await seed({ key: "jane_smith", code: "OPS-1002", totalCents: 8000, holder: ["Jane", "Smith", "jane.smith@example.test"], transport: "car",
    attendees: [{ first: "Jane", last: "Smith", typeCode: "ADULT", meal: "vegetarian" }, { first: "Sam", last: "Jones", typeCode: "YOUTH", meal: "vegan" }] });
  await pay("jane_smith", 3000);
  await seed({ key: "jane_doe", code: "OPS-1003", totalCents: 5000, holder: ["Jane", "Doe", "jane.doe@example.test"],
    attendees: [{ first: "Jane", last: "Doe", typeCode: "ADULT" }, { first: "Sam", last: "Smith", typeCode: "YOUTH" }] });
  // Two different people who share a name, one tied timestamp each.
  const tie = new Date("2026-10-02T09:00:00Z");
  await seed({ key: "pat1", code: "OPS-1004", holder: ["Pat", "Lee", "pat.lee.one@example.test"], attendees: [{ first: "Pat", last: "Lee", typeCode: "ADULT" }], submittedAt: tie, createdAt: tie });
  await seed({ key: "pat2", code: "OPS-1005", holder: ["Pat", "Lee", "pat.lee.two@example.test"], attendees: [{ first: "Pat", last: "Lee", typeCode: "ADULT" }], submittedAt: tie, createdAt: tie });
  const r5 = await seed({ key: "cancelled", code: "OPS-1006", status: "CANCELLED", totalCents: 5000, holder: ["Cora", "Quill", "cora.quill@example.test"], attendees: [{ first: "Cora", last: "Quill", typeCode: "ADULT" }] });
  await pay("cancelled", 5000);
  const refund = await prisma.refund.create({ data: { id: `${P}_refund_1`, eventId: eventA, paymentId: `${P}_pay_cancelled`, amount: 50, status: "SUCCEEDED" } });
  assert(refund.id, "refund created");
  const r6 = await seed({ key: "waiting", code: "OPS-1007", status: "WAITLISTED", totalCents: 6000, holder: ["Wanda", "Waits", "wanda.waits@example.test"], attendees: [{ first: "Wanda", last: "Waits", typeCode: "ADULT" }], submission: false });
  await prisma.registrationWaitlistEntry.create({ data: { eventId: eventA, registrationId: r6.registrationId, position: 1, attendeeCount: 1, status: "WAITING" } });
  const r7 = await seed({ key: "arrived", code: "OPS-1008", totalCents: 4000, holder: ["Avery", "Arrived", "avery.arrived@example.test"], attendees: [{ first: "Avery", last: "Arrived", typeCode: "ADULT" }, { first: "Blake", last: "Arrived", typeCode: "YOUTH" }] });
  await pay("arrived", 4000);
  for (const [index, id] of r7.attendeeIds.entries()) {
    await prisma.checkIn.create({ data: { id: `${P}_ci_arrived_${index}`, eventId: eventA, registrationAttendeeId: id, idempotencyKey: `${P}-ci-arrived-${index}` } });
  }
  await prisma.checkIn.create({ data: { id: `${P}_ci_jane`, eventId: eventA, registrationAttendeeId: r2.attendeeIds[0], idempotencyKey: `${P}-ci-jane` } });
  // An undone check-in does not count.
  await prisma.checkIn.create({ data: { id: `${P}_ci_undone`, eventId: eventA, registrationAttendeeId: r1.attendeeIds[0], idempotencyKey: `${P}-ci-undone`, undoneAt: new Date() } });
  // Tags: one on a registration, one on an attendee, one removed.
  await prisma.registrationTagAssignment.create({ data: { eventId: eventA, registrationId: r1.registrationId, tagId: tagVip.id, appliedByUserId: staffId } });
  await prisma.attendeeTagAssignment.create({ data: { eventId: eventA, attendeeId: r2.attendeeIds[1], tagId: tagVip.id, appliedByUserId: staffId } });
  await prisma.registrationTagAssignment.create({ data: { eventId: eventA, registrationId: r5.registrationId, tagId: tagVip.id, appliedByUserId: staffId, removedAt: new Date(), removedByUserId: staffId } });
  // Notes: neither body is ever searchable.
  const restricted = await prisma.staffNote.create({ data: { id: `${P}_note_r`, eventId: eventA, registrationId: r1.registrationId, visibility: "RESTRICTED", restrictedPermission: "VIEW_SENSITIVE_DATA", authorUserId: staffId } });
  await prisma.staffNoteRevision.create({ data: { noteId: restricted.id, sequence: 1, body: "ZEBRAQUILL restricted note body", authorUserId: staffId } });
  const plain = await prisma.staffNote.create({ data: { id: `${P}_note_s`, eventId: eventA, registrationId: r2.registrationId, visibility: "STAFF", authorUserId: staffId } });
  await prisma.staffNoteRevision.create({ data: { noteId: plain.id, sequence: 1, body: "OTTERQUILL staff note body", authorUserId: staffId } });
  // Another event whose people share names and a code prefix with this one.
  await seed({ key: "b_marta", code: "OPS-B-1001", event: eventB, totalCents: 1000, holder: ["Marta", "Alvarez", "marta.b@example.test"], attendees: [{ first: "Marta", last: "Alvarez" }] });

  // ---- a large event ---------------------------------------------------------
  const bulkTime = new Date("2026-10-03T10:00:00Z");
  await prisma.person.createMany({ data: Array.from({ length: BULK }, (_, i) => ({ id: `${P}_p_bulk${i}`, firstName: `Bulk${i}`, lastName: "Crowd" })) });
  await prisma.registration.createMany({
    data: Array.from({ length: BULK }, (_, i) => ({
      id: `${P}_r_bulk${i}`, eventId: eventA, accountHolderPersonId: `${P}_p_bulk${i}`, confirmationCode: `OPS-B${String(i).padStart(5, "0")}`,
      status: "CONFIRMED" as const, totalAmount: 0, contactSnapshot: { firstName: `Bulk${i}`, lastName: "Crowd", email: "", phone: "" },
      // Every bulk row shares one created time and has no submitted time: only the id tie-break keeps the order total.
      submittedAt: null, createdAt: bulkTime,
    })),
  });
  await prisma.registrationAttendee.createMany({
    data: Array.from({ length: BULK }, (_, i) => ({
      id: `${P}_a_bulk${i}`, eventId: eventA, registrationId: `${P}_r_bulk${i}`, personId: `${P}_p_bulk${i}`, attendeeType: "ATTENDEE",
      attendeeTypeDefinitionId: `${P}_type_adult`, position: 0, profileSnapshot: { firstName: `Bulk${i}`, lastName: "Crowd", email: "", phone: "" },
    })),
  });
  console.log(`ok  seeded ${BULK} bulk registrations plus the named fixtures`);

  // ---- viewers ----------------------------------------------------------------
  const view = (eventId: string, ...permissions: EventPermission[]): SearchViewer => ({ eventId, permissions });
  const admin = view(eventA, "VIEW_EVENT", "CONFIGURE_EVENT", "MANAGE_REGISTRATION", "MANAGE_FINANCE", "MANAGE_COMMUNICATIONS", "MANAGE_CHECK_IN", "VIEW_REPORTS", "MANAGE_STAFF", "VIEW_SENSITIVE_DATA", "MANAGE_IMPORTS", "MANAGE_FORMS");
  const registrar = view(eventA, "VIEW_EVENT", "MANAGE_REGISTRATION", "VIEW_SENSITIVE_DATA");
  const finance = view(eventA, "VIEW_EVENT", "MANAGE_FINANCE", "VIEW_SENSITIVE_DATA");
  const checkIn = view(eventA, "VIEW_EVENT", "MANAGE_CHECK_IN");
  const readOnly = view(eventA, "VIEW_EVENT");
  const nobody = view(eventA);
  const adminB = view(eventB, "VIEW_EVENT", "MANAGE_REGISTRATION", "VIEW_SENSITIVE_DATA", "MANAGE_FINANCE");
  const ids = (result: { registrationIds: string[] }) => result.registrationIds;
  const run = (viewer: SearchViewer, qs: string) => search.searchOperationsRegistrations(viewer, new URLSearchParams(qs));
  const reg = (key: string) => `${P}_r_${key}`;
  const sameSet = (left: readonly string[], right: readonly string[]) => left.length === right.length && [...left].sort().join() === [...right].sort().join();

  /** Every page of a search: the total must equal the rows walked, with no repeat and no gap. */
  async function walk(viewer: SearchViewer, qs: string, size = 100) {
    const all: string[] = [];
    let total = -1;
    let facetTotal = -1;
    for (let page = 1; page < 200; page += 1) {
      const params = new URLSearchParams(qs);
      params.set("size", String(size));
      params.set("page", String(page));
      const result = await search.searchOperationsRegistrations(viewer, params);
      assert(result.ok, `walk ${qs} page ${page}: ${JSON.stringify(result.issues)}`);
      total = result.total;
      facetTotal = result.facets.status.reduce((sum, entry) => sum + entry.count, 0);
      if (result.registrationIds.length === 0) break;
      all.push(...result.registrationIds);
      if (page >= result.pageCount) break;
    }
    assert(new Set(all).size === all.length, `walk ${qs}: a registration appeared on two pages`);
    assert(all.length === total, `walk ${qs}: count ${total} differs from the ${all.length} rows paged`);
    assert(facetTotal === total || total === 0, `walk ${qs}: facet counts ${facetTotal} differ from total ${total}`);
    return { all, total };
  }

  // 1. Lookup by an attendee who is not the payer still works (#316), by name and email.
  assert(sameSet(ids(await run(registrar, "q=Diego")), [reg("marta")]), "an attendee who is not the payer is found by name");
  assert(sameSet(ids(await run(registrar, "q=diego.alvarez@example")), [reg("marta")]), "an attendee is found by email");
  assert(sameSet(ids(await run(registrar, "q=ops-1001")), [reg("marta")]), "a confirmation code matches ignoring case");
  assert(sameSet(ids(await run(registrar, "q=555-0101")), [reg("marta")]), "the payer is found by phone");
  console.log("ok  attendee lookup keeps working: name, email, code, phone");

  // 2. Every word must match one person.
  assert(sameSet(ids(await run(registrar, "q=Jane+Smith")), [reg("jane_smith")]), "Jane Smith does not match Jane Doe travelling with Sam Smith");
  assert(sameSet(ids(await run(registrar, "q=Sam+Smith")), [reg("jane_doe")]), "an attendee full name matches");
  // Wildcards typed by a person are literal text.
  assert(ids(await run(registrar, "q=%25")).length === 0 && ids(await run(registrar, "q=_")).length === 0, "percent and underscore are not wildcards");
  console.log("ok  words match the same person; wildcards are literal");

  // 3. Duplicate names: both found, a total order, the same on every run, and the id breaks the tie.
  const pats = await run(registrar, "q=Pat+Lee&sort=created");
  assert(pats.ok && pats.registrationIds.length === 2 && new Set(pats.registrationIds).size === 2, "two people named Pat Lee are both returned, once each");
  const patsAgain = await run(registrar, "q=Pat+Lee&sort=created");
  assert(pats.registrationIds.join() === patsAgain.registrationIds.join(), "tied rows keep one order between runs");
  assert(pats.registrationIds.join() === [reg("pat2"), reg("pat1")].join(), "a created-descending tie falls back to id descending");
  const patsName = await run(registrar, "q=Pat+Lee&sort=name");
  assert(patsName.registrationIds.join() === [reg("pat1"), reg("pat2")].join(), "a name-ascending tie falls back to id ascending");
  console.log("ok  duplicate names are distinct rows in a deterministic order");

  // 4. Restricted and staff note text is not reachable by any search, whoever asks.
  for (const needle of ["ZEBRAQUILL", "OTTERQUILL", "restricted note"]) {
    const result = await run(admin, `q=${encodeURIComponent(needle)}`);
    assert(result.ok && result.total === 0, `note text "${needle}" is not searchable`);
  }
  const suggestNotes = await search.suggestOperationsSearch(admin, "ZEBRA");
  assert(suggestNotes.ok && suggestNotes.suggestions.length === 0, "note text is not suggested");
  const catalogAdmin = await search.describeOperationsSearch(admin);
  const offered = JSON.stringify(catalogAdmin.filters).toLowerCase();
  assert(!/note|consent|health|medical|member/.test(offered.replace("allerg", "")), "no filter for notes, consent, health or membership is offered");
  assert(!offered.includes("food_allergies") && !offered.includes("allergies"), "the health-type form question is not offered");
  console.log("ok  note text, consent, health and membership are not searchable or offered");

  // 5. Unauthorized filters: refused with no rows, and no different from a filter that does not exist.
  const noText = await run(readOnly, "q=Marta");
  assert(!noText.ok && noText.total === 0 && noText.registrationIds.length === 0 && noText.issues[0]?.code === "unavailable", "a viewer without VIEW_SENSITIVE_DATA cannot search by text");
  const noFinance = await run(registrar, "payment=PAID");
  assert(!noFinance.ok && noFinance.issues[0]?.code === "unavailable", "payment state needs MANAGE_FINANCE");
  const noCheckIn = await run(readOnly, "checkIn=ANY");
  assert(!noCheckIn.ok && noCheckIn.issues[0]?.code === "unavailable", "check-in state needs check-in or registration access");
  const noTags = await run(checkIn, `tag=${tagVip.id}`);
  assert(!noTags.ok && noTags.issues[0]?.code === "unavailable", "tags are not available to a check-in-only viewer");
  const noAnswers = await run(readOnly, "answer=ATTENDEE:meal=vegan");
  assert(!noAnswers.ok && noAnswers.issues[0]?.code === "unavailable", "form answers need VIEW_SENSITIVE_DATA");
  const none = await run(nobody, "status=CONFIRMED");
  assert(!none.ok && none.total === 0, "a viewer without VIEW_EVENT gets nothing");
  // Event B has no waitlist: the filter does not exist there. A viewer who may not use payment sees the identical shape.
  const missing = await run(adminB, "waitlist=WAITING");
  assert(!missing.ok && missing.issues[0]?.code === noFinance.issues[0]?.code && missing.issues[0]?.message === noFinance.issues[0]?.message, "a missing domain and a forbidden one read the same");
  // Allowed filters still work for the right viewer.
  assert(sameSet(ids(await run(finance, "payment=PAID")), [reg("marta"), reg("arrived")]), "paid in full");
  assert(sameSet(ids(await run(finance, "payment=PARTIAL")), [reg("jane_smith")]), "partly paid");
  assert(sameSet(ids(await run(finance, "payment=REFUNDED")), [reg("cancelled")]), "refunded");
  const unpaid = await run(finance, "payment=UNPAID");
  assert(sameSet(ids(unpaid), [reg("jane_doe"), reg("waiting"), reg("cancelled")]), `unpaid is a total above zero with nothing left paid (a fully refunded registration included, as in finance): ${unpaid.registrationIds.join()}`);
  console.log("ok  unauthorized filters are refused without rows or leaks; the right viewer gets the right rows");

  // 6. Check-in, waitlist, tags, source, attendee type, status, organization-less filters.
  assert(sameSet(ids(await run(registrar, "checkIn=ALL")), [reg("arrived")]), "every attendee checked in");
  assert(sameSet(ids(await run(registrar, "checkIn=ANY")), [reg("arrived"), reg("jane_smith")]), "an undone check-in does not count");
  assert((await run(registrar, "checkIn=NONE")).total === (await run(registrar, "")).total - 2, "nobody checked in is the rest");
  assert(sameSet(ids(await run(registrar, "waitlist=WAITING")), [reg("waiting")]), "waitlist state");
  assert(sameSet(ids(await run(registrar, `tag=${tagVip.id}`)), [reg("marta"), reg("jane_smith")]), "a tag on the registration or on an attendee matches; a removed one does not");
  const oldTag = await run(registrar, `tag=${tagOld.id}`);
  assert(oldTag.ok && oldTag.total === 0, "a deactivated tag with no assignments matches nothing");
  const stale = await run(registrar, "tag=ops_tag_gone");
  assert(!stale.ok && stale.issues.some((issue) => issue.code === "stale-reference"), "an unknown tag id is reported as stale");
  const staffSourced = await run(registrar, "source=STAFF");
  assert(staffSourced.total === await prisma.registration.count({ where: { eventId: eventA, publicFormSubmission: null } }) && ids(staffSourced).includes(reg("waiting")), "source STAFF is registrations with no submission");
  const types = await run(registrar, "attendeeType=YOUTH");
  assert(sameSet(ids(types), [reg("marta"), reg("jane_smith"), reg("jane_doe"), reg("arrived")]), "attendee type by code");
  assert((await run(registrar, "attendeeType=GONE")).issues.some((issue) => issue.code === "stale-reference"), "an unknown attendee type is reported");
  assert(sameSet(ids(await run(registrar, "status=CANCELLED,WAITLISTED")), [reg("cancelled"), reg("waiting")]), "lifecycle status");
  console.log("ok  check-in, waitlist, tag, source, attendee type and status filters");

  // 7. Form answers: stable key survives the relabel and the version change; stale and sensitive keys are reported.
  assert(sameSet(ids(await run(registrar, "answer=ATTENDEE:meal=vegan")), [reg("marta"), reg("jane_smith")]), "meal=vegan matches across form versions and the relabelled choice");
  assert(sameSet(ids(await run(registrar, "answer=REGISTRATION:transport=bus")), [reg("marta")]), "a registration-wide answer from the older form version still matches");
  assert(sameSet(ids(await run(registrar, "answer=ATTENDEE:meal=vegan&answer=ATTENDEE:meal=vegetarian")), [reg("marta"), reg("jane_smith")]), "values of one key are alternatives");
  assert(sameSet(ids(await run(registrar, "answer=ATTENDEE:meal=vegan&answer=REGISTRATION:transport=car")), [reg("jane_smith")]), "different keys combine");
  const kosher = await run(registrar, "answer=ATTENDEE:meal=kosher");
  assert(kosher.ok && kosher.total === 0, "a choice added by the newer version is offered");
  const gone = await run(registrar, "answer=REGISTRATION:legacy_field=x");
  assert(!gone.ok && gone.total === 0 && gone.issues.some((issue) => issue.code === "field-unavailable"), "a stale field key is reported, not reinterpreted");
  const goneValue = await run(registrar, "answer=ATTENDEE:meal=pescatarian");
  assert(!goneValue.ok && goneValue.issues.some((issue) => issue.code === "value-not-offered") && goneValue.total === 0, "a choice no longer offered is reported");
  const health = await run(admin, "answer=ATTENDEE:food_allergies=peanut");
  assert(!health.ok && health.total === 0 && health.issues.some((issue) => issue.code === "field-unavailable"), "a health-type question is never searchable, even for an administrator");
  const labelKey = await run(registrar, "answer=ATTENDEE:Dinner+choice=vegan");
  assert(!labelKey.ok, "a label is not a key");
  console.log("ok  form-answer keys are stable; stale, label and health keys are reported");

  // 8. Another event is unreachable, in rows, counts and suggestions.
  const inB = await run(adminB, "q=Marta");
  assert(inB.ok && sameSet(ids(inB), [`${P}_r_b_marta`]) && inB.total === 1, "event B's viewer sees only event B");
  const inA = await run(registrar, "q=Marta");
  assert(inA.ok && !ids(inA).includes(`${P}_r_b_marta`), "event A's viewer never sees event B's registration");
  const codeB = await run(registrar, "q=OPS-B-1001");
  assert(codeB.ok && codeB.total === 0, "event B's confirmation code finds nothing from event A");
  const suggestB = await search.suggestOperationsSearch(registrar, "OPS-B-1001");
  assert(suggestB.suggestions.length === 0, "event B's code is not suggested in event A");
  const everythingA = await walk(registrar, "");
  assert(everythingA.all.every((id) => !id.includes("_b_marta")), "no row from another event in a full walk");
  console.log("ok  another event is unreachable");

  // 9. Results, counts, facets and suggestions agree.
  const combos = ["", "status=CONFIRMED", "q=Alvarez", "q=Crowd", "payment=PAID", "checkIn=NONE", `tag=${tagVip.id}`, "attendeeType=ADULT", "answer=ATTENDEE:meal=vegan", "sort=name&q=Pat", "source=PUBLIC_FORM"];
  for (const qs of combos) {
    const { all, total } = await walk(admin, qs);
    const single = await run(admin, `${qs}${qs ? "&" : ""}size=100`);
    assert(single.total === total && all.slice(0, 100).join() === single.registrationIds.join(), `count and first page agree for "${qs}"`);
  }
  for (const prefix of ["Mar", "Pat", "Jane S", "OPS-100", "Bulk1"]) {
    const suggested = await search.suggestOperationsSearch(admin, prefix);
    const full = await walk(admin, `q=${encodeURIComponent(prefix)}`);
    assert(suggested.ok && suggested.suggestions.every((entry) => full.all.includes(entry.registrationId)), `every suggestion for "${prefix}" is a registration the search returns`);
    assert(suggested.suggestions.length <= 8, "suggestions are bounded");
  }
  const narrowedSuggest = await search.suggestOperationsSearch(registrar, "Jane", new URLSearchParams("status=CANCELLED"));
  assert(narrowedSuggest.suggestions.length === 0, "suggestions honour the filters already chosen");
  const readOnlySuggest = await search.suggestOperationsSearch(readOnly, "Marta");
  assert(!readOnlySuggest.ok && readOnlySuggest.suggestions.length === 0, "a viewer who may not search by text gets no suggestions");
  console.log("ok  results, counts, facets and suggestions agree");

  // 10. The URL form round-trips and means the same on the server.
  const parsed = domain.parseOperationsSearchParams(new URLSearchParams("q=Alvarez&status=CONFIRMED&sort=name.desc&answer=ATTENDEE:meal=vegan"));
  const roundTrip = await search.searchOperationsRegistrations(registrar, parsed.query);
  const viaUrl = await search.searchOperationsRegistrations(registrar, new URLSearchParams(roundTrip.queryString));
  assert(roundTrip.ok && roundTrip.registrationIds.join() === viaUrl.registrationIds.join() && viaUrl.queryString === roundTrip.queryString, "a serialized query returns the same rows");
  console.log("ok  query serialization round-trips");

  // 11. Large event: canonical paging over tied rows, bounds, indexes.
  const started = Date.now();
  const crowd = await walk(registrar, "q=Crowd", 100);
  const crowdAgain = await walk(registrar, "q=Crowd", 100);
  assert(crowd.total === BULK && crowd.all.join() === crowdAgain.all.join(), "paging 1500 rows with one shared timestamp is stable");
  const sorted = [...crowd.all].sort().reverse();
  assert(crowd.all.join() === sorted.join(), "bulk rows tied on every visible value fall back to id descending");
  const unfiltered = await walk(registrar, "", 100);
  assert(unfiltered.total >= BULK, "an unfiltered walk reaches every row of the event");
  const elapsed = Date.now() - started;
  console.log(`ok  ${BULK + 8} registrations paged in ${elapsed} ms (three full walks)`);
  const tooBig = await run(registrar, "size=1000");
  assert(tooBig.issues.some((issue) => issue.code === "invalid-value") && !tooBig.ok, "page size is capped");
  const tooDeep = await run(registrar, "page=5000");
  assert(!tooDeep.ok, "page depth is capped");
  const tooLong = await run(registrar, `q=${"a".repeat(500)}`);
  assert(!tooLong.ok, "a very long search text is refused");
  const beyond = await search.searchOperationsRegistrations(registrar, new URLSearchParams("q=Crowd&page=100&size=100"));
  assert(beyond.ok && beyond.registrationIds.length === 0 && beyond.total === BULK, "a page past the end is empty, with the true total");
  await prisma.$executeRawUnsafe(`ANALYZE "Registration"`);
  const plan = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
    return tx.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
      `EXPLAIN SELECT id FROM "Registration" WHERE "eventId" = '${eventA}' ORDER BY "createdAt" DESC, id DESC LIMIT 50`,
    );
  });
  assert(plan.map((row) => row["QUERY PLAN"]).join("\n").includes("Registration_eventId_createdAt_id_idx"), `the canonical order reads the event-scoped index: ${plan.map((row) => row["QUERY PLAN"]).join(" / ")}`);
  console.log("ok  large event: stable paging, capped sizes, indexed canonical order");
}

main()
  .then(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.log("operations search checks passed");
  })
  .catch(async (error) => {
    console.error(error);
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
