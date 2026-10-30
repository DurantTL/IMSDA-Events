import type { RoleText } from "@/modules/access/role-descriptions";
import styles from "@/components/role-details.module.css";

/**
 * The "Details" disclosure shown under a role's one-line summary (#1278): what the role
 * can and cannot do. Native <details>, so it needs no script and works on a phone.
 */
export function RoleDetails({ role }: { role: RoleText }) {
  if (role.can.length === 0 && role.cannot.length === 0) return null;
  // `role-details` stays as a stable hook: people-directory.module.css targets it.
  return (
    <details className={`${styles.roleDetails} role-details`}>
      <summary>Details<span className="sr-only"> about {role.name}</span></summary>
      <div className={styles.roleDetailsBody}>
        {role.can.length > 0 ? (
          <div>
            <p className={styles.roleDetailsLabel}>Can</p>
            <ul>{role.can.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
        ) : null}
        {role.cannot.length > 0 ? (
          <div>
            <p className={styles.roleDetailsLabel}>Can&apos;t</p>
            <ul>{role.cannot.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}
