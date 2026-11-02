/**
 * Shared unsaved-changes registry (#647). Forms register a message while they
 * hold unsaved edits; `guardedNavigate` asks once for confirmation when at
 * least one form is dirty. Today only the event picker uses it.
 * `communications-workspace` `setQuery` has its own discard confirmation, so
 * it must not be wrapped (that would prompt twice). Kept free of React so it
 * can be unit tested in the node environment.
 */

const entries = new Map<symbol, string>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

/** Registers a dirty form; the returned function unregisters it. */
export function registerUnsavedChanges(message: string): () => void {
  const key = Symbol("unsaved-changes");
  entries.set(key, message);
  notify();
  return () => {
    if (entries.delete(key)) notify();
  };
}

/** Calls `listener` whenever a form becomes dirty or clean (#1452); returns an unsubscribe. */
export function subscribeUnsavedChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Asks the person whether to leave. `GuardedLeaveConfirmer` is installed by the in-page dialog host. */
export type LeaveConfirmer = (message: string) => Promise<boolean>;
let leaveConfirmer: LeaveConfirmer | null = null;

/** Installs the in-page dialog that asks before leaving (#1452); returns a function that removes it. */
export function setLeaveConfirmer(confirmer: LeaveConfirmer): () => void {
  leaveConfirmer = confirmer;
  return () => {
    if (leaveConfirmer === confirmer) leaveConfirmer = null;
  };
}

/**
 * Asks before leaving through the in-page dialog. Only when no dialog host is
 * mounted (a page outside the root layout, a test) does it fall back to the
 * browser's own `window.confirm`.
 */
export function confirmLeave(message: string): Promise<boolean> {
  if (leaveConfirmer) return leaveConfirmer(message);
  return Promise.resolve(typeof window !== "undefined" ? window.confirm(message) : true);
}

/** How long a confirmed leave stays approved for `beforeunload`, which fires after the click. */
export const navigationPassWindowMs = 2000;
let pass: { until: number; used: boolean } | null = null;

/**
 * Records that the person just confirmed leaving, so the same navigation is not
 * asked about again by the link listener, `guardedNavigate`, the Back guard or
 * `beforeunload`. One-shot for the in-app checks (`consumeNavigationPass`); the
 * short window lets `beforeunload` see it too (`hasNavigationPass`).
 */
export function allowNextNavigation(): void {
  pass = { until: Date.now() + navigationPassWindowMs, used: false };
}

/**
 * True once for the in-app navigation that follows a confirmed leave. The pass
 * is gone afterwards, so a reload right after still warns. `keepWindow` is for
 * the link listener only: a plain link becomes a full-page navigation after the
 * click, and `beforeunload` still has to see the pass.
 */
export function consumeNavigationPass(keepWindow = false): boolean {
  if (!pass || pass.used || Date.now() > pass.until) return false;
  if (keepWindow) pass.used = true;
  else pass = null;
  return true;
}

/** Drops a pass that is no longer needed. */
export function clearNavigationPass(): void {
  pass = null;
}

/** Whether a confirmed leave is still fresh; does not use it up (for `beforeunload`). */
export function hasNavigationPass(): boolean {
  return pass !== null && Date.now() <= pass.until;
}

export function hasRegisteredUnsavedChanges(): boolean {
  return entries.size > 0;
}

/** The message of the most recently registered dirty form, or null when clean. */
export function unsavedChangesMessage(): string | null {
  let latest: string | null = null;
  for (const message of entries.values()) latest = message;
  return latest;
}

/**
 * Runs `navigate` immediately when nothing is dirty (or the person already
 * confirmed this leave); otherwise only after confirmation. Returns whether
 * navigation ran. Cancel leaves everything untouched: `navigate` is not called.
 * With a synchronous `confirm` the answer is a boolean. Without one the
 * question goes to the in-page dialog, so the answer is a promise; callers
 * must not assume navigation has happened until it resolves true.
 */
export function guardedNavigate(navigate: () => void, confirm: (message: string) => boolean): boolean;
export function guardedNavigate(navigate: () => void, confirm?: undefined): boolean | Promise<boolean>;
export function guardedNavigate(
  navigate: () => void,
  confirm?: (message: string) => boolean,
): boolean | Promise<boolean> {
  const message = unsavedChangesMessage();
  if (message === null || consumeNavigationPass()) {
    navigate();
    return true;
  }
  if (confirm) {
    if (!confirm(message)) return false;
    navigate();
    return true;
  }
  return confirmLeave(message).then((leave) => {
    if (!leave) return false;
    navigate();
    return true;
  });
}

/** What a guard returns: now for a clean page or sync confirm, later for the in-page dialog. */
export type GuardResult = boolean | Promise<boolean>;
