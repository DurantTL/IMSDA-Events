import {
  ADMIN_ROLE_LABELS,
  adminRoleSwitchNote,
  type AdminRole,
  type AdminRoleCounts,
} from "@/modules/access/admin-roles-domain";

export const ADMIN_ROLE_ENDPOINT = "/api/staff/admin-role";

/**
 * The admin role switcher (#1225): one pill per admin role the person holds,
 * the showing one highlighted, each with the count waiting in that role. A real
 * form with real buttons, so it works by keyboard and without scripts. It only
 * changes the view: server gates never read the choice.
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
      <form action={ADMIN_ROLE_ENDPOINT} className="admin-role-pills" method="post">
        {held.map((role) => {
          const count = counts[role];
          return (
            <button
              aria-pressed={role === active}
              className="admin-role-pill"
              key={role}
              name="role"
              type="submit"
              value={role}
            >
              <span>{ADMIN_ROLE_LABELS[role]}</span>
              {typeof count === "number" && count > 0 && (
                <>
                  <span aria-hidden="true" className="admin-role-count">{count > 99 ? "99+" : count}</span>
                  <span className="sr-only">{count} waiting</span>
                </>
              )}
            </button>
          );
        })}
      </form>
      {note && <p className="admin-role-note">{note}</p>}
    </section>
  );
}
