import Link from "next/link";
import styles from "./month-heading-link.module.css";

/**
 * The link that sits beside a month heading in a full-year grid (#1842): it opens that month's view (every club for the
 * month). It is separate from the heading's sort control, so sorting keeps working. The name is "<Month Year> records".
 */
export function MonthHeadingLink({ href, label }: { href: string; label: string }) {
  return (
    <Link className={styles.link} href={href} prefetch={false}>
      <span aria-hidden="true">›</span>
      <span className="sr-only">{label} records</span>
    </Link>
  );
}

/**
 * A club-month cell's link to that club's record (#1842). `name` is the full accessible name
 * ("<Club>, <Month Year>: <status>"); the children are the visible text (points or the status word).
 */
export function RecordCellLink({ href, name, children }: { href: string; name: string; children: React.ReactNode }) {
  return <Link aria-label={name} className={styles.cell} href={href} prefetch={false}>{children}</Link>;
}
