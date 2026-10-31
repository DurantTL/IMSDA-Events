import { logError } from "@/lib/logger";
import {
  isAuthorizedSweepRequest,
  sweepOutbox,
} from "@/modules/communications/outbox-sweep";
import { refreshDueCalendarFeeds } from "@/modules/calendar/feeds";
import { reconcileDeadlineReminders } from "@/modules/calendar/deadline-reminders";
import { sendDueLocationWaitlistDigests } from "@/modules/event-locations/waitlist-digest";
import { pruneExpiredCommunityContent } from "@/modules/community/repository";
import { pruneAlertFeed } from "@/modules/notifications/feed";
import { prunePublicMetrics } from "@/modules/public-metrics/repository";
import { sweepClassWaitlists } from "@/modules/honors/waitlist-repository";
import { sendDueClassChangeEmails } from "@/modules/honors/class-change-emails";
import { sendDueHonorWatchSummaries } from "@/modules/honors/watch-emails";
import { runHealthSnapshotSweep } from "@/modules/health-records/snapshot-hooks";
import { expireStalePendingTeams } from "@/modules/general-link-registrations/repository";
import { runAlertScan } from "@/modules/operations/alert-scan";
import { sweepHostedCheckouts } from "@/modules/payments/square-hosted-invalidation";
import { recordJobRun, recordSweepHeartbeat } from "@/modules/operations/sweep-heartbeat-repository";
import { CALENDAR_FEED_REFRESH_JOB, GENERAL_LINK_EXPIRY_JOB, MESSAGE_FILE_CLEANUP_JOB, PAY_ON_SQUARE_LINK_SWEEP_JOB } from "@/modules/operations/sweep-heartbeat";
import { withRequestContext } from "@/lib/request-context";
import { sweepMessageFiles } from "@/modules/communications/message-file-sweep";
import { messageFileSweepDeletes } from "@/modules/communications/message-file-config";

/**
 * The scheduled caller for the message outbox.
 *
 * This is a machine endpoint: it carries a bearer token instead of a session
 * and deliberately skips the same-origin check, which exists to protect
 * cookie-authenticated routes from a browser. Without a configured
 * `OUTBOX_SWEEP_TOKEN` it is always 401 — never open by omission.
 */
