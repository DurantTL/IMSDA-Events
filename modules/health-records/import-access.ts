import type { HealthViewer } from "@/modules/health-records/domain";
import { HealthRecordError } from "@/modules/health-records/errors";
import { requireHealthRecordsEnabled } from "@/modules/health-records/flag";

/**
 * The one rule for who may run the Cognito health record import (#878): a system
 * administrator, signed in as themselves. Staff holding the health permission, club
 * leaders, coordinators and an administrator acting as a director are all refused.
 * The routes call it before they read the upload, and the repository calls it again.
 */
export function requireHealthImporter(viewer: HealthViewer) {
  requireHealthRecordsEnabled();
  if (viewer.kind !== "SYSTEM_ADMIN" || viewer.actAsId) {
    throw new HealthRecordError("FORBIDDEN", "Only a system administrator can import health records.");
  }
  return viewer;
}
