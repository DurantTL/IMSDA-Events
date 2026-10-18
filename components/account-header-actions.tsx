import Link from "next/link";
import { LayoutDashboard, ShieldCheck } from "lucide-react";
import { AttendeeSignOutButton } from "@/components/attendee-sign-out-button";
import type { WorkspaceContext } from "@/modules/access/workspace-contexts";

/**
 * The right side of the My account header (#1009): the staff and system links
 * a browser with a live staff session may use (`otherWorkspaceContextsForAttendee`
 * decides which), next to Sign out, which stays whenever an attendee account is
 * shown. Links only; `/overview` and `/admin` check access themselves.
 */
export function AccountHeaderActions({
  contexts,
  showSignOut,
}: {
  contexts: WorkspaceContext[];
  showSignOut: boolean;
}) {
  return (
    <div className="public-header-links">
      {contexts.map((context) => (
        <Link className="text-button" href={context.href} key={context.kind}>
          {context.kind === "system_admin"
            ? <ShieldCheck size={16} aria-hidden="true" />
            : <LayoutDashboard size={16} aria-hidden="true" />}
          {" "}<span>{context.label}</span>
        </Link>
      ))}
      {showSignOut && <AttendeeSignOutButton />}
    </div>
  );
}
