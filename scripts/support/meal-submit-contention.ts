/**
 * Shared harness for the simultaneous meal-bearing registration submission checks (#920): the benchmark
 * (`scripts/benchmark-meal-submit-contention.ts`) and the pass/fail check (`scripts/verify-meal-submit-contention.ts`).
 *
 * Every submission goes through the real public path, `submitPublicRegistration`, with its production attempt count
 * (`submitAttempts`) and no extra retry wrapper. The harness only observes: it wraps the singleton Prisma client's
 * `$transaction` to count how many attempts each submission needed and what the failed attempts failed with.
 *
 * Uses fictitious rows it creates and removes itself. Import this before anything that imports `@/lib/prisma`.
 */
import { loadEnvConfig } from "@next/env";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { PrismaClient, RegistrationFormStatus } from "@prisma/client";
import { assertLocalDatabase } from "./local-only-guard";
import { fillBlankSyntheticEnv } from "./synthetic-env";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run this verification");
fillBlankSyntheticEnv("SECRET_ENCRYPTION_KEY", "meal-submit-contention-synthetic-key-not-a-secret");

type AttemptLog = { attempts: number; failures: string[] };
const attemptLog = new AsyncLocalStorage<AttemptLog>();

// The app's singleton client, with `$transaction` observed. Installed before the app first asks for it.
const observed = new PrismaClient();
const originalTransaction = observed.$transaction.bind(observed) as (...args: unknown[]) => Promise<unknown>;
(observed as unknown as { $transaction: unknown }).$transaction = async (...args: unknown[]) => {
  // Only the submission's own SERIALIZABLE transaction is an "attempt" (other work after commit uses its own transactions).
  const options = args[1] as { isolationLevel?: string } | undefined;
  const log = options?.isolationLevel === "Serializable" ? attemptLog.getStore() : undefined;
  if (log) log.attempts += 1;
  try {
    return await originalTransaction(...args);
  } catch (error) {
    if (log) log.failures.push(error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 400) : String(error));
    throw error;
  }
};
(globalThis as unknown as { prisma?: PrismaClient }).prisma = observed;

export const prisma = observed;

const before = new Date("2027-06-01T12:00:00Z");

export type ContentionOutcome = { ok: boolean; attempts: number; failures: string[]; error?: string };
export type ContentionRound = { submissions: number; firstTryFailures: number; exhausted: number; attempts: number; outcomes: ContentionOutcome[] };

