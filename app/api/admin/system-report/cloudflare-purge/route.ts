import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { runCloudflarePurge } from "@/modules/system-admin/system-report/cloudflare-purge";
import { requireTesterAdmin, testerJson, testerRateLimited } from "@/modules/system-admin/system-report/tester-route";

/**
 * The System report's "Clear Cloudflare cache" action (#1429). POST sends one purge-everything request to the private
 * webhook. System administrators only, checked here on the server; limited to three an hour; audited. Answers are fixed
 * states and sentences: never the webhook address, its response, or an error message.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const admin = await requireTesterAdmin();
  if ("response" in admin) return admin.response;
  try {
    const run = await runCloudflarePurge({ user: admin.user });
    if (run.kind === "rate-limited") return testerRateLimited(run.nextAllowedAt, "cloudflare");
    if (run.kind === "not-configured") {
      return testerJson({ state: "not-configured", message: "Not set up. Add CLOUDFLARE_PURGE_WEBHOOK_URL in the xCloud settings." }, 503);
    }
    if (run.outcome === "purged") return testerJson({ state: "purged", message: "Cloudflare cache cleared. Pages may load a little slower for a few minutes." });
    const message = run.outcome === "timeout"
      ? "Cloudflare did not answer in time. The cache may not be cleared. Try again in a minute."
      : "The cache could not be cleared. Try again, and check the webhook setting if it keeps failing.";
    return testerJson({ state: "failed", message }, 502);
  } catch (error) {
    logError("System report Cloudflare purge failed", error);
    return testerJson({ state: "failed", message: "The cache could not be cleared. Try again." }, 500);
  }
}

export const POST = withRequestContext(postHandler);
