/**
 * Proves typed-name signature evidence (#1265) against a real PostgreSQL database, where the unit tests' stand-ins can't:
 *
 * - a public registration submission with a signature field records one evidence row, in the same transaction as the
 *   registration: the typed name, the exact statement, its hash, the moment, the trusted client IP (null when none is
 *   configured or resolvable) and a user-agent hash, never the raw agent;
 * - an attendee-level signature records one row per signing attendee, and an optional blank signature records nothing;
 * - a retried submission creates no second row;
 * - the database enforces the shape: the evidence is append-only (no update, delete or bulk delete), and a row whose
 *   registration, attendee or form version belongs to another event is refused;
 * - an event that holds a signature cannot be deleted.
 *
 * Uses fictitious rows it creates and removes itself (removal of evidence needs the superuser bypass the local and CI
 * databases allow, because the product itself can never delete it).
 *
 *   npm run test:signatures
 */
import { loadEnvConfig } from "@next/env";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient, RegistrationFormStatus } from "@prisma/client";
import { assertLocalDatabase } from "./support/local-only-guard";
import { fillBlankSyntheticEnv } from "./support/synthetic-env";
import { registrationFormDefinitionSchema } from "../modules/forms/definition";
import { submitPublicRegistration } from "../modules/forms/public-repository";
import { EventDeletionError, deleteEvent, getEventDeletionPreview } from "../modules/events/deletion-repository";
import { getRateLimitConfiguration, trustedClientIpAddress } from "../modules/rate-limit/domain";
import { hashUserAgent } from "../modules/access/tokens";

loadEnvConfig(process.cwd());
// Local-only, before any Prisma client or connection exists.
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "verify-signatures-synthetic-key-not-a-secret");

const prisma = new PrismaClient();
const P = `sig1265_${randomUUID().slice(0, 8)}`;
const surname = `Sample${P}`;
const ids = {
  staff: `${P}_staff`,
  eventA: `${P}_ev_a`,
  eventB: `${P}_ev_b`,
  form: `${P}_form`,
  formVersion: `${P}_form_v1`,
  formB: `${P}_form_b`,
  formVersionB: `${P}_form_b_v1`,
};
const formSlug = `${P}-form`;
const slugOf = (eventId: string) => `${eventId.replace(/_/g, "-")}-slug`;

// Obviously synthetic statement; no legal text.
const STATEMENT = "Synthetic statement signed in the signature check.\nLine two with “quotes” and   inner  spacing.";
const ATTENDEE_STATEMENT = "Synthetic attendee statement signed in the signature check.";
const USER_AGENT = "Synthetic Agent/1.0";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function rejects(promise: Promise<unknown>, pattern?: RegExp) {
  return promise.then(() => false, (error: unknown) => (pattern ? pattern.test(String(error instanceof Error ? error.message : error)) : true));
}

