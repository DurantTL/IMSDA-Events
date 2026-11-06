import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import styles from "@/components/health-access.module.css";

/**
 * One grant as the review list returns it (ids, dates, counts and the typed reason; never a health value). Declared
 * here so this component does not reach the sealed-copy module; the page passes the repository's rows, and the
 * compiler checks they fit.
 */
export type BreakGlassGrantRow = {
  id: string;
  userId: string | null;
  userDisplayName: string | null;
  personId: string | null;
  reason: string;
  grantedAt: Date | string;
  expiresAt: Date | string;
  uses: { total: number; lastUsedAt: Date | string | null; byKind: Partial<Record<string, number>> };
};

/** The repository returns at most this many grants or holds; a list that reaches it may be cut short. */
export const HEALTH_ACCESS_LIST_CAP = 200;

const KIND_LABELS = { LIVE_RECORD: "live record", SEALED_COPIES: "sealed copies" } as const;

/** Central time, labeled ("Nov 10, 2026, 2:00 PM CST"), like every time on the site (rule B13). */
const when = (value: Date | string) => formatInConferenceTime(value, { dateStyle: "medium", timeStyle: "short" });

function Grant({ grant }: { grant: BreakGlassGrantRow }) {
  const byKind = Object.entries(grant.uses.byKind).map(([kind, count]) => `${count} ${KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? kind}`);
  return (
    <li className={styles.item}>
      <dl>
        <dt>Who</dt>
        <dd>{grant.userDisplayName ?? "Unknown administrator"}</dd>
        <dt>Granted</dt>
        <dd>{when(grant.grantedAt)}</dd>
        <dt>Ends</dt>
        <dd>{when(grant.expiresAt)}</dd>
        <dt>Person id</dt>
        <dd>{grant.personId ?? "None"}</dd>
        <dt>Reason</dt>
        <dd>{grant.reason}</dd>
        <dt>Used</dt>
        <dd>{grant.uses.total === 0 || !grant.uses.lastUsedAt ? "Not used" : `${grant.uses.total} time${grant.uses.total === 1 ? "" : "s"} (${byKind.join(", ")}), last ${when(grant.uses.lastUsedAt)}`}</dd>
      </dl>
    </li>
  );
}

/**
 * Break-glass grants for the monthly review (#1617): who, when, why, whose record (an id) and until when, and how it
 * was used. Active grants first, then the history. Ids, dates, counts and the typed reason only; never a health value.
 */
export function HealthAccessGrants({ grants, now }: { grants: readonly BreakGlassGrantRow[]; now: Date }) {
  const active = grants.filter((grant) => grant.expiresAt > now);
  const past = grants.filter((grant) => grant.expiresAt <= now);
  return (
    <section aria-labelledby="break-glass-grants" className={styles.card}>
      <div className="section-heading"><h2 id="break-glass-grants">Break-glass grants</h2></div>
      <p className={styles.copy}>For the monthly review. A grant lasts 24 hours and covers one person&apos;s live health record and sealed copies. No health information is shown here.</p>
      {grants.length >= HEALTH_ACCESS_LIST_CAP && <p className={styles.copy}>Showing the latest {HEALTH_ACCESS_LIST_CAP} grants.</p>}
      <h3>Active now</h3>
      {active.length === 0 ? <p className={styles.copy}>No break-glass grant is active.</p> : <ul className={styles.list}>{active.map((grant) => <Grant grant={grant} key={grant.id} />)}</ul>}
      <h3>Review history</h3>
      {past.length === 0 ? <p className={styles.copy}>No earlier grants.</p> : <ul className={styles.list}>{past.map((grant) => <Grant grant={grant} key={grant.id} />)}</ul>}
    </section>
  );
}
