import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireStaffHealthViewer } from "@/modules/health-records/access";
import { healthApiError, healthDisabledResponse, healthJson } from "@/modules/health-records/api";
import { applyHealthImport } from "@/modules/health-records/import-repository";
import { readHealthImportUpload } from "@/modules/health-records/import-upload";

/**
 * Step two of the Cognito health record import (#878): the same file is sent
 * again, matched again, and a sealed record is written for each matched row
 * that has none yet. A person who already has a record is skipped, so sending
 * the same file twice changes nothing. Nothing is stored from the file itself.
 */
async function postHandler(request: Request) {
  const disabled = healthDisabledResponse();
  if (disabled) return disabled;
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const viewer = await requireStaffHealthViewer();
    const { files, include } = await readHealthImportUpload(request);
    return healthJson({ result: await applyHealthImport(viewer, files, { include }) });
  } catch (error) {
    return healthApiError(error, "Importing health records");
  }
}

export const POST = withRequestContext(postHandler);
