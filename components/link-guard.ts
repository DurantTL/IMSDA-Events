import {
  allowNextNavigation,
  consumeNavigationPass,
  guardedNavigate,
  type GuardResult,
} from "@/components/unsaved-changes-registry";

/**
 * The link guard's pure rules (#1180), shared by the form hook's document-level
 * click listener and `GuardedLink`, so one click asks at most once. When the
 * listener has already asked and the person said yes, it marks the click, and
 * `GuardedLink` then navigates without asking again. Kept free of React and the
 * DOM so the behavior is unit tested in the node environment.
 */
export type ClickLike = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

const confirmedClicks = new WeakSet<object>();

/** Records that this click's navigation was already confirmed by the person. */
export function markNavigationConfirmed(click: object): void {
  confirmedClicks.add(click);
}

export function isNavigationConfirmed(click: object): boolean {
  return confirmedClicks.has(click);
}

/** A plain left-click; a modified click (new tab or window) keeps the link's normal behavior. */
export function isPlainLeftClick(click: ClickLike): boolean {
  return click.button === 0 && !click.metaKey && !click.ctrlKey && !click.shiftKey && !click.altKey;
}

type AnchorLike = {
  target: string;
  href: string;
  hasAttribute: (name: string) => boolean;
  getAttribute: (name: string) => string | null;
  click?: () => void;
};
type ListenerEvent = ClickLike & {
  defaultPrevented: boolean;
  target: unknown;
  preventDefault: () => void;
  stopPropagation: () => void;
};

/**
 * The document-level click listener a dirty form installs (`useUnsavedChangesGuard`):
 * one question for a plain click on a link that leaves the page.
 *
 * With the in-page dialog (`confirm` returns a promise) the click is always
 * stopped first and the dialog opens. On "Leave" the one-shot pass is set and
 * the same link is clicked again, so a Next `<Link>`, `GuardedLink` (with its
 * `onNavigate`) or the browser follows it normally without asking twice; on
 * "Keep editing" nothing happens. A synchronous `confirm` (a test, or a plain
 * boolean) keeps the older behavior: yes marks the click and lets it through.
 */
