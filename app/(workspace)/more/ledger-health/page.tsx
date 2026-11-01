import { ExactValue, Money } from "@/components/exact-value";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, HeartPulse, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { AccessRestricted } from "@/components/access-restricted";
import { staffPageTitles } from "@/components/staff-navigation";
import { getPrisma } from "@/lib/prisma";
import { reconcileRegistrationLedger } from "@/modules/ledger/reconciliation";
import { resolveEventContext } from "@/modules/events/selection";
import styles from "../health/operational-health.module.css";

export const metadata: Metadata = { title: staffPageTitles.ledgerCheck };

const visibleRowLimit = 50;

function words(value: string) {
  return value
    .toLocaleLowerCase("en-US")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase("en-US"));
}

/**
 * Read-only shadow check (#117): the new append-only ledger against each registration's current total. Same permission
 * as the Payments page (MANAGE_FINANCE), checked here on the server. Nothing on this page writes.
 */
export default async function LedgerCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const requested = (await searchParams).event;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_FINANCE")) {
    return (
      <AccessRestricted
        title="Ledger check is restricted"
        detail="Only event administrators and finance managers can compare registration totals with the ledger. Ask an event administrator if you need finance access."
      />
    );
  }

  const { checked, failing } = await reconcileRegistrationLedger(getPrisma(), { eventId: event.id });
  const eventQuery = `event=${encodeURIComponent(event.id)}`;
  const shown = failing.slice(0, visibleRowLimit);

  return (
    <section className={`page-stack ${styles.workspace}`}>
      <div className="page-intro">
        <div>
          <p className="eyebrow">Running beside today&apos;s totals</p>
          <h2 className="duplicate-page-title">{staffPageTitles.ledgerCheck}</h2>
          <p>
            The ledger is a new record of every charge and credit on a registration. For {event.name} it is being kept
            beside each registration&apos;s current total so the two can be compared before anything relies on it. This
            page compares them and changes nothing: the current total is still the number everyone sees and pays.
          </p>
        </div>
        <div className={styles.introActions}>
          <Link className="secondary-button" href={`/more/ledger-health?${eventQuery}`}>
            <RefreshCw aria-hidden="true" size={15} />
            Check again
          </Link>
        </div>
      </div>

      <div className={styles.scopeNote}>
        <ShieldCheck aria-hidden="true" size={20} />
        <div>
          <strong>Only registrations that differ are listed.</strong>
          <p>
            Some changes are not recorded in the ledger yet: staff adjustments, card fees, payment-choice changes, club
            transfers, direct total edits, and imports that update an existing registration. A registration changed that
            way is expected to appear here until a later step covers it. A registration made before the ledger shows
            &quot;No ledger entries&quot; until an administrator runs the one-time backfill.
          </p>
        </div>
      </div>

      {failing.length === 0 ? (
        <div className={styles.healthyState} role="status">
          <HeartPulse aria-hidden="true" size={22} />
          <div>
            <strong>The ledger matches every registration.</strong>
            <p>{checked} {checked === 1 ? "registration was" : "registrations were"} checked and none differ.</p>
          </div>
        </div>
      ) : (
        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div className={styles.sectionTitle}>
              <span className={styles.sectionIcon}><TriangleAlert aria-hidden="true" size={20} /></span>
              <div>
                <h2>Registrations that differ</h2>
                <p>{failing.length} of {checked} {checked === 1 ? "registration" : "registrations"} checked. Difference is the current total minus the ledger.</p>
              </div>
            </div>
            <span className={styles.count}>{failing.length} {failing.length === 1 ? "item" : "items"}</span>
          </div>
          <ul className={styles.issueList}>
            {shown.map((row) => (
              <li className={styles.issue} key={row.registrationId}>
                <div className={styles.issueMain}>
                  <div className={styles.issueTitle}>
                    <strong><ExactValue>{row.confirmationCode}</ExactValue> · {words(row.status)}</strong>
                    <span className={`${styles.badge} ${row.hasNoEntries ? "" : styles.badgeUrgent}`}>
                      {row.hasNoEntries ? "No ledger entries" : `${row.entryCount} ${row.entryCount === 1 ? "entry" : "entries"}`}
                    </span>
                  </div>
                  <p>
                    Current total <Money cents={row.expectedCents} /> · Ledger <Money cents={row.ledgerCents} /> · Difference <Money cents={row.differenceCents} />
                  </p>
                </div>
                <Link className={styles.resolveLink} href={`/finance?${eventQuery}&registration=${encodeURIComponent(row.registrationId)}`}>
                  Open registration
                  <ArrowRight aria-hidden="true" size={14} />
                </Link>
              </li>
            ))}
          </ul>
          {failing.length > visibleRowLimit ? (
            <p className={styles.moreNotice}>Showing the first {visibleRowLimit} of {failing.length}.</p>
          ) : null}
        </section>
      )}
    </section>
  );
}
