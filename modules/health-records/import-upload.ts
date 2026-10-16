import { HealthBodyError } from "@/modules/health-records/api";
import { MAX_HEALTH_IMPORT_FILES, MAX_HEALTH_IMPORT_FILE_BYTES } from "@/modules/health-records/import-files";

/**
 * Reads the multipart upload of the health record import (#878) into memory.
 * Files are never written anywhere. Which rows to import travels as repeated
 * `include` fields, each `sourceId:memberId` exactly as the preview showed it. Nothing is selected by default.
 */

const MAX_UPLOAD_BYTES = MAX_HEALTH_IMPORT_FILES * MAX_HEALTH_IMPORT_FILE_BYTES + 200_000;

export async function readHealthImportUpload(request: Request): Promise<{ files: Array<{ bytes: Uint8Array }>; include: Array<{ sourceId: string; memberId: string }> }> {
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
  const include: Array<{ sourceId: string; memberId: string }> = [];
  for (const value of form.getAll("include").slice(0, 5_000)) {
    if (typeof value !== "string") continue;
    const split = value.lastIndexOf(":");
    if (split > 0 && split < value.length - 1) include.push({ sourceId: value.slice(0, split), memberId: value.slice(split + 1) });
  }
  return { files, include };
}
