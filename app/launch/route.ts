import { getCurrentSession } from "@/modules/access/current-session";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { STAFF_LAUNCH_PATH } from "@/lib/staff-web-app";

/**
 * Where the saved app opens (#1713): the staff Home for a staff session, the account for a signed-in account, else the
 * public home page. The destination is one of these three fixed paths; nothing from the request (query string or headers)
 * ever picks it, and the answer is never cached. A failed session lookup counts as signed out, so the app still opens.
 */
export const dynamic = "force-dynamic";

const ACCOUNT_PATH = "/account";
const PUBLIC_PATH = "/";

async function launchPath(): Promise<string> {
  try {
    if ((await getCurrentSession()).user) return STAFF_LAUNCH_PATH;
    const { account, via } = await getCurrentAttendee();
    if (account && via === "attendee") return ACCOUNT_PATH;
  } catch {
    // Fall through to the public home page.
  }
  return PUBLIC_PATH;
}

export async function GET() {
  return new Response(null, {
    status: 307,
    headers: { Location: await launchPath(), "Cache-Control": "no-store" },
  });
}
