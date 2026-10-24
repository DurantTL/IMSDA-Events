import { isSystemWorkspacePath, systemNavActiveEntryKey, systemNavEntryKey, systemNavGroups } from "@/components/system-navigation";
import { withCurrentEvent } from "@/components/staff-navigation";
import { otherWorkspaceContextsForStaff } from "@/modules/access/workspace-contexts";

/**
 * Work contexts in the staff shell (#1180, slice B of #1074). System
 * administration, the selected event and My registrations are different places
 * to work, and the shell says which one is active. A context is only a place to
 * look: switching never grants a role and never replaces a page's own server
 * authorization. Every function here is pure; nothing reads or writes the
 * remembered-event cookie.
 */
export type WorkContextKind = "system" | "event" | "registrations" | "profile";

export type ActiveWorkContext = {
  kind: WorkContextKind;
  /** The short tag shown before the name. */
  kindLabel: string;
  /** What the shell calls the place: "System administration", the event name, "Your account". */
  label: string;
  /** One more line of scope, for example "All events". */
  detail: string;
};

const isProfilePath = (pathname: string) => pathname === "/profile" || pathname.startsWith("/profile/");

/**
 * Whether the System chrome (sidebar groups and the phone System menu) is drawn.
 * Only a real system administrator, and only on a System page: a plain
 * attendee, director, coordinator or limited event staff never get it.
 */
export function showsSystemChrome(input: { isSystemAdmin: boolean; pathname: string }): boolean {
  return input.isSystemAdmin && isSystemWorkspacePath(input.pathname);
}

/** Which context the page is in, and how to name it. The event name is the viewer's own, already loaded for the picker. */
export function activeWorkContext(input: { pathname: string; isSystemAdmin: boolean; eventName?: string | null }): ActiveWorkContext {
  if (showsSystemChrome(input)) {
    return { kind: "system", kindLabel: "System", label: "System administration", detail: "All events" };
  }
  if (isProfilePath(input.pathname)) {
    return { kind: "profile", kindLabel: "Account", label: "Your account", detail: "Not tied to an event" };
  }
  return { kind: "event", kindLabel: "Event", label: input.eventName?.trim() || "No event selected", detail: "Event workspace" };
}

export type WorkContextSwitch = {
  kind: WorkContextKind;
  label: string;
  /** `get` is a guarded link; `post` is the existing staff-to-attendee handoff form. */
  method: "get" | "post";
  href: string;
};

/** The way back into System: keeps the event the person already had, so the remembered event is never replaced by going there. */
export function returnToSystemHref(selectedEventId: string | null | undefined): string {
  return withCurrentEvent("/admin", selectedEventId);
}

/** A deliberate step into an event: the event is named in the URL, so it is the explicit choice. */
export function enterEventHref(eventId: string | null | undefined, path = "/overview"): string {
  return withCurrentEvent(path, eventId);
}

/**
 * The other contexts this viewer may switch into from where they are. System is
 * offered to a system administrator only; My registrations only when the
 * existing attendee handoff exists; the event only when one is selected. The
 * list excludes the active context.
 */
export function workContextSwitches(input: {
  isSystemAdmin: boolean;
  attendeeAccountAvailable: boolean;
  selectedEventId: string | null | undefined;
  active: WorkContextKind;
}): WorkContextSwitch[] {
  const switches: WorkContextSwitch[] = [];
  const others = otherWorkspaceContextsForStaff({ isSystemAdmin: input.isSystemAdmin, attendeeAccountAvailable: input.attendeeAccountAvailable });
  if (input.active !== "event" && input.selectedEventId) {
    switches.push({ kind: "event", label: "Event workspace", method: "get", href: enterEventHref(input.selectedEventId) });
  }
  for (const context of others) {
    if (context.kind === "system_admin" && input.active !== "system") {
      switches.push({ kind: "system", label: "System administration", method: "get", href: returnToSystemHref(input.selectedEventId) });
    }
    if (context.kind === "attendee") {
      switches.push({ kind: "registrations", label: context.label, method: "post", href: "/api/auth/switch-to-attendee" });
    }
  }
  return switches;
}

export type SystemMenuItem = { key: string; href: string; label: string; description: string; active: boolean };
export type SystemMenuGroup = { key: string; label: string; items: SystemMenuItem[] };

/**
 * The phone System menu: the same groups and destinations as the desktop System
 * sidebar (`systemNavGroups`), and nothing for anyone who is not a system
 * administrator. The selected event is carried in each link so it is kept, never
 * used as a filter.
 */
export function systemMenuGroups(input: { isSystemAdmin: boolean; pathname: string; selectedEventId: string | null | undefined }): SystemMenuGroup[] {
  if (!input.isSystemAdmin) return [];
  const activeKey = systemNavActiveEntryKey(input.pathname);
  return systemNavGroups.map((group) => ({
    key: group.key,
    label: group.label,
    items: group.items.map((item) => {
      const key = systemNavEntryKey(group, item);
      return { key, href: withCurrentEvent(item.href, input.selectedEventId), label: item.label, description: item.description, active: key === activeKey };
    }),
  }));
}

/** The menu stays open only while the viewer is still a system administrator; a removed role closes it on the next render. */
export function systemMenuStillAllowed(input: { isSystemAdmin: boolean }): boolean {
  return input.isSystemAdmin;
}

export type SystemMenuCloseReason = "close" | "escape" | "outside" | "navigate";

/** Focus goes back to the opener for every close except following a link, where the new page takes focus. */
export function systemMenuReturnsFocus(reason: SystemMenuCloseReason): boolean {
  return reason !== "navigate";
}