async function postHandler(request: Request) {
  if (!isAuthorizedSweepRequest(request)) {
    return Response.json(
      { error: "SWEEP_NOT_AUTHORIZED", message: "A valid sweep credential is required." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
    );
  }

  try {
    const result = await sweepOutbox();
    // Recorded before the alert scan so a scan failure cannot hide a sweep
    // that worked, and never allowed to fail the sweep itself.
    await recordSweepHeartbeat("SUCCEEDED").catch((error) => {
      logError("Could not record the outbox sweep heartbeat", error);
    });
    // The sweep already runs every few minutes, which makes it the natural
    // place to read the system's signals: one cron, one credential, and the
    // queue's state is known here anyway. A scan failure must not make a
    // successful sweep look failed.
    const alerts = await runAlertScan().catch((error) => {
      logError("The alert scan failed after a successful sweep", error);
      return null;
    });
    const communityRetention = await pruneExpiredCommunityContent().catch((error) => {
      logError("Community retention sweep failed after a successful outbox sweep", error);
      return null;
    });
    // The administrator alert feed (#1033): items past 90 days are deleted (reads already hide them), with their read receipts.
    // Emails and audit rows are untouched. Its failure must not make a successful sweep look failed.
    const alertFeedRetention = await pruneAlertFeed().catch((error) => {
      logError("The alert feed retention sweep failed after a successful outbox sweep", error);
      return null;
    });
    // Public analytics (#111): daily aggregate rows older than 400 days are deleted. Counts only, nothing personal.
    // Its failure must not make a successful sweep look failed.
    const publicMetricsRetention = await prunePublicMetrics().catch((error) => {
      logError("The public analytics retention sweep failed after a successful outbox sweep", error);
      return null;
    });
    // The daily location waitlist digest to Area Coordinators and event staff
    // (#599). It waits for its morning send time (Central) and sends at most one
    // email per person per date, so running it on every sweep is safe. Its
    // failure must not make a successful sweep look failed.
    const locationWaitlistDigest = await sendDueLocationWaitlistDigests().catch((error) => {
      logError("The location waitlist digest failed after a successful outbox sweep", error);
      return null;
    });
    // Imported Google calendars (#444): feeds whose own refresh interval has
    // passed, a few per sweep. Each feed's failure is recorded on the feed; none
    // of it may make a successful sweep look failed.
    const calendarFeeds = await refreshDueCalendarFeeds().catch((error) => {
      logError("The calendar feed refresh failed after a successful outbox sweep", error);
      return null;
    });
    // The System report (#1357) shows when this step last ran and what it found: counts only. Recording never fails the sweep.
    await recordJobRun(
      CALENDAR_FEED_REFRESH_JOB,
      calendarFeeds ? "SUCCEEDED" : "FAILED",
      calendarFeeds ? { due: calendarFeeds.due, refreshed: calendarFeeds.refreshed, failed: calendarFeeds.failed } : undefined,
    ).catch((error) => {
      logError("Could not record the calendar feed refresh run", error);
    });
    // Deadline reminders (#910): prepares the 14-day and 2-day reminder batches that have come due and brings the
    // waiting ones in line with the calendar. It only prepares: nothing is emailed until a system administrator sends
    // a batch. Safe on every sweep (one batch per deadline and point). Its failure must not make a successful sweep look failed.
    const deadlineReminders = await reconcileDeadlineReminders().catch((error) => {
      logError("Deadline reminder preparation failed after a successful outbox sweep", error);
      return null;
    });
    // Pay on Square links (#327): withdraw expired or stale ones and retry any deletion Square has
    // not confirmed. Square has no link expiry of its own, so this is what makes expiry real.
    // Its failure must not make a successful sweep look failed.
    const hostedLinks = await sweepHostedCheckouts().catch((error) => {
      logError("The Pay on Square link sweep failed after a successful outbox sweep", error);
      return null;
    });
    // The System report (#1374) shows when this step last ran and what it found: counts only. Recording never fails the sweep.
    await recordJobRun(
      PAY_ON_SQUARE_LINK_SWEEP_JOB,
      hostedLinks ? "SUCCEEDED" : "FAILED",
      hostedLinks ? { withdrawn: hostedLinks.withdrawn, deleted: hostedLinks.deleted, failed: hostedLinks.failed } : undefined,
    ).catch((error) => {
      logError("Could not record the Pay on Square link sweep run", error);
    });
    // Honors Weekend class waitlists (#831): offers that ran out pass to the next youth in line, each director
    // emailed once for a new offer. Its failure must not make a successful sweep look failed.
    const classWaitlists = await sweepClassWaitlists().catch((error) => {
      logError("The class waitlist sweep failed after a successful outbox sweep", error);
      return null;
    });
    // Honors Weekend instructor class emails (#1098): right-away emails a failed send left behind, and from about 6:00 AM
    // Central the daily summary of who joined or left each instructor's classes. At most one summary per instructor per
    // Central date, so running it on every sweep is safe. Its failure must not make a successful sweep look failed.
    const instructorClassEmails = await sendDueClassChangeEmails().catch((error) => {
      logError("The instructor class email sweep failed after a successful outbox sweep", error);
      return null;
    });
    // Honor watch summaries (#1099): from about 6:00 AM Central, each watch's one daily email of who joined or left the classes
    // it looks at, read from the same change log. At most one per watch, address and Central date, so running it on every sweep
    // is safe. Its failure must not make a successful sweep look failed.
    const honorWatchSummaries = await sendDueHonorWatchSummaries().catch((error) => {
      logError("The honor watch summary sweep failed after a successful outbox sweep", error);
      return null;
    });
    // Sealed health copies (#924): the event-start copies that are due, and the daily deletion of copies whose
    // keep-until date has passed (never one under a legal hold). A no-op with HEALTH_RECORDS_ENABLED off, safe on
    // every sweep, and it reports counts only. Its failure must not make a successful sweep look failed.
    const healthSnapshots = await runHealthSnapshotSweep().catch((error) => {
      logError("The sealed health copy sweep failed after a successful outbox sweep", error);
      return null;
    });
    // General registration link (#931): teams still waiting 30 days after their event ended lose their typed answers and are
    // marked EXPIRED. Safe on every sweep; it reports counts only. Its failure must not make a successful sweep look failed.
    const generalLinkRetention = await expireStalePendingTeams().catch((error) => {
      logError("The general link retention sweep failed after a successful outbox sweep", error);
      return null;
    });
    // The System report (#1375) shows when this step last ran and its counts. Recording never fails the sweep.
    await recordJobRun(
      GENERAL_LINK_EXPIRY_JOB,
      generalLinkRetention ? "SUCCEEDED" : "FAILED",
      generalLinkRetention ? { expired: generalLinkRetention.expired, events: generalLinkRetention.events } : undefined,
    ).catch((error) => {
      logError("Could not record the pending-team expiry run", error);
    });
    // Message files (#845): uploads nothing refers to. It only REPORTS what it would delete unless a human set
    // MESSAGE_FILE_SWEEP_DELETE=true, never touches a file inside the grace period (24 hours at the least) or one
    // anything refers to, and returns counts only. Its failure must not make a successful sweep look failed.
    const messageFiles = await sweepMessageFiles({ mode: messageFileSweepDeletes() ? "apply" : "dry-run" })
      .then((report) => ({
        mode: report.mode,
        graceHours: report.graceHours,
        candidates: report.candidates.count,
        candidateBytes: report.candidates.bytes,
        deleted: report.deleted.count,
        bytesRemoved: report.bytesRemoved.bytes,
        cleanupPending: report.cleanup.pending,
        cleanupFailed: report.cleanup.failed,
        reservationsExpired: report.reservations.expired,
        reservationsReconciled: report.reservations.reconciled,
      }))
      .catch((error) => {
        logError("The message file sweep failed after a successful outbox sweep", error);
        return null;
      });
    await recordJobRun(
      MESSAGE_FILE_CLEANUP_JOB,
      messageFiles ? "SUCCEEDED" : "FAILED",
      messageFiles
        ? {
            mode: messageFiles.mode,
            candidates: messageFiles.candidates,
            deleted: messageFiles.deleted,
            cleanupPending: messageFiles.cleanupPending,
            cleanupFailed: messageFiles.cleanupFailed,
          }
        : undefined,
    ).catch((error) => {
      logError("Could not record the message file cleanup run", error);
    });
    return Response.json({
      sweptEventCount: result.sweptEventIds.length,
      sweptAccountMessages: result.sweptAccountMessages,
      skipped: result.skipped,
      scheduledEmails: result.scheduledEmails,
      queueBefore: result.snapshotBefore,
      alerts: alerts && {
        sent: alerts.sent.map((alert) => alert.key),
        suppressed: alerts.suppressed.map((alert) => alert.key),
        undelivered: alerts.undelivered.map((alert) => alert.key),
        cleared: alerts.cleared,
      },
      communityRetention,
      alertFeedRetention,
      publicMetricsRetention,
      calendarFeeds,
      deadlineReminders,
      hostedLinks,
      classWaitlists,
      instructorClassEmails,
      honorWatchSummaries,
      healthSnapshots,
      generalLinkRetention,
      messageFiles,
      locationWaitlistDigest: locationWaitlistDigest && {
        status: locationWaitlistDigest.status,
        changesCovered: locationWaitlistDigest.changesCovered,
        recipients: locationWaitlistDigest.recipients,
        delivered: locationWaitlistDigest.delivered,
      },
    });
  } catch (error) {
    logError("Outbox sweep failed", error);
    await recordSweepHeartbeat("FAILED").catch(() => undefined);
    return Response.json(
      { error: "SWEEP_FAILED", message: "The outbox sweep could not complete." },
      { status: 500 }
    );
  }
}

export const POST = withRequestContext(postHandler);
