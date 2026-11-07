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
