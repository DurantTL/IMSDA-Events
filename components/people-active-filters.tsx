"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import styles from "./people-directory.module.css";

export const PEOPLE_STATUS_ID = "people-status";

type Chip = { key: string; label: string; removeLabel: string; href: string };

/**
 * The active filter chips and Clear all (#1321). They are plain links, so they work without JavaScript. With it, a
 * click remembers where focus should go (the next chip's remove link, else the previous one, else the result count),
 * and once the new list arrives focus moves there instead of being lost to the page body.
 */
export function PeopleActiveFilters({ chips, clearHref }: { chips: readonly Chip[]; clearHref: string }) {
  const listRef = useRef<HTMLUListElement>(null);
  const targets = useRef<string[] | null>(null);
  const signature = chips.map((chip) => chip.key).join("|");

  useEffect(() => {
    const wanted = targets.current;
    if (!wanted) return;
    targets.current = null;
    for (const key of wanted) {
      const element = key === "status"
        ? document.getElementById(PEOPLE_STATUS_ID)
        : listRef.current?.querySelector<HTMLElement>(`[data-chip="${CSS.escape(key)}"]`);
      if (element) {
        element.focus();
        return;
      }
    }
  }, [signature]);

  if (chips.length === 0) return null;
  const remember = (index: number) => () => {
    targets.current = [...chips.slice(index + 1).map((chip) => chip.key), ...chips.slice(0, index).reverse().map((chip) => chip.key), "status"];
  };
  return (
    <div className={styles.activeBar}>
      <ul aria-label="Active filters" className={styles.activeList} ref={listRef}>
        {chips.map((chip, index) => (
          <li className={styles.activeChip} key={chip.key}>
            <span>{chip.label}</span>
            <Link aria-label={chip.removeLabel} className={styles.remove} data-chip={chip.key} href={chip.href} onClick={remember(index)}>
              <span aria-hidden="true">&times;</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link className={styles.clearAll} href={clearHref} onClick={() => { targets.current = ["status"]; }}>Clear all</Link>
    </div>
  );
}
