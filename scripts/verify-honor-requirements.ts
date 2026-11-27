/**
 * Proves the honor requirement text store (#2054) against a real PostgreSQL
 * database, with fictitious honors and text it creates and removes itself:
 *
 *  - an import adds an honor's text with its credit (source page, license and
 *    its link, date) and the lines in order;
 *  - importing the same text again changes nothing, and changed text becomes a
 *    new version while the old one is kept, retired;
 *  - two imports that both think they replace the same version: the second is
 *    refused, so an honor never has two current versions;
 *  - the database itself refuses a second current version, a set tied to both
 *    an honor and a class or to neither, a requirement numbered 0, and the
 *    deletion of an honor that has text;
 *  - the honor catalog counts top-level requirements only;
 *  - the import is audited with counts and codes, never the text.
 *
 *   npm run test:honor-requirements
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { parseRequirementCsv, planRequirementImport, REQUIREMENT_CSV_HEADERS } from "../modules/requirements/requirements-csv";
import { toCsv } from "../modules/reporting/csv";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const P = "honorreqtext";
const staffUserId = `${P}_staff`;
const honorIds = { knots: `${P}_knots`, stars: `${P}_stars` };
const WIKI = "https://wiki.pathfindersonline.org/w/AY_Honors/Sample_Knots/Requirements";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function refused(promise: Promise<unknown>, message: string) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  assert(error, `${message}: the database accepted it`);
}

async function cleanup() {
  await prisma.requirementSet.deleteMany({ where: { honorId: { in: Object.values(honorIds) } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: staffUserId } });
  await prisma.honor.deleteMany({ where: { id: { in: Object.values(honorIds) } } });
  await prisma.user.deleteMany({ where: { id: staffUserId } });
}

const file = (rows: string[][]) => toCsv([[...REQUIREMENT_CSV_HEADERS], ...rows]);
const knotRows = (first: string) => [
  ["HRT-KNOTS", "Sample Knots", "en", "2026-11-27", WIKI, "CC BY-SA 3.0", "", "1", "", first],
  ["HRT-KNOTS", "Sample Knots", "en", "2026-11-27", WIKI, "CC BY-SA 3.0", "", "2", "", "Do the following:"],
  ["HRT-KNOTS", "Sample Knots", "en", "2026-11-27", WIKI, "CC BY-SA 3.0", "", "2", "a", "Tie a sample hitch."],
];

async function main() {
  const { applyRequirementImport, getHonorRequirements, listCurrentHonorRequirementSets, RequirementImportConflictError } = await import("../modules/requirements/repository");
  const { listHonors } = await import("../modules/honors/repository");

  await cleanup();
  await prisma.user.create({ data: { id: staffUserId, email: `${P}-staff@example.test`, displayName: "Requirements Check Staff", globalRole: "SYSTEM_ADMIN" } });
  await prisma.honor.createMany({
    data: [
      { id: honorIds.knots, code: "HRT-KNOTS", name: "Sample Knots", normalizedName: `${P} sample knots`, category: "RECREATION" },
      { id: honorIds.stars, code: "HRT-STARS", name: "Sample Stars", normalizedName: `${P} sample stars`, category: "NATURE" },
    ],
  });
  const catalog = [{ id: honorIds.knots, code: "HRT-KNOTS", name: "Sample Knots" }, { id: honorIds.stars, code: "HRT-STARS", name: "Sample Stars" }];
  const plan = async (rows: string[][]) => planRequirementImport(parseRequirementCsv(file(rows)), catalog, await listCurrentHonorRequirementSets(Object.values(honorIds)));

  const first = await plan(knotRows("Tie three sample knots."));
  assert(first.length === 1 && first[0]!.action === "ADD", `the first import adds the text, got ${JSON.stringify(first.map((step) => step.action))}`);
  assert((await applyRequirementImport(first, staffUserId)).added === 1, "one honor added");
  const shown = await getHonorRequirements(honorIds.knots);
  assert(shown && shown.requirementCount === 2, `two top-level requirements, got ${shown?.requirementCount}`);
  assert(shown.credit.sourceUrl === WIKI && shown.credit.license === "CC BY-SA 3.0" && shown.credit.licenseUrl === "https://creativecommons.org/licenses/by-sa/3.0/" && shown.credit.retrievedOn === "2026-11-27", `the credit is stored with the text, got ${JSON.stringify(shown.credit)}`);
  assert(shown.credit.sourceName === "Pathfinder Wiki, North American Division Youth Ministries", `the source names its publisher, got ${shown.credit.sourceName}`);
  assert(shown.sections[0]!.items[1]!.parts[0]!.text === "Tie a sample hitch.", "the lettered part stays under its requirement");
  const listed = (await listHonors()).find((honor) => honor.id === honorIds.knots);
  assert(listed?.requirementCount === 2, `the catalog counts top-level requirements, got ${listed?.requirementCount}`);
  assert((await listHonors()).find((honor) => honor.id === honorIds.stars)?.requirementCount === 0, "an honor without text shows none");
  console.log("ok  an import adds the text with its credit and counts top-level requirements");

  const again = await plan(knotRows("Tie three sample knots."));
  assert(again[0]!.action === "SKIP", "the same text again changes nothing");
  const changed = await plan(knotRows("Tie four sample knots."));
  assert(changed[0]!.action === "REPLACE", "changed text replaces the current version");
  const stale = await plan(knotRows("Tie five sample knots."));
  assert((await applyRequirementImport(changed, staffUserId)).replaced === 1, "one honor replaced");
  const versions = await prisma.requirementSet.findMany({ where: { honorId: honorIds.knots }, orderBy: { createdAt: "asc" }, select: { retiredAt: true, requirements: { select: { text: true }, orderBy: { position: "asc" } } } });
  assert(versions.length === 2 && versions[0]!.retiredAt && !versions[1]!.retiredAt, "the old version is kept, retired, and the new one is current");
  assert(versions[0]!.requirements[0]!.text === "Tie three sample knots.", "the old text is unchanged");
  assert((await getHonorRequirements(honorIds.knots))!.sections[0]!.items[0]!.text === "Tie four sample knots.", "the new text is shown");
  console.log("ok  unchanged text is skipped, and changed text becomes a new version with the old one kept");

  const conflict = await applyRequirementImport(stale, staffUserId).then(() => null, (error: unknown) => error);
  assert(conflict instanceof RequirementImportConflictError, `an import planned against a version that was replaced meanwhile is refused, got ${String(conflict)}`);
  assert(await prisma.requirementSet.count({ where: { honorId: honorIds.knots, retiredAt: null } }) === 1, "still one current version");
  assert(await prisma.requirementSet.count({ where: { honorId: honorIds.knots } }) === 2, "and the refused import saved nothing");
  console.log("ok  a racing import is refused and saves nothing");

  const base = { subject: "HONOR" as const, retrievedOn: "2026-11-27", sourceKey: "pathfinder-wiki", sourceName: "Sample", sourceUrl: WIKI, license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/" };
  await refused(prisma.requirementSet.create({ data: { ...base, honorId: honorIds.knots } }), "a second current version for the same honor and language");
  await refused(prisma.requirementSet.create({ data: { ...base, honorId: honorIds.stars, classLevel: "FRIEND" } }), "a set tied to an honor and a class");
  await refused(prisma.requirementSet.create({ data: { ...base, subject: "CLASS" } }), "a class set with no class");
  const spare = await prisma.requirementSet.create({ data: { ...base, honorId: honorIds.stars, language: "es" }, select: { id: true } });
  await refused(prisma.requirement.create({ data: { setId: spare.id, position: 0, number: 0, text: "Zero" } }), "a requirement numbered 0");
  await refused(prisma.honor.delete({ where: { id: honorIds.knots } }), "deleting an honor that has requirement text");
  await prisma.requirementSet.delete({ where: { id: spare.id } });
  console.log("ok  the database refuses two current versions, a set with no single subject, number 0, and deleting an honor with text");

  const audits = await prisma.auditLog.findMany({ where: { actorUserId: staffUserId, action: "HONOR_REQUIREMENTS_IMPORTED" }, select: { metadata: true } });
  assert(audits.length === 2, `each saved import is audited once, got ${audits.length}`);
  const recorded = JSON.stringify(audits.map((audit) => audit.metadata));
  assert(recorded.includes("HRT-KNOTS") && !recorded.includes("sample knots") && !recorded.includes("sample hitch"), "the audit has codes and counts, never the text");
  console.log("ok  imports are audited with codes and counts only");

  console.log("Honor requirement checks passed.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
