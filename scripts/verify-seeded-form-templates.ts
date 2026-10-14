/**
 * Proves the seeded form template guarantees (#153) against a real PostgreSQL
 * database. The Women's Retreat, Camp Meeting and Spring Camporee forms are
 * seeded data synced by `npm run form-templates:sync`. The hard promise:
 * syncing, re-syncing and shipping a newer template version never changes an
 * existing event, registration form or published form version.
 *
 * Existing events and forms (the seeded demo events plus ones this script
 * creates from each seeded template before the first sync) are snapshotted
 * whole, then the sync runs: first creation, a rerun, concurrent runs, a
 * version bump, a rerun at the old code version. After each step every
 * snapshot must be byte-identical. Also proves that the synced rows equal the
 * bundled seeds, that a new form is created from the newest synced version
 * (and records it), and that an older form keeps its own definition.
 * Uses fictitious users and data it creates and removes itself.
 *
 *   npm run test:seeded-form-templates
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { createRegistrationFormFromTemplateInTransaction, listFormTemplates } from "../modules/forms/repository";
import { canonicalJson } from "../modules/event-clones/domain";
import { bundledSeededFormTemplates, type SeededFormTemplateSeed } from "../modules/forms/seeded-template-data";
import { syncSeededFormTemplates } from "../modules/forms/seeded-templates";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const P = "seedfm";
const adminId = `${P}_admin`;
const keys = bundledSeededFormTemplates.map((seed) => seed.key);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { actorUserId: adminId } });
  await prisma.event.deleteMany({ where: { slug: { startsWith: `${P}-` } } });
  await prisma.user.deleteMany({ where: { id: adminId } });
}

/** Every row of every table an event, form or published form version lives in, whole, as JSON. */
async function snapshot() {
  const tables = {
    events: await prisma.event.findMany({ orderBy: { id: "asc" } }),
    forms: await prisma.registrationForm.findMany({ orderBy: { id: "asc" } }),
    versions: await prisma.registrationFormVersion.findMany({ orderBy: { id: "asc" } }),
    eventTemplates: await prisma.eventTemplate.findMany({ orderBy: { id: "asc" } }),
    eventTemplateVersions: await prisma.eventTemplateVersion.findMany({ orderBy: { id: "asc" } }),
    applications: await prisma.eventTemplateApplication.findMany({ orderBy: { id: "asc" } }),
  };
  return { json: JSON.stringify(tables), counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])) };
}

async function createForms(eventId: string) {
  return prisma.$transaction(async (tx) => {
    const created: Record<string, string> = {};
    for (const key of keys) created[key] = (await createRegistrationFormFromTemplateInTransaction(tx, eventId, adminId, key)).id;
    return created;
  });
}

