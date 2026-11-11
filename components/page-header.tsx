import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActionsMenu } from "@/components/actions-menu";
import { BackLink } from "@/components/back-link";
import { NavigationLink as Link } from "@/components/navigation-link";
import styles from "./page-header.module.css";

/** One link in a page's "Tools" menu. */
export type PageHeaderTool = {
  href: string;
  label: string;
  icon?: LucideIcon;
};

type PageHeaderParts = {
  /** One sentence in the muted colour. Longer help goes to Help & learning. */
  description?: ReactNode;
  /** The page's one filled button, shown beside the title. */
  primary?: ReactNode;
  /** A second button beside the title, outlined. At most two buttons show beside the title. */
  secondary?: ReactNode;
  /** More work in one "Actions" menu (`<li>` items). */
  actions?: ReactNode;
  /** Links to the page's sub-pages in a "Tools" menu. */
  tools?: readonly PageHeaderTool[];
  /** Something small beside the actions, such as a count badge. */
  extra?: ReactNode;
  /** Local tabs or anchors under the title. */
  below?: ReactNode;
};

/** The class names a legacy wrapper keeps, so the pages and tests that rely on them are unchanged. */
export type PageHeaderLegacy = {
  root: string;
  description?: string;
  actions?: string;
  eyebrow?: string;
  testId?: string;
  data?: Record<string, string | undefined>;
};

export type TitledPageHeaderProps = PageHeaderParts & {
  /** The page's one `h1`: the same words as the tab, menu item or hub card that opened the page. */
  title: string;
  /** A club or church name: marked so a browser translator leaves it as written. */
  exactName?: boolean;
  /** Only when it adds something the title and tabs do not say (a step number, a club year). Never the area, the event or the title again. */
  eyebrow?: ReactNode;
  /** Only on a detail page reached from a list. */
  back?: { href: string; label: string };
  legacy?: undefined;
};

type LegacyPageHeaderProps = PageHeaderParts & {
  title?: undefined;
  eyebrow?: ReactNode;
  back?: { href: string; label: string };
  /**
   * Legacy "the shell draws the title" mode, used only by `StaffPageHeader` and the admin section header. The page's
   * `h1` is drawn by the staff shell (`components/page-header-routes.ts` lists the pages that draw their own instead),
   * so this draws none. New pages pass a `title` and never this.
   */
  legacy: PageHeaderLegacy;
};

export type PageHeaderProps = TitledPageHeaderProps | LegacyPageHeaderProps;

function HeaderActions({ primary, secondary, actions, tools, extra, className }: Pick<PageHeaderParts, "primary" | "secondary" | "actions" | "tools" | "extra"> & { className: string }) {
  const hasTools = Boolean(tools && tools.length > 0);
  if (!primary && !secondary && !actions && !hasTools && !extra) return null;
  return (
    <div className={className}>
      {extra}
      {primary}
      {secondary}
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
  );
}

/**
 * The one header at the top of a staff page's content (#1772): an optional single back link, the title (the page's one
 * `h1`), an optional one-sentence description, the page's one filled main action and at most one outlined button beside
 * the title, an Actions menu and a Tools menu. Below 640px the actions drop under the title, full width.
 * Spec: `docs/design-system/components/PageHeader/README.md`; rules D1 to D4 in `docs/SITE-RULES.md`.
 *
 * A page that renders this with a `title` draws its own `h1`, so its route is listed in `components/page-header-routes.ts`
 * and the staff shell does not draw a second one. Inside an event the event name is in the shell's crumb row; this shows
 * no event chip. The title-less `legacy` mode keeps the older header parts working; see `PageHeaderLegacy`.
 */
export function PageHeader(props: PageHeaderProps) {
  const { description, primary, secondary, actions, tools, extra, below, eyebrow, back } = props;
  if (props.legacy) {
    const { legacy } = props;
    const hasActions = Boolean(primary || secondary || actions || (tools && tools.length > 0) || extra);
    if (!description && !hasActions && !eyebrow && !back && !below) return null;
    const dataAttributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(legacy.data ?? {})) if (value !== undefined) dataAttributes[`data-${key}`] = value;
    return (
      <div className={legacy.root} data-testid={legacy.testId} {...dataAttributes}>
        {eyebrow ? <p className={legacy.eyebrow ?? "eyebrow"}>{eyebrow}</p> : null}
        {description ? <p className={legacy.description}>{description}</p> : null}
        {below}
        <HeaderActions actions={actions} className={legacy.actions ?? ""} extra={extra} primary={primary} secondary={secondary} tools={tools} />
        {back ? <BackLink href={back.href} variant="staff">{back.label}</BackLink> : null}
      </div>
    );
  }
  return (
    <header className={`page-header ${styles.header}`} data-page-header="">
      {back ? <BackLink href={back.href} variant="staff">{back.label}</BackLink> : null}
      <div className={styles.row}>
        <div className={`page-header-text ${styles.text}`}>
          {eyebrow ? <p className={`eyebrow ${styles.eyebrow}`}>{eyebrow}</p> : null}
          <h1 className={styles.title} translate={props.exactName ? "no" : undefined}>{props.title}</h1>
          {description ? <p className={`page-header-description ${styles.description}`}>{description}</p> : null}
        </div>
        <HeaderActions actions={actions} className={`page-header-actions ${styles.actions}`} extra={extra} primary={primary} secondary={secondary} tools={tools} />
      </div>
      {below ? <div className={styles.below}>{below}</div> : null}
    </header>
  );
}
