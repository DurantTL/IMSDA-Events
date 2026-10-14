/**
 * Proves consent policy definitions and immutable published versions (#129, slice 1 of #43) against a
 * real PostgreSQL database, where the unit tests' fake client can't:
 *
 * - a policy carries a kind and a scope; the scope and the owning event must agree, and kind, scope and
 *   event can never be changed after creation (check constraint and trigger);
 * - a draft is editable and at most one draft exists per policy, even when two are started at once;
 * - publishing freezes the draft: the repository refuses to edit it and the database trigger refuses any
 *   UPDATE of a published row, written by hand too; a correction is a new version;
 * - a published row must carry its publisher, time, hash, effective start and the human material-change
 *   judgment; a draft carries none of them; the effective window can never end before it starts;
 * - publishing twice at once publishes once; the earlier version is left exactly as it was;
 * - the version effective at a date is chosen by window (open-ended, overlapping, before the first start),
 *   and the version an evidence row references is chosen by id: two separate queries that disagree after a
 *   correction takes effect;
 * - the current-version pointer can only name a published version of the same policy;
 * - applicability can only name an organization policy or the event's own policy, and only the event's own
 *   attendee types; age bands, roles and attendee types select who a policy applies to and whether it is required;
 * - audit rows carry ids, flags and counts only, never policy text;
 * - a published version (and a policy that has one) can never be deleted and re-inserted: only event deletion removes
 *   them, and the real deleteEvent path removes an event's applicability rows, versions and policies before its
 *   attendee types (a plain delete of the event is refused); every guard answers SQLSTATE CP001, which the API maps to 409;
 * - the version lookups are scoped to an event (own or organization policies only) and can demand a kind;
 * - an effective-from earlier than the moment of publishing is refused;
 * - a one-field applicability update leaves every other field alone, and the age band is checked on the merged values;
 * - the full list shows an organization policy's published versions only; the slim read for form builders has
 *   published versions only and no body text.
 *
 * Uses fictitious rows it creates and removes itself, and obviously synthetic placeholder text.
 *
 *   npm run test:consent-policies
 */
import { loadEnvConfig } from "@next/env";
import { assertLocalDatabase } from "./support/local-only-guard";
import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { consentPolicyApiError } from "../modules/consent/api-errors";
import {
  ConsentPolicyError,
  createConsentPolicy,
  createEventPolicyApplicability,
  createNextDraftVersion,
  getPolicyVersionEffectiveAt,
  getPolicyVersionForEvidence,
  listConsentPoliciesForEvent,
  listPublishedPolicyVersionsForEvent,
  publishPolicyVersion,
  resolveApplicablePolicies,
  updateDraftPolicyVersion,
  updateEventPolicyApplicability,
} from "../modules/consent/repository";

loadEnvConfig(process.cwd());
// Local-only, before any Prisma client or connection exists.
assertLocalDatabase(process.env, "run this verification");

const prisma = new PrismaClient();
const P = `cp129_${randomUUID().slice(0, 8)}`;
const PS = P.replace(/_/g, "-");
const ids = { staff: `${P}_staff`, eventA: `${P}_ev_a`, eventB: `${P}_ev_b`, typeA: `${P}_type_a`, typeB: `${P}_type_b` };
const TEXT = { title: "Synthetic placeholder title", bodyText: "Lorem placeholder body for automated verification only." };
const SECRET_TEXT = "Distinctive placeholder sentence that must never reach an audit row.";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function refused(promise: Promise<unknown>, pattern: RegExp, message: string) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  assert(error !== null && pattern.test(String(error instanceof Error ? error.message : error)), `${message}: got ${String(error)}`);
}

async function expectCode(promise: Promise<unknown>, code: string, message: string) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  assert(error instanceof ConsentPolicyError && error.code === code, `${message}: expected ${code}, got ${String(error)}`);
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { OR: [{ eventId: { in: [ids.eventA, ids.eventB] } }, { actorUserId: ids.staff }] } });
  // Published versions are removed only the way event deletion removes them.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
    await tx.consentPolicyVersion.deleteMany({ where: { policy: { OR: [{ eventId: { in: [ids.eventA, ids.eventB] } }, { slug: { startsWith: PS } }] } } });
    await tx.consentPolicy.deleteMany({ where: { OR: [{ eventId: { in: [ids.eventA, ids.eventB] } }, { slug: { startsWith: PS } }] } });
  });
  await prisma.event.deleteMany({ where: { id: { in: [ids.eventA, ids.eventB] } } });
  await prisma.user.deleteMany({ where: { id: ids.staff } });
}

