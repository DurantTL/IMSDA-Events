import type { listSnapshotBreakGlassGrants } from "@/modules/health-records/snapshot-access-repository";
import styles from "@/components/health-access.module.css";

export type BreakGlassGrantRow = Awaited<ReturnType<typeof listSnapshotBreakGlassGrants>>[number];

/** A fixed, zone-explicit format, so the server render never depends on the viewer's locale. */
export function formatGrantInstant(value: Date | string | null) {
  if (!value) return "Never";
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const KIND_LABELS = { LIVE_RECORD: "live record", SEALED_COPIES: "sealed copies" } as const;

function Grant({ grant }: { grant: BreakGlassGrantRow }) {
  const byKind = Object.entries(grant.uses.byKind).map(([kind, count]) => `${count} ${KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? kind}`);
  return (
    <li className={styles.item}>
      <dl>
        <dt>Who</dt>
        <dd>{grant.userDisplayName ?? "Unknown administrator"}</dd>
        <dt>Granted</dt>
        <dd>{formatGrantInstant(grant.grantedAt)}</dd>
        <dt>Ends</dt>
        <dd>{formatGrantInstant(grant.expiresAt)}</dd>
        <dt>Person id</dt>
        <dd>{grant.personId ?? "None"}</dd>
        <dt>Reason</dt>
        <dd>{grant.reason}</dd>
        <dt>Used</dt>
        <dd>{grant.uses.total === 0 ? "Not used" : `${grant.uses.total} time${grant.uses.total === 1 ? "" : "s"} (${byKind.join(", ")}), last ${formatGrantInstant(grant.uses.lastUsedAt)}`}</dd>
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
      <h2 id="break-glass-grants">Break-glass grants</h2>
      <p className={styles.copy}>For the monthly review. A grant lasts 24 hours and covers one person&apos;s live health record and sealed copies. No health information is shown here.</p>
      <h3>Active now</h3>
      {active.length === 0 ? <p className={styles.copy}>No break-glass grant is active.</p> : <ul className={styles.list}>{active.map((grant) => <Grant grant={grant} key={grant.id} />)}</ul>}
      <h3>Review history</h3>
      {past.length === 0 ? <p className={styles.copy}>No earlier grants.</p> : <ul className={styles.list}>{past.map((grant) => <Grant grant={grant} key={grant.id} />)}</ul>}
    </section>
  );
}
