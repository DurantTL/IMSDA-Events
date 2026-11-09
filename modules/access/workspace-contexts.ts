/**
 * The multi-context workspace switcher (#108): a signed-in identity may hold
 * more than one context — a staff `User` account (with event memberships and,
 * for system administrators, the whole system) and, separately, an
 * `AttendeeAccount` reached by the existing staff-to-attendee handoff
 * (`modules/attendee-accounts/current-attendee.ts`). The two session models
 * stay separate (ADR 0003); this only decides which *other* workspaces the
 * identity currently in front of us is allowed to switch into, so the UI can
 * list permitted options only and never ask anyone to choose a role they do
 * not hold.
 *
 * Pure and side-effect-free on purpose, like `login-routing.ts`: callers
 * gather what already exists elsewhere (`findSwitchableAttendeeAccountForStaff`,
 * the signed-in staff session, `currentStaffActingContext`) and pass in
 * booleans/ids; the decision of what to show is unit-testable without a
 * database, cookies, or React.
 */

export type WorkspaceContext = {
  /** Stable, machine-readable kind — never rendered directly. */
  kind: "system_admin" | "attendee" | "staff_workspace";
  href: string;
  label: string;
};

const SYSTEM_ADMIN_CONTEXT: WorkspaceContext = {
  kind: "system_admin",
  href: "/admin",
  label: "System management",
};

const ATTENDEE_CONTEXT: WorkspaceContext = {
  kind: "attendee",
  href: "/account",
  label: "My registrations",
};

const STAFF_WORKSPACE_CONTEXT: WorkspaceContext = {
  kind: "staff_workspace",
  href: "/overview",
  label: "Staff workspace",
};

/**
 * The other workspaces a signed-in **staff** identity may switch into: system
 * management, when the account is a system administrator, and the matching
 * attendee account, when one exists for the staff email (the existing
 * staff-to-attendee handoff). Neither is offered unless the account actually
 * has it — a staff member with no matching attendee account never sees an
 * attendee option, and a non-admin never sees system management.
 *
 * The account's own event workspaces are deliberately not repeated here: the
 * sidebar's event picker (`components/app-shell.tsx`) already lists exactly
 * the account's own active events, sourced the same way `resolveLoginDestination`
 * is (`modules/events/repository.ts`), so this only adds the contexts that
 * picker does not cover.
 */
export function otherWorkspaceContextsForStaff(input: {
  isSystemAdmin: boolean;
  attendeeAccountAvailable: boolean;
}): WorkspaceContext[] {
  const contexts: WorkspaceContext[] = [];
  if (input.isSystemAdmin) contexts.push(SYSTEM_ADMIN_CONTEXT);
  if (input.attendeeAccountAvailable) contexts.push(ATTENDEE_CONTEXT);
  return contexts;
}

export type WorkspaceSwitchOption = {
  kind: WorkspaceContext["kind"];
  label: string;
  href: string;
  /** The workspace the person is in now. */
  current: boolean;
  /** `get` is a guarded link; `post` is the staff-to-attendee handoff form. */
  method: "get" | "post";
};

/**
 * The account menu's workspace switcher (#1565, #108): the workspaces this signed-in staff identity holds, and no other.
 * "Staff workspace" is always there (they are in it); System management only for a system administrator; My registrations
 * only when the staff-to-attendee handoff exists. A Club portal or Area coordinator entry waits for the one-account
 * switch (ADR 0013), which gives the staff session no signal for them yet, so none is invented here. Switching needs no
 * second sign-in: System is a link, and the attendee handoff is the existing form post. Nothing here grants access.
 */
export function staffWorkspaceOptions(input: {
  isSystemAdmin: boolean;
  attendeeAccountAvailable: boolean;
  /** Where "Staff workspace" opens: the selected event's first tab, or the role's landing page. */
  staffHref: string;
  /** Whether the page is a System management page. */
  onSystemPage: boolean;
}): WorkspaceSwitchOption[] {
  const options: WorkspaceSwitchOption[] = [
    { kind: "staff_workspace", label: STAFF_WORKSPACE_CONTEXT.label, href: input.staffHref, current: !input.onSystemPage, method: "get" },
  ];
  for (const context of otherWorkspaceContextsForStaff(input)) {
    options.push({
      kind: context.kind,
      label: context.label,
      href: context.kind === "attendee" ? "/api/auth/switch-to-attendee" : context.href,
      current: context.kind === "system_admin" && input.onSystemPage,
      method: context.kind === "attendee" ? "post" : "get",
    });
  }
  return options;
}

/**
 * The other workspaces a signed-in **attendee** identity may switch into: the
 * staff workspace, and for a system administrator also system management, but
 * only when this browser also carries a live staff session (the reverse of the
 * handoff above). An attendee with no staff session never sees either option:
 * `isSystemAdmin` is ignored without one, so it can never offer System
 * management on its own. These are links only; `/overview` and `/admin` keep
 * their own server-side checks.
 */
export function otherWorkspaceContextsForAttendee(input: {
  hasStaffSession: boolean;
  isSystemAdmin?: boolean;
}): WorkspaceContext[] {
  if (!input.hasStaffSession) return [];
  return input.isSystemAdmin
    ? [STAFF_WORKSPACE_CONTEXT, SYSTEM_ADMIN_CONTEXT]
    : [STAFF_WORKSPACE_CONTEXT];
}

/**
 * What the My account header's Sign out ends (#1009). The attendee account can
 * be reached through a staff session (`getCurrentAttendee()` falls back to the
 * staff user's matching attendee account), so ending only the attendee session
 * would leave the person signed in. With a staff session Sign out ends both;
 * without one it ends the attendee session, as before. While a staff "act as"
 * is active there is no attendee sign-out at all (the staff workspace's own
 * sign-out ends it).
 */
export type AccountSignOutMode = "none" | "attendee" | "both";

export function accountSignOutMode(input: {
  hasAttendeeAccount: boolean;
  hasStaffSession: boolean;
  actingAsClubRole: boolean;
}): AccountSignOutMode {
  if (input.actingAsClubRole || !input.hasAttendeeAccount) return "none";
  return input.hasStaffSession ? "both" : "attendee";
}

