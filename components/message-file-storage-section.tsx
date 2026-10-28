import { HardDrive } from "lucide-react";
import { formatFileSize } from "@/modules/communications/message-file-rules";
import type { MessageFileStorageUsage } from "@/modules/communications/message-file-usage";

/**
 * System management > Email > Message file storage (#845): how much each event's email attachments and pictures use
 * against the per-event limit, and what the sweep that clears unused ones is set to do. Read only.
 */
export function MessageFileStorageSection({ usage }: { usage: MessageFileStorageUsage }) {
  const pendingCleanup = usage.events.reduce((sum, event) => sum + event.pendingCleanupCount, 0);
  return (
    <section className="panel" id="message-file-storage" aria-labelledby="message-file-storage-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow"><HardDrive aria-hidden="true" size={14} /> Message file storage</p>
          <h2 id="message-file-storage-heading">Email attachments and pictures</h2>
        </div>
      </div>
      <p className="field-help message-file-storage-note">
        Each event may keep {formatFileSize(usage.quotaBytes)} of message files. Files nothing uses are only removed after {usage.graceHours} hours.
      </p>
      <p className="field-help message-file-storage-note" data-sweep-mode={usage.sweepMode}>
        {usage.sweepMode === "delete"
          ? "The scheduled sweep is deleting unused files. "
          : "The scheduled sweep is in dry-run mode: it only reports what it would delete, and nothing is removed. "}
        To see what it would remove, run <code>npm run message-files:sweep</code> on the server. Adding <code>-- --apply</code> deletes.
      </p>
      {pendingCleanup > 0 || usage.expiredReservations > 0 ? (
        <p className="inline-notice error message-file-storage-note" data-pending-cleanup role="status">
          {pendingCleanup > 0 ? `${pendingCleanup} removed file${pendingCleanup === 1 ? "" : "s"} could not be deleted from disk yet. ` : ""}
          {usage.expiredReservations > 0 ? `${usage.expiredReservations} interrupted upload${usage.expiredReservations === 1 ? "" : "s"} still hold${usage.expiredReservations === 1 ? "s" : ""} space. ` : ""}
          These are only cleared when the sweep runs with <code>--apply</code> (or with <code>MESSAGE_FILE_SWEEP_DELETE=true</code> set), and until then they keep counting against the event&apos;s limit.
        </p>
      ) : null}
      {usage.events.length === 0 ? (
        <p className="quiet-copy">No event has message files yet.</p>
      ) : (
        <ul className="notification-event-list" aria-label="Message file storage by event">
          {usage.events.map((event) => (
            <li data-message-file-event={event.eventId} key={event.eventId}>
              <span>
                <strong>{event.eventName ?? "An event that was deleted"}</strong>
                <small className="quiet-copy">
                  {event.fileCount} file{event.fileCount === 1 ? "" : "s"}, {formatFileSize(event.usedBytes)} of {formatFileSize(usage.quotaBytes)} used
                  {event.usedBytes > usage.quotaBytes ? " (over the limit)" : ""}.
                  {event.pendingCleanupBytes > 0
                    ? ` ${formatFileSize(event.pendingCleanupBytes)} in ${event.pendingCleanupCount} removed file${event.pendingCleanupCount === 1 ? "" : "s"} could not be deleted from disk yet and will be retried.`
                    : ""}
                  {event.reservedBytes > 0 ? ` ${formatFileSize(event.reservedBytes)} is being uploaded.` : ""}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
