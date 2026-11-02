/** The CSV download response shared by the staff and Area Coordinator kitchen exports (#787). */
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { eventFileScope } from "@/modules/reporting/export-scope";

export async function kitchenCsvResponse(csv: string, eventId: string) {
  return csvDownloadResponse(csv, exportFileName({ scope: await eventFileScope(eventId), kind: "kitchen-report" }));
}
