import { HealthBodyError } from "@/modules/health-records/api";
import { MAX_HEALTH_IMPORT_FILES, MAX_HEALTH_IMPORT_FILE_BYTES } from "@/modules/health-records/import-files";

/**
 * Reads the multipart upload of the health record import (#878) into memory.
 * Files are never written anywhere. Which entries to import travels as repeated
 * `include` fields (Cognito entry ids), or `includeAll=true`.
 */

const MAX_UPLOAD_BYTES = MAX_HEALTH_IMPORT_FILES * MAX_HEALTH_IMPORT_FILE_BYTES + 200_000;

export async function readHealthImportUpload(request: Request): Promise<{ files: Array<{ bytes: Uint8Array }>; include: string[] | null }> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) throw new HealthBodyError("That upload is too large. Export fewer entries at a time.");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HealthBodyError("Send the export as a file upload.");
  }
  const files: Array<{ bytes: Uint8Array }> = [];
  for (const value of form.getAll("file")) {
    if (typeof value === "string") continue;
    if (value.size > MAX_HEALTH_IMPORT_FILE_BYTES) throw new HealthBodyError("A chosen file is larger than 8 MB. Export fewer entries at a time.");
    files.push({ bytes: new Uint8Array(await value.arrayBuffer()) });
  }
  const include = form.get("includeAll") === "true"
    ? null
    : form.getAll("include").filter((value): value is string => typeof value === "string").slice(0, 5_000);
  return { files, include };
}