export async function createContentionHarness() {
  // Dynamic imports so the observed client is installed first.
  const { applyCampMeetingMealPreset } = await import("@/modules/meals/config-repository");
  const { registrationFormDefinitionSchema } = await import("@/modules/forms/definition");
  const { submitPublicRegistration } = await import("@/modules/forms/public-repository");
  type PublicRegistrationInput = import("@/modules/forms/public-domain").PublicRegistrationInput;
  const { removeEventOwnedRows } = await import("@/modules/events/deletion-repository");

  const P = `mct920_${randomUUID().slice(0, 8)}`;
  const userId = `${P}_user`;
  const eventId = `${P}_ev`;
  const slug = `${eventId}-slug`;
  const formSlug = `${P}-form`;
  const versionId = `${P}_form_v1`;
  const surname = `Contend${P}`;
  let counter = 0;

  const field = (key: string, label: string, type: string, scope: string, required: boolean, priceCents?: number) => ({
    id: `${P}_${key}_${scope}`, key, label, helpText: "", type, scope, required, options: [], ...(priceCents ? { priceCents } : {}),
  });
  const definition = registrationFormDefinitionSchema.parse({
    title: "Meal contention",
    description: "Temporary fictitious form used only by the meal submission contention check.",
    confirmationMessage: "Received.",
    attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 8, attendeeLabel: "Guest", addButtonLabel: "Add another guest" },
    sections: [
      { id: `${P}_contact`, title: "Contact", description: "", fields: [
        field("primary_contact_first_name", "First name", "TEXT", "REGISTRATION", true),
        field("primary_contact_last_name", "Last name", "TEXT", "REGISTRATION", true),
        field("email", "Email", "EMAIL", "REGISTRATION", true),
      ] },
      { id: `${P}_guests`, title: "Guests", description: "", fields: [
        field("first_name", "First name", "TEXT", "ATTENDEE", true),
        field("last_name", "Last name", "TEXT", "ATTENDEE", true),
      ] },
      { id: `${P}_meals`, title: "Meal tickets", description: "", fields: [
        field("breakfast_adult_qty", "Adult breakfast tickets", "NUMBER", "REGISTRATION", false, 700),
        field("supper_adult_qty", "Adult supper tickets", "NUMBER", "REGISTRATION", false, 800),
        field("supper_child_qty", "Child supper tickets", "NUMBER", "REGISTRATION", false, 600),
      ] },
    ],
  });

  async function cleanup() {
    const events = (await prisma.event.findMany({ where: { id: { startsWith: `${P}_` } }, select: { id: true } })).map((row) => row.id);
    for (const id of events) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('imsda.event_deletion', 'on', true)`;
        await removeEventOwnedRows(tx, id);
      }, { timeout: 120_000 });
    }
    const registrationIds = (await prisma.registration.findMany({ where: { eventId: { in: events } }, select: { id: true } })).map((row) => row.id);
    await prisma.messageOutbox.deleteMany({ where: { registrationId: { in: registrationIds } } });
    await prisma.event.deleteMany({ where: { id: { in: events } } });
    await prisma.person.deleteMany({ where: { OR: [{ lastName: surname }, { normalizedEmail: { startsWith: `${P}.` } }] } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: userId }, { eventId: { in: events } }] } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }

  async function setup(options: { capacity?: { mealType: "SUPPER"; capacity: number } } = {}) {
    await cleanup();
    await prisma.user.create({ data: { id: userId, email: `${P}@meals.example.test`, displayName: "Contention verifier" } });
    await prisma.event.create({
      data: {
        id: eventId, slug, name: `Meal contention ${P}`, startsAt: new Date("2027-06-15T15:00:00Z"), endsAt: new Date("2027-06-19T15:00:00Z"),
        timezone: "America/Chicago", registrationClosesOn: "2027-06-14", attendeeEditPolicy: "TIERED", isPublished: true,
      },
    });
    await applyCampMeetingMealPreset(eventId, userId);
    if (options.capacity) {
      await prisma.eventMealService.updateMany({ where: { eventId, mealType: options.capacity.mealType }, data: { capacity: options.capacity.capacity } });
    }
    await prisma.registrationForm.create({
      data: {
        id: `${P}_form`, eventId, createdByUserId: userId, name: definition.title, slug: formSlug, status: RegistrationFormStatus.PUBLISHED,
        versions: { create: { id: versionId, createdByUserId: userId, versionNumber: 1, status: RegistrationFormStatus.PUBLISHED, publishedAt: new Date(), definition } },
      },
    });
  }

  /** Submits `count` registrations at once through the production path, each ordering the given answers. */
  async function submitSimultaneously(count: number, meals: Record<string, number> = { supper_adult_qty: 2 }): Promise<ContentionRound> {
    const inputs = Array.from({ length: count }, () => {
      counter += 1;
      return {
        versionId, idempotencyKey: randomUUID(),
        responses: { primary_contact_first_name: "Mea", primary_contact_last_name: "Holder", email: `${P}.s${counter}@meals.example.test`, ...meals },
        attendees: [{ clientId: "p0", responses: { first_name: "Guest", last_name: surname } }],
        website: "",
      } as PublicRegistrationInput;
    });
    const outcomes = await Promise.all(inputs.map((input) => attemptLog.run({ attempts: 0, failures: [] }, async (): Promise<ContentionOutcome> => {
      const log = attemptLog.getStore()!;
      try {
        await submitPublicRegistration(slug, formSlug, input, before);
        return { ok: true, attempts: log.attempts, failures: log.failures };
      } catch (error) {
        return { ok: false, attempts: log.attempts, failures: log.failures, error: error instanceof Error ? error.message : String(error) };
      }
    })));
    return {
      submissions: count,
      firstTryFailures: outcomes.filter((outcome) => outcome.failures.length > 0).length,
      exhausted: outcomes.filter((outcome) => !outcome.ok).length,
      attempts: outcomes.reduce((sum, outcome) => sum + outcome.attempts, 0),
      outcomes,
    };
  }

  /**
   * The meal layer alone: registrations that already exist each sync the same meal tickets in their own SERIALIZABLE
   * transaction, retried like the public path (4 attempts, same pause). Isolates what `syncFormMealSelections` itself contributes.
   */
  async function syncMealsSimultaneously(count: number): Promise<ContentionRound> {
    const { syncFormMealSelections } = await import("@/modules/meals/selection-repository");
    const { isSerializationFailure, pauseBeforeRetry } = await import("@/lib/prisma-errors");
    const registrations = await Promise.all(Array.from({ length: count }, async () => {
      counter += 1;
      const n = counter;
      const person = await prisma.person.create({ data: { firstName: "Alder", lastName: surname, normalizedEmail: `${P}.m${n}@meals.example.test` } });
      return prisma.registration.create({
        data: { eventId, accountHolderPersonId: person.id, confirmationCode: `MCT-${P.slice(-6).toUpperCase()}${n}`, status: "CONFIRMED", totalAmount: 0, submittedAt: before, contactSnapshot: { firstName: "Alder", lastName: surname } },
      });
    }));
    const outcomes = await Promise.all(registrations.map((registration) => attemptLog.run({ attempts: 0, failures: [] }, async (): Promise<ContentionOutcome> => {
      const log = attemptLog.getStore()!;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await prisma.$transaction((tx) => syncFormMealSelections(tx, {
            eventId, registrationId: registration.id, formVersionId: versionId, responses: { supper_adult_qty: 2 },
            lineItems: [{ key: "supper_adult_qty", amountCents: 1600 }], previousResponses: null,
          }), { isolationLevel: "Serializable" });
          return { ok: true, attempts: log.attempts, failures: log.failures };
        } catch (error) {
          if (!isSerializationFailure(error)) return { ok: false, attempts: log.attempts, failures: log.failures, error: String(error) };
          if (attempt < 3) await pauseBeforeRetry(attempt);
        }
      }
      return { ok: false, attempts: log.attempts, failures: log.failures, error: "exhausted" };
    })));
    return {
      submissions: count,
      firstTryFailures: outcomes.filter((outcome) => outcome.failures.length > 0).length,
      exhausted: outcomes.filter((outcome) => !outcome.ok).length,
      attempts: outcomes.reduce((sum, outcome) => sum + outcome.attempts, 0),
      outcomes,
    };
  }

  return { P, eventId, userId, setup, cleanup, submitSimultaneously, syncMealsSimultaneously, slug, formSlug };
}

/**
 * Runs `work` while sampling pg_locks every few milliseconds. Returns the most SIReadLock predicate locks seen per
 * relation (these are what SERIALIZABLE transactions read; a write into a locked range makes a read/write dependency),
 * the most ungranted lock requests seen at once (queued waiters), and how many distinct sampled instants had waiters.
 */
export async function sampleLocks<T>(work: () => Promise<T>) {
  const sampler = new PrismaClient();
  const maxSiRead = new Map<string, number>();
  let maxWaiting = 0;
  let waitingSamples = 0;
  let running = true;
  const loop = (async () => {
    while (running) {
      const rows = await sampler.$queryRaw<Array<{ relname: string | null; locktype: string; count: bigint }>>`
        SELECT c.relname, l.locktype, count(*) AS count FROM pg_locks l LEFT JOIN pg_class c ON c.oid = l.relation
        WHERE l.mode = 'SIReadLock' AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
        GROUP BY 1, 2`;
      for (const row of rows) {
        const key = `${row.relname ?? "?"} (${row.locktype})`;
        maxSiRead.set(key, Math.max(maxSiRead.get(key) ?? 0, Number(row.count)));
      }
      const [waiting] = await sampler.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM pg_locks WHERE NOT granted AND locktype IN ('relation', 'advisory', 'transactionid', 'tuple')`;
      const n = Number(waiting!.count);
      maxWaiting = Math.max(maxWaiting, n);
      if (n > 0) waitingSamples += 1;
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
  })();
  try {
    const result = await work();
    return { result, maxSiRead, maxWaiting, waitingSamples };
  } finally {
    running = false;
    await loop;
    await sampler.$disconnect();
  }
}
