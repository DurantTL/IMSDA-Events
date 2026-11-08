import "server-only";

import { randomUUID } from "node:crypto";
import { logError, logInfo } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import { AccountEmailNotConfiguredError, getAccountEmailSender, isAccountEmailConfigured } from "@/modules/communications/account-email";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { checkProblemReportCopyRateLimit } from "@/modules/rate-limit/service";
import { problemReportCopyEmailContent, type ProblemReportDetails } from "@/modules/support/problem-report-domain";

/**
 * The emailed copy of a problem report (#1715). Same outbox path as the conference order confirmation: the account slice
 * of the outbox (no event, sender from `ACCOUNT_EMAIL_*`), which takes a bare address, so the person needs no account.
 * One copy per report, never bulk. It is best-effort: a copy that cannot be queued, or is held back by its own rate
 * limit, never fails or loses the report, which is already saved.
 */
export type ProblemReportCopyResult = "sent" | "skipped";

export async function sendProblemReportCopy(request: Request, input: {
  reportId: string;
  reference: string;
  message: string;
  email: string | null | undefined;
  details: ProblemReportDetails | null;
}): Promise<ProblemReportCopyResult> {
  const address = input.email?.trim().toLowerCase();
  if (!address) return "skipped";
  try {
    if (!isAccountEmailConfigured()) {
      logInfo("A problem report copy was not sent because account email is not configured.", { reference: input.reference });
      return "skipped";
    }
    const limit = await checkProblemReportCopyRateLimit(request, address);
    if (!limit.allowed) {
      logInfo("A problem report copy was not sent because its rate limit was reached.", { reference: input.reference });
      return "skipped";
    }
    const sender = getAccountEmailSender();
    const content = problemReportCopyEmailContent({ reference: input.reference, message: input.message, page: input.details?.path });
    const message = await getPrisma().messageOutbox.create({
      data: {
        eventId: null,
        templateKey: "PROBLEM_REPORT_COPY",
        recipientKind: "ACCOUNT",
        recipientEmail: address,
        recipientName: null,
        senderNameSnapshot: sender.name,
        senderEmailSnapshot: sender.address,
        replyToEmailSnapshot: sender.replyTo,
        subjectSnapshot: content.subject,
        bodyTextSnapshot: content.bodyText,
        metadata: { trigger: "PROBLEM_REPORT_COPY", reportId: input.reportId, accountEmail: true, realDelivery: true },
        idempotencyKey: `problem-report-copy:${input.reportId}`,
        correlationId: randomUUID(),
        status: "PENDING",
      },
      select: { id: true },
    });
    try {
      await processAccountEmailQueue({ messageIds: [message.id], limit: 1 });
    } catch (error) {
      // Queued is what matters; the outbox sweep tries again.
      logError("A problem report copy could not be delivered now.", error, { reference: input.reference });
    }
    return "sent";
  } catch (error) {
    if (!(error instanceof AccountEmailNotConfiguredError)) logError("A problem report copy could not be queued.", error, { reference: input.reference });
    return "skipped";
  }
}
