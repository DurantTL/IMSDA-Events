import Link from "next/link";

/**
 * A column-header sort link (#1458). It used to leave the tab order on a phone, when the header row of a
 * `table-cards` table was hidden under its cards. Since #1457 a card-mode table shows its sortable headers as a
 * visible "Sort by" row above the cards (at every width where it is cards), so the link is always visible and
 * always a Tab stop. The name is kept so the server-sorted list and its tests keep one import.
 */
export function PhoneHiddenSortLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return <Link className={className} href={href}>{children}</Link>;
}