async function cleanup() {
  const eventIds = [ids.eventA, ids.eventB];
  // The product can never delete evidence; the superuser bypass lets this check clear its own rows.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.$executeRaw`DELETE FROM "SignatureEvidence" WHERE "eventId" IN (${Prisma.join(eventIds)})`;
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

function formDefinition(prefix: string) {
  return registrationFormDefinitionSchema.parse({
    title: "Signature verification",
    description: "Temporary fictitious form used only by the signature check.",
    confirmationMessage: "Received.",
    attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 8, attendeeLabel: "Attendee", addButtonLabel: "Add another attendee" },
    sections: [
      {
        id: `${prefix}_contact`, title: "Contact", description: "", fields: [
          { id: `${prefix}_f_first`, key: "primary_contact_first_name", label: "First name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
          { id: `${prefix}_f_last`, key: "primary_contact_last_name", label: "Last name", helpText: "", type: "TEXT", scope: "REGISTRATION", required: true, options: [] },
          { id: `${prefix}_f_email`, key: "email", label: "Email", helpText: "", type: "EMAIL", scope: "REGISTRATION", required: true, options: [] },
          { id: `${prefix}_f_reg_sig`, key: "reg_sig", label: "Registrant signature", helpText: "", type: "SIGNATURE", scope: "REGISTRATION", required: true, options: [], signature: { text: STATEMENT } },
          { id: `${prefix}_f_opt_sig`, key: "opt_sig", label: "Optional signature", helpText: "", type: "SIGNATURE", scope: "REGISTRATION", required: false, options: [], signature: { text: "Synthetic optional statement." } },
        ],
      },
      {
        id: `${prefix}_attendees`, title: "Attendees", description: "", fields: [
          { id: `${prefix}_a_first`, key: "first_name", label: "First name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
          { id: `${prefix}_a_last`, key: "last_name", label: "Last name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
          { id: `${prefix}_a_sig`, key: "att_sig", label: "Attendee signature", helpText: "", type: "SIGNATURE", scope: "ATTENDEE", required: false, options: [], signature: { text: ATTENDEE_STATEMENT } },
        ],
      },
    ],
  });
}

async function main() {
  await cleanup();
  await prisma.user.create({ data: { id: ids.staff, email: `${P}-staff@example.test`, displayName: "Signature Check Staff", globalRole: "SYSTEM_ADMIN" } });
  const year = new Date().getUTCFullYear() + 1;
  const startsAt = new Date(Date.UTC(year, 2, 5, 15, 0, 0));
  const endsAt = new Date(Date.UTC(year, 2, 7, 15, 0, 0));
  for (const id of [ids.eventA, ids.eventB]) {
    await prisma.event.create({ data: { id, slug: slugOf(id), name: `Signature Check ${id}`, startsAt, endsAt, timezone: "America/Chicago", isPublished: true, audience: "GENERAL", billingMode: "ATTENDEE_PAY" } });
  }
  for (const [eventId, formId, versionId, slug] of [[ids.eventA, ids.form, ids.formVersion, formSlug], [ids.eventB, ids.formB, ids.formVersionB, `${formSlug}-b`]] as const) {
    const definition = formDefinition(eventId === ids.eventA ? `${P}_a` : `${P}_b`);
    await prisma.registrationForm.create({
      data: {
        id: formId, eventId, createdByUserId: ids.staff, name: definition.title, slug, status: RegistrationFormStatus.PUBLISHED,
        versions: { create: { id: versionId, createdByUserId: ids.staff, versionNumber: 1, status: RegistrationFormStatus.PUBLISHED, publishedAt: new Date(), definition } },
      },
    });
  }

  let submissions = 0;
  function submission(registration: Record<string, unknown>, attendees: Array<{ clientId: string; first: string; sig?: string }>) {
    submissions += 1;
    return {
      versionId: ids.formVersion,
      idempotencyKey: randomUUID(),
      responses: {
        primary_contact_first_name: "Ann",
        primary_contact_last_name: surname,
        email: `${P}-registrant-${submissions}@example.test`,
        ...registration,
      },
      attendees: attendees.map((attendee) => ({
        clientId: attendee.clientId,
        responses: { first_name: attendee.first, last_name: surname, ...(attendee.sig !== undefined ? { att_sig: attendee.sig } : {}) },
      })),
      website: "" as const,
    };
  }
  const submit = (input: ReturnType<typeof submission>, context: { userAgent: string | null; ipAddress?: string | null } = { userAgent: USER_AGENT }) =>
    submitPublicRegistration(slugOf(ids.eventA), formSlug, input, undefined, undefined, context);
  const registrationFor = (confirmationCode: string) => prisma.registration.findFirstOrThrow({
    where: { confirmationCode, eventId: ids.eventA },
    select: { id: true, attendees: { select: { id: true, profileSnapshot: true } } },
  });

  // ---- The IP comes only from a configured trusted proxy ----
  const forwarded = new Request("https://events.example.test/api", { headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.9" } });
  const trustedIp = trustedClientIpAddress(forwarded, getRateLimitConfiguration({ NODE_ENV: "test", RATE_LIMIT_TRUSTED_PROXY_HOPS: "1" }));
  assert(trustedIp === "203.0.113.9", "a configured trusted proxy yields the client address");
  assert(trustedClientIpAddress(forwarded, getRateLimitConfiguration({ NODE_ENV: "test" })) === null, "no trusted proxy configured means no address");

  // ---- A real submission with a trusted IP ----
  const first = submission({ reg_sig: "  Ann Sample  ", opt_sig: "" }, [
    { clientId: "a1", first: "Ann", sig: "Ann Sample" },
    { clientId: "a2", first: "Bob" },
  ]);
  const before = Date.now();
  const confirmation = await submit(first, { userAgent: USER_AGENT, ipAddress: trustedIp });
  const registration = await registrationFor(confirmation.confirmationCode);
  const rows = await prisma.signatureEvidence.findMany({ where: { registrationId: registration.id }, orderBy: { fieldKey: "asc" } });
  assert(rows.length === 2, `two signatures recorded: the registrant's and one attendee's (got ${rows.length})`);
  const registrant = rows.find((row) => row.fieldKey === "reg_sig");
  assert(registrant, "the registrant signature is recorded");
  assert(registrant.signerName === "Ann Sample", "with the trimmed typed name");
  assert(registrant.signedText === STATEMENT && registrant.contentHash === sha256(STATEMENT), "the exact statement and its hash");
  assert(registrant.eventId === ids.eventA && registrant.formVersionId === ids.formVersion && registrant.registrationAttendeeId === null, "tied to the event, form version and registration");
  assert(registrant.fieldLabel === "Registrant signature" && registrant.fieldId === `${P}_a_f_reg_sig`, "naming the field");
  assert(registrant.ipAddress === "203.0.113.9", "the trusted IP");
  assert(registrant.userAgentHash === hashUserAgent(USER_AGENT) && !JSON.stringify(rows).includes(USER_AGENT), "and only a hash of the user agent");
  assert(registrant.signedAt.getTime() >= before - 60_000 && registrant.signedAt.getTime() <= Date.now() + 1_000, "stamped with the moment of submission");
  const attendeeRow = rows.find((row) => row.fieldKey === "att_sig");
  const ann = registration.attendees.find((attendee) => (attendee.profileSnapshot as { firstName?: string }).firstName === "Ann");
  assert(attendeeRow && ann && attendeeRow.registrationAttendeeId === ann.id && attendeeRow.signedText === ATTENDEE_STATEMENT, "the attendee signature names that attendee");
  assert(!rows.some((row) => row.fieldKey === "opt_sig"), "an optional blank signature records nothing");

  // ---- A retry creates no second row ----
  const replay = await submit(first, { userAgent: USER_AGENT, ipAddress: "203.0.113.77" });
  assert(replay.confirmationCode === confirmation.confirmationCode, "a retried submission is the same registration");
  const afterRetry = await prisma.signatureEvidence.findMany({ where: { registrationId: registration.id } });
  assert(afterRetry.length === 2 && afterRetry.every((row) => row.ipAddress === "203.0.113.9"), "and records no second signature");

  // ---- No trusted IP: null ----
  const noIpConfirmation = await submit(submission({ reg_sig: "Cy Sample" }, [{ clientId: "b1", first: "Cy" }]), { userAgent: null });
  const noIpRegistration = await registrationFor(noIpConfirmation.confirmationCode);
  const noIpRows = await prisma.signatureEvidence.findMany({ where: { registrationId: noIpRegistration.id } });
  assert(noIpRows.length === 1 && noIpRows[0]!.ipAddress === null && noIpRows[0]!.userAgentHash === null, "with no trusted proxy the IP (and absent user agent) are null");

  // ---- Only a blank optional signature next to a required one records just the required one ----
  const blankConfirmation = await submit(submission({ reg_sig: "Di Sample", opt_sig: "   " }, [{ clientId: "c1", first: "Di", sig: "  " }]), { userAgent: USER_AGENT, ipAddress: trustedIp });
  const blankRegistration = await registrationFor(blankConfirmation.confirmationCode);
  const blankRows = await prisma.signatureEvidence.findMany({ where: { registrationId: blankRegistration.id } });
  assert(blankRows.length === 1 && blankRows[0]!.fieldKey === "reg_sig", "blank optional signatures (registration and attendee) record nothing");

  // ---- The database enforces the shape ----
  assert(await rejects(prisma.signatureEvidence.update({ where: { id: registrant.id }, data: { signerName: "Rewritten" } }), /append-only/), "evidence cannot be updated");
  assert(await rejects(prisma.signatureEvidence.update({ where: { id: registrant.id }, data: { ipAddress: null } }), /append-only/), "the IP cannot be wiped");
  assert(await rejects(prisma.signatureEvidence.delete({ where: { id: registrant.id } }), /append-only/), "evidence cannot be deleted");
  assert(await rejects(prisma.signatureEvidence.deleteMany({ where: { eventId: ids.eventA } }), /append-only/), "nor deleted in bulk");
  assert(await rejects(prisma.$executeRaw`TRUNCATE TABLE "SignatureEvidence"`, /append-only/), "nor truncated");
  assert(await prisma.signatureEvidence.count({ where: { registrationId: registration.id } }) === 2, "and nothing was removed");

  const base = {
    eventId: ids.eventA, registrationId: registration.id, registrationAttendeeId: null as string | null, formVersionId: ids.formVersion, fieldId: "f_x", fieldKey: "reg_sig",
    fieldLabel: "Synthetic", signerName: "Ann Sample", signedText: STATEMENT, contentHash: sha256(STATEMENT), signedAt: new Date(),
  };
  const raw = (overrides: Record<string, unknown>) => prisma.signatureEvidence.create({ data: { ...base, idempotencyKey: `${P}_raw_${randomUUID()}`, ...overrides } });
  assert(await rejects(raw({ eventId: ids.eventB }), /another event/), "a registration of another event is refused");
  assert(await rejects(raw({ registrationAttendeeId: `${P}_no_such_attendee` }), /not on this registration/), "an attendee that is not on the registration is refused");
  const otherRegistration = await registrationFor(noIpConfirmation.confirmationCode);
  assert(await rejects(raw({ registrationAttendeeId: ann!.id, registrationId: otherRegistration.id }), /not on this registration/), "another registration's attendee is refused");
  assert(await rejects(raw({ formVersionId: ids.formVersionB }), /another event/), "a form version of another event is refused");
  assert(await rejects(raw({ idempotencyKey: registrant.idempotencyKey }), undefined), "a duplicate idempotency key is refused");
  const good = await raw({});
  assert(good.eventId === ids.eventA, "while a well-formed row is accepted");

  // ---- Event deletion refuses while a signature exists ----
  const actor = { userId: ids.staff, globalRole: "SYSTEM_ADMIN" as const };
  const preview = await getEventDeletionPreview(ids.eventA, actor);
  const signatureCount = await prisma.signatureEvidence.count({ where: { eventId: ids.eventA } });
  assert(preview && preview.counts.signatureEvidence === signatureCount, "the deletion preview counts the signatures");
  assert(preview && !preview.decision.allowed && /signature record/.test(preview.decision.reason), "and refuses, naming them");
  const deletion = await deleteEvent({ eventId: ids.eventA, actor, confirmName: `Signature Check ${ids.eventA}` }).then(() => null, (error: unknown) => error);
  assert(deletion instanceof EventDeletionError && deletion.code === "EVENT_DELETE_FORBIDDEN", "deleting the event is refused");
  assert(await prisma.event.count({ where: { id: ids.eventA } }) === 1 && await prisma.signatureEvidence.count({ where: { eventId: ids.eventA } }) === signatureCount, "and nothing was removed");

  // ---- Nothing that feeds an export, a log or a message holds the statement or the address ----
  const registrationIds = (await prisma.registration.findMany({ where: { eventId: ids.eventA }, select: { id: true } })).map((row) => row.id);
  const surfaces = JSON.stringify({
    registrations: await prisma.registration.findMany({ where: { id: { in: registrationIds } } }),
    audit: await prisma.auditLog.findMany({ where: { eventId: ids.eventA } }),
    messages: await prisma.messageOutbox.findMany({ where: { registrationId: { in: registrationIds } } }),
  });
  for (const secret of [STATEMENT, ATTENDEE_STATEMENT, "203.0.113.9"]) {
    assert(!surfaces.includes(JSON.stringify(secret).slice(1, -1)), "the statement and the IP appear in no registration row, audit row or message");
  }

  console.log("Signature evidence verification passed.");
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
