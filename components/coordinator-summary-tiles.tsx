import type { ReactNode } from "react";
import styles from "./coordinator-summary-tiles.module.css";

export type CoordinatorTile = { label: string; value: ReactNode; detail?: string; icon: ReactNode };

/**
 * Summary tiles for the coordinator pages, in the club portal's tile style (#1555): the club home's `club-home-counts`
 * grid and `club-home-count` tile, with an icon beside each label. Counts only; the caller decides every value.
 */
export function CoordinatorSummaryTiles({ tiles, label, headingId }: { tiles: readonly CoordinatorTile[]; label?: string; headingId?: string }) {
  return (
    <section aria-label={headingId ? undefined : label} aria-labelledby={headingId}>
      <dl className={`club-home-counts ${styles.tiles}`}>
        {tiles.map((tile) => (
          <div className="club-home-count" key={tile.label}>
            <dt className={styles.label}>
              <span aria-hidden="true" className={styles.icon}>{tile.icon}</span>
              <span>{tile.label}</span>
            </dt>
            <dd className="club-home-count-value">{tile.value}</dd>
            {tile.detail && <dd className="club-home-count-definition">{tile.detail}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}
