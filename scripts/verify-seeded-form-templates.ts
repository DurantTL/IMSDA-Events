/**
 * Proves the form template guarantees (#153, #1064) against a real PostgreSQL
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
 * Destructive: it deletes every row in both seeded template tables. It refuses
 * to run unless NODE_ENV is not production and DATABASE_URL points at this
 * machine (a local database or the CI service container), using the same
 * guard as prisma/seed.ts.
 *
 *   npm run test:seeded-form-templates
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { createRegistrationForm, createRegistrationFormFromTemplateInTransaction, listFormTemplates } from "../modules/forms/repository";
import { getFormTemplate } from "../modules/forms/definition";
import { copyFormTemplate, listFormTemplateLibrary, saveFormTemplateVersion } from "../modules/forms/form-template-library";
import { codeFormTemplates, type CodeFormTemplate } from "../modules/forms/form-template-library-domain";
import { canonicalJson } from "../modules/event-clones/domain";
import { bundledSeededFormTemplates, type SeededFormTemplateSeed } from "../modules/forms/seeded-template-data";
import { syncSeededFormTemplates } from "../modules/forms/seeded-templates";
import { assertLocalDatabase } from "./support/local-only-guard";

loadEnvConfig(process.cwd());
assertLocalDatabase(process.env, "run the seeded form template check (it deletes all seeded template rows)");

const prisma = new PrismaClient();
const P = "seedfm";
const adminId = `${P}_admin`;
const keys = bundledSeededFormTemplates.map((seed) => seed.key);
/** Every template the code defines (#1064): the seeded ones and the rest of `formTemplates`. */
const total = codeFormTemplates().length;

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
  assert(first.created.length === total && first.updated.length === 0 && first.unchanged.length === 0 && first.ahead.length === 0 && first.appOwned.length === 0, `first sync creates a row for every code template (${JSON.stringify(first)})`);
  const rows = await prisma.seededFormTemplate.findMany({ include: { versions: true } });
  assert(rows.length === total && rows.every((row) => row.versions.length === 1 && row.latestSource === "CODE" && row.versions[0]!.source === "CODE"), "one row and one immutable CODE version row per template");
  for (const seed of bundledSeededFormTemplates) {
    const row = rows.find((entry) => entry.key === seed.key)!;
    assert(row.version === seed.version && canonicalJson(row.definition) === canonicalJson(seed.definition), `${seed.key}: the synced definition equals the bundled seed`);
    assert(row.name === seed.name && row.description === seed.description && row.audience === seed.audience, `${seed.key}: name, description and audience equal the bundled seed`);
  }
  await unchanged("after the first sync");
  console.log("ok  the first sync creates every code template from the code's data and leaves existing events and form versions byte-identical");

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
  assert(rerun.created.length === 0 && rerun.updated.length === 0 && rerun.unchanged.length === total, "a rerun reports every template unchanged");
  const stamps = JSON.stringify(await prisma.seededFormTemplate.findMany({ orderBy: { key: "asc" } }));
  const racing = await Promise.all([syncSeededFormTemplates(prisma), syncSeededFormTemplates(prisma), syncSeededFormTemplates(prisma)]);
  assert(racing.every((result) => result.unchanged.length === total), "concurrent reruns find everything current");
  assert(JSON.stringify(await prisma.seededFormTemplate.findMany({ orderBy: { key: "asc" } })) === stamps, "a rerun does not even touch the seeded rows");
  assert(await prisma.seededFormTemplateVersion.count() === total, "a rerun adds no version row");
  await unchanged("after reruns");
  await prisma.seededFormTemplateVersion.deleteMany();
  await prisma.seededFormTemplate.deleteMany();
  const parallelFirst = await Promise.all([syncSeededFormTemplates(prisma), syncSeededFormTemplates(prisma)]);
  assert(parallelFirst.flatMap((result) => result.created).length === total && await prisma.seededFormTemplate.count() === total && await prisma.seededFormTemplateVersion.count() === total,
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

  // 7. A template edited in the app is never overwritten by sync (#1064). The forms made in step 4 are history from here on.
  Object.assign(baseline, await snapshot());
  const rsvpDefinition = structuredClone(getFormTemplate("simple_rsvp")!.definition);
  rsvpDefinition.title = "Seedfm app-edited RSVP";
  const save = (key: string, definition: typeof rsvpDefinition, expectedVersion: number) =>
    saveFormTemplateVersion(key, { expectedVersion, name: "Seedfm edited template", description: "Seedfm", audience: "Individual", definition }, adminId);
  const saved = await save("simple_rsvp", rsvpDefinition, 1);
  assert(saved.version === 2, "the first app save makes version 2");
  const rsvpRow = () => prisma.seededFormTemplate.findUniqueOrThrow({ where: { key: "simple_rsvp" }, include: { versions: { orderBy: { version: "asc" } } } });
  let edited = await rsvpRow();
  assert(edited.version === 2 && edited.latestSource === "APP" && edited.name === "Seedfm edited template", "the template moved to the app version");
  assert(edited.versions.map((row) => `${row.version}:${row.source}`).join() === "1:CODE,2:APP" && edited.versions[1]!.createdByUserId === adminId && edited.versions[0]!.createdByUserId === null, "both versions are kept, the app one with its author");
  assert((edited.versions[0]!.definition as { title?: string }).title === getFormTemplate("simple_rsvp")!.definition.title, "version 1 is kept as the code had it");
  const editedStamp = JSON.stringify(edited);
  const afterEdit = await syncSeededFormTemplates(prisma);
  assert(afterEdit.appOwned.some((item) => item.key === "simple_rsvp" && item.version === 2) && afterEdit.updated.length === 0 && afterEdit.created.length === 0, `sync reports the app-edited template and updates nothing (${JSON.stringify(afterEdit)})`);
  assert(JSON.stringify(await rsvpRow()) === editedStamp, "sync left the app-edited template byte-identical");
  // A much larger code version still does not win over an app edit. The seeded retreat is at CODE version 2 here (step 4).
  const retreatSeed = bundledSeededFormTemplates[0]!;
  assert(retreatSeed.key === "womens_retreat_export", "the first bundled seed is the Women's Retreat");
  await save("womens_retreat_export", { ...structuredClone(retreatSeed.definition), title: "Seedfm app-edited retreat" }, 2);
  const bigger: CodeFormTemplate = { ...retreatSeed, version: 9, definition: { ...structuredClone(retreatSeed.definition), title: "Seedfm code retreat 9" } };
  const biggerResult = await syncSeededFormTemplates(prisma, [bigger]);
  assert(biggerResult.appOwned.length === 1 && biggerResult.updated.length === 0, "a seed with a larger code version skips an app-owned latest version");
  const retreatRow = await prisma.seededFormTemplate.findUniqueOrThrow({ where: { key: "womens_retreat_export" } });
  assert(retreatRow.version === 3 && retreatRow.latestSource === "APP" && (retreatRow.definition as { title?: string }).title === "Seedfm app-edited retreat", "the app-edited retreat is untouched by the larger code version");
  await unchanged("after app edits and syncs");
  console.log("ok  sync never overwrites a template edited in the app, whatever version the code has, and existing events and form versions stay byte-identical");

  // 8. Two saves from the same version cannot both win, and none is lost.
  const racingSaves = await Promise.allSettled([
    save("simple_rsvp", { ...rsvpDefinition, title: "Seedfm race A" }, 2),
    save("simple_rsvp", { ...rsvpDefinition, title: "Seedfm race B" }, 2),
  ]);
  assert(racingSaves.filter((result) => result.status === "fulfilled").length === 1, "exactly one of two concurrent saves from the same version succeeds");
  const loser = racingSaves.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert((loser.reason as { code?: string }).code === "VERSION_CONFLICT", "the other is refused as a version conflict");
  edited = await rsvpRow();
  assert(edited.version === 3 && edited.versions.map((row) => row.version).join() === "1,2,3", "no version was lost or duplicated");
  assert(canonicalJson(edited.versions[2]!.definition) === canonicalJson(edited.definition), "the template row equals its latest version row");
  // An app save racing a sync that would update the same template: the lock serializes them, and neither overwrites the other.
  const registrationTemplate = getFormTemplate("retreat_registration")!;
  const changedSeed: CodeFormTemplate = { ...registrationTemplate, version: undefined, definition: { ...structuredClone(registrationTemplate.definition), title: "Seedfm code-changed registration" } };
  const registrationRow = await prisma.seededFormTemplate.findUniqueOrThrow({ where: { key: "retreat_registration" } });
  const raced = await Promise.allSettled([
    save("retreat_registration", { ...structuredClone(registrationTemplate.definition), title: "Seedfm app-edited registration" }, registrationRow.version),
    syncSeededFormTemplates(prisma, [changedSeed]),
  ]);
  assert(raced.every((result) => result.status === "fulfilled" || (result.reason as { code?: string }).code === "VERSION_CONFLICT"), "the only acceptable failure of the race is a version conflict");
  const racedRow = await prisma.seededFormTemplate.findUniqueOrThrow({ where: { key: "retreat_registration" }, include: { versions: { orderBy: { version: "asc" } } } });
  assert(racedRow.versions.map((row) => row.version).join() === Array.from({ length: racedRow.version }, (_, index) => index + 1).join(), "the versions are contiguous: none lost or duplicated");
  const latest = racedRow.versions[racedRow.versions.length - 1]!;
  assert(canonicalJson(latest.definition) === canonicalJson(racedRow.definition) && latest.source === racedRow.latestSource, "the row equals its latest version, source included");
  const racedTitle = (racedRow.definition as { title?: string }).title;
  assert(racedRow.latestSource === "APP" ? racedTitle === "Seedfm app-edited registration" : racedTitle === "Seedfm code-changed registration", "the latest definition is exactly one side of the race, never a mix");
  console.log("ok  concurrent saves lose no version, and an app save and a sync cannot overwrite each other");

  // 9. New forms use the latest version, an app-created template is discoverable and usable, and existing forms never change.
  await unchanged("after the races");
  const latestTitle = (edited.definition as { title?: string }).title;
  const freshForm = await prisma.$transaction((tx) => createRegistrationFormFromTemplateInTransaction(tx, event.id, adminId, "simple_rsvp"));
  assert((JSON.parse(await storedDefinition(freshForm.id)) as { title?: string }).title === latestTitle, "a form created now starts from the latest app version of the template");
  const freshAudit2 = await prisma.auditLog.findFirstOrThrow({ where: { entityId: freshForm.id, action: "REGISTRATION_FORM_CREATED" } });
  assert((freshAudit2.metadata as { templateVersion?: number }).templateVersion === 3, "its creation audit records template version 3");
  Object.assign(baseline, await snapshot());
  const copied = await copyFormTemplate({ sourceKey: "simple_rsvp", name: "Seedfm Copy" }, adminId);
  assert(copied.version === 1, "a copy starts at version 1");
  await unchanged("after copying a template");
  assert((await listFormTemplates()).some((entry) => entry.key === copied.key), "an app-created template is listed in the picker");
  const fromCopy = await createRegistrationForm(event.id, adminId, copied.key);
  assert(fromCopy.name === latestTitle, "a form can be created from an app-created template");
  const copyAudit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: fromCopy.id, action: "REGISTRATION_FORM_CREATED" } });
  assert((copyAudit.metadata as { templateKey?: string; templateVersion?: number }).templateKey === copied.key && (copyAudit.metadata as { templateVersion?: number }).templateVersion === 1, "its creation audit records the app template key and version");
  const library = await listFormTemplateLibrary();
  assert(library.find((entry) => entry.key === "simple_rsvp")!.usedByForms >= 1 && library.find((entry) => entry.key === copied.key)!.usedByForms === 1, "the library counts the forms made from each template");
  const saveAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "FORM_TEMPLATE_VERSION_SAVED", actorUserId: adminId } });
  assert(saveAudit.eventId === null && Object.keys(saveAudit.metadata as object).sort().join() === "previousVersionNumber,productionWrite,source,templateKey,versionId,versionNumber", "the save audit entry carries ids and the template key only");
  console.log("ok  new forms use the latest version, an app-created template is discoverable and usable, and copying changes no existing form");
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
