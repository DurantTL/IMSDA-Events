import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireClubsAdministration } from "@/modules/organizations/access";
import { honorApiError } from "@/modules/honors/api-errors";
import { listHonors } from "@/modules/honors/repository";
import {
  MAX_REQUIREMENT_CSV_BYTES,
  parseRequirementCsv,
  planRequirementImport,
  RequirementCsvError,
} from "@/modules/requirements/requirements-csv";
import {
  applyRequirementImport,
  listCurrentHonorRequirementSets,
  RequirementImportConflictError,
} from "@/modules/requirements/repository";
import { withRequestContext } from "@/lib/request-context";

const importSchema = z.object({
  csv: z.string().max(MAX_REQUIREMENT_CSV_BYTES, "That file is too large. Split it into files of up to 20,000 rows."),
  confirm: z.boolean().default(false),
}).strict();

/**
 * Honor requirements CSV import (#2054): preview, then save on confirm. Only
 * text from a source whose license is recorded is accepted; nothing is
 * deleted, and changed text becomes a new version.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireClubsAdministration();
    const { csv, confirm } = importSchema.parse(await request.json());
    let rows;
    try {
      rows = parseRequirementCsv(csv);
    } catch (error) {
      if (error instanceof RequirementCsvError) return Response.json({ error: "INVALID_REQUIREMENT_CSV", message: error.message }, { status: 400 });
      throw error;
    }
    const honors = await listHonors();
    const codes = new Set(rows.map((row) => row.code));
    const inFile = honors.filter((honor) => codes.has(honor.code));
    const current = await listCurrentHonorRequirementSets(inFile.map((honor) => honor.id));
    const plan = planRequirementImport(rows, inFile.map(({ id, code, name }) => ({ id, code, name })), current);
    // The shared import dialog knows Add, Update and Skip; a new version of an honor's text is its Update.
    const steps = plan.map(({ line, name, action, message }) => ({ line, name, action: action === "REPLACE" ? "UPDATE" as const : action, message }));
    if (!confirm) return Response.json({ steps });
    const result = await applyRequirementImport(plan, actor.id);
    return Response.json({
      steps: steps.map((step) => ({
        ...step,
        message: step.action === "ADD" ? "Added." : step.action === "UPDATE" ? "Replaced; the old version is kept." : step.message,
      })),
      ...result,
      honors: await listHonors(),
    });
  } catch (error) {
    if (error instanceof RequirementImportConflictError) return Response.json({ error: error.code, message: error.message }, { status: 409 });
    return honorApiError(error, "Importing honor requirements");
  }
}

export const POST = withRequestContext(postHandler);
