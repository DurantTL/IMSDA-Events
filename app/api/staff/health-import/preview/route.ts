import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireStaffHealthViewer } from "@/modules/health-records/access";
import { healthApiError, healthDisabledResponse, healthJson } from "@/modules/health-records/api";
import { previewHealthImport } from "@/modules/health-records/import-repository";
import { readHealthImportUpload } from "@/modules/health-records/import-upload";

/**
 * Step one of the Cognito health record import (#878): a system administrator
 * uploads the export and gets back who it matched. The file is read in memory
 * and never stored or logged, and the answer carries no health value.
 */
async function postHandler(request: Request) {
  const disabled = healthDisabledResponse();
  if (disabled) return disabled;
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const viewer = await requireStaffHealthViewer();
    const { files } = await readHealthImportUpload(request);
    return healthJson({ preview: await previewHealthImport(viewer, files) });
  } catch (error) {
    return healthApiError(error, "Previewing the health record import");
  }
}

export const POST = withRequestContext(postHandler);
