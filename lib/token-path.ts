/**
 * The path a log line carries. The segment after `/club-forms/`, `/manage/`, `/staff-invite/` (a personal invitation link, #804)
 * or `/api/public/staff-invitations/` is a private bearer token, and so is the segment after `/health-records/` or
 * `/api/public/health-records/` (a health record link), and the segment after `/account/visiting-club/` (a visiting club's
 * invitation link). Each is replaced before it can reach a log.
 *
 * Kept free of imports so the instrumentation hook can use it without loading the request context.
 */
export function redactTokenPath(pathname: string) {
  return pathname
    .replace(/^(\/(?:api\/public\/)?(?:club-forms|manage|unsubscribe|staff-invite|staff-invitations|health-records)\/)[^/]+/, "$1[redacted]")
    .replace(/^(\/account\/visiting-club\/)[^/]+/, "$1[redacted]");
}