export function createLinkNavigationListener(options: {
  message: string;
  confirm: (message: string) => boolean | Promise<boolean>;
  currentHref: () => string;
  isAllowed: () => boolean;
  /** Follows the link again after "Leave"; defaults to `link.click()`. */
  retrigger?: (link: AnchorLike) => void;
}): (event: ListenerEvent) => void {
  return (event) => {
    if (options.isAllowed() || event.defaultPrevented || isNavigationConfirmed(event) || !isPlainLeftClick(event)) return;
    const target = event.target as { closest?: (selector: string) => AnchorLike | null } | null;
    if (!target || typeof target.closest !== "function") return;
    const link = target.closest("a[href]");
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const href = link.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    const destination = new URL(link.href, options.currentHref());
    if (destination.href === options.currentHref()) return;
    // This is the click that follows a confirmed "Leave": let it through, and tell `GuardedLink`.
    if (consumeNavigationPass()) {
      markNavigationConfirmed(event);
      return;
    }
    const answer = options.confirm(options.message);
    if (answer === true) {
      markNavigationConfirmed(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (answer === false) return;
    void answer.then((leave) => {
      if (!leave) return;
      allowNextNavigation();
      if (options.retrigger) options.retrigger(link);
      else link.click?.();
    });
  };
}

export type GuardedClickResult = "ignored" | "navigated" | "cancelled";
type GuardedClickOutcome = GuardedClickResult | Promise<Exclude<GuardedClickResult, "ignored">>;

/**
 * What `GuardedLink` does with a click. Ignored (left to the browser) when
 * something already handled it, for a modified click, a link with its own
 * target window, or a download. Otherwise the default is stopped and `run`
 * navigates: at once when the form hook already confirmed this click, else
 * through the guard, which asks once if a form is dirty and does nothing on Cancel
 * (with the in-page dialog the result is a promise).
 */
export function handleGuardedLinkClick(input: {
  event: { defaultPrevented: boolean; preventDefault: () => void; nativeEvent: ClickLike };
  target?: string;
  download?: unknown;
  run: () => void;
  guard?: (navigate: () => void) => GuardResult;
}): GuardedClickOutcome {
  const { event, target, download, run, guard = guardedNavigate } = input;
  if (event.defaultPrevented || !isPlainLeftClick(event.nativeEvent)) return "ignored";
  const ownWindow = Boolean(target) && target !== "_self";
  const isDownload = download !== undefined && download !== false;
  if (ownWindow || isDownload) return "ignored";
  event.preventDefault();
  if (isNavigationConfirmed(event.nativeEvent)) {
    run();
    return "navigated";
  }
  const answer = guard(run);
  if (typeof answer === "boolean") return answer ? "navigated" : "cancelled";
  // The in-page dialog is open: navigation runs only if the person chooses Leave.
  return answer.then((ran) => (ran ? "navigated" : "cancelled"));
}

/** Marks the extra history entry the Back guard adds while a form holds unsaved edits (#1452). */
export const backGuardMarker = "__imsdaUnsavedGuard";

type BackGuardHistory = { state: unknown; pushState: (state: unknown, unused: string, url: string) => void; back: () => void };

function isNextState(state: unknown): state is Record<string, unknown> {
  return typeof state === "object" && state !== null && Boolean((state as { __NA?: unknown }).__NA);
}

function hasBackMarker(state: unknown): boolean {
  return typeof state === "object" && state !== null && Boolean((state as Record<string, unknown>)[backGuardMarker]);
}

/**
 * Browser Back while a form has unsaved edits (#1452). When the page becomes
 * dirty it adds one history entry for the same URL (a copy of Next's state, so
 * Next's own Back handling treats it as the same page). Back then lands on the
 * original entry, still on this page, and the guard asks: "Keep editing" adds
 * the entry again and nothing changes; "Leave" goes back once more. When the
 * form was saved in place (clean), the extra entry is skipped silently. The
 * guard never navigates on its own when a save finishes. Kept free of the DOM
 * so it is unit tested in the node environment; the dialog host wires it up.
 */
export function createBackGuard(deps: {
  history: BackGuardHistory;
  href: () => string;
  message: () => string | null;
  ask: (message: string) => Promise<boolean>;
}): { onDirtyChange: () => void; onPopState: (event: { state: unknown }) => void } {
  let onSentinel = false;
  let sentinelHref = "";
  let asking = false;

  function pushSentinel() {
    const state = deps.history.state;
    // Only Next's own entries are copied; anything else would make Next reload on Back.
    if (!isNextState(state)) return;
    sentinelHref = deps.href();
    deps.history.pushState({ ...state, [backGuardMarker]: true }, "", sentinelHref);
    onSentinel = true;
  }

  return {
    onDirtyChange() {
      if (deps.message() !== null && !onSentinel) pushSentinel();
    },
    onPopState(event) {
      const wasSentinel = onSentinel;
      const nowSentinel = hasBackMarker(event.state);
      onSentinel = nowSentinel;
      if (consumeNavigationPass()) return;
      const message = deps.message();
      if (wasSentinel && !nowSentinel && deps.href() === sentinelHref) {
        if (message === null) {
          deps.history.back();
          return;
        }
        if (asking) return;
        asking = true;
        void deps.ask(message).then((leave) => {
          asking = false;
          if (leave) {
            allowNextNavigation();
            deps.history.back();
          } else if (deps.message() !== null) {
            pushSentinel();
          } else {
            // Saved while the dialog was open: nothing left to protect, so leave as Back asked.
            deps.history.back();
          }
        });
        return;
      }
      // Forward onto an extra entry whose form is gone or clean: step past it.
      if (!wasSentinel && nowSentinel && message === null) deps.history.back();
    },
  };
}
