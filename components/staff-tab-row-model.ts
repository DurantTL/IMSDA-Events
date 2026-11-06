export type RowView = { key: string; label: string; href: string; current?: boolean };
export type RowTab = {
  key: string;
  label: string;
  href: string;
  count?: number;
  current?: boolean;
  views?: readonly RowView[];
};

/** `aria-current` for a tab: "page" on its own page; "true" when one of its views is the page, so only one link says "page". */
export function tabCurrent(tab: Pick<RowTab, "current" | "views">): "page" | "true" | undefined {
  if (!tab.current) return undefined;
  return tab.views?.some((view) => view.current) ? "true" : "page";
}
