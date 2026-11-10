import type { ReactNode } from "react";
import { PageHeader, type TitledPageHeaderProps } from "@/components/page-header";

/**
 * The detail page template (#1772): one back link to the list the page was opened from, the header, then the page's
 * sections. The back link is the header's (`back`), so there is only ever one. A detail page reached from a tab has none.
 */
export function DetailPage({
  header,
  notices,
  children,
}: {
  header: TitledPageHeaderProps;
  /** Banners under the header (view-only notices, alerts). */
  notices?: ReactNode;
  /** The sections, each a `panel` with its own `h2`. */
  children: ReactNode;
}) {
  return (
    <section className="page-stack" data-page-template="detail">
      <PageHeader {...header} />
      {notices}
      {children}
    </section>
  );
}
