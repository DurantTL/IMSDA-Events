import type { ComponentProps, ReactNode } from "react";
import { ListPager } from "@/components/list-pager";
import { PageHeader, type TitledPageHeaderProps } from "@/components/page-header";

/**
 * The list page template (#1772): header, filters and search, the list or table (which becomes cards on a phone the way
 * every table does, rule B3), the pager. Compose the existing parts into the slots: `SearchField`/filters for `filters`,
 * the sortable table or card list for `children`, and the `ListPager` props for `pager` (rule B1: the one shared count line). The template adds no styling of its own beyond the page stack.
 */
export function ListPage({
  header,
  notices,
  filters,
  children,
  pager,
  footer,
}: {
  header: TitledPageHeaderProps;
  /** Banners above the list (a notice, a carried context). */
  notices?: ReactNode;
  /** The search box and filters, in the order the page shows them. */
  filters?: ReactNode;
  /** The list, table or empty state (rule B4). */
  children: ReactNode;
  /** The props of the shared `ListPager`; leave out for a list that never pages. */
  pager?: ComponentProps<typeof ListPager>;
  /** What sits below the list, such as a link out or a sign-out button. */
  footer?: ReactNode;
}) {
  return (
    <section className="page-stack" data-page-template="list">
      <PageHeader {...header} />
      {notices}
      {filters ? <div data-template-slot="filters">{filters}</div> : null}
      <div data-template-slot="list">{children}</div>
      {pager ? <ListPager {...pager} /> : null}
      {footer}
    </section>
  );
}
