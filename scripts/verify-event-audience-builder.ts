/**
 * Proves the reviewed event audience builder (#176) against a real PostgreSQL database. Preview only: nothing here
 * sends, queues or schedules a message.
 *
 * - one email in several roles and several registrations is one recipient, with every role and reason kept and each
 *   registration's own balance (no merged financial confirmations);
 * - registrations are selected by the operations search (#180): its filters (lifecycle, attendee type, payment state,
 *   check-in, tags) qualify people, each with a reason, and the readiness narrowing and the roles are the audience's own;
 * - a health-type or sensitive-flagged form question is unsearchable and never offered, and an audience larger than the
 *   search can enumerate is refused, not truncated;
 * - suppressed addresses (an event opt-out, a bounce), missing and invalid addresses are excluded with a reason, and an
 *   operational message ignores an announcement opt-out;
 * - protected data cannot qualify or appear: a restricted note, health-style answers, another event's tag and the staff
 *   list never show in any preview, and a filter the caller may not use (tags without VIEW_SENSITIVE_DATA, payment
 *   without MANAGE_FINANCE, a group or organization role on an event without that domain, another event's tag) is
 *   refused with one identical answer;
 * - the fingerprint and counts are identical across batch sizes, paged previews cover 650+ registrations without
 *   repeating or skipping anyone, and a changed record after preview changes the fingerprint;
 * - a snapshot needs the fingerprint that was previewed (PREVIEW_CHANGED otherwise), replays by UUID, refuses a reused id
 *   for another audience, and writes an audit row of ids and counts with no address;
 * - previewing and snapshotting create no message, batch or outbox row.
 *
 * Uses fictitious rows it creates and removes itself.
 *
 *   npm run test:event-audience-builder
 */
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-audience-builder-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `aud176_${randomUUID().slice(0, 8)}`;
const ids = {
  admin: `${P}_admin`,
  comms: `${P}_comms`,
  event: `${P}_event`,
  other: `${P}_other`,
  tagVip: `${P}_tag_vip`,
  tagOther: `${P}_tag_other`,
  org: `${P}_org`,
  org2: `${P}_org2`,
};
const email = (name: string) => `${P}.${name}@example.test`;
const SECRET_NOTE = `RESTRICTED-NOTE-BODY-${P}`;
const SECRET_ANSWER = `SECRET-ALLERGY-ANSWER-${P}`;

const commsPermissions = ["VIEW_EVENT", "MANAGE_COMMUNICATIONS"];
const adminPermissions = ["VIEW_EVENT", "MANAGE_COMMUNICATIONS", "VIEW_SENSITIVE_DATA", "MANAGE_CHECK_IN", "MANAGE_REGISTRATION", "MANAGE_FINANCE", "CONFIGURE_EVENT"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

const personIds: string[] = [];
async function person(name: string, mail: string | null) {
  const id = `${P}_p_${name}`;
  personIds.push(id);
  await prisma.person.create({ data: { id, firstName: name, lastName: "Synthetic", normalizedEmail: mail } });
  return id;
}

async function cleanup() {
  const eventIds = [ids.event, ids.other];
  await prisma.auditLog.deleteMany({ where: { OR: [{ eventId: { in: eventIds } }, { actorUserId: { in: [ids.admin, ids.comms] } }] } });
  await prisma.eventAudienceSnapshot.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.emailAnnouncementOptOut.deleteMany({ where: { normalizedEmail: { startsWith: `${P}.` } } });
  await prisma.messageOutbox.deleteMany({ where: { recipientEmail: { startsWith: `${P}.` } } });
  // A billing contact is ended, never deleted; the trigger is lifted only to remove these synthetic rows.
  await prisma.$executeRawUnsafe('ALTER TABLE "OrganizationBillingContact" DISABLE TRIGGER "OrganizationBillingContact_no_delete"');
  try {
    await prisma.organizationBillingContact.deleteMany({ where: { organizationId: { in: [ids.org, ids.org2] } } });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "OrganizationBillingContact" ENABLE TRIGGER "OrganizationBillingContact_no_delete"');
  }
  await prisma.clubEventRegistration.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.groupEventRegistration.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ids.org, ids.org2] } } });
  await prisma.person.deleteMany({ where: { id: { startsWith: `${P}_p_` } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.comms] } } });
}

