/**
 * Proves acknowledgment evidence (#150) against a real PostgreSQL database, where the unit tests' stand-ins can't:
 *
 * - a registration form submission records one evidence row per ticked acknowledgment (registration level, and per
 *   attendee on a roster), in the same transaction as the registration: the exact wording for a text acknowledgment,
 *   a published #129 policy version (by id, never the text) for a policy one, who gave it, when, through which channel,
 *   and only approved request metadata;
 * - a hidden conditional acknowledgment records nothing and a required one that is missing refuses the submission;
 * - a retried submission, a retried staff request and the same content entered twice create no second row, and one
 *   request id reused for a different request is refused;
 * - a minor's acknowledgment needs the responsible adult declared on the registration (#131): the account holder,
 *   another adult, a household member who can manage the child, a minor's own tick and "None of us" all fail, and a
 *   refused submission leaves no registration and no evidence behind;
 * - staff-entered and paper evidence name the staff member and the person who acknowledged, take their wording from the
 *   registration's own form version, and refuse an attendee, field, registration or date that does not fit;
 * - status is resolved at a moment in time: a later policy version leaves an earlier acknowledgment standing unless it
 *   was marked a material change, and the evidence still reads back the version the person actually saw;
 * - the database enforces the shape: evidence is append-only (no update, no delete), every reference is RESTRICT
 *   (registration, person, form version and policy version cannot be deleted from under it), a policy version of
 *   another event, of another kind, or a draft is refused, a minor row without authority, unapproved metadata and a
 *   duplicate are refused;
 * - an event that holds evidence cannot be deleted, and no export-bound row, audit row or message holds the wording.
 *
 * Uses fictitious rows it creates and removes itself (removal of evidence needs the superuser bypass the local and CI
 * databases allow, because the product itself can never delete it).
 *
 *   npm run test:acknowledgments
 */
import { loadEnvConfig } from "@next/env";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient, RegistrationFormStatus } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { registrationFormDefinitionSchema, type RegistrationFormField } from "../modules/forms/definition";
import { submitPublicRegistration, PublicRegistrationError } from "../modules/forms/public-repository";
import {
  AcknowledgmentError,
  assertAcknowledgmentPoliciesAvailable,
  getAcknowledgmentEvidencePayload,
  listRegistrationAcknowledgments,
  recordAcknowledgmentEvidence,
  recordStaffAcknowledgment,
} from "../modules/acknowledgments/repository";
import { contentHashFor } from "../modules/consent/domain";
import { createConsentPolicy, createNextDraftVersion, publishPolicyVersion } from "../modules/consent/repository";
import { EventDeletionError, deleteEvent, getEventDeletionPreview } from "../modules/events/deletion-repository";

loadEnvConfig(process.cwd());
// Local-only, before any Prisma client or connection exists.
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-acknowledgments-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `ack150_${randomUUID().slice(0, 8)}`;
const PS = P.replace(/_/g, "-");
const surname = `Sample${P}`;
const ids = {
  staff: `${P}_staff`,
  eventA: `${P}_ev_a`,
  eventB: `${P}_ev_b`,
  form: `${P}_form`,
  formVersion: `${P}_form_v1`,
  polHist: `${P}_pol_hist`,
  polSoft: `${P}_pol_soft`,
};
const formSlug = `${P}-form`;
const slugOf = (eventId: string) => `${eventId.replace(/_/g, "-")}-slug`;

// Obviously synthetic wording; no legal text.
const TEXT_WORDING = "Synthetic acknowledgment wording, line one.\nLine two with “quotes”, an accent (café) and   inner  spacing.";
const PROGRAM_WORDING = "Synthetic program acknowledgment wording for the conditional field.";
const ACTIVITY_WORDING = "Synthetic activity acknowledgment wording for the attendee conditional field.";
const MAIN_BODY = "Synthetic policy body text that must only ever be read by exact version id.";
const USER_AGENT = "Synthetic Agent/1.0";

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function rejects(promise: Promise<unknown>, pattern?: RegExp) {
  return promise.then(() => false, (error: unknown) => (pattern ? pattern.test(String(error instanceof Error ? error.message : error)) : true));
}

async function expectCode(promise: Promise<unknown>, code: string, message: string) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  assert(error instanceof AcknowledgmentError && error.code === code, `${message}: expected ${code}, got ${String(error)}`);
}

async function cleanup() {
  const eventIds = [ids.eventA, ids.eventB];
  // The product can never delete evidence or a published policy version; the superuser bypass lets this check clear its own rows.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.$executeRaw`DELETE FROM "AcknowledgmentEvidence" WHERE "eventId" IN (${Prisma.join(eventIds)})`;
    await tx.$executeRaw`DELETE FROM "ConsentPolicyVersion" WHERE "policyId" IN (SELECT "id" FROM "ConsentPolicy" WHERE "eventId" IN (${Prisma.join(eventIds)}))`;
    await tx.$executeRaw`DELETE FROM "ConsentPolicy" WHERE "eventId" IN (${Prisma.join(eventIds)})`;
  });
  const registrationIds = (await prisma.registration.findMany({ where: { eventId: { in: eventIds } }, select: { id: true } })).map((row) => row.id);
  await prisma.messageOutbox.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ eventId: { in: eventIds } }, { actorUserId: ids.staff }] } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.registration.deleteMany({ where: { id: { in: registrationIds } } });
  await prisma.household.deleteMany({ where: { name: { startsWith: P } } });
  await prisma.person.deleteMany({ where: { lastName: surname } });
  await prisma.person.deleteMany({ where: { normalizedEmail: { startsWith: `${P}-` } } });
  await prisma.person.deleteMany({ where: { id: { startsWith: `${P}_` } } });
  await prisma.user.deleteMany({ where: { id: ids.staff } });
}