async function publishForm(formId: string) {
  await prisma.registrationFormVersion.updateMany({ where: { formId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
  await prisma.registrationForm.update({ where: { id: formId }, data: { status: "PUBLISHED" } });
}

async function storedDefinition(formId: string) {
  return canonicalJson((await prisma.registrationFormVersion.findFirstOrThrow({ where: { formId }, orderBy: { versionNumber: "desc" } })).definition);
}

async function run() {
  await prisma.user.create({ data: { id: adminId, email: `${P}-admin@example.test`, displayName: "Seeded Form Check Admin", globalRole: "SYSTEM_ADMIN" } });
  const event = await prisma.event.create({ data: { name: "Seedfm Existing 2026", slug: `${P}-existing-2026`, startsAt: new Date("2026-05-05T12:00:00Z"), endsAt: new Date("2026-05-07T12:00:00Z"), timezone: "America/Chicago" } });

  // Start from a database that has never run the sync: no seeded rows (a deploy before form-templates:sync).
  await prisma.seededFormTemplateVersion.deleteMany();
  await prisma.seededFormTemplate.deleteMany();

  // Existing history, created from the bundled seeds before any sync; one form is published.
  const before = await createForms(event.id);
  await publishForm(before.womens_retreat_export!);
  const beforeDefinitions = Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await storedDefinition(before[key]!)] as const)));
  const baseline = await snapshot();
  assert(baseline.counts.events! >= 1 && baseline.counts.versions! >= 3, "the baseline holds the existing events and form versions");
  const unchanged = async (step: string) => {
    const now = await snapshot();
    assert(now.json === baseline.json, `${step}: every existing event, form, published form version and event template row is byte-identical`);
  };

  // 1. The first sync creates the three rows at the bundled versions, with the bundled content.
  const first = await syncSeededFormTemplates(prisma);
  assert(first.created.length === 3 && first.updated.length === 0 && first.unchanged.length === 0 && first.ahead.length === 0, `first sync creates three rows (${JSON.stringify(first)})`);
  const rows = await prisma.seededFormTemplate.findMany({ include: { versions: true } });
  assert(rows.length === 3 && rows.every((row) => row.versions.length === 1), "one row and one immutable version row per template");
  for (const seed of bundledSeededFormTemplates) {
    const row = rows.find((entry) => entry.key === seed.key)!;
    assert(row.version === seed.version && canonicalJson(row.definition) === canonicalJson(seed.definition), `${seed.key}: the synced definition equals the bundled seed`);
    assert(row.name === seed.name && row.description === seed.description && row.audience === seed.audience, `${seed.key}: name, description and audience equal the bundled seed`);
  }
  await unchanged("after the first sync");
  console.log("ok  the first sync creates the three seeded templates from the bundled data and leaves existing events and form versions byte-identical");

  // 2. Forms created from the synced rows are stored exactly as the ones created before the sync.
  const afterSync = await createForms(event.id);
  for (const key of keys) {
    assert(await storedDefinition(afterSync[key]!) === beforeDefinitions[key], `${key}: a form created after the sync stores the same definition as one created before it`);
  }
  const createdAudit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: afterSync.camp_meeting_export!, action: "REGISTRATION_FORM_CREATED" } });
  assert((createdAudit.metadata as { templateKey?: string; templateVersion?: number }).templateVersion === 1, "the creation audit records the seeded template version");
  const listed = await listFormTemplates();
  for (const seed of bundledSeededFormTemplates) {
    const entry = listed.find((item) => item.key === seed.key)!;
    assert(entry.name === seed.name && entry.sectionCount === seed.definition.sections.length, `${seed.key}: the picker lists the seeded template`);
  }
  // Re-baseline: the forms just created are part of the existing history from here on.
  const rebaseline = await snapshot();
  Object.assign(baseline, rebaseline);
  console.log("ok  forms created from the synced rows store the same definition as before, and the picker lists the seeded templates");

  // 3. A rerun changes nothing; so do concurrent runs.
  const rerun = await syncSeededFormTemplates(prisma);
  assert(rerun.created.length === 0 && rerun.updated.length === 0 && rerun.unchanged.length === 3, "a rerun reports all three unchanged");
  const stamps = JSON.stringify(await prisma.seededFormTemplate.findMany({ orderBy: { key: "asc" } }));
  const racing = await Promise.all([syncSeededFormTemplates(prisma), syncSeededFormTemplates(prisma), syncSeededFormTemplates(prisma)]);
  assert(racing.every((result) => result.unchanged.length === 3), "concurrent reruns find everything current");
  assert(JSON.stringify(await prisma.seededFormTemplate.findMany({ orderBy: { key: "asc" } })) === stamps, "a rerun does not even touch the seeded rows");
  assert(await prisma.seededFormTemplateVersion.count() === 3, "a rerun adds no version row");
  await unchanged("after reruns");
  await prisma.seededFormTemplateVersion.deleteMany();
  await prisma.seededFormTemplate.deleteMany();
  const parallelFirst = await Promise.all([syncSeededFormTemplates(prisma), syncSeededFormTemplates(prisma)]);
  assert(parallelFirst.flatMap((result) => result.created).length === 3 && await prisma.seededFormTemplate.count() === 3 && await prisma.seededFormTemplateVersion.count() === 3,
    "two syncs racing on an empty table create each template exactly once");
  await unchanged("after racing first syncs");
  console.log("ok  reruns and concurrent runs change nothing, and racing first syncs create each template exactly once");

  // 4. A newer version reaches only forms created after it.
  const revisedSeeds: SeededFormTemplateSeed[] = bundledSeededFormTemplates.map((seed) => {
    if (seed.key !== "womens_retreat_export") return seed;
    const definition = structuredClone(seed.definition);
    definition.title = "Seedfm revised retreat registration";
    definition.sections[0]!.fields[0]!.label = "Seedfm revised first question";
    return { ...seed, version: seed.version + 1, definition };
  });
  const bump = await syncSeededFormTemplates(prisma, revisedSeeds);
  assert(bump.updated.length === 1 && bump.updated[0]!.key === "womens_retreat_export" && bump.unchanged.length === 2, `the bump updates only the revised template (${JSON.stringify(bump)})`);
  const wr = await prisma.seededFormTemplate.findUniqueOrThrow({ where: { key: "womens_retreat_export" }, include: { versions: { orderBy: { version: "asc" } } } });
  assert(wr.version === 2 && wr.versions.length === 2, "the revised template is at version 2 with both versions kept");
  assert(canonicalJson(wr.versions[0]!.definition) === canonicalJson(bundledSeededFormTemplates.find((seed) => seed.key === "womens_retreat_export")!.definition), "version 1 is kept as it was");
  await unchanged("after shipping a newer template version");
  for (const key of keys) {
    assert(await storedDefinition(before[key]!) === beforeDefinitions[key], `${key}: the form created before the bump keeps its original definition`);
  }
  const published = await prisma.registrationFormVersion.findFirstOrThrow({ where: { formId: before.womens_retreat_export!, status: "PUBLISHED" } });
  assert(canonicalJson(published.definition) === beforeDefinitions.womens_retreat_export, "the published Women's Retreat form version is untouched by the newer template");
  const fresh = await prisma.$transaction((tx) => createRegistrationFormFromTemplateInTransaction(tx, event.id, adminId, "womens_retreat_export"));
  const freshVersion = await prisma.registrationFormVersion.findFirstOrThrow({ where: { formId: fresh.id } });
  assert((freshVersion.definition as { title?: string }).title === "Seedfm revised retreat registration", "a form created after the bump starts from version 2");
  const freshAudit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: fresh.id, action: "REGISTRATION_FORM_CREATED" } });
  assert((freshAudit.metadata as { templateVersion?: number }).templateVersion === 2, "its creation audit records template version 2");
  console.log("ok  a newer seeded version reaches only forms created after it; earlier forms and the published version keep their definition");

  // 5. Code at an older version never rolls the data back.
  const ahead = await syncSeededFormTemplates(prisma);
  assert(ahead.ahead.length === 1 && ahead.ahead[0]!.stored === 2 && ahead.ahead[0]!.code === 1, "a sync from older code reports the template as ahead");
  assert((await prisma.seededFormTemplate.findUniqueOrThrow({ where: { key: "womens_retreat_export" } })).version === 2, "and leaves it at version 2");
  console.log("ok  a sync from older code reports a newer stored version and leaves it alone");

  // 6. A seed the form builder would refuse is refused before anything is written.
  const broken = structuredClone(bundledSeededFormTemplates[0]!);
  broken.version = 99;
  (broken.definition.sections as unknown as { fields: unknown }[])[0]!.fields = "not a list";
  let refused = false;
  try {
    await syncSeededFormTemplates(prisma, [broken]);
  } catch {
    refused = true;
  }
  assert(refused && (await prisma.seededFormTemplate.findUniqueOrThrow({ where: { key: broken.key } })).version === 2, "an invalid seed is refused and changes nothing");
  console.log("ok  an invalid seed is refused before anything is written");
}

async function main() {
  await cleanup();
  try {
    await run();
  } finally {
    await cleanup();
    // Leave the table in sync with this code, as a deploy would.
    await prisma.seededFormTemplateVersion.deleteMany();
    await prisma.seededFormTemplate.deleteMany();
    await syncSeededFormTemplates(prisma);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