const day = (offset: number) => new Date(Date.UTC(2031, 0, 1 + offset));

async function main() {
  await prisma.user.create({ data: { id: ids.staff, email: `${P}-staff@example.test`, displayName: "Consent Check Staff", globalRole: "SYSTEM_ADMIN" } });
  // Event A starts 2031-06-01 (age bands are read on that date).
  for (const id of [ids.eventA, ids.eventB]) {
    await prisma.event.create({
      data: {
        id, slug: `${id.replace(/_/g, "-")}-slug`, name: `Consent Check ${id}`, startsAt: new Date(Date.UTC(2031, 5, 1, 15)),
        endsAt: new Date(Date.UTC(2031, 5, 3, 15)), timezone: "America/Chicago", isPublished: true, audience: "GENERAL", billingMode: "ATTENDEE_PAY",
      },
    });
  }
  await prisma.eventAttendeeType.create({ data: { id: ids.typeA, eventId: ids.eventA, code: "youth", label: "Youth" } });
  await prisma.eventAttendeeType.create({ data: { id: ids.typeB, eventId: ids.eventB, code: "youth", label: "Youth" } });

  // ---- Definitions: kind and scope ----
  const policy = await createConsentPolicy(ids.eventA, ids.staff, { kind: "CONSENT", slug: `${PS}-photo`, name: "Synthetic photo policy", title: TEXT.title, bodyText: SECRET_TEXT });
  assert(policy.kind === "CONSENT" && policy.scope === "EVENT" && policy.eventId === ids.eventA, "event policy carries kind, scope and event");
  assert(policy.versions.length === 1 && policy.versions[0].status === "DRAFT" && policy.versions[0].versionNumber === 1, "first version is a draft");
  assert(policy.currentVersionId === null, "no current version before a publish");
  await expectCode(createConsentPolicy(ids.eventA, ids.staff, { kind: "WAIVER", slug: `${PS}-photo`, name: "Dup", ...TEXT }), "SLUG_TAKEN", "slug is unique inside an event");
  const orgPolicy = await createConsentPolicy(null, ids.staff, { kind: "ACKNOWLEDGMENT", slug: `${PS}-org-ack`, name: "Synthetic org acknowledgment", ...TEXT });
  assert(orgPolicy.scope === "ORGANIZATION" && orgPolicy.eventId === null, "organization policy has no event");
  await expectCode(createConsentPolicy(null, ids.staff, { kind: "WAIVER", slug: `${PS}-org-ack`, name: "Dup", ...TEXT }), "SLUG_TAKEN", "organization slugs are unique too");
  await refused(prisma.consentPolicy.create({ data: { kind: "CONSENT", scope: "EVENT", eventId: null, slug: `${PS}-bad1`, name: "Bad", createdByUserId: ids.staff } }), /ConsentPolicy_scope_event_check/, "event scope needs an event");
  await refused(prisma.consentPolicy.create({ data: { kind: "CONSENT", scope: "ORGANIZATION", eventId: ids.eventA, slug: `${PS}-bad2`, name: "Bad", createdByUserId: ids.staff } }), /ConsentPolicy_scope_event_check/, "organization scope has no event");
  await refused(prisma.consentPolicy.update({ where: { id: policy.id }, data: { kind: "WAIVER" } }), /immutable/, "kind cannot change");
  await refused(prisma.consentPolicy.update({ where: { id: policy.id }, data: { eventId: ids.eventB } }), /immutable/, "owning event cannot change");
  await refused(prisma.consentPolicy.update({ where: { id: orgPolicy.id }, data: { scope: "EVENT", eventId: ids.eventA } }), /immutable/, "scope cannot change");

  // ---- Drafts ----
  const draft1 = policy.versions[0];
  await expectCode(createNextDraftVersion(ids.eventA, policy.id, ids.staff, TEXT), "DRAFT_EXISTS", "one draft at a time");
  const racers = await Promise.allSettled([
    prisma.consentPolicyVersion.create({ data: { policyId: policy.id, createdByUserId: ids.staff, versionNumber: 2, ...TEXT } }),
    prisma.consentPolicyVersion.create({ data: { policyId: policy.id, createdByUserId: ids.staff, versionNumber: 3, ...TEXT } }),
  ]);
  assert(racers.every((result) => result.status === "rejected"), "the database allows only one draft per policy");
  const edited = await updateDraftPolicyVersion(ids.eventA, policy.id, draft1.id, ids.staff, { title: TEXT.title, bodyText: SECRET_TEXT + " Edited." });
  assert(edited.bodyText.endsWith("Edited.") && edited.status === "DRAFT" && edited.contentHash === null, "a draft is editable and has no hash");
  await expectCode(updateDraftPolicyVersion(ids.eventB, policy.id, draft1.id, ids.staff, TEXT), "VERSION_NOT_FOUND", "another event cannot edit this policy's draft");
  await expectCode(publishPolicyVersion(ids.eventB, policy.id, ids.staff, { effectiveFrom: day(0), isMaterialChange: false }), "POLICY_NOT_FOUND", "another event cannot publish it");
  await expectCode(publishPolicyVersion(null, policy.id, ids.staff, { effectiveFrom: day(0), isMaterialChange: false }), "POLICY_NOT_FOUND", "the organization route cannot publish an event policy");

  // ---- Publish freezes ----
  await expectCode(publishPolicyVersion(ids.eventA, policy.id, ids.staff, { effectiveFrom: new Date(Date.now() - 86_400_000), isMaterialChange: true }), "EFFECTIVE_FROM_IN_PAST", "a version cannot be backdated");
  assert((await prisma.consentPolicyVersion.findUniqueOrThrow({ where: { id: draft1.id } })).status === "DRAFT", "a refused backdated publish leaves the draft a draft");
  await publishPolicyVersion(ids.eventA, policy.id, ids.staff, { effectiveFrom: day(0), effectiveTo: day(100), isMaterialChange: true });
  const v1 = await prisma.consentPolicyVersion.findUniqueOrThrow({ where: { id: draft1.id } });
  assert(v1.status === "PUBLISHED" && v1.publishedAt !== null && v1.publishedByUserId === ids.staff && v1.contentHash?.length === 64, "publish records publisher, time and hash");
  assert(v1.isMaterialChange === true, "the material-change flag is kept as the human set it");
  assert((await prisma.consentPolicy.findUniqueOrThrow({ where: { id: policy.id } })).currentVersionId === v1.id, "the policy points at its published version");
  await expectCode(publishPolicyVersion(ids.eventA, policy.id, ids.staff, { effectiveFrom: day(0), isMaterialChange: false }), "NO_DRAFT", "nothing left to publish");
  await expectCode(updateDraftPolicyVersion(ids.eventA, policy.id, v1.id, ids.staff, TEXT), "VERSION_IMMUTABLE", "the repository refuses to edit a published version");
  await refused(prisma.consentPolicyVersion.update({ where: { id: v1.id }, data: { bodyText: "Changed." } }), /immutable/, "the database refuses to change the text");
  await refused(prisma.consentPolicyVersion.update({ where: { id: v1.id }, data: { effectiveTo: day(200) } }), /immutable/, "the database refuses to change the window");
  await refused(prisma.consentPolicyVersion.update({ where: { id: v1.id }, data: { isMaterialChange: false } }), /immutable/, "the database refuses to change the flag");
  await refused(prisma.consentPolicyVersion.update({ where: { id: v1.id }, data: { status: "DRAFT" } }), /immutable/, "a published version cannot go back to draft");
  await refused(prisma.consentPolicyVersion.updateMany({ where: { policyId: policy.id }, data: { title: "Changed" } }), /immutable/, "a bulk update is refused too");
  const unchanged = await prisma.consentPolicyVersion.findUniqueOrThrow({ where: { id: v1.id } });
  assert(unchanged.bodyText === v1.bodyText && unchanged.updatedAt.getTime() === v1.updatedAt.getTime(), "the row is untouched");

  // ---- A published version is never deleted and re-inserted ----
  const deleteError = await prisma.consentPolicyVersion.delete({ where: { id: v1.id } }).then(() => null, (caught: unknown) => caught);
  assert(deleteError !== null && /cannot be deleted/.test(String(deleteError)), "the database refuses to delete a published version");
  const mapped = consentPolicyApiError(deleteError);
  assert(mapped.status === 409 && (await mapped.json()).error === "CONSENT_POLICY_CONFLICT", "a trigger refusal (SQLSTATE CP001) is answered 409");
  await refused(prisma.consentPolicyVersion.deleteMany({ where: { policyId: policy.id } }), /cannot be deleted/, "a bulk delete is refused too");
  await refused(prisma.consentPolicy.delete({ where: { id: policy.id } }), /cannot be deleted/, "a policy with a published version cannot be deleted");
  await refused(prisma.consentPolicy.deleteMany({ where: { id: policy.id } }), /cannot be deleted/, "nor in bulk");
  assert(await prisma.consentPolicyVersion.count({ where: { id: v1.id } }) === 1, "the version is still there");

  // ---- Field requirements ----
  await refused(prisma.consentPolicyVersion.create({ data: { policyId: orgPolicy.id, createdByUserId: ids.staff, versionNumber: 9, status: "PUBLISHED", ...TEXT } }), /published_fields_check/, "a published row needs its evidence fields");
  await refused(prisma.consentPolicyVersion.create({ data: { policyId: orgPolicy.id, createdByUserId: ids.staff, versionNumber: 9, status: "DRAFT", isMaterialChange: true, ...TEXT } }), /published_fields_check/, "a draft carries no publish fields");
  await refused(publishPolicyVersion(null, orgPolicy.id, ids.staff, { effectiveFrom: day(10), effectiveTo: day(10), isMaterialChange: false }), /after effective-from|Effective/i, "an empty window is refused");
  await refused(publishPolicyVersion(null, orgPolicy.id, ids.staff, { effectiveFrom: day(10) }), /./, "the material-change flag is required");

  // ---- Corrections, overlap, open-ended, by date vs by evidence ----
  // v1 has window [day0, day100). v2: an open-ended correction from day 50 that overlaps v1. v3 starts day 300.
  await createNextDraftVersion(ids.eventA, policy.id, ids.staff, { title: TEXT.title, bodyText: "Synthetic correction text." });
  const v2 = await publishPolicyVersion(ids.eventA, policy.id, ids.staff, { effectiveFrom: day(50), isMaterialChange: false });
  assert(v2.versionNumber === 2 && v2.isMaterialChange === false && v2.effectiveTo === null, "a correction is version 2 and may have no end");
  const v1Again = await prisma.consentPolicyVersion.findUniqueOrThrow({ where: { id: v1.id } });
  assert(v1Again.effectiveTo?.getTime() === day(100).getTime() && v1Again.status === "PUBLISHED", "publishing v2 leaves v1 exactly as it was");
  assert((await getPolicyVersionEffectiveAt(ids.eventA, policy.id, day(-1))) === null, "before the first start nothing is effective");
  assert((await getPolicyVersionEffectiveAt(ids.eventA, policy.id, day(10)))?.id === v1.id, "inside v1 only: v1");
  assert((await getPolicyVersionEffectiveAt(ids.eventA, policy.id, day(60)))?.versionNumber === 2, "overlap resolves to the higher version number");
  assert((await getPolicyVersionEffectiveAt(ids.eventA, policy.id, day(100)))?.versionNumber === 2, "the end instant is exclusive");
  assert((await getPolicyVersionEffectiveAt(ids.eventA, policy.id, day(5000)))?.versionNumber === 2, "a version with no end stays effective");
  await createNextDraftVersion(ids.eventA, policy.id, ids.staff, { title: TEXT.title, bodyText: "Synthetic third text." });
  assert((await getPolicyVersionEffectiveAt(ids.eventA, policy.id, day(5000)))?.versionNumber === 2, "a draft is never effective");
  await publishPolicyVersion(ids.eventA, policy.id, ids.staff, { effectiveFrom: day(300), isMaterialChange: true });
  assert((await getPolicyVersionEffectiveAt(ids.eventA, policy.id, day(299)))?.versionNumber === 2, "v3 is not effective before its start");
  assert((await getPolicyVersionEffectiveAt(ids.eventA, policy.id, day(300)))?.versionNumber === 3, "v3 takes over at its start");
  // Evidence: the version someone saw on day 10 is still v1, whatever is effective now.
  const seen = await getPolicyVersionForEvidence(ids.eventA, v1.id);
  assert(seen.id === v1.id && seen.bodyText === v1.bodyText && seen.contentHash === v1.contentHash, "evidence resolves to the exact version by id");
  assert((await getPolicyVersionEffectiveAt(ids.eventA, policy.id, day(5000)))?.id !== seen.id, "the by-date and by-evidence queries are different questions");
  const draftOnly = await createNextDraftVersion(ids.eventA, policy.id, ids.staff, TEXT);
  await expectCode(getPolicyVersionForEvidence(ids.eventA, draftOnly.id), "VERSION_NOT_FOUND", "a draft is never an evidence target");

  // ---- Concurrent publish ----
  const results = await Promise.allSettled([
    publishPolicyVersion(ids.eventA, policy.id, ids.staff, { effectiveFrom: day(400), isMaterialChange: false }),
    publishPolicyVersion(ids.eventA, policy.id, ids.staff, { effectiveFrom: day(500), isMaterialChange: true }),
  ]);
  assert(results.filter((result) => result.status === "fulfilled").length === 1, "two simultaneous publishes publish once");
  assert(await prisma.consentPolicyVersion.count({ where: { policyId: policy.id, status: "PUBLISHED" } }) === 4, "four published versions");
  assert(await prisma.consentPolicyVersion.count({ where: { policyId: policy.id, status: "DRAFT" } }) === 0, "no draft is left");

  // ---- Event scope of the lookups, organization policies, and the reads for staff and form builders ----
  const orgV1 = await publishPolicyVersion(null, orgPolicy.id, ids.staff, { effectiveFrom: day(0), isMaterialChange: false });
  await createNextDraftVersion(null, orgPolicy.id, ids.staff, { title: TEXT.title, bodyText: SECRET_TEXT + " Organization draft." });
  assert((await getPolicyVersionEffectiveAt(ids.eventB, orgPolicy.id, day(5)))?.id === orgV1.id, "an organization policy's version is effective for any event");
  assert((await getPolicyVersionForEvidence(ids.eventB, orgV1.id)).id === orgV1.id, "and referenceable from any event");
  await expectCode(getPolicyVersionEffectiveAt(ids.eventB, policy.id, day(5)), "POLICY_NOT_FOUND", "another event's policy is not found by date");
  await expectCode(getPolicyVersionForEvidence(ids.eventB, v1.id), "VERSION_NOT_FOUND", "another event's version is not found as evidence");
  await getPolicyVersionEffectiveAt(ids.eventA, policy.id, day(5), "WAIVER").then(() => { throw new Error("FAILED: a kind mismatch must be refused"); }, (caught: unknown) => assert(caught instanceof Error && caught.name === "PolicyKindMismatchError", "a CONSENT policy is not a WAIVER"));
  await getPolicyVersionForEvidence(ids.eventA, v1.id, "ACKNOWLEDGMENT").then(() => { throw new Error("FAILED: a kind mismatch must be refused"); }, (caught: unknown) => assert(caught instanceof Error && caught.name === "PolicyKindMismatchError", "a CONSENT version is not an ACKNOWLEDGMENT"));
  assert((await getPolicyVersionForEvidence(ids.eventA, v1.id, "CONSENT")).id === v1.id, "the expected kind passes");

  const eventBAck = await createConsentPolicy(ids.eventB, ids.staff, { kind: "ACKNOWLEDGMENT", slug: `${PS}-ack-b`, name: "Synthetic event B acknowledgment", ...TEXT });
  await publishPolicyVersion(ids.eventB, eventBAck.id, ids.staff, { effectiveFrom: day(0), isMaterialChange: false });
  const listedForA = await listConsentPoliciesForEvent(ids.eventA);
  const orgListed = listedForA.find((row) => row.id === orgPolicy.id);
  assert(orgListed !== undefined && orgListed.versions.length === 1 && orgListed.versions[0].status === "PUBLISHED", "event admins see an organization policy's published version only, not its draft");
  assert(!JSON.stringify(listedForA).includes("Organization draft"), "no organization draft text reaches the event");
  assert(!listedForA.some((row) => row.id === eventBAck.id), "another event's policy is not listed");
  assert(listedForA.find((row) => row.id === policy.id)?.versions.length === 4, "the event's own policy lists every version");
  const slim = await listPublishedPolicyVersionsForEvent(ids.eventA);
  assert(slim.length >= 5 && slim.every((row) => row.contentHash !== null), "the slim read has the published versions (hash set)");
  assert(slim.some((row) => row.id === orgV1.id) && slim.some((row) => row.id === v1.id), "own and organization versions are there");
  assert(!slim.some((row) => row.policy.id === eventBAck.id), "another event's versions are not");
  assert(slim.every((row) => !("bodyText" in row)) && !JSON.stringify(slim).includes("Lorem placeholder") && !JSON.stringify(slim).includes("Organization draft"), "no body text and no draft in the slim read");
  assert(slim.every((row) => row.kind === row.policy.kind), "the slim read carries the kind");

  // ---- Current-version pointer ----
  const foreignDraft = await prisma.consentPolicyVersion.findFirstOrThrow({ where: { policyId: orgPolicy.id, status: "DRAFT" } });
  await refused(prisma.consentPolicy.update({ where: { id: policy.id }, data: { currentVersionId: foreignDraft.id } }), /current version must be/, "another policy's version cannot be current");
  await refused(prisma.consentPolicy.update({ where: { id: orgPolicy.id }, data: { currentVersionId: foreignDraft.id } }), /current version must be/, "a draft cannot be current");

  // ---- Applicability ----
  const ack = eventBAck;
  await expectCode(createEventPolicyApplicability(ids.eventA, ids.staff, { policyId: ack.id }), "POLICY_NOT_FOUND", "another event's policy cannot be configured");
  await refused(prisma.eventConsentPolicyApplicability.create({ data: { eventId: ids.eventA, policyId: ack.id } }), /another event/, "the database refuses it too");
  await expectCode(createEventPolicyApplicability(ids.eventA, ids.staff, { policyId: policy.id, attendeeTypeDefinitionId: ids.typeB }), "ATTENDEE_TYPE_NOT_FOUND", "another event's attendee type is refused");
  await refused(prisma.eventConsentPolicyApplicability.create({ data: { eventId: ids.eventA, policyId: policy.id, attendeeTypeDefinitionId: ids.typeB } }), /attendee type belongs/, "and by the database");
  await refused(prisma.eventConsentPolicyApplicability.create({ data: { eventId: ids.eventA, policyId: policy.id, minimumAge: 20, maximumAge: 10 } }), /age_band_check/, "an inverted age band is refused");
  const banded = await createEventPolicyApplicability(ids.eventA, ids.staff, { policyId: policy.id, role: "Youth Leader", minimumAge: 0, maximumAge: 17, isRequired: true });
  const oneField = await updateEventPolicyApplicability(ids.eventA, banded.id, ids.staff, { isRequired: false });
  assert(oneField.isRequired === false && oneField.role === "youth leader" && oneField.minimumAge === 0 && oneField.maximumAge === 17 && oneField.isActive === true && oneField.attendeeTypeDefinitionId === null, "a one-field update leaves every other field alone");
  const clearOne = await updateEventPolicyApplicability(ids.eventA, banded.id, ids.staff, { role: null, isRequired: true });
  assert(clearOne.role === null && clearOne.minimumAge === 0 && clearOne.maximumAge === 17 && clearOne.isRequired === true, "null clears one field and only that one");
  await updateEventPolicyApplicability(ids.eventA, banded.id, ids.staff, { minimumAge: 20 }).then(() => { throw new Error("FAILED: an inverted merged band must be refused"); }, (caught: unknown) => assert(caught instanceof Error && caught.name === "ApplicabilityAgeBandError", "the age band is checked against the stored maximum"));
  const afterRefusal = await prisma.eventConsentPolicyApplicability.findUniqueOrThrow({ where: { id: banded.id } });
  assert(afterRefusal.minimumAge === 0 && afterRefusal.maximumAge === 17, "a refused update changes nothing");
  await createEventPolicyApplicability(ids.eventA, ids.staff, { policyId: orgPolicy.id, attendeeTypeDefinitionId: ids.typeA, isRequired: false });
  await createEventPolicyApplicability(ids.eventA, ids.staff, { policyId: orgPolicy.id, role: "  Volunteer ", isRequired: true });
  const youthDob = new Date(Date.UTC(2020, 0, 1));
  const adultDob = new Date(Date.UTC(1990, 0, 1));
  const forYouth = await resolveApplicablePolicies(ids.eventA, { attendeeTypeDefinitionId: ids.typeA, role: null, dateOfBirth: youthDob });
  assert(forYouth.length === 2 && forYouth.find((row) => row.policy.id === policy.id)?.isRequired === true && forYouth.find((row) => row.policy.id === orgPolicy.id)?.isRequired === false, "a youth gets the age-banded consent (required) and the type-scoped acknowledgment (optional)");
  const forAdult = await resolveApplicablePolicies(ids.eventA, { attendeeTypeDefinitionId: null, role: "volunteer", dateOfBirth: adultDob });
  assert(forAdult.length === 1 && forAdult[0].policy.id === orgPolicy.id && forAdult[0].isRequired === true, "an adult volunteer gets only the role-scoped policy, required");
  const unknownAge = await resolveApplicablePolicies(ids.eventA, { attendeeTypeDefinitionId: null, role: null, dateOfBirth: null });
  assert(unknownAge.length === 0, "an age-banded policy never matches an unknown birth date");

  // ---- Audit: ids only ----
  const audits = await prisma.auditLog.findMany({ where: { OR: [{ eventId: { in: [ids.eventA, ids.eventB] } }, { actorUserId: ids.staff }], action: { startsWith: "CONSENT_POLICY" } } });
  assert(audits.length >= 10, "policy changes are audited");
  const serialized = JSON.stringify(audits);
  assert(!serialized.includes(SECRET_TEXT) && !serialized.includes("Lorem placeholder") && !serialized.includes("Synthetic correction") && !serialized.includes("Synthetic photo policy"), "no audit row holds policy text or a policy name");
  assert(audits.some((row) => row.action === "CONSENT_POLICY_PUBLISHED" && (row.metadata as { isMaterialChange?: boolean } | null)?.isMaterialChange !== undefined), "the publish audit records the flag");

  // ---- Event deletion ----
  assert(await prisma.consentPolicyVersion.count({ where: { policy: { eventId: ids.eventA } } }) > 0, "there are versions to remove");
  assert(await prisma.eventConsentPolicyApplicability.count({ where: { eventId: ids.eventA, attendeeTypeDefinitionId: ids.typeA } }) > 0, "applicability names an attendee type, which RESTRICTs its deletion");
  // A plain delete of the event is refused: published versions go only through the event-deletion path.
  const plain = await prisma.event.delete({ where: { id: ids.eventA } }).then(() => null, (caught: unknown) => caught);
  assert(plain !== null, "a plain delete of an event with published policy versions is refused");
  assert(await prisma.consentPolicyVersion.count({ where: { policy: { eventId: ids.eventA } } }) > 0, "and removed nothing");
  const { deleteEvent } = await import("../modules/events/deletion-repository");
  const deleted = await deleteEvent({ eventId: ids.eventA, actor: { userId: ids.staff, globalRole: "SYSTEM_ADMIN" }, confirmName: `Consent Check ${ids.eventA}` });
  assert(deleted.eventId === ids.eventA, "deleteEvent (removeEventOwnedRows) removes an event that has policies, versions and applicability");
  assert(await prisma.event.count({ where: { id: ids.eventA } }) === 0, "the event is gone");
  assert(await prisma.consentPolicy.count({ where: { eventId: ids.eventA } }) === 0, "its policies are gone");
  assert(await prisma.consentPolicyVersion.count({ where: { policyId: policy.id } }) === 0, "and their versions");
  assert(await prisma.eventConsentPolicyApplicability.count({ where: { eventId: ids.eventA } }) === 0, "and the event's configuration");
  assert(await prisma.eventAttendeeType.count({ where: { id: ids.typeA } }) === 0, "and its attendee types");
  assert(await prisma.consentPolicy.count({ where: { id: orgPolicy.id } }) === 1 && await prisma.consentPolicyVersion.count({ where: { id: orgV1.id } }) === 1, "an organization policy and its published version outlive the event");
  assert(await prisma.consentPolicy.count({ where: { id: ack.id } }) === 1, "another event's policy is untouched");

  console.log("Consent policy verification passed.");
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
