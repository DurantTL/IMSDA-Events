import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActionsMenu } from "@/components/actions-menu";

/** One link in a page's "Tools" menu. */
export type StaffPageTool = {
  href: string;
  label: string;
  icon?: LucideIcon;
};

/**
 * The one header every staff page uses under the workspace topbar (#981).
 *
 * The topbar already names the page and holds the page's only `<h1>`
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
  const hasTools = Boolean(tools && tools.length > 0);
  if (!description && !primary && !actions && !hasTools && !extra) return null;
  return (
    <div className="staff-page-header">
      {description ? <p className="staff-page-description">{description}</p> : null}
      {primary || actions || hasTools || extra ? (
        <div className="staff-page-actions">
          {extra}
          {primary}
          {actions ? <ActionsMenu>{actions}</ActionsMenu> : null}
          {hasTools ? (
            <ActionsMenu label="Tools">
              {tools!.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link href={href}>{Icon ? <Icon aria-hidden="true" size={16} /> : null}{label}</Link>
                </li>
              ))}
            </ActionsMenu>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
