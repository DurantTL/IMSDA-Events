import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { jsonOk, mealRoute } from "@/modules/meals/api";
import { MealError } from "@/modules/meals/errors";
import { confirmScannerImport, previewScannerImport } from "@/modules/meals/scanner-import-repository";
import { SCANNER_IMPORT_MAX_BYTES } from "@/modules/meals/scanner-import";

const noStore = { "Cache-Control": "no-store" };
/** Recording new redemptions needs report access; accepting an un-redeem (it lowers the served counts) also needs finance access. */
async function canAcceptUnredeem(eventId: string) {
  try {
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    return true;
  } catch (error) {
    if (error instanceof AccessDeniedError) return false;
    throw error;
  }
}

const tooLarge = () => Response.json({ error: "FILE_TOO_LARGE", message: "The file is larger than 2 MB. Export a shorter period and try again." }, { status: 413, headers: noStore });

/**
 * Café scanner results (#1028). One route, two steps, both reading the uploaded CSV (the Google Sheet downloaded as CSV,
 * or the scanner's transactions.csv):
 * - `step=preview` plans the file and writes nothing;
 * - `step=confirm` sends the file again with the preview's `digest`, plans it again inside a transaction and saves only if
 *   the plan is the same. `accept` lists the un-redeem conflicts staff accepted (ticket numbers).
 * VIEW_REPORTS, like the meal ticket export the file comes from; accepting an un-redeem also needs MANAGE_FINANCE. The size is capped before the body is read.
 */
export const POST = mealRoute("VIEW_REPORTS", "Importing café scanner results", async ({ request, eventId, userId }) => {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > SCANNER_IMPORT_MAX_BYTES + 64 * 1024) return tooLarge();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new MealError("INVALID", "Choose a CSV file.");
  if (!file.name.toLowerCase().endsWith(".csv")) throw new MealError("INVALID", "The file must be a .csv file.");
  if (file.size > SCANNER_IMPORT_MAX_BYTES) return tooLarge();
  const text = await file.text();
  const step = form.get("step");
  if (step === "preview") {
    return jsonOk({ preview: await previewScannerImport(eventId, file.name, text, await canAcceptUnredeem(eventId)) });
  }
  if (step === "confirm") {
    const digest = form.get("digest");
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) throw new MealError("INVALID", "Preview the file before confirming.");
    const accept = form.getAll("accept").map((value) => Number(value));
    if (accept.some((value) => !Number.isInteger(value) || value < 1)) throw new MealError("INVALID", "The accepted un-redeems are not valid.");
    const result = await confirmScannerImport({
      eventId, userId, fileName: file.name, text, digest, acceptUnredeem: accept, acknowledgeOtherSource: form.get("acknowledge") === "yes",
      canAcceptUnredeem: accept.length > 0 && await canAcceptUnredeem(eventId),
    });
    return jsonOk({ result });
  }
  throw new MealError("INVALID", "Unknown step.");
});
