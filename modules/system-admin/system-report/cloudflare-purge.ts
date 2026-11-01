import "server-only";

import { logError } from "@/lib/logger";
import { isCloudflarePurgeConfigured, purgeCloudflareCache, type CloudflarePurgeOutcome } from "@/integrations/cloudflare/purge";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { checkSystemCloudflarePurgeRateLimit } from "@/modules/rate-limit/service";
import { nextAllowedAt } from "@/modules/system-admin/system-report/tester-limits";

/**
 * The System report's "Clear Cloudflare cache" action (#1429). A system administrator confirms; one purge-everything
 * request goes to the private webhook; the answer is a fixed state. The webhook URL never appears here: this module
 * only sees outcome words from the adapter. The audit entry carries ids and the outcome word, nothing else.
 */

export type CloudflarePurgeRun =
  | { kind: "not-configured" }
  | { kind: "rate-limited"; nextAllowedAt: string }
  | { kind: "done"; outcome: Exclude<CloudflarePurgeOutcome, "not-configured"> };

export async function runCloudflarePurge(input: { user: { id: string }; now?: Date }): Promise<CloudflarePurgeRun> {
  const now = input.now ?? new Date();
  if (!isCloudflarePurgeConfigured()) return { kind: "not-configured" };

  const limit = await checkSystemCloudflarePurgeRateLimit(input.user.id);
  if (!limit.allowed) return { kind: "rate-limited", nextAllowedAt: nextAllowedAt(limit, now).toISOString() };

  const outcome = await purgeCloudflareCache();
  if (outcome === "not-configured") return { kind: "not-configured" };
  try {
    await writeAuditLog({
      actorUserId: input.user.id,
      action: "SYSTEM_REPORT_CLOUDFLARE_PURGE",
      entityType: "CloudflareCache",
      summary: "A system administrator cleared the Cloudflare cache from the System report.",
      metadata: { outcome },
    });
  } catch (error) {
    logError("Could not audit a Cloudflare cache purge", error);
  }
  return { kind: "done", outcome };
}
