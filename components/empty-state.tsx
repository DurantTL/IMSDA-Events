import Link from "next/link";
import { Search } from "lucide-react";
import type { ReactNode } from "react";

export type EmptyStateAction = { label: string; href?: string; onClick?: () => void };

/**
 * The create action an empty state may offer (#743). Only an authorized viewer
 * gets one: without permission the state still explains what is missing, but
 * offers nothing the server would refuse. The server decides again either way.
 */
export function emptyStateAction(canCreate: boolean, action: EmptyStateAction | undefined): EmptyStateAction | null {
  return canCreate && action ? action : null;
}

/** What is missing, why, and (when allowed) how to add it. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  canCreate = false,
  hint,
  actionClass = "primary-button",
  className = "empty-state",
  headingLevel = 3,
  announce = true,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: EmptyStateAction;
  /** Whether the viewer may create what is missing. Defaults to false: no action. */
  canCreate?: boolean;
  /** Shown instead of the action to a viewer who cannot create. */
  hint?: string;
  /** "secondary-button" when the page already has its one filled primary action. */
  actionClass?: "primary-button" | "secondary-button";
  className?: string;
  /** The title's heading level; pass the one that follows the heading above it. Defaults to 3. */
  headingLevel?: 2 | 3 | 4;
  /**
   * True (default): a polite status. False when the empty state is just the visible result of a search or filter, or is
   * present at first render: no live region, so typing never re-announces it. "alert" for a failure the viewer must hear now.
   */
  announce?: boolean | "alert";
}) {
  const Heading = `h${headingLevel}` as const;
  const offered = emptyStateAction(canCreate, action);
  return (
    <div className={className} role={announce === "alert" ? "alert" : announce ? "status" : undefined}>
      {icon}
      <Heading>{title}</Heading>
      {children && <p>{children}</p>}
      {offered && (offered.href
        ? <Link className={actionClass} href={offered.href} onClick={offered.onClick}>{offered.label}</Link>
        : <button className={actionClass} onClick={offered.onClick} type="button">{offered.label}</button>)}
      {!offered && hint && <p className="empty-state-hint">{hint}</p>}
    </div>
  );
}

/**
 * "Nothing matches" (#1449, rule 4): a search or filter found nothing, which is
 * not the same as the list being empty. Names what was searched, says how to
 * get the rows back, and offers "Clear filters". It never offers the create
 * action or says "yet". Pass an `href` for a server list, an `onClick` for a
 * client list. `known` is a sentence stating the unfiltered total; pass it only
 * when that total is actually known.
 */
export function NoMatchesState({
  noun,
  query,
  known,
  clear,
  icon,
  className = "empty-state panel",
  headingLevel = 3,
  announce = false,
}: {
  /** Plural noun for what is listed, e.g. "registrations". */
  noun: string;
  /** The text searched for; empty or omitted when only non-text filters are set. */
  query?: string;
  known?: string;
  clear: { href?: string; onClick?: () => void };
  icon?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3 | 4;
  /** Defaults to false: this is the visible result of a search, so typing never re-announces it. */
  announce?: boolean;
}) {
  const text = (query ?? "").trim();
  return (
    <EmptyState
      action={{ label: "Clear filters", ...clear }}
      actionClass="primary-button"
      announce={announce}
      canCreate
      className={className}
      headingLevel={headingLevel}
      icon={icon ?? <Search aria-hidden="true" size={24} />}
      title={text ? `No ${noun} match "${text}"` : `No ${noun} match these filters`}
    >
      {`${known ? `${known} ` : ""}${text ? "Check the spelling, or clear the search and filters to see them all." : "Clear the filters to see them all."}`}
    </EmptyState>
  );
}
