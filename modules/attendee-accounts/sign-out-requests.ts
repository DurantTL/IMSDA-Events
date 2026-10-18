/**
 * The requests behind the My account Sign out button (#1009). The attendee
 * session is always ended; with a staff session on the browser the staff
 * session is ended too, through the existing staff logout, so the browser is
 * really signed out. One failing request never skips the other. Pure of React
 * and cookies so it is tested with a stub `fetch`.
 */
export async function postAccountSignOut(
  endStaffSession: boolean,
  send: (url: string, init: { method: "POST" }) => Promise<unknown> = (url, init) => fetch(url, init),
): Promise<void> {
  const urls = ["/api/attendee/sign-out", ...(endStaffSession ? ["/api/auth/logout"] : [])];
  for (const url of urls) {
    try {
      await send(url, { method: "POST" });
    } catch {
      // The next request still runs; the page reload shows what is actually signed in.
    }
  }
}