async function publishedVersion(options: { policyId: string; versionNumber: number; effectiveFrom: Date; effectiveTo: Date | null; isMaterialChange: boolean; label: string }) {
  const title = `Synthetic ${options.label} v${options.versionNumber}`;
  const bodyText = `Synthetic ${options.label} body v${options.versionNumber}.`;
  return prisma.consentPolicyVersion.create({
    data: {
      id: `${options.policyId}_v${options.versionNumber}`,
      policyId: options.policyId,
      createdByUserId: ids.staff,
      publishedByUserId: ids.staff,
      versionNumber: options.versionNumber,
      status: "PUBLISHED",
      title,
      bodyText,
      contentHash: contentHashFor({ title, bodyText }),
      effectiveFrom: options.effectiveFrom,
      effectiveTo: options.effectiveTo,
      isMaterialChange: options.isMaterialChange,
      publishedAt: new Date(options.effectiveFrom.getTime() - 3_600_000),
    },
  });
}

async function main() {
  await cleanup();
  await prisma.user.create({ data: { id: ids.staff, email: `${P}-staff@example.test`, displayName: "Acknowledgment Check Staff", globalRole: "SYSTEM_ADMIN" } });
  const year = new Date().getUTCFullYear() + 1;
  const startsAt = new Date(Date.UTC(year, 2, 5, 15, 0, 0));
  const endsAt = new Date(Date.UTC(year, 2, 7, 15, 0, 0));
  for (const id of [ids.eventA, ids.eventB]) {
    await prisma.event.create({ data: { id, slug: slugOf(id), name: `Acknowledgment Check ${id}`, startsAt, endsAt, timezone: "America/Chicago", isPublished: true, audience: "GENERAL", billingMode: "ATTENDEE_PAY" } });
  }

  // ---- Policies, through the real #129 functions where time does not matter ----
  const main = await createConsentPolicy(ids.eventA, ids.staff, { kind: "ACKNOWLEDGMENT", slug: `${PS}-main`, name: "Synthetic main acknowledgment", title: "Synthetic main title", bodyText: MAIN_BODY });
  const mainV1 = await publishPolicyVersion(ids.eventA, main.id, ids.staff, { effectiveFrom: new Date(), isMaterialChange: false });
  const waiver = await createConsentPolicy(ids.eventA, ids.staff, { kind: "WAIVER", slug: `${PS}-waiver`, name: "Synthetic waiver", title: "Synthetic waiver title", bodyText: "Synthetic waiver body." });
  const waiverV1 = await publishPolicyVersion(ids.eventA, waiver.id, ids.staff, { effectiveFrom: new Date(), isMaterialChange: false });
  const draftOnly = await createConsentPolicy(ids.eventA, ids.staff, { kind: "ACKNOWLEDGMENT", slug: `${PS}-draft`, name: "Synthetic draft", title: "Synthetic draft title", bodyText: "Synthetic draft body." });
  const draftVersionId = (await prisma.consentPolicyVersion.findFirstOrThrow({ where: { policyId: draftOnly.id } })).id;
  const otherEventPolicy = await createConsentPolicy(ids.eventB, ids.staff, { kind: "ACKNOWLEDGMENT", slug: `${PS}-other`, name: "Synthetic other event", title: "Synthetic other title", bodyText: "Synthetic other body." });
  const otherV1 = await publishPolicyVersion(ids.eventB, otherEventPolicy.id, ids.staff, { effectiveFrom: new Date(), isMaterialChange: false });
  // Two policies with history: version 1 in force 90 to 30 days ago, version 2 since. One v2 is a material change, one is not.
  for (const [policyId, label, material] of [[ids.polHist, "material", true], [ids.polSoft, "soft", false]] as const) {
    await prisma.consentPolicy.create({ data: { id: policyId, eventId: ids.eventA, kind: "ACKNOWLEDGMENT", scope: "EVENT", slug: `${PS}-${label}`, name: `Synthetic ${label} history`, createdByUserId: ids.staff } });
    await publishedVersion({ policyId, versionNumber: 1, effectiveFrom: daysAgo(90), effectiveTo: daysAgo(30), isMaterialChange: true, label });
    await publishedVersion({ policyId, versionNumber: 2, effectiveFrom: daysAgo(30), effectiveTo: null, isMaterialChange: material, label });
  }
  const histV1 = `${ids.polHist}_v1`;
  const softV1 = `${ids.polSoft}_v1`;

  // ---- The form ----
  const definition = registrationFormDefinitionSchema.parse({
    title: "Acknowledgment verification",
    description: "Temporary fictitious form used only by the acknowledgment check.",
    confirmationMessage: "Received.",
    attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 8, attendeeLabel: "Attendee", addButtonLabel: "Add another attendee" },
    sections: [
      {
        id: `${P}_contact`, title: "Contact", description: "", fields: [
          { id: `${P}_f_first`, key: "primary_contact_first_name", label: "First name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
          { id: `${P}_f_last`, key: "primary_contact_last_name", label: "Last name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
          { id: `${P}_f_email`, key: "email", label: "Email", helpText: "", type: "EMAIL", scope: "REGISTRATION", required: true, options: [] },
          { id: `${P}_f_program`, key: "wants_program", label: "Joining the program?", helpText: "", type: "RADIO", scope: "REGISTRATION", required: false, options: ["Yes", "No"] },
          { id: `${P}_f_reg_ack`, key: "reg_ack", label: "Registration acknowledgment", helpText: "", type: "ACKNOWLEDGMENT", scope: "REGISTRATION", required: true, options: [], acknowledgment: { source: "TEXT", text: TEXT_WORDING } },
          { id: `${P}_f_program_ack`, key: "program_ack", label: "Program acknowledgment", helpText: "", type: "ACKNOWLEDGMENT", scope: "REGISTRATION", required: true, options: [], conditional: { fieldKey: "wants_program", operator: "EQUALS", value: "Yes" }, acknowledgment: { source: "TEXT", text: PROGRAM_WORDING } },
        ],
      },
      {
        id: `${P}_attendees`, title: "Attendees", description: "", fields: [
          { id: `${P}_a_first`, key: "first_name", label: "First name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
          { id: `${P}_a_last`, key: "last_name", label: "Last name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
          { id: `${P}_a_age`, key: "attendee_age", label: "Age", helpText: "", type: "NUMBER", scope: "ATTENDEE", required: false, options: [] },
          { id: `${P}_a_activity`, key: "attending_activity", label: "Attending the activity?", helpText: "", type: "RADIO", scope: "ATTENDEE", required: false, options: ["Yes", "No"] },
          { id: `${P}_a_policy_ack`, key: "att_policy_ack", label: "Policy acknowledgment", helpText: "", type: "ACKNOWLEDGMENT", scope: "ATTENDEE", required: false, options: [], acknowledgment: { source: "POLICY_VERSION", policyVersionId: mainV1.id } },
          { id: `${P}_a_text_ack`, key: "att_text_ack", label: "Activity acknowledgment", helpText: "", type: "ACKNOWLEDGMENT", scope: "ATTENDEE", required: false, options: [], conditional: { fieldKey: "attending_activity", operator: "EQUALS", value: "Yes" }, acknowledgment: { source: "TEXT", text: ACTIVITY_WORDING } },
          { id: `${P}_a_hist_ack`, key: "hist_material_ack", label: "Historical material acknowledgment", helpText: "", type: "ACKNOWLEDGMENT", scope: "ATTENDEE", required: false, options: [], acknowledgment: { source: "POLICY_VERSION", policyVersionId: histV1 } },
          { id: `${P}_a_soft_ack`, key: "hist_soft_ack", label: "Historical non-material acknowledgment", helpText: "", type: "ACKNOWLEDGMENT", scope: "ATTENDEE", required: false, options: [], acknowledgment: { source: "POLICY_VERSION", policyVersionId: softV1 } },
        ],
      },
    ],
  });
  await prisma.registrationForm.create({
    data: {
      id: ids.form, eventId: ids.eventA, createdByUserId: ids.staff, name: definition.title, slug: formSlug, status: RegistrationFormStatus.PUBLISHED,
      versions: { create: { id: ids.formVersion, createdByUserId: ids.staff, versionNumber: 1, status: RegistrationFormStatus.PUBLISHED, publishedAt: new Date(), definition } },
    },
  });
  const field = (key: string) => definition.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === key) as RegistrationFormField;

  type Attendee = { clientId: string; first: string; age: number; responses?: Record<string, unknown> };
  let submissions = 0;
  function submission(contact: { first: string; last?: string; email?: string }, registration: Record<string, unknown>, attendees: Attendee[], responsibleAdults?: Record<string, string>) {
    submissions += 1;
    return {
      versionId: ids.formVersion,
      idempotencyKey: randomUUID(),
      responses: {
        primary_contact_first_name: contact.first,
        primary_contact_last_name: contact.last ?? surname,
        email: contact.email ?? `${P}-registrant-${submissions}@example.test`,
        ...registration,
      },
      attendees: attendees.map((attendee) => ({
        clientId: attendee.clientId,
        responses: { first_name: attendee.first, last_name: surname, attendee_age: String(attendee.age), ...(attendee.responses ?? {}) },
      })),
      ...(responsibleAdults ? { responsibleAdults } : {}),
      website: "" as const,
    };
  }
  const submit = (input: ReturnType<typeof submission>, userAgent: string | null = USER_AGENT) =>
    submitPublicRegistration(slugOf(ids.eventA), formSlug, input, undefined, undefined, { userAgent });
  async function load(confirmationCode: string) {
    const registration = await prisma.registration.findFirstOrThrow({
      where: { confirmationCode, eventId: ids.eventA },
      select: { id: true, accountHolderPersonId: true, updatedAt: true, attendees: { select: { id: true, personId: true, profileSnapshot: true, formResponses: true } } },
    });
    const byName = (first: string) => {
      const attendee = registration.attendees.find((row) => (row.profileSnapshot as { firstName?: string }).firstName === first);
      assert(attendee, `attendee ${first} saved`);
      return attendee;
    };
    return { registration, byName };
  }
  const evidenceFor = (registrationId: string) => prisma.acknowledgmentEvidence.findMany({ where: { registrationId }, orderBy: [{ acknowledgedAt: "asc" }, { id: "asc" }] });

  // ---- A real submission: a parent (the registrant), a declared minor, another adult ----
  const familyInput = submission(
    { first: "Dan" },
    { wants_program: "Yes", reg_ack: true, program_ack: true },
    [
      { clientId: "a-dad", first: "Dan", age: 44, responses: { att_policy_ack: true, attending_activity: "Yes", att_text_ack: true } },
      { clientId: "a-son", first: "Sam", age: 12, responses: { att_policy_ack: true } },
      { clientId: "a-uncle", first: "Ulf", age: 40 },
    ],
    { "a-son": "a-dad" },
  );
  const registrationsBefore = await prisma.registration.count({ where: { eventId: ids.eventA } });
  const confirmation = await submit(familyInput);
  const family = await load(confirmation.confirmationCode);
  const dan = family.byName("Dan");
  const sam = family.byName("Sam");
  const ulf = family.byName("Ulf");
  assert(dan.personId === family.registration.accountHolderPersonId, "the registrant is the first attendee's person");
  const rows = await evidenceFor(family.registration.id);
  assert(rows.length === 5, `five acknowledgments recorded (got ${rows.length})`);
  const row = (key: string, attendeeId: string | null) => {
    const found = rows.find((candidate) => candidate.fieldKey === key && candidate.registrationAttendeeId === attendeeId);
    assert(found, `evidence for ${key}`);
    return found;
  };
  const regAck = row("reg_ack", null);
  assert(regAck.source === "TEXT" && regAck.shownText === TEXT_WORDING && regAck.contentHash === sha256(TEXT_WORDING), "the registration acknowledgment records the exact wording, byte for byte");
  assert(regAck.subjectPersonId === null && regAck.actedByPersonId === dan.personId && regAck.channel === "ONLINE" && regAck.recordedByUserId === null && regAck.formVersionId === ids.formVersion, "it names the registrant, the online channel and the form version");
  assert(Math.abs(regAck.acknowledgedAt.getTime() - Date.now()) < 60_000 && regAck.eventId === ids.eventA && regAck.registrationId === family.registration.id, "and the moment, event and registration");
  assert(row("program_ack", null).shownText === PROGRAM_WORDING, "the conditional registration acknowledgment applied and was recorded");
  const danPolicy = row("att_policy_ack", dan.id);
  assert(danPolicy.source === "POLICY_VERSION" && danPolicy.policyVersionId === mainV1.id && danPolicy.shownText === null && danPolicy.contentHash === mainV1.contentHash, "a policy acknowledgment records the version id and hash, never the text");
  assert(danPolicy.subjectPersonId === dan.personId && danPolicy.subjectMinorStatus === "ADULT" && danPolicy.guardianAuthorityId === null, "an adult acknowledging for themselves needs no authority");
  assert(row("att_text_ack", dan.id).shownText === ACTIVITY_WORDING, "the conditional attendee acknowledgment applied and was recorded");
  const samPolicy = row("att_policy_ack", sam.id);
  const samAuthority = await prisma.guardianAuthority.findFirstOrThrow({ where: { eventId: ids.eventA, minorPersonId: sam.personId, state: "ACTIVE" } });
  assert(samPolicy.subjectPersonId === sam.personId && samPolicy.actedByPersonId === dan.personId && samPolicy.subjectMinorStatus === "MINOR" && samPolicy.guardianAuthorityId === samAuthority.id, "a minor's acknowledgment names the declared authority that allowed it");
  assert(!rows.some((candidate) => candidate.registrationAttendeeId === ulf.id), "the other adult acknowledged nothing");
  for (const evidence of rows) {
    const keys = Object.keys(evidence.requestMetadata as Record<string, unknown>);
    assert(keys.every((key) => ["userAgentHash", "formVersionId", "submissionKey"].includes(key)), "request metadata holds only approved keys");
  }
  assert((regAck.requestMetadata as Record<string, string>).userAgentHash === sha256(USER_AGENT) && !JSON.stringify(regAck.requestMetadata).includes(USER_AGENT), "the user agent is kept only as a one-way hash");
  assert(dan.formResponses && (dan.formResponses as Record<string, unknown>).att_policy_ack === true, "the stored answer is only Yes");

  // ---- Retries create nothing ----
  const replay = await submit(familyInput);
  assert(replay.confirmationCode === confirmation.confirmationCode, "a retried submission returns the first confirmation");
  assert((await evidenceFor(family.registration.id)).length === 5 && await prisma.registration.count({ where: { eventId: ids.eventA } }) === registrationsBefore + 1, "and creates no second registration or evidence");

  // ---- Conditions and required answers ----
  const hidden = await submit(submission(
    { first: "Cora" },
    { wants_program: "No", reg_ack: true, program_ack: true },
    [{ clientId: "a-self", first: "Cora", age: 30, responses: { attending_activity: "No", att_text_ack: true } }],
  ));
  const hiddenRows = await evidenceFor((await load(hidden.confirmationCode)).registration.id);
  assert(hiddenRows.length === 1 && hiddenRows[0]!.fieldKey === "reg_ack", "an acknowledgment hidden by its condition records nothing, even if sent");
  let refused: unknown = null;
  try {
    await submit(submission({ first: "Cleo" }, { wants_program: "No" }, [{ clientId: "a-self", first: "Cleo", age: 30 }]));
  } catch (caught) { refused = caught; }
  assert(refused instanceof PublicRegistrationError && refused.code === "INVALID_SUBMISSION" && refused.issues.some((issue) => issue.key === "reg_ack"), "a missing required acknowledgment refuses the submission");
  refused = null;
  try {
    await submit(submission({ first: "Cleo" }, { wants_program: "Yes", reg_ack: true }, [{ clientId: "a-self", first: "Cleo", age: 30 }]));
  } catch (caught) { refused = caught; }
  assert(refused instanceof PublicRegistrationError && refused.issues.some((issue) => issue.key === "program_ack"), "a conditional acknowledgment that applies is required");

  // ---- Acting for another person: refused, and nothing is left behind ----
  const evidenceBefore = await prisma.acknowledgmentEvidence.count({ where: { eventId: ids.eventA } });
  const registrationCountBefore = await prisma.registration.count({ where: { eventId: ids.eventA } });
  const guardianAuthorityBefore = await prisma.guardianAuthority.count({ where: { eventId: ids.eventA } });
  const unauthorized: Array<[string, ReturnType<typeof submission>, string]> = [
    ["a minor's acknowledgment when the registrant is the account holder but another adult is the declared one",
      submission({ first: "Dee" }, { reg_ack: true }, [
        { clientId: "a-dad", first: "Dee", age: 40 },
        { clientId: "a-son", first: "Sue", age: 9, responses: { att_policy_ack: true } },
        { clientId: "a-uncle", first: "Uri", age: 41 },
      ], { "a-son": "a-uncle" }), "attendees.1.responses.att_policy_ack"],
    ["a minor's acknowledgment when no responsible adult was named (None of us)",
      submission({ first: "Dee" }, { reg_ack: true }, [
        { clientId: "a-dad", first: "Dee", age: 40 },
        { clientId: "a-son", first: "Sue", age: 9, responses: { att_policy_ack: true } },
      ], { "a-son": "NONE" }), "attendees.1.responses.att_policy_ack"],
    ["a co-attendee adult's acknowledgment given by the registrant",
      submission({ first: "Dee" }, { reg_ack: true }, [
        { clientId: "a-dad", first: "Dee", age: 40 },
        { clientId: "a-uncle", first: "Uri", age: 41, responses: { att_policy_ack: true } },
      ]), "attendees.1.responses.att_policy_ack"],
  ];
  for (const [label, input, path] of unauthorized) {
    let error: unknown = null;
    try {
      await submit(input);
    } catch (caught) { error = caught; }
    assert(error instanceof PublicRegistrationError && error.code === "INVALID_SUBMISSION", `${label}: refused`);
    assert(error.issues.some((issue) => issue.code === "ACKNOWLEDGMENT_NOT_AUTHORIZED" && issue.path === path), `${label}: the refusal marks the field (${path})`);
  }
  assert(await prisma.registration.count({ where: { eventId: ids.eventA } }) === registrationCountBefore, "a refused acknowledgment leaves no registration behind");
  assert(await prisma.acknowledgmentEvidence.count({ where: { eventId: ids.eventA } }) === evidenceBefore, "and no evidence");
  assert(await prisma.guardianAuthority.count({ where: { eventId: ids.eventA } }) === guardianAuthorityBefore, "and no declaration");

  // ---- Staff-entered and paper evidence ----
  const stranger = await prisma.person.create({ data: { id: `${P}_stranger`, firstName: "Stan", lastName: surname } });
  const household = await prisma.household.create({ data: { name: `${P}_household` } });
  await prisma.householdMember.createMany({ data: [dan.personId, sam.personId, stranger.id, ulf.personId].map((personId) => ({ householdId: household.id, personId, canManage: true, relationship: "family" })) });
  const regId = family.registration.id;
  const paperRequest = randomUUID();
  const paper = await recordStaffAcknowledgment({
    eventId: ids.eventA, registrationId: regId, fieldKey: "hist_material_ack", attendeeId: dan.id, channel: "PAPER",
    acknowledgedAt: daysAgo(60), actorUserId: ids.staff, clientRequestId: paperRequest,
  });
  assert(paper.created && !paper.replayed && paper.evidence.channel === "PAPER" && paper.evidence.actedByPersonId === dan.personId, "a paper acknowledgment is recorded for the person themselves");
  const paperRow = await prisma.acknowledgmentEvidence.findUniqueOrThrow({ where: { id: paper.evidence.id } });
  assert(paperRow.recordedByUserId === ids.staff && paperRow.policyVersionId === histV1 && paperRow.shownText === null && Math.abs(paperRow.acknowledgedAt.getTime() - daysAgo(60).getTime()) < 60_000, "it names the staff member, the policy version of the registration's own form, and the paper's date");
  const again = await recordStaffAcknowledgment({
    eventId: ids.eventA, registrationId: regId, fieldKey: "hist_material_ack", attendeeId: dan.id, channel: "PAPER",
    acknowledgedAt: daysAgo(1), actorUserId: ids.staff, clientRequestId: paperRequest,
  });
  assert(again.replayed && !again.created && again.evidence.id === paper.evidence.id, "a retried staff request returns the first result");
  const sameContent = await recordStaffAcknowledgment({
    eventId: ids.eventA, registrationId: regId, fieldKey: "hist_material_ack", attendeeId: dan.id, channel: "PAPER",
    acknowledgedAt: daysAgo(2), actorUserId: ids.staff, clientRequestId: randomUUID(),
  });
  assert(!sameContent.created && !sameContent.replayed && sameContent.evidence.id === paper.evidence.id, "the same content entered again under a new request returns the row already on file");
  await expectCode(recordStaffAcknowledgment({
    eventId: ids.eventA, registrationId: regId, fieldKey: "hist_material_ack", attendeeId: dan.id, channel: "STAFF_ENTERED",
    acknowledgedAt: daysAgo(2), actorUserId: ids.staff, clientRequestId: paperRequest,
  }), "IDEMPOTENCY_CONFLICT", "one request id cannot describe a different acknowledgment");
  assert(await prisma.acknowledgmentEvidence.count({ where: { registrationId: regId, fieldKey: "hist_material_ack" } }) === 1, "no conflicting duplicate was created");
  const typed = await recordStaffAcknowledgment({
    eventId: ids.eventA, registrationId: regId, fieldKey: "hist_soft_ack", attendeeId: dan.id, channel: "STAFF_ENTERED",
    acknowledgedAt: daysAgo(60), actorUserId: ids.staff, clientRequestId: randomUUID(),
  });
  assert(typed.created && typed.evidence.channel === "STAFF_ENTERED", "an acknowledgment staff typed in for the person is recorded");
  // A minor on paper: only the declared adult can have signed.
  const minorRequest = (actedByPersonId: string | null) => recordStaffAcknowledgment({
    eventId: ids.eventA, registrationId: regId, fieldKey: "hist_material_ack", attendeeId: sam.id, channel: "PAPER",
    acknowledgedAt: daysAgo(60), actorUserId: ids.staff, clientRequestId: randomUUID(), actedByPersonId,
  });
  await expectCode(minorRequest(null), "ACTING_FOR_MINOR_NOT_AUTHORIZED", "the minor's own tick is not authority");
  await expectCode(minorRequest(ulf.personId), "ACTING_FOR_MINOR_NOT_AUTHORIZED", "an adult on the registration who was not declared is refused");
  await expectCode(minorRequest(stranger.id), "ACTING_FOR_MINOR_NOT_AUTHORIZED", "a household member who can manage the child is refused");
  const declared = await minorRequest(dan.personId);
  assert(declared.created && declared.evidence.guardianAuthorityId === samAuthority.id && declared.evidence.actedByPersonId === dan.personId, "the declared responsible adult can sign for the minor");
  await expectCode(recordStaffAcknowledgment({
    eventId: ids.eventA, registrationId: regId, fieldKey: "hist_soft_ack", attendeeId: ulf.id, channel: "PAPER",
    acknowledgedAt: daysAgo(10), actorUserId: ids.staff, clientRequestId: randomUUID(), actedByPersonId: dan.personId,
  }), "ACTING_FOR_ANOTHER_NOT_AUTHORIZED", "nobody signs for another adult");
  assert(await prisma.acknowledgmentEvidence.count({ where: { registrationId: regId, subjectPersonId: ulf.personId } }) === 0, "a refused entry records nothing");
  const bad = (overrides: Partial<Parameters<typeof recordStaffAcknowledgment>[0]>) => recordStaffAcknowledgment({
    eventId: ids.eventA, registrationId: regId, fieldKey: "hist_soft_ack", attendeeId: dan.id, channel: "PAPER", actorUserId: ids.staff, clientRequestId: randomUUID(), ...overrides,
  });
  await expectCode(bad({ fieldKey: "no_such_field" }), "FIELD_NOT_FOUND", "an unknown field is refused");
  await expectCode(bad({ fieldKey: "first_name" }), "FIELD_NOT_FOUND", "a field that is not an acknowledgment is refused");
  await expectCode(bad({ attendeeId: null }), "ATTENDEE_REQUIRED", "an attendee-level acknowledgment needs an attendee");
  await expectCode(bad({ fieldKey: "reg_ack", attendeeId: dan.id }), "ATTENDEE_NOT_ALLOWED", "a registration-level acknowledgment names no attendee");
  await expectCode(bad({ attendeeId: "not-an-attendee" }), "ATTENDEE_NOT_FOUND", "an attendee who is not on the registration is refused");
  await expectCode(bad({ eventId: ids.eventB }), "REGISTRATION_NOT_FOUND", "another event's staff cannot reach the registration");
  await expectCode(bad({ acknowledgedAt: new Date(Date.now() + 86_400_000) }), "ACKNOWLEDGED_AT_INVALID", "a date in the future is refused");
  await expectCode(bad({ fieldKey: "att_text_ack", attendeeId: ulf.id }), "FIELD_NOT_APPLICABLE", "a conditional acknowledgment that does not apply to the person is refused");
  await expectCode(bad({ actedByPersonId: "not-a-person" }), "ACTOR_NOT_FOUND", "the person who acknowledged must exist");
  const registrationLevel = await recordStaffAcknowledgment({
    eventId: ids.eventA, registrationId: (await load(hidden.confirmationCode)).registration.id, fieldKey: "program_ack", channel: "PAPER", actorUserId: ids.staff, clientRequestId: randomUUID(),
  }).then(() => "recorded", (error: unknown) => (error instanceof AcknowledgmentError ? error.code : String(error)));
  assert(registrationLevel === "FIELD_NOT_APPLICABLE", "a registration-level condition is judged on the stored answers");

  // ---- Historical status ----
  const view = async (at?: Date) => (await listRegistrationAcknowledgments(ids.eventA, regId, at))!;
  const statusOf = (views: Awaited<ReturnType<typeof view>>, key: string, attendeeId: string) => {
    const found = views.find((candidate) => candidate.fieldKey === key && candidate.subject.kind === "ATTENDEE" && candidate.subject.attendeeId === attendeeId);
    assert(found, `a status row for ${key}`);
    return found.status;
  };
  assert(statusOf(await view(daysAgo(100)), "hist_material_ack", dan.id) === "NOT_ACKNOWLEDGED", "before the acknowledgment: not acknowledged");
  assert(statusOf(await view(daysAgo(45)), "hist_material_ack", dan.id) === "ACKNOWLEDGED", "while version 1 was in force: acknowledged");
  assert(statusOf(await view(), "hist_material_ack", dan.id) === "REACKNOWLEDGMENT_REQUIRED", "after a material change took effect: acknowledge again");
  assert(statusOf(await view(daysAgo(45)), "hist_soft_ack", dan.id) === "ACKNOWLEDGED", "a non-material policy at the time: acknowledged");
  assert(statusOf(await view(), "hist_soft_ack", dan.id) === "ACKNOWLEDGED_EARLIER_VERSION", "after a non-material change: the earlier acknowledgment stands");
  assert(statusOf(await view(), "att_policy_ack", dan.id) === "ACKNOWLEDGED" && statusOf(await view(), "att_policy_ack", ulf.id) === "NOT_ACKNOWLEDGED", "the current policy: acknowledged by the one who gave it, not by the other adult");
  const mainDraft = await createNextDraftVersion(ids.eventA, main.id, ids.staff, { title: "Synthetic main title v2", bodyText: "Synthetic main body v2." });
  const futureStart = new Date(Date.now() + 2 * 86_400_000);
  await publishPolicyVersion(ids.eventA, main.id, ids.staff, { effectiveFrom: futureStart, isMaterialChange: true });
  assert(mainDraft.versionNumber === 2, "a second version of the main policy exists");
  assert(statusOf(await view(), "att_policy_ack", dan.id) === "ACKNOWLEDGED", "a version that has not taken effect yet changes nothing");
  assert(statusOf(await view(new Date(futureStart.getTime() + 60_000)), "att_policy_ack", dan.id) === "REACKNOWLEDGMENT_REQUIRED", "once it takes effect and is material, they must acknowledge again");
  const views = await view();
  assert(!JSON.stringify(views).includes(TEXT_WORDING) && !JSON.stringify(views).includes(MAIN_BODY), "the status read carries no wording");
  const payload = await getAcknowledgmentEvidencePayload(ids.eventA, regId, danPolicy.id);
  assert(payload.policyVersion?.versionNumber === 1 && payload.policyVersion.bodyText === MAIN_BODY, "evidence reads back the version the person saw, though a later one is now published");
  const textPayload = await getAcknowledgmentEvidencePayload(ids.eventA, regId, regAck.id);
  assert(textPayload.shownText === TEXT_WORDING && Object.keys(textPayload.requestMetadata).every((key) => ["userAgentHash", "formVersionId", "submissionKey"].includes(key)), "the payload is the exact wording and approved metadata only");
  await expectCode(getAcknowledgmentEvidencePayload(ids.eventA, "another-registration", regAck.id), "EVIDENCE_NOT_FOUND", "evidence is read only through the registration that owns it");
  await expectCode(getAcknowledgmentEvidencePayload(ids.eventB, regId, regAck.id), "EVIDENCE_NOT_FOUND", "and only through its own event");

  // ---- A policy version the event cannot use ----
  const policyField = (policyVersionId: string): RegistrationFormField => ({ ...field("att_policy_ack"), acknowledgment: { source: "POLICY_VERSION", policyVersionId } });
  const attendeeRequest = (policyVersionId: string) => prisma.$transaction((tx) => recordAcknowledgmentEvidence(tx, {
    eventId: ids.eventA, registrationId: regId, formVersionId: ids.formVersion, field: policyField(policyVersionId),
    attendee: { attendeeId: dan.id, personId: dan.personId, status: "ADULT" }, actedByPersonId: dan.personId, channel: "ONLINE", recordedByUserId: null,
    acknowledgedAt: new Date(), idempotencyKey: randomUUID(),
  }));
  await expectCode(attendeeRequest(otherV1.id), "POLICY_VERSION_UNAVAILABLE", "another event's policy version is not found");
  await expectCode(attendeeRequest(waiverV1.id), "POLICY_VERSION_UNAVAILABLE", "a waiver cannot stand in for an acknowledgment");
  await expectCode(attendeeRequest(draftVersionId), "POLICY_VERSION_UNAVAILABLE", "a draft is never evidence");
  await expectCode(attendeeRequest("missing-version"), "POLICY_VERSION_UNAVAILABLE", "a version that does not exist is not found");
  const withField = (candidate: RegistrationFormField) => ({ ...definition, sections: [{ ...definition.sections[0]!, fields: [candidate] }] });
  assert(await assertAcknowledgmentPoliciesAvailable(ids.eventA, withField(policyField(mainV1.id))).then(() => true), "a published acknowledgment version of the event passes the builder check");
  for (const unusable of [otherV1.id, waiverV1.id, draftVersionId]) {
    await expectCode(assertAcknowledgmentPoliciesAvailable(ids.eventA, withField(policyField(unusable))), "POLICY_VERSION_UNAVAILABLE", "the builder check refuses an unusable version");
  }
  const orgPolicy = await createConsentPolicy(null, ids.staff, { kind: "ACKNOWLEDGMENT", slug: `${PS}-org`, name: "Synthetic organization acknowledgment", title: "Synthetic org title", bodyText: "Synthetic org body." });
  const orgV1 = await publishPolicyVersion(null, orgPolicy.id, ids.staff, { effectiveFrom: new Date(), isMaterialChange: false });
  assert(await assertAcknowledgmentPoliciesAvailable(ids.eventA, withField(policyField(orgV1.id))).then(() => true), "an organization-scoped acknowledgment version can be used by any event");
  await prisma.$transaction(async (tx) => { await tx.$executeRaw`SET LOCAL session_replication_role = replica`; await tx.$executeRaw`DELETE FROM "ConsentPolicyVersion" WHERE "policyId" = ${orgPolicy.id}`; await tx.$executeRaw`DELETE FROM "ConsentPolicy" WHERE "id" = ${orgPolicy.id}`; });

  // ---- Database guarantees ----
  assert(await rejects(prisma.acknowledgmentEvidence.update({ where: { id: regAck.id }, data: { fieldLabel: "Rewritten" } }), /append-only/), "evidence is not edited");
  assert(await rejects(prisma.acknowledgmentEvidence.update({ where: { id: regAck.id }, data: { shownText: "Rewritten wording" } }), /append-only/), "the wording is not edited");
  assert(await rejects(prisma.acknowledgmentEvidence.delete({ where: { id: regAck.id } }), /append-only/), "evidence is not deleted");
  assert(await rejects(prisma.acknowledgmentEvidence.deleteMany({ where: { eventId: ids.eventA } }), /append-only/), "a bulk delete is refused too");
  const deletedUnderEventDeletion = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    return tx.$executeRaw`DELETE FROM "AcknowledgmentEvidence" WHERE "id" = ${regAck.id}`;
  }).then(() => false, (error: unknown) => /append-only/.test(String(error instanceof Error ? error.message : error)));
  assert(deletedUnderEventDeletion, "event deletion cannot delete evidence either");
  // RESTRICT: with event deletion on (which lets the policy and declaration triggers step aside), the evidence still refuses.
  const restricted = async (statement: (tx: Prisma.TransactionClient) => Promise<unknown>, label: string) => {
    const refusedByEvidence = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
      return statement(tx);
    }).then(() => false, (error: unknown) => /AcknowledgmentEvidence/.test(String(error instanceof Error ? error.message : error)));
    assert(refusedByEvidence, `${label} is refused by the evidence reference`);
  };
  await restricted((tx) => tx.$executeRaw`DELETE FROM "ConsentPolicyVersion" WHERE "id" = ${mainV1.id}`, "deleting the policy version");
  await restricted((tx) => tx.$executeRaw`DELETE FROM "Registration" WHERE "id" = ${regId}`, "deleting the registration");
  const base = {
    eventId: ids.eventA, registrationId: regId, registrationAttendeeId: dan.id, subjectPersonId: dan.personId, actedByPersonId: dan.personId,
    channel: "ONLINE" as const, formVersionId: ids.formVersion, fieldId: `${P}_a_policy_ack`, fieldKey: "att_policy_ack", fieldLabel: "Policy acknowledgment",
    source: "POLICY_VERSION" as const, policyVersionId: mainV1.id, contentHash: mainV1.contentHash!, contentRef: `policy:${mainV1.id}`,
    subjectMinorStatus: "ADULT", acknowledgedAt: new Date(), idempotencyKey: `${P}-raw`, requestHash: "raw",
  };
  const raw = (overrides: Record<string, unknown>) => prisma.acknowledgmentEvidence.create({ data: { ...base, idempotencyKey: `${P}-raw-${randomUUID()}`, ...overrides } as Prisma.AcknowledgmentEvidenceUncheckedCreateInput });
  assert(await rejects(raw({ policyVersionId: otherV1.id, contentRef: `policy:${otherV1.id}`, contentHash: otherV1.contentHash }), /published acknowledgment version/), "a policy version of another event is refused by the database");
  assert(await rejects(raw({ policyVersionId: waiverV1.id, contentRef: `policy:${waiverV1.id}`, contentHash: waiverV1.contentHash }), /published acknowledgment version/), "a policy version of another kind is refused by the database");
  assert(await rejects(raw({ policyVersionId: draftVersionId, contentRef: `policy:${draftVersionId}`, contentHash: "x" }), /published acknowledgment version/), "a draft is refused by the database");
  assert(await rejects(raw({ eventId: ids.eventB }), /another event/), "a registration of another event is refused by the database");
  assert(await rejects(raw({ registrationAttendeeId: ulf.id }), /not the subject person/), "an attendee who is not the subject person is refused by the database");
  assert(await rejects(raw({ subjectMinorStatus: "MINOR", guardianAuthorityId: null, registrationAttendeeId: sam.id, subjectPersonId: sam.personId }), /minor_check|check constraint/i), "a minor's row without authority is refused by the database");
  assert(await rejects(raw({ requestMetadata: { ipAddress: "203.0.113.9" } }), /request_metadata_check|check constraint/i), "unapproved request metadata is refused by the database");
  assert(await rejects(raw({ recordedByUserId: ids.staff }), /channel_check|check constraint/i), "an online row naming a staff recorder is refused");
  assert(await rejects(raw({ channel: "PAPER", recordedByUserId: null }), /channel_check|check constraint/i), "a paper row without a staff recorder is refused");
  assert(await rejects(raw({ shownText: "also text" }), /source_check|check constraint/i), "a row that is both text and a policy version is refused");
  assert(await rejects(raw({ registrationAttendeeId: null }), /subject_check|check constraint/i), "an attendee subject without a person pairing is refused");
  assert(await rejects(raw({}), /unique/i), "the same content for the same subject and field cannot be recorded twice, whatever the request id");
  assert(await rejects(raw({ registrationAttendeeId: null, subjectPersonId: null, fieldKey: "reg_ack", contentRef: regAck.contentRef, source: "TEXT", shownText: TEXT_WORDING, policyVersionId: null, contentHash: regAck.contentHash }), /unique/i), "and the same holds for a registration-level subject");

  // ---- Event deletion refuses while evidence exists ----
  const actor = { userId: ids.staff, globalRole: "SYSTEM_ADMIN" as const };
  const preview = await getEventDeletionPreview(ids.eventA, actor);
  assert(preview && preview.counts.acknowledgmentEvidence === await prisma.acknowledgmentEvidence.count({ where: { eventId: ids.eventA } }), "the deletion preview counts the evidence");
  assert(preview && !preview.decision.allowed && /acknowledgment record/.test(preview.decision.reason), "and refuses, naming it");
  const deletion = await deleteEvent({ eventId: ids.eventA, actor, confirmName: `Acknowledgment Check ${ids.eventA}` }).then(() => null, (error: unknown) => error);
  assert(deletion instanceof EventDeletionError && deletion.code === "EVENT_DELETE_FORBIDDEN", "deleting the event is refused");
  assert(await prisma.event.count({ where: { id: ids.eventA } }) === 1 && await prisma.acknowledgmentEvidence.count({ where: { eventId: ids.eventA } }) > 0, "and nothing was removed");

  // ---- Nothing that feeds an export, a log or a message holds the wording ----
  const allRegistrations = (await prisma.registration.findMany({ where: { eventId: ids.eventA }, select: { id: true } })).map((registration) => registration.id);
  const surfaces = JSON.stringify({
    attendees: await prisma.registrationAttendee.findMany({ where: { registrationId: { in: allRegistrations } } }),
    registrations: await prisma.registration.findMany({ where: { id: { in: allRegistrations } } }),
    submissions: await prisma.publicRegistrationSubmission.findMany({ where: { registrationId: { in: allRegistrations } } }),
    audit: await prisma.auditLog.findMany({ where: { eventId: ids.eventA } }),
    messages: await prisma.messageOutbox.findMany({ where: { registrationId: { in: allRegistrations } } }),
  });
  for (const secret of [TEXT_WORDING, PROGRAM_WORDING, ACTIVITY_WORDING, MAIN_BODY, sha256(TEXT_WORDING)]) {
    assert(!surfaces.includes(JSON.stringify(secret).slice(1, -1)), "the wording appears in no response snapshot, registration row, audit row or message");
  }
  const audits = await prisma.auditLog.findMany({ where: { eventId: ids.eventA, action: "ACKNOWLEDGMENT_RECORDED" } });
  assert(audits.length === await prisma.acknowledgmentEvidence.count({ where: { eventId: ids.eventA } }), "every evidence row is audited once");
  for (const entry of audits) {
    const metadata = entry.metadata as Record<string, unknown>;
    assert(!("shownText" in metadata) && !("fieldLabel" in metadata) && !("requestMetadata" in metadata) && !("userAgentHash" in metadata), "an evidence audit row carries ids and flags only");
  }

  console.log("Acknowledgment evidence verification passed.");
}

main()
  .catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError) console.error(error.code, error.message);
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error: unknown) => console.error("cleanup failed", error));
    await prisma.$disconnect();
  });
