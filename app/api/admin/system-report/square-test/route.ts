import { z } from "zod";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { runSquareTest } from "@/modules/system-admin/system-report/square-tester";
import { requireTesterAdmin, testerJson, testerRateLimited } from "@/modules/system-admin/system-report/tester-route";

const bodySchema = z.object({ includeLink: z.boolean().default(false) }).strict();

/**
 * The System report's Square tester (#1383). Reads Square's account, location and notice setup, asks Square to send its
 * test notice, and only when ticked makes a $1 payment link and deletes it. It cannot charge or refund: see the
 * allow-list in `square-tester`. System administrators only; limited to five runs an hour; audited.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const admin = await requireTesterAdmin();
  if ("response" in admin) return admin.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return testerJson({ error: "INVALID_REQUEST", message: "Check the request and try again." }, 400);
  try {
    const run = await runSquareTest({ user: admin.user, includeLink: parsed.data.includeLink });
    if (run.kind === "rate-limited") return testerRateLimited(run.nextAllowedAt, "square");
    return testerJson({ result: run.result });
  } catch (error) {
    logError("System report Square test failed", error);
    return testerJson({ error: "SQUARE_TEST_FAILED", message: "The Square checks could not be run." }, 500);
  }
}

export const POST = withRequestContext(postHandler);
