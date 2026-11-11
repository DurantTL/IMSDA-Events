import { SortableHeader } from "@/components/list-sort";
import { MonthHeadingLink } from "@/components/month-heading-link";
import type { ServerSort } from "@/lib/list-sort";

/**
 * A column header of a server-rendered table (#1458): a sort link when the page passed `sorting` (from `serverSort`),
 * a plain header otherwise. This file is deliberately not a client module: `sorting` holds the function `hrefFor`,
 * which cannot cross into a client component, so the href is worked out here and the client `SortableHeader` gets
 * plain strings and booleans only.
 */
export function ColumnHeader<K extends string>({ column, label, sorting, className, hiddenLabel, monthLink }: {
  column: K;
  label: string;
  sorting?: ServerSort<K>;
  className?: string;
  hiddenLabel?: string;
  /** A month column's link to that month's view (#1842), beside the sort control, never in place of it. */
  monthLink?: { href: string; label: string };
}) {
  const after = monthLink ? <MonthHeadingLink href={monthLink.href} label={monthLink.label} /> : undefined;
  if (!sorting) return <th className={className} role="columnheader" scope="col">{label}{hiddenLabel && <span className="sr-only">, {hiddenLabel}</span>}{after}</th>;
  return <SortableHeader active={sorting.order.key === column} className={className} direction={sorting.order.dir} after={after} hiddenLabel={hiddenLabel} href={sorting.hrefFor(column)} label={label} />;
}
