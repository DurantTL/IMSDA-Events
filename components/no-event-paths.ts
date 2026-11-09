/**
 * The pages a staff member with no event may open (#1077, #111, #1568). The workspace layout lets them past /no-access only for
 * these; the staff rail and tabs use the same list in tests so a no-event viewer is never shown a link that dead-ends (#1735).
 * Each page still checks its own permission on the server.
 */
export function opensWithoutEvent(target: string): boolean {
  const path = target.split("?", 1)[0].split("#", 1)[0].replace(/\/+$/, "");
  const within = (root: string) => path === root || path.startsWith(`${root}/`);
  // Help (#1077) and Home (#1568) are open to every staff member; the site content editor (#111) is open to a grant holder.
  return within("/help") || within("/home") || within("/admin/site-content");
}
