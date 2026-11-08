import { ArrowRight } from "lucide-react";
import { NavigationLink as Link } from "@/components/navigation-link";
import styles from "@/components/admin-hub.module.css";
import type { HubBody, HubCard } from "@/modules/system-admin/admin-hubs-model";

/** The shared chip colours (`.status-chip` in globals.css): status words always, colour only as a second cue. */
const chipClass = { ok: "green", warn: "coral", review: "purple", soon: "gold", draft: "neutral" } as const;

/**
 * One Admin hub page body (#1569): the key numbers, the one main action, then a card for each destination with its own
 * status. The page title is the workspace topbar's heading. Everything here is a link: nothing approves, publishes, sends
 * or changes a record. A status says its words ("Unavailable", "1 to review"), never colour alone.
 */
export function AdminHub({ view }: { view: HubBody }) {
  const stats = view.stats ?? [];
  return (
    <div className={styles.hub} data-testid={`admin-hub-${view.key}`}>
      <div className={styles.intro}>
        <p className={styles.introText}>{view.description}</p>
        {view.action ? (
          <Link className={styles.action} href={view.action.href} data-testid="hub-action">
            {view.action.label}
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        ) : null}
      </div>

      {stats.length > 0 ? (
        <section aria-labelledby="hub-stats-heading">
          <h2 id="hub-stats-heading" className="sr-only">Key numbers</h2>
          <ul className={`metric-grid ${styles.stats}`} data-testid="hub-stats" data-count={stats.length}>
            {stats.map((stat) => (
              <li key={stat.key} className={`metric-card ${styles.stat}`} data-metric={stat.key} data-unavailable={stat.value === null ? "true" : undefined}>
                <strong className={styles.statValue}>{stat.display}</strong>
                <p className={styles.statLabel}>{stat.value === null ? `${stat.label}: could not be read just now` : stat.label}</p>
                {stat.note ? <small className={styles.statNote}>{stat.note}</small> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.groups.map((group, index) => (
        <HubCardGroup key={`${group.title}-${index}`} headingId={`hub-group-${index}`} title={group.title} cards={group.cards} />
      ))}
    </div>
  );
}

/**
 * One titled group of destination cards. Shared by the hubs and by a page that groups its own related links (the selected
 * club, #1587): the cards fill their row 2, 3 or 4 across, four become 2 x 2 on an iPad and one per row on a phone, and a
 * status that could not be read says "Unavailable". Every card is a plain link.
 */
export function HubCardGroup({ headingId, title, cards, testId = "hub-card" }: { headingId: string; title: string; cards: readonly HubCard[]; testId?: string }) {
  if (cards.length === 0) return null;
  return (
    <section className={styles.group} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.groupHeading}>{title}</h2>
      <ul className={styles.cards} data-count={cards.length}>
        {cards.map((card) => (
          <li key={card.href}>
            <Link className={styles.card} href={card.href} data-testid={testId}>
              <span className={styles.cardTop}>
                <span className={styles.cardTitle}>{card.title}</span>
                {card.status ? <span className={`status-chip ${chipClass[card.status.tone]} ${styles.chip}`} data-tone={card.status.tone}>{card.status.text}</span> : null}
              </span>
              <span className={styles.cardText}>{card.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
