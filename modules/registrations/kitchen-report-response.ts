/** The CSV download response shared by the staff and Area Coordinator kitchen exports (#787). */
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

export function kitchenCsvResponse(csv: string, eventId: string) {
  return csvDownloadResponse(csv, exportFileName({ scope: eventId, kind: "kitchen-report" }));
}
