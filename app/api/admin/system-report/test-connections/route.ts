import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { withRequestContext } from "@/lib/request-context";
import { runConnectionTests } from "@/modules/system-admin/system-report/connection-tests";

/**
 * Runs the System report's read-only connection tests (#1357) on demand: never on page load. System administrators
 * only, checked here on the server, with the same same-origin check as the other admin POST routes. It sends no email
 * and makes no charge; the answer is four fixed words per service (reachable, refused, unavailable, not-configured), for email, Square, Google sign-in keys, the password breach service, the Apple Pay domain file and our own calendar feed (#1380); all are GET-only, never a provider message, host, key or URL.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const { user } = await getCurrentSession();
  if (!user || user.globalRole !== "SYSTEM_ADMIN") {
    return Response.json(
      { error: "SYSTEM_ADMIN_REQUIRED", message: "Only a system administrator can test connections." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const results = await runConnectionTests();
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = withRequestContext(postHandler);
