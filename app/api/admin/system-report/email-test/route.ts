import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { readEmailTestStatus, runEmailTest } from "@/modules/system-admin/system-report/email-tester";
import { requireTesterAdmin, testerJson, testerRateLimited } from "@/modules/system-admin/system-report/tester-route";

/**
 * The System report's email tester (#1383). POST sends one labelled test email to the one address typed, through the
 * real outbox; GET follows that one email by id. System administrators only, checked here on the server. Answers are
 * fixed states and sentences: never a provider message or payload, and never any other outbox row.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const admin = await requireTesterAdmin();
  if ("response" in admin) return admin.response;
  try {
    const run = await runEmailTest({ user: admin.user, body: await request.json().catch(() => null) });
    if (run.kind === "invalid") return testerJson({ error: "INVALID_EMAIL", message: "Enter one valid email address." }, 400);
    if (run.kind === "rate-limited") return testerRateLimited(run.nextAllowedAt, "email");
    if (run.kind === "backup-not-configured") return testerJson({ error: "BACKUP_NOT_CONFIGURED", message: "The backup email service is not set up on this server." }, 409);
    if (run.kind === "not-configured") return testerJson({ error: "EMAIL_NOT_CONFIGURED", message: "Email sending is not set up on this server." }, 503);
    return testerJson({ status: run.status }, 201);
  } catch (error) {
    logError("System report email test failed", error);
    return testerJson({ error: "EMAIL_TEST_FAILED", message: "The test email could not be started." }, 500);
  }
}

async function getHandler(request: Request) {
  const admin = await requireTesterAdmin();
  if ("response" in admin) return admin.response;
  try {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    const status = await readEmailTestStatus(id, admin.user.id);
    if (!status) return testerJson({ error: "TEST_NOT_FOUND", message: "That test email was not found." }, 404);
    return testerJson({ status });
  } catch (error) {
    logError("System report email test status failed", error);
    return testerJson({ error: "EMAIL_TEST_FAILED", message: "The test email's status could not be read." }, 500);
  }
}

export const POST = withRequestContext(postHandler);
export const GET = withRequestContext(getHandler);
