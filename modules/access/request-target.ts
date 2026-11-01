// Staff workspace pages and the signed-in account area, so a signed-out visit
// can sign in and come back (#568). Only these get the request-target header.
export const requestTargetPrefixes = [
  "/account",
  "/admin",
  "/check-in",
  "/communications",
  "/community",
  "/finance",
  "/help",
  "/imports",
  "/information-forms",
  "/more",
  "/overview",
  "/profile",
  "/people",
  "/registration-builder",
  "/staff",
  "/event-setup",
  "/events-admin",
];
export const requestTargetExactPaths = ["/no-access", "/select-event", "/archived-events"];

/** True for the paths where `proxy.ts` records the request target (#108, #568). Keep in step with its matcher. */
export function wantsRequestTarget(pathname: string) {
  return requestTargetExactPaths.includes(pathname)
    || requestTargetPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

