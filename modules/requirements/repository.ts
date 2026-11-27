import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import type { CurrentRequirementSet, RequirementImportStep } from "@/modules/requirements/requirements-csv";
import { groupRequirements, type RequirementCredit, type RequirementSection } from "@/modules/requirements/domain";

/** Two imports raced for the same honor: the partial unique index allows one current set per honor and language. */
export class RequirementImportConflictError extends Error {
  readonly code = "REQUIREMENTS_CHANGED";
  constructor() {
    super("Someone else imported requirements for one of these honors at the same time. Preview the file again.");
  }
}

const lineSelect = { section: true, number: true, label: true, text: true } satisfies Prisma.RequirementSelect;

/** The current requirement sets for the given honors, with their lines in order, for planning an import. */
export async function listCurrentHonorRequirementSets(honorIds: readonly string[]): Promise<CurrentRequirementSet[]> {
  if (honorIds.length === 0) return [];
  const sets = await getPrisma().requirementSet.findMany({
    where: { subject: "HONOR", honorId: { in: [...honorIds] }, retiredAt: null },
    select: { id: true, honorId: true, language: true, sourceUrl: true, requirements: { select: lineSelect, orderBy: { position: "asc" } } },
  });
  return sets.map((set) => ({ id: set.id, honorId: set.honorId!, language: set.language, sourceUrl: set.sourceUrl, lines: set.requirements }));
}

/** Saves the ADD and REPLACE steps of a planned import in one transaction; SKIP steps change nothing. */
export async function applyRequirementImport(steps: readonly RequirementImportStep[], actorUserId: string) {
  const saving = steps.filter((step) => step.action !== "SKIP" && step.honorId && step.source);
  try {
    await getPrisma().$transaction(async (tx) => {
      const now = new Date();
      for (const step of saving) {
        if (step.action === "REPLACE") {
          // Retire only if it is still the current set; otherwise someone imported in between.
          const retired = await tx.requirementSet.updateMany({ where: { id: step.replacesSetId!, retiredAt: null }, data: { retiredAt: now } });
          if (retired.count !== 1) throw new RequirementImportConflictError();
        }
        const source = step.source!;
        await tx.requirementSet.create({
          data: {
            subject: "HONOR",
            honorId: step.honorId!,
            language: step.language,
            retrievedOn: step.retrievedOn,
            sourceKey: source.key,
            sourceName: `${source.name}, ${source.publisher}`,
            sourceUrl: step.sourceUrl,
            license: source.license,
            licenseUrl: source.licenseUrl,
            requirements: {
              createMany: { data: step.lines.map((line, position) => ({ position, section: line.section, number: line.number, label: line.label, text: line.text })) },
            },
          },
        });
      }
      const added = saving.filter((step) => step.action === "ADD").length;
      const replaced = saving.length - added;
      await writeAuditLog({
        actorUserId,
        action: "HONOR_REQUIREMENTS_IMPORTED",
        entityType: "RequirementSet",
        summary: `Imported honor requirements: ${added} added, ${replaced} replaced with a new version.`,
        metadata: {
          honors: steps.length,
          added,
          replaced,
          skipped: steps.length - saving.length,
          codes: saving.map((step) => step.code).slice(0, 200),
        },
      }, tx);
    }, { timeout: 60_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new RequirementImportConflictError();
    throw error;
  }
  const added = saving.filter((step) => step.action === "ADD").length;
  return { added, replaced: saving.length - added };
}

export type HonorRequirementsView = {
  sections: RequirementSection[];
  requirementCount: number;
  credit: RequirementCredit;
};

/** An honor's current English requirements, grouped for display with the credit to show under them, or null when none are imported. */
export async function getHonorRequirements(honorId: string, language = "en"): Promise<HonorRequirementsView | null> {
  const set = await getPrisma().requirementSet.findFirst({
    where: { subject: "HONOR", honorId, language, retiredAt: null },
    select: {
      sourceName: true, sourceUrl: true, license: true, licenseUrl: true, retrievedOn: true,
      requirements: { select: lineSelect, orderBy: { position: "asc" } },
    },
  });
  if (!set) return null;
  return {
    sections: groupRequirements(set.requirements),
    requirementCount: set.requirements.filter((line) => line.label === "").length,
    credit: { sourceName: set.sourceName, sourceUrl: set.sourceUrl, license: set.license, licenseUrl: set.licenseUrl, retrievedOn: set.retrievedOn },
  };
}

/** One honor for its requirements page: name, code, category, and whether it is active. */
export async function getHonorSummary(honorId: string) {
  return getPrisma().honor.findUnique({
    where: { id: honorId },
    select: { id: true, code: true, name: true, description: true, category: true, isActive: true },
  });
}
