import type { ReactNode } from "react";
import { PageHeader, type PageHeaderTool } from "@/components/page-header";

/** One link in a page's "Tools" menu. */
export type StaffPageTool = PageHeaderTool;

/**
 * The header most staff pages use under the workspace topbar (#981). Legacy since #1772: it renders through
 * `PageHeader` in its title-less mode, so there is one place to change; new pages use `PageHeader` or a page template
 * with a title instead.
 *
 * The shell already names the page and holds the page's only `<h1>`
 * (`staffSubpageTitle`), so this draws no heading and no eyebrow: just an
 * optional one-line `description` on the left and, on the right, one `primary`
 * action, then secondary work in an "Actions" menu (`actions`, `<li>` items)
 * and links to the page's sub-pages in a "Tools" menu (`tools`). A page with
 * none of the three renders nothing.
 *
 * Tools are only for destinations the sidebar and More do not already list; a
 * link that copies them should be removed, not folded in.
 */
export function StaffPageHeader({
  description,
  primary,
  actions,
  tools,
  extra,
}: {
  description?: ReactNode;
  primary?: ReactNode;
  actions?: ReactNode;
  tools?: readonly StaffPageTool[];
  /** Something small that sits beside the actions, such as a count badge. */
  extra?: ReactNode;
}) {
  return (
    <PageHeader
      actions={actions}
      description={description}
      extra={extra}
      legacy={{ root: "staff-page-header", description: "staff-page-description", actions: "staff-page-actions" }}
      primary={primary}
      tools={tools}
    />
  );
}
