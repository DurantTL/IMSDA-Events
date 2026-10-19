import { getCurrentSession } from "@/modules/access/current-session";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { getAdminAttentionSummary } from "@/modules/system-admin/attention-repository";

/**
 * The system administrator notification bell (#1032). Counts span every event, so this is gated on the global role,
 * checked here on the server; the bell is only rendered for system administrators, but hiding it is not the control.
 * Read only. `private, no-store` so neither a shared cache nor the browser holds it (opening the panel must read
 * again); the server's shared 30 second answer keeps a busy page from turning into a query storm.
 */
async function getHandler() {
  const { user } = await getCurrentSession();
  if (!user || user.globalRole !== "SYSTEM_ADMIN") {
    return Response.json(
      { error: "SYSTEM_ADMIN_REQUIRED", message: "Only a system administrator can see this." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    return Response.json({ attention: await getAdminAttentionSummary() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logError("Loading the admin notification bell failed", error);
    return Response.json(
      { error: "ATTENTION_UNAVAILABLE", message: "Notifications could not be loaded." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = withRequestContext(getHandler);
