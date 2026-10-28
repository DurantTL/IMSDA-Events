import type { RoleText } from "@/modules/access/role-descriptions";

/**
 * The "Details" disclosure shown under a role's one-line summary (#1278): what the role
 * can and cannot do. Native <details>, so it needs no script and works on a phone.
 */
export function RoleDetails({ role }: { role: RoleText }) {
  if (role.can.length === 0 && role.cannot.length === 0) return null;
  return (
    <details className="role-details">
      <summary>Details<span className="sr-only"> about {role.name}</span></summary>
      <div className="role-details-body">
        {role.can.length > 0 ? (
          <div>
            <h4>Can</h4>
            <ul>{role.can.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
        ) : null}
        {role.cannot.length > 0 ? (
          <div>
            <h4>Can&apos;t</h4>
            <ul>{role.cannot.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}
