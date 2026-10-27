import type { HealthViewer } from "@/modules/health-records/domain";
import { HealthRecordError } from "@/modules/health-records/errors";
import { requireHealthRecordsEnabled } from "@/modules/health-records/flag";

/**
 * The one rule for who may run the Cognito health record import (#878): a system
 * administrator, or an active Clubs Administrator (#1232, Caleb 2026-10-26; the viewer
 * comes from `requireStaffHealthViewer`, which reads the grant on every request),
 * signed in as themselves. Staff holding the health permission, club leaders,
 * coordinators and anyone acting as a director are all refused.
 * The routes call it before they read the upload, and the repository calls it again.
 */
export function requireHealthImporter(viewer: HealthViewer) {
  requireHealthRecordsEnabled();
  if (viewer.kind !== "SYSTEM_ADMIN" || viewer.actAsId) {
    throw new HealthRecordError("FORBIDDEN", "Only a system administrator or a Clubs Administrator can import health records.");
  }
  return viewer;
}
