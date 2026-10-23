import {
  SnsUnavailableError,
  SnsConfigurationError,
  SnsVerificationError,
  confirmSnsSubscription,
  parseSesNotification,
  verifySnsRequest,
} from "@/integrations/email/ses-sns";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { recordSesFeedbackEvent } from "@/modules/communications/ses-event-repository";

export const runtime = "nodejs";

/**
 * Amazon SNS endpoint for SES bounce, complaint and delivery reports (#863). Answers:
 *
 * - 200: recorded, a duplicate, a notification this system does not act on, or a confirmed subscription;
 * - 4xx: the request is permanently invalid (not JSON, wrong type, a topic or account that is not allowed, a signature
 *   that does not verify): SNS stops retrying it;
 * - 503: not configured here, or AWS could not be reached right now: SNS retries;
 * - 500: storing the event failed: SNS retries.
 *
 * Logs carry the SNS message id and counts only, never an address or a notification body.
 */
async function postHandler(request: Request) {
  const rawBody = await request.text();
  try {
    const verified = await verifySnsRequest(rawBody, request.headers);
    const { envelope } = verified;

    if (envelope.Type === "SubscriptionConfirmation") {
      await confirmSnsSubscription(verified);
      logInfo("Confirmed the SES notification topic subscription.", { snsMessageId: envelope.MessageId });
      return Response.json({ received: true, confirmed: true });
    }
    if (envelope.Type === "UnsubscribeConfirmation") {
      // Never followed: re-subscribing is an operator step (docs/DEPLOY-DOCKER.md).
      logWarn("The SES notification topic subscription was unsubscribed.", { snsMessageId: envelope.MessageId });
      return Response.json({ received: true, ignored: true });
    }

    const feedback = parseSesNotification(envelope, verified.config);
    if (!feedback) return Response.json({ received: true, ignored: true });
    const result = await recordSesFeedbackEvent(envelope.MessageId, feedback);
    return Response.json({
      received: true,
      duplicate: result.duplicate,
      matched: result.matchedMessageId !== null,
      suppressed: result.suppressedCount,
    });
  } catch (error) {
    if (error instanceof SnsConfigurationError) {
      return Response.json(
        { error: "SES_WEBHOOK_NOT_CONFIGURED", message: "The email delivery notification endpoint is not configured." },
        { status: 503 },
      );
    }
    if (error instanceof SnsVerificationError) {
      logWarn("An SES notification was rejected.", { status: error.status });
      return Response.json(
        { error: "INVALID_SNS_MESSAGE", message: "The notification could not be verified." },
        { status: error.status },
      );
    }
    if (error instanceof SnsUnavailableError) {
      logWarn("An SES notification could not be verified right now; SNS will retry.");
      return Response.json(
        { error: "SNS_TEMPORARILY_UNAVAILABLE", message: "The notification could not be verified right now. Try again." },
        { status: 503 },
      );
    }
    logError("Recording the SES notification failed", error);
    return Response.json(
      { error: "SES_WEBHOOK_FAILED", message: "The notification could not be recorded." },
      { status: 500 },
    );
  }
}

export const POST = withRequestContext(postHandler);
