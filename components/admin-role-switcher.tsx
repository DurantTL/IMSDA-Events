import {
  ADMIN_ROLE_LABELS,
  adminRoleSwitchNote,
  type AdminRole,
  type AdminRoleCounts,
} from "@/modules/access/admin-roles-domain";

/** Where a pill goes: a GET route outside /api (`app/(workspace)/admin-role/[role]/route.ts`). */
export function adminRoleSwitchHref(role: AdminRole): string {
  return `/admin-role/${role}`;
}

/**
 * The admin role switcher (#1225): one pill per admin role the person holds,
 * the showing one highlighted, each with the count waiting in that role. Plain
 * links, so they work by keyboard and without scripts. Not next/link: the GET
 * sets the view cookie, so it must never be prefetched. A form POST to /api
 * drew a Cloudflare challenge on every click. It only changes the view: server
 * gates never read the choice.
 */
export function AdminRoleSwitcher({
  held,
  active,
  counts = {},
}: {
  held: readonly AdminRole[];
  active: AdminRole | null;
  counts?: AdminRoleCounts;
}) {
  if (held.length === 0) return null;
  const note = adminRoleSwitchNote(held);
  return (
    <section className="admin-role-bar" aria-label="Admin role">
      <div className="admin-role-pills">
        {held.map((role) => {
          const count = counts[role];
          return (
            <a
              aria-current={role === active ? "page" : undefined}
              className="admin-role-pill"
              href={adminRoleSwitchHref(role)}
              key={role}
            >
              <span>{ADMIN_ROLE_LABELS[role]}</span>
              {typeof count === "number" && count > 0 && (
                <>
                  <span aria-hidden="true" className="admin-role-count">{count > 99 ? "99+" : count}</span>
                  <span className="sr-only">{count} waiting</span>
                </>
              )}
            </a>
          );
        })}
      </div>
      {note && <p className="admin-role-note">{note}</p>}
    </section>
  );
}
