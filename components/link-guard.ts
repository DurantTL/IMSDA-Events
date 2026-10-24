import { guardedNavigate } from "@/components/unsaved-changes-registry";

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

type AnchorLike = { target: string; href: string; hasAttribute: (name: string) => boolean; getAttribute: (name: string) => string | null };
type ListenerEvent = ClickLike & {
  defaultPrevented: boolean;
  target: unknown;
  preventDefault: () => void;
  stopPropagation: () => void;
};

/**
 * The document-level click listener a dirty form installs (`useUnsavedChangesGuard`):
 * one confirm for a plain click on a link that leaves the page. A yes marks the
 * click so `GuardedLink` does not ask again; a no stops the click.
 */
export function createLinkNavigationListener(options: {
  message: string;
  confirm: (message: string) => boolean;
  currentHref: () => string;
  isAllowed: () => boolean;
}): (event: ListenerEvent) => void {
  return (event) => {
    if (options.isAllowed() || event.defaultPrevented || !isPlainLeftClick(event)) return;
    const target = event.target as { closest?: (selector: string) => AnchorLike | null } | null;
    if (!target || typeof target.closest !== "function") return;
    const link = target.closest("a[href]");
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const href = link.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    const destination = new URL(link.href, options.currentHref());
    if (destination.href === options.currentHref()) return;
    if (options.confirm(options.message)) {
      markNavigationConfirmed(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
}

export type GuardedClickResult = "ignored" | "navigated" | "cancelled";

/**
 * What `GuardedLink` does with a click. Ignored (left to the browser) when
 * something already handled it, for a modified click, a link with its own
 * target window, or a download. Otherwise the default is stopped and `run`
 * navigates: at once when the form hook already confirmed this click, else
 * through the guard, which asks once if a form is dirty and does nothing on Cancel.
 */
export function handleGuardedLinkClick(input: {
  event: { defaultPrevented: boolean; preventDefault: () => void; nativeEvent: ClickLike };
  target?: string;
  download?: unknown;
  run: () => void;
  guard?: (navigate: () => void) => boolean;
}): GuardedClickResult {
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
  return guard(run) ? "navigated" : "cancelled";
}
