"use client";

import Link from "next/link";
import { useId, useMemo } from "react";
import { useClientSearch } from "@/components/search-as-you-type";
import { filterGuides } from "@/modules/help/visibility";
import type { PortalAudience } from "@/modules/help/types";
import styles from "@/app/(workspace)/help/help.module.css";

/** What the hub needs about one guide the server already decided this viewer may see. No viewer data. */
export type PortalHubGuide = { id: string; title: string; summary: string; audience: PortalAudience; keywords: readonly string[] };

const groups: readonly { audience: PortalAudience; title: string }[] = [
  { audience: "attendee", title: "Your registrations" },
  { audience: "director", title: "Your club" },
  { audience: "coordinator", title: "Club coordination" },
];

/**
 * The portal Help hub's guide list with a plain filter over title, summary and keywords (#1482, rules S1, S4, S5). Same
 * pieces and look as the staff hub: nothing is sent as you type, focus stays in the box, the count is announced, and Enter and
 * no-JavaScript still work (the full list is rendered by the server). The server has already chosen which guides this viewer
 * may see; this only narrows that list.
 */
export function PortalHelpSearch({ guides }: { guides: readonly PortalHubGuide[] }) {
  const inputId = useId();
  const countId = useId();
  const search = useClientSearch();
  const query = search.term;
  const shown = useMemo(() => filterGuides(guides, query), [guides, query]);
  const filtered = Boolean(query.trim());
  const count = `${shown.length} ${shown.length === 1 ? "guide" : "guides"}${filtered ? " match" : " available"}.`;

  return (
    <>
      <div className={styles.searchField}>
        <label className={styles.searchLabel} htmlFor={inputId}>Search the guides</label>
        <input
          aria-describedby={countId}
          autoComplete="off"
          className={styles.searchInput}
          id={inputId}
          {...search.inputProps}
          placeholder="For example: passkey, roster, step by step"
          type="search"
        />
        <p className={styles.count} id={countId} role="status">{count}</p>
      </div>
      {shown.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>No guide matches. Try a shorter or different word.</p>
          <button className="secondary-button" onClick={() => search.setValue("")} type="button">Show all guides</button>
        </div>
      ) : groups.map((group) => {
        const inGroup = shown.filter((guide) => guide.audience === group.audience);
        if (inGroup.length === 0) return null;
        return (
          <section aria-label={group.title} className={styles.group} key={group.audience}>
            <h2 className={styles.groupTitle}>{group.title}</h2>
            <ul className={styles.list}>
              {inGroup.map((guide) => (
                <li className={styles.card} key={guide.id}>
                  <Link className={styles.cardLink} href={`/account/help/${guide.id}`}>
                    <span className={styles.cardTitle}>{guide.title}</span>
                    <span className={styles.cardSummary}>{guide.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