async function main() {
  const { evaluateEventAudience, previewEventAudience, createAudienceSnapshot, getAudienceFilterOptions } = await import("@/modules/communications/audience-repository");
  const { registrationFormDefinitionSchema } = await import("../modules/forms/definition");
  const { AudienceFilterNotAvailableError } = await import("@/modules/communications/audience-query");
  const { MessagingError } = await import("@/modules/communications/messaging-error");

  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ids.admin, email: `${P}.admin@example.test`, displayName: "Synthetic Admin" },
      { id: ids.comms, email: `${P}.comms@example.test`, displayName: "Synthetic Comms" },
    ],
  });
  for (const [eventId, slug] of [[ids.event, "event"], [ids.other, "other"]] as const) {
    await prisma.event.create({
      data: {
        id: eventId, slug: `${P}-${slug}`, name: `Audience Verification ${slug}`,
        startsAt: new Date("2027-10-08T21:00:00Z"), endsAt: new Date("2027-10-10T17:00:00Z"), location: "Synthetic Camp",
      },
    });
  }
  await prisma.eventMembership.createMany({
    data: [
      { eventId: ids.event, userId: ids.admin, role: "EVENT_ADMIN" },
      { eventId: ids.event, userId: ids.comms, role: "COMMUNICATIONS_MANAGER" },
    ],
  });
  const typeIds = { ADULT: `${P}_type_adult`, YOUTH: `${P}_type_youth` };
  await prisma.eventAttendeeType.createMany({
    data: [
      { id: typeIds.ADULT, eventId: ids.event, code: "ADULT", label: "Adult" },
      { id: typeIds.YOUTH, eventId: ids.event, code: "YOUTH", label: "Youth" },
    ],
  });
  // One ordinary choice question and one sensitive one (the kind that holds health information).
  const formField = (id: string, key: string, label: string, options: string[], extra: Record<string, unknown> = {}) => (
    { id: `${P}_${id}`, key, label, helpText: "", type: "SELECT", scope: "ATTENDEE", required: false, options, ...extra }
  );
  await prisma.registrationForm.create({
    data: {
      id: `${P}_form`, eventId: ids.event, createdByUserId: ids.admin, name: "Audience check form", slug: `${P}-form`, status: "PUBLISHED",
      versions: { create: [{
        id: `${P}_formv1`, createdByUserId: ids.admin, versionNumber: 1, status: "PUBLISHED", publishedAt: new Date("2027-01-01T00:00:00Z"),
        definition: registrationFormDefinitionSchema.parse({
          title: "Audience check form", description: "Fictitious.", confirmationMessage: "Thanks.",
          sections: [{ id: `${P}_s1`, title: "Details", description: "", fields: [
            formField("f_meal", "meal", "Dinner choice", ["plain", "vegan"]),
            formField("f_medical", "medical_condition", "Medical condition", ["asthma", "none"], { sensitive: true }),
          ] }],
        }),
      }] },
    },
  });
  await prisma.eventTag.createMany({
    data: [
      { id: ids.tagVip, eventId: ids.event, name: "Synthetic VIP", normalizedName: "synthetic vip", color: "#336699" },
      { id: ids.tagOther, eventId: ids.other, name: "Other Event Tag", normalizedName: "other event tag", color: "#993366" },
    ],
  });

  let registrationCount = 0;
  async function register(code: string, holder: string, status: "CONFIRMED" | "CANCELLED" | "DRAFT", total: string, contactEmail: string | null, attendees: Array<{ person: string; type?: string; responses?: object }> = [{ person: holder }]) {
    registrationCount += 1;
    const registration = await prisma.registration.create({
      data: {
        eventId: ids.event, accountHolderPersonId: holder, confirmationCode: `${P}-${code}`.toUpperCase(), status,
        totalAmount: total, submittedAt: new Date("2027-09-01T10:00:00Z"),
        contactSnapshot: contactEmail === null ? { firstName: "Contact", lastName: code, email: "" } : { firstName: "Contact", lastName: code, email: contactEmail },
      },
      select: { id: true },
    });
    const attendeeIds: string[] = [];
    let position = 0;
    for (const item of attendees) {
      const attendee = await prisma.registrationAttendee.create({
        data: {
          eventId: ids.event, registrationId: registration.id, personId: item.person, attendeeType: item.type ?? "ADULT", attendeeTypeDefinitionId: typeIds[(item.type ?? "ADULT") as "ADULT" | "YOUTH"], position: position++,
          profileSnapshot: { firstName: "Snapshot", lastName: "Hidden" }, formResponses: item.responses ?? {},
        },
        select: { id: true },
      });
      attendeeIds.push(attendee.id);
    }
    return { id: registration.id, attendeeIds };
  }

  const pat = await person("Pat", email("shared"));
  const sam = await person("Sam", email("sam"));
  const vera = await person("Vera", email("vera"));
  const opt = await person("Opt", email("optout"));
  const bounce = await person("Bounce", email("bounce"));
  const noMail = await person("NoMail", null);
  const cancelled = await person("Cancelled", email("cancelled"));
  const draft = await person("Draft", email("draft"));
  const kid = await person("Kid", email("kid"));
  const leader = await person("Leader", email("groupleader"));
  const orgPerson = await person("OrgRep", email("orgrep"));

  // R1 and R2 share one address: Pat is the contact of both, and the attendee of R1 as well.
  const r1 = await register("r1", pat, "CONFIRMED", "200.00", email("shared"), [{ person: pat }, { person: kid, type: "YOUTH" }]);
  const r2 = await register("r2", pat, "CONFIRMED", "80.00", email("shared"), [{ person: sam }]);
  const r3 = await register("r3", vera, "CONFIRMED", "50.00", email("vera"), [{ person: vera, responses: { allergy: SECRET_ANSWER } }]);
  const r4 = await register("r4", opt, "CONFIRMED", "50.00", email("optout"));
  const r5 = await register("r5", bounce, "CONFIRMED", "50.00", email("bounce"));
  const r6 = await register("r6", noMail, "CONFIRMED", "50.00", null, [{ person: noMail }]);
  const r7 = await register("r7", cancelled, "CANCELLED", "50.00", email("cancelled"));
  const r8 = await register("r8", draft, "DRAFT", "50.00", email("draft"));
  const r9 = await register("r9", sam, "CONFIRMED", "0.00", email("sam"), [{ person: sam }]);
  // R1 owes $150 (a $50 payment); R3 is paid in full.
  await prisma.payment.create({ data: { eventId: ids.event, registrationId: r1.id, amount: "50.00", status: "SUCCEEDED", method: "CASH", receivedAt: new Date() } });
  await prisma.payment.create({ data: { eventId: ids.event, registrationId: r3.id, amount: "50.00", status: "SUCCEEDED", method: "CASH", receivedAt: new Date() } });
  // R3 is tagged VIP and its attendee is checked in; it also carries a restricted note.
  await prisma.registrationTagAssignment.create({ data: { eventId: ids.event, registrationId: r3.id, tagId: ids.tagVip, appliedByUserId: ids.admin } });
  await prisma.checkIn.create({ data: { eventId: ids.event, registrationAttendeeId: r3.attendeeIds[0]!, idempotencyKey: `${P}-ci` } });
  const note = await prisma.staffNote.create({
    data: { eventId: ids.event, registrationId: r3.id, visibility: "RESTRICTED", restrictedPermission: "MANAGE_FINANCE", authorUserId: ids.admin },
  });
  await prisma.staffNoteRevision.create({ data: { noteId: note.id, sequence: 1, body: SECRET_NOTE, authorUserId: ids.admin } });
  // Suppression: R4 opted out of this event's announcements, R5's address last bounced (a provider event).
  await prisma.emailAnnouncementOptOut.create({ data: { normalizedEmail: email("optout"), scope: "EVENT", eventId: ids.event, scopeKey: ids.event, source: "PAGE" } });
  await prisma.messageOutbox.create({
    data: {
      eventId: ids.other, templateKey: "EVENT_ANNOUNCEMENT", recipientKind: "REGISTRANT", recipientEmail: email("bounce"),
      senderNameSnapshot: "Synthetic", subjectSnapshot: "x", bodyTextSnapshot: "x", idempotencyKey: `${P}-bounce`, correlationId: randomUUID(),
      status: "SENT", providerDeliveryStatus: "BOUNCED", providerStatusAt: new Date(),
    },
  });
  void r6; void r7; void r8; void r9; void r4; void r5; void r2;

  const outboxBefore = await prisma.messageOutbox.count();
  const batchCountBefore = await prisma.auditLog.count({ where: { eventId: ids.event } });
  const run = (permissions: string[], query: unknown, options = {}) => evaluateEventAudience(ids.event, permissions, query, options);
  const emails = (result: Awaited<ReturnType<typeof run>>) => result.result.recipients.map((recipient) => recipient.email);

  // 1. One email in several roles and registrations: one recipient, roles and reasons kept, balances never merged.
  const shared = await run(commsPermissions, { roles: ["REGISTRATION_CONTACT", "ATTENDEE"], messageKind: "OPERATIONAL" });
  const sharedRecipient = shared.result.recipients.find((recipient) => recipient.email === email("shared"));
  assert(sharedRecipient, "the shared address is a recipient");
  assert(shared.result.recipients.filter((recipient) => recipient.email === email("shared")).length === 1, "the shared address is listed once");
  assert(sharedRecipient.roles.join() === "ATTENDEE,REGISTRATION_CONTACT", `both roles kept: ${sharedRecipient.roles}`);
  const byCode = Object.fromEntries(sharedRecipient.registrations.map((entry) => [entry.confirmationCode.replace(`${P}-`.toUpperCase(), ""), entry]));
  assert(sharedRecipient.registrations.length === 2, "two registrations stay separate under one address");
  assert(byCode.R1!.balanceCents === 15000 && byCode.R2!.balanceCents === 8000, `each registration keeps its own balance: ${byCode.R1!.balanceCents}/${byCode.R2!.balanceCents}`);
  assert(byCode.R1!.roles.join() === "ATTENDEE,REGISTRATION_CONTACT" && byCode.R2!.roles.join() === "REGISTRATION_CONTACT", "roles are kept per registration");
  assert(sharedRecipient.reasons.some((reason) => reason.dimension === "roles" && reason.value === "ATTENDEE"), "the attendee rule is a recorded reason");
  assert(shared.result.counts.messageTargetCount > shared.result.counts.recipientCount, "message targets exceed addresses");

  // 2. The operations search qualifies, with reasons; drafts and cancelled registrations stay out by default.
  const due = await run(adminPermissions, { search: "payment=UNPAID,PARTIAL", messageKind: "OPERATIONAL" });
  assert([email("shared")].every((mail) => emails(due).includes(mail)) && !emails(due).includes(email("vera")), `payment filter: ${emails(due)}`);
  assert(due.result.recipients.every((recipient) => recipient.reasons.some((reason) => reason.dimension === "payment" && reason.value === "UNPAID,PARTIAL")), "each recipient says why");
  const paid = await run(adminPermissions, { search: "payment=PAID", messageKind: "OPERATIONAL" });
  assert(emails(paid).join() === email("vera"), `paid in full: ${emails(paid)}`);
  const youth = await run(commsPermissions, { roles: ["ATTENDEE"], search: "attendeeType=YOUTH", messageKind: "OPERATIONAL" });
  assert(emails(youth).join() === email("kid"), `attendee type: ${emails(youth)}`);
  assert(youth.result.recipients[0]!.reasons.some((reason) => reason.dimension === "attendeeType" && reason.label === "Attendee type Youth"), "the attendee-type rule is a reason, with its label");
  const defaults = await run(commsPermissions, { messageKind: "OPERATIONAL" });
  assert(!emails(defaults).includes(email("cancelled")) && !emails(defaults).includes(email("draft")), "cancelled and draft are not in the default audience");
  assert(emails(await run(commsPermissions, { search: "status=CANCELLED", messageKind: "OPERATIONAL" })).join() === email("cancelled"), "cancelled can be chosen");
  await run(commsPermissions, { search: "status=DRAFT" }).then(
    () => { throw new Error("FAILED: a draft audience was accepted"); },
    (error) => assert(error instanceof AudienceFilterNotAvailableError, "a draft can never be an audience"),
  );
  // The canonical query is what is evaluated and hashed: the same search written two ways is one audience.
  const spelled = await run(adminPermissions, { search: "payment=PARTIAL,UNPAID&status=SUBMITTED,CONFIRMED&sort=name&page=3", messageKind: "OPERATIONAL" });
  assert(spelled.result.fingerprint === due.result.fingerprint && spelled.queryHash === due.queryHash, "equivalent searches have one hash and one fingerprint");

  // 3. Tags, check-in and readiness need their permissions, then qualify exactly.
  const tagged = await run(adminPermissions, { search: `tag=${ids.tagVip}`, messageKind: "OPERATIONAL" });
  assert(emails(tagged).join() === email("vera") && tagged.result.recipients[0]!.reasons.some((reason) => reason.label === "Tag Synthetic VIP"), "tag filter with the tag in the reason");
  assert(emails(await run(adminPermissions, { search: "checkIn=ALL", messageKind: "OPERATIONAL" })).join() === email("vera"), "check-in filter");
  assert(!emails(await run(adminPermissions, { search: "checkIn=NONE", messageKind: "OPERATIONAL" })).includes(email("vera")), "no-one-checked-in excludes the checked-in");
  assert(emails(await run(adminPermissions, { readinessStates: ["ATTENDEE_RESPONSES_INCOMPLETE"], messageKind: "OPERATIONAL" })).length === 0, "no public submission, so readiness matches none");
  const answered = await run(adminPermissions, { search: "answer=ATTENDEE:meal=vegan", messageKind: "OPERATIONAL" });
  assert(answered.result.counts.recipientCount === 0, "a form-answer filter from the search is honoured (nobody answered it)");

  // 4. Exclusions with reasons; an announcement honours opt-outs, an operational message does not; bounces always apply.
  const announcement = await run(commsPermissions, { messageKind: "ANNOUNCEMENT" });
  const codes = Object.fromEntries(announcement.result.exclusions.map((exclusion) => [exclusion.code, exclusion]));
  assert(codes.OPTED_OUT_EVENT?.email === email("optout"), "the opted-out address is excluded with its reason");
  assert(codes.PROVIDER_BOUNCED?.email === email("bounce"), "the bounced address is excluded with its reason");
  assert(codes.NO_EMAIL && codes.NO_EMAIL.registrations.length === 1, "the missing address is excluded with its reason");
  assert(!emails(announcement).includes(email("optout")) && !emails(announcement).includes(email("bounce")), "excluded addresses are not recipients");
  const operational = await run(commsPermissions, { messageKind: "OPERATIONAL" });
  assert(emails(operational).includes(email("optout")) && !emails(operational).includes(email("bounce")), "operational mail ignores an announcement opt-out but not a bounce");

  // 5. Unauthorized or unavailable filters reveal nothing, identically.
  async function refusal(permissions: string[], query: unknown) {
    try {
      await run(permissions, query);
    } catch (error) {
      assert(error instanceof AudienceFilterNotAvailableError, `a typed refusal, got ${String(error)}`);
      return error.message;
    }
    throw new Error("FAILED: the filter should have been refused");
  }
  const forbidden = await refusal(commsPermissions, { search: `tag=${ids.tagVip}` });
  const otherEventTag = await refusal(adminPermissions, { search: `tag=${ids.tagOther}` });
  const missingTag = await refusal(adminPermissions, { search: "tag=no-such-tag" });
  const noCheckIn = await refusal(commsPermissions, { search: "checkIn=ALL" });
  const noFinance = await refusal(commsPermissions, { search: "payment=UNPAID" });
  const noIdentity = await refusal(commsPermissions, { search: "q=Pat" });
  const noReadiness = await refusal(commsPermissions, { readinessStates: ["ATTENDEE_RESPONSES_INCOMPLETE"] });
  const noGroups = await refusal(adminPermissions, { roles: ["GROUP_LEADER"] });
  const noOrgs = await refusal(adminPermissions, { roles: ["ORGANIZATION_CONTACT"] });
  const sensitiveAnswer = await refusal(adminPermissions, { search: "answer=ATTENDEE:medical_condition=asthma" });
  const staleAnswer = await refusal(adminPermissions, { search: "answer=ATTENDEE:no_such_question=x" });
  const malformed = await refusal(adminPermissions, { search: "payment=MAYBE" });
  assert(new Set([forbidden, otherEventTag, missingTag, noCheckIn, noFinance, noIdentity, noReadiness, noGroups, noOrgs, sensitiveAnswer, staleAnswer, malformed]).size === 1, "every refusal is the same fixed message");
  assert(!forbidden.includes("VIP") && !forbidden.match(/\d/), "the refusal names no value and no count");
  const commsOptions = JSON.stringify(await getAudienceFilterOptions(ids.event, commsPermissions));
  assert(!commsOptions.includes("Synthetic VIP") && !commsOptions.includes('"key":"tag"') && !commsOptions.includes('"key":"checkIn"') && !commsOptions.includes('"key":"payment"'), "the filter list for comms holds nothing it may not use");
  assert(!commsOptions.includes("GROUP_LEADER") && !commsOptions.includes("ORGANIZATION_CONTACT"), "domains the event lacks are not offered");
  assert(!commsOptions.includes('"DRAFT"'), "a draft is never offered");
  const adminOptions = JSON.stringify(await getAudienceFilterOptions(ids.event, adminPermissions));
  assert(adminOptions.includes("Synthetic VIP") && adminOptions.includes("Dinner choice"), "an authorized caller is offered the tag and the ordinary question");
  assert(!adminOptions.includes("medical_condition") && !adminOptions.includes("Medical condition") && !adminOptions.includes("asthma"), "a sensitive question is never offered, even to an administrator");

  // 6. Group and organization domains appear only when the event has them; only an approved, current contact qualifies.
  await prisma.groupEventRegistration.create({ data: { eventId: ids.event, registrationId: r3.id, billingPersonId: leader } });
  const groups = await run(commsPermissions, { roles: ["GROUP_LEADER"], messageKind: "OPERATIONAL" });
  assert(emails(groups).join() === email("groupleader") && groups.result.recipients[0]!.roles.join() === "GROUP_LEADER", `group leader: ${emails(groups)}`);
  for (const [orgId, label] of [[ids.org, "A"], [ids.org2, "B"]] as const) {
    await prisma.organization.create({ data: { id: orgId, type: "CLUB", name: `Synthetic Club ${label} ${P}`, normalizedName: `synthetic club ${label.toLowerCase()} ${P}` } });
  }
  await prisma.clubEventRegistration.create({ data: { eventId: ids.event, organizationId: ids.org, registrationId: r3.id } });
  await prisma.clubEventRegistration.create({ data: { eventId: ids.event, organizationId: ids.org2, registrationId: r1.id } });
  // Club B's contact is on file but unverified; Club A's is verified and current.
  await prisma.organizationBillingContact.create({ data: { organizationId: ids.org2, name: "Unverified Rep", email: email("unverified"), roleLabel: "Treasurer" } });
  await prisma.organizationBillingContact.create({ data: { organizationId: ids.org, name: "OrgRep", email: email("orgrep"), roleLabel: "Treasurer", verifiedAt: new Date(), verifiedByUserId: ids.admin } });
  const orgs = await run(commsPermissions, { roles: ["ORGANIZATION_CONTACT"], messageKind: "OPERATIONAL" });
  assert(emails(orgs).join() === email("orgrep"), `only the approved organization contact qualifies: ${emails(orgs)}`);
  void orgPerson;

  // 7. Protected data never appears in any preview, for any caller.
  const everything = JSON.stringify([
    await previewEventAudience(ids.event, adminPermissions, { query: { roles: ["REGISTRATION_CONTACT", "ATTENDEE", "GROUP_LEADER", "ORGANIZATION_CONTACT"], search: `tag=${ids.tagVip}` } }),
    await previewEventAudience(ids.event, adminPermissions, { query: { roles: ["REGISTRATION_CONTACT", "ATTENDEE"], messageKind: "OPERATIONAL" }, page: { limit: 200 } }),
    await previewEventAudience(ids.event, adminPermissions, { query: { messageKind: "OPERATIONAL" }, view: "exclusions" }),
    await previewEventAudience(ids.event, commsPermissions, { query: {} }),
  ]);
  for (const secret of [SECRET_NOTE, SECRET_ANSWER, "Snapshot", "Hidden", ids.tagOther, "Other Event Tag", `${P}.admin@`, `${P}.comms@`]) {
    assert(!everything.includes(secret), `a protected value leaked into a preview: ${secret}`);
  }
  // Answer existence qualifies nothing by content: changing the answer text changes no audience.
  const beforeAnswer = (await run(adminPermissions, { roles: ["ATTENDEE"], messageKind: "OPERATIONAL" })).result.fingerprint;
  await prisma.registrationAttendee.update({ where: { id: r3.attendeeIds[0]! }, data: { formResponses: { allergy: "different text" } } });
  assert((await run(adminPermissions, { roles: ["ATTENDEE"], messageKind: "OPERATIONAL" })).result.fingerprint === beforeAnswer, "answer content does not affect the audience");
  await prisma.staffNoteRevision.create({ data: { noteId: note.id, sequence: 2, body: "edited restricted note", authorUserId: ids.admin } });
  assert((await run(adminPermissions, { roles: ["ATTENDEE"], messageKind: "OPERATIONAL" })).result.fingerprint === beforeAnswer, "note content does not affect the audience");

  // 8. Large audiences: 650 more registrations, paged, identical across batch sizes and arrival.
  const bulkPeople = Array.from({ length: 650 }, (_, index) => ({ id: `${P}_p_bulk${index}`, firstName: `Bulk${index}`, lastName: "Synthetic", normalizedEmail: `${P}.bulkperson${index}@example.test` }));
  await prisma.person.createMany({ data: bulkPeople });
  await prisma.registration.createMany({
    data: bulkPeople.map((item, index) => ({
      id: `${P}_bulkreg${index}`, eventId: ids.event, accountHolderPersonId: item.id, confirmationCode: `${P}-B${String(index).padStart(4, "0")}`.toUpperCase(),
      status: "CONFIRMED" as const, totalAmount: index % 2 === 0 ? "40.00" : "0.00", submittedAt: new Date("2027-09-02T10:00:00Z"),
      contactSnapshot: { firstName: "Bulk", lastName: String(index), email: `${P}.bulk${index % 600}@example.test` },
    })),
  });
  await prisma.registrationAttendee.createMany({
    data: bulkPeople.map((item, index) => ({
      eventId: ids.event, registrationId: `${P}_bulkreg${index}`, personId: item.id, attendeeType: "ADULT", position: 0, profileSnapshot: {}, formResponses: {},
    })),
  });
  const small = await run(adminPermissions, { messageKind: "OPERATIONAL" }, { batchSize: 40 });
  const medium = await run(adminPermissions, { messageKind: "OPERATIONAL" }, { batchSize: 250 });
  const large = await run(adminPermissions, { messageKind: "OPERATIONAL" }, { batchSize: 5000 });
  assert(small.result.fingerprint === medium.result.fingerprint && medium.result.fingerprint === large.result.fingerprint, "the fingerprint does not depend on batch size");
  assert(JSON.stringify(small.result.counts) === JSON.stringify(large.result.counts), "counts do not depend on batch size");
  assert(small.result.counts.recipientCount >= 600 && small.result.counts.messageTargetCount >= 650, `large audience counted: ${small.result.counts.recipientCount}/${small.result.counts.messageTargetCount}`);
  const seen: string[] = [];
  let after: string | undefined;
  let pages = 0;
  let fingerprint = "";
  for (;;) {
    const page = await previewEventAudience(ids.event, adminPermissions, { query: { messageKind: "OPERATIONAL" }, page: { limit: 100, after } }, { batchSize: 60 });
    assert(page.items.length <= 100, "a page never exceeds its limit");
    fingerprint ||= page.fingerprint;
    assert(page.fingerprint === fingerprint && page.counts.recipientCount === small.result.counts.recipientCount, "every page carries the whole audience's counts and fingerprint");
    seen.push(...(page.items as Array<{ email: string }>).map((item) => item.email));
    pages += 1;
    if (!page.nextCursor) break;
    after = page.nextCursor;
  }
  assert(pages >= 7 && seen.length === small.result.counts.recipientCount && new Set(seen).size === seen.length, `paging covered each recipient once over ${pages} pages`);
  assert(seen.join() === [...seen].sort().join(), "pages follow one stable order");

  // 9. A record changed after preview changes the fingerprint; the snapshot refuses a stale one.
  const query = { roles: ["REGISTRATION_CONTACT"], search: "payment=UNPAID,PARTIAL", messageKind: "OPERATIONAL" };
  const reviewed = await previewEventAudience(ids.event, adminPermissions, { query });
  const snapshotId = randomUUID();
  const staleId = randomUUID();
  await prisma.payment.create({ data: { eventId: ids.event, registrationId: r1.id, amount: "10.00", status: "SUCCEEDED", method: "CASH", receivedAt: new Date() } });
  const changed = await previewEventAudience(ids.event, adminPermissions, { query });
  assert(changed.fingerprint !== reviewed.fingerprint, "a payment after the preview changes the fingerprint");
  try {
    await createAudienceSnapshot(ids.event, ids.admin, adminPermissions, { snapshotId: staleId, query, previewFingerprint: reviewed.fingerprint });
    throw new Error("FAILED: a stale fingerprint was accepted");
  } catch (error) {
    assert(error instanceof MessagingError && error.code === "PREVIEW_CHANGED", `a stale fingerprint is refused: ${String(error)}`);
  }
  assert((await prisma.eventAudienceSnapshot.count({ where: { id: staleId } })) === 0, "nothing is recorded for a stale preview");

  // 10. Snapshot: audited, idempotent, reuse refused, unauthorized query refused.
  const first = await createAudienceSnapshot(ids.event, ids.admin, adminPermissions, { snapshotId, query, previewFingerprint: changed.fingerprint });
  assert(!first.replayed && first.fingerprint === changed.fingerprint && first.sourceQueryVersion === "audience-query/2", "the snapshot records the fingerprint and the query version");
  assert(first.queryHash === changed.queryHash, "the snapshot records the query hash");
  const replay = await createAudienceSnapshot(ids.event, ids.admin, adminPermissions, { snapshotId, query, previewFingerprint: changed.fingerprint });
  assert(replay.replayed && replay.snapshotId === first.snapshotId && replay.createdAt === first.createdAt, "a lost-response replay returns the original");
  assert((await prisma.eventAudienceSnapshot.count({ where: { id: snapshotId } })) === 1, "exactly one snapshot row");
  try {
    await createAudienceSnapshot(ids.event, ids.admin, adminPermissions, { snapshotId, query: { ...query, search: "payment=PAID" }, previewFingerprint: changed.fingerprint });
    throw new Error("FAILED: a reused snapshot id for another audience was accepted");
  } catch (error) {
    assert(error instanceof MessagingError && error.code === "IDEMPOTENCY_KEY_REUSED", `reuse refused: ${String(error)}`);
  }
  await createAudienceSnapshot(ids.event, ids.comms, commsPermissions, { snapshotId: randomUUID(), query: { search: `tag=${ids.tagVip}` }, previewFingerprint: "0".repeat(64) }).then(
    () => { throw new Error("FAILED: an unauthorized query was snapshotted"); },
    (error) => assert(error instanceof AudienceFilterNotAvailableError, "an unauthorized query cannot be snapshotted"),
  );
  const stored = await prisma.eventAudienceSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
  assert(stored.recipientCount === changed.counts.recipientCount && stored.exclusionCount === changed.counts.exclusionCount, "stored counts match the preview");
  const audit = await prisma.auditLog.findMany({ where: { eventId: ids.event, action: "EVENT_AUDIENCE_SNAPSHOT_CREATED" } });
  assert(audit.length === 1 && audit[0]!.actorUserId === ids.admin && audit[0]!.entityId === snapshotId, "one audit row names the actor and the snapshot");
  const auditText = JSON.stringify(audit);
  assert(!auditText.includes("@example.test") && !auditText.includes("Synthetic"), "the audit row holds no address or name");
  assert(!JSON.stringify(stored).includes("@example.test"), "the snapshot holds no address");

  // 11. Preview only: no message, outbox row or other audit trail was created by any of it.
  assert((await prisma.messageOutbox.count()) === outboxBefore, "no outbox row was created");
  assert((await prisma.messageOutbox.count({ where: { eventId: ids.event } })) === 0, "no message exists for the event");
  const newAudits = await prisma.auditLog.count({ where: { eventId: ids.event } });
  assert(newAudits - batchCountBefore === 1, `only the snapshot was audited: ${newAudits - batchCountBefore}`);
  void registrationCount;

  console.log("Event audience builder verification passed.");
}

main()
  .then(async () => {
    await cleanup();
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    try { await cleanup(); } catch (cleanupError) { console.error("cleanup failed", cleanupError); }
    await prisma.$disconnect();
    process.exit(1);
  });
