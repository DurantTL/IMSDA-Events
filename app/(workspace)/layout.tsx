import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { REQUEST_TARGET_HEADER } from "@/modules/access/login-routing";
import { profileHomeFor, resolveProfileSessions, twoStepQuery } from "@/modules/account-profile/load-profile";

export const dynamic = "force-dynamic";

/**
 * Every page under the staff/admin workspace is authenticated (#108): noindex
 * here so a page that doesn't set its own `robots` still isn't indexable.
 * Child pages inherit it unless they set `robots` themselves. Paths that
 * `robots.ts` disallows are never fetched by obeying crawlers, so the tag
 * matters mainly for workspace paths it does not list (for example /admin).
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The recorded request query when the request target is `/profile` (#646),
 * else null. `proxy.ts` sets the header (overwriting any client value).
 */
async function profileRequestQuery(): Promise<URLSearchParams | null> {
  try {
    const target = (await headers()).get(REQUEST_TARGET_HEADER) ?? "";
    const [path, query = ""] = target.split("?", 2);
    return path.replace(/\/+$/, "") === "/profile" ? new URLSearchParams(query.split("#", 1)[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Whether the request target is Help & learning (#1077): `/help` or a page below it.
 * Every staff member may open it, including staff with no event, so the shell lets
 * them in like `/profile`. Unlike `/profile`, a visitor with no staff session needs
 * no special redirect: the shell sends them to the staff login.
 */
async function isHelpRequest(): Promise<boolean> {
  try {
    const target = (await headers()).get(REQUEST_TARGET_HEADER) ?? "";
    const path = target.split("?", 1)[0].split("#", 1)[0].replace(/\/+$/, "");
    return path === "/help" || path.startsWith("/help/");
  } catch {
    return false;
  }
}

/**
 * `/profile` (#646) lives in this group so it keeps the shell. Staff with no
 * event assignment can still open their own profile (#623), so `/profile` lets
 * them in instead of /no-access. The shell would send any visitor without a
 * staff session to the staff login, and layouts render alongside pages, so the
 * page's own redirects would come too late: for `/profile` the layout decides
 * first. An attendee-only browser goes to `/account/profile`, a signed-out one
 * to the sign-in chooser. On a client-side navigation this layout is not
 * re-rendered, which only happens for an account that already had events.
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const profileQuery = await profileRequestQuery();
  if (profileQuery) {
    const sessions = await resolveProfileSessions();
    if (!sessions.staff) redirect(profileHomeFor(sessions, twoStepQuery(profileQuery.getAll("twoStep"))));
  }
  return <WorkspaceShell anyStaffWithoutEvents={Boolean(profileQuery) || await isHelpRequest()}>{children}</WorkspaceShell>;
}
