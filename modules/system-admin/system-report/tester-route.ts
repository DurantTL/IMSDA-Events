import "server-only";

import { getCurrentSession } from "@/modules/access/current-session";

const noStore = { "Cache-Control": "no-store" } as const;

export function testerJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...noStore, ...headers } });
}

/** The tester routes' shared server-side check: a signed-in system administrator, or a fixed 403 answer. */
export async function requireTesterAdmin(): Promise<{ user: { id: string } } | { response: Response }> {
  const { user } = await getCurrentSession();
  if (!user || user.globalRole !== "SYSTEM_ADMIN") {
    return { response: testerJson({ error: "SYSTEM_ADMIN_REQUIRED", message: "Only a system administrator can use the testers." }, 403) };
  }
  return { user: { id: user.id } };
}

/** The fixed 429 answer: the time the next run is allowed, so the card can say it. */
export function testerRateLimited(nextAllowedAt: string, what: "email" | "square") {
  const seconds = Math.max(1, Math.ceil((new Date(nextAllowedAt).getTime() - Date.now()) / 1000));
  return testerJson({
    error: "RATE_LIMITED",
    message: what === "email" ? "Limit reached: 3 test emails an hour." : "Limit reached: 5 Square runs an hour.",
    nextAllowedAt,
  }, 429, { "Retry-After": String(seconds) });
}
