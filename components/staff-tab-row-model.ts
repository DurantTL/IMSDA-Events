export type RowView = { key: string; label: string; href: string; current?: boolean };
export type RowTab = {
  key: string;
  label: string;
  href: string;
  count?: number;
  current?: boolean;
  views?: readonly RowView[];
};

const pathOfHref = (href: string) => href.split(/[?#]/)[0];

/**
 * `aria-current` for a tab: "page" only when the tab opens exactly the page shown, so only one link in the document says
 * "page". Another page of the tab's area (a view's page, or a page the tab does not link to) is "true".
 */
export function tabCurrent(tab: Pick<RowTab, "current" | "views" | "href">, pathname?: string): "page" | "true" | undefined {
  if (!tab.current) return undefined;
  if (tab.views?.some((view) => view.current)) return "true";
  return pathname !== undefined && pathOfHref(tab.href) !== pathname ? "true" : "page";
}

/** `aria-current` for a view, by the same rule. */
export function viewCurrent(view: Pick<RowView, "current" | "href">, pathname?: string): "page" | "true" | undefined {
  if (!view.current) return undefined;
  return pathname !== undefined && pathOfHref(view.href) !== pathname ? "true" : "page";
}

/**
 * Whether a row of tabs fits (#1734): the row's natural width against the room it has. A row collapses to its menu line only
 * when it would not fit, at any screen width, never because the screen is narrow. A row not yet measured (no width) fits.
 * Sub-pixel rounding gets a 0.5px allowance so a row that exactly fits never flips to the menu.
 */
export function tabRowFits(naturalWidth: number, room: number): boolean {
  if (!(naturalWidth > 0) || !(room > 0)) return true;
  return naturalWidth <= room + 0.5;
}
