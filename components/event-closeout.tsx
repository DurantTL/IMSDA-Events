import { ClipboardCheck, WalletCards } from "lucide-react";
import { EventCloseoutActions } from "@/components/event-closeout-actions";
import { withCurrentEvent } from "@/components/staff-navigation";
import { CLOSEOUT_NOTE_MAX_LENGTH, checkLabels, closeoutStateWords, type CloseoutCheck } from "@/modules/events/closeout-domain";
import type { CloseoutView } from "@/modules/events/closeout-repository";
import { LIFECYCLE_REASON_MAX_LENGTH } from "@/modules/events/lifecycle-state";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import { formatCents } from "@/modules/payments/format-cents";
import styles from "@/components/event-closeout.module.css";

type Props = {
  data: CloseoutView;
  /** MANAGE_FINANCE or FINALIZE_INVOICES: may sign off and reopen. Everyone else who opens the page only reads. */
  canSignOff: boolean;
  /** The finance pages the checks link to are for MANAGE_FINANCE; the money report and emails open for anyone who sees this page. */
  canManageFinance: boolean;
};

const when = (iso: string) => formatInConferenceTime(iso, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const badgeClass = { ready: styles.badgeReady, warning: styles.badgeWarning, blocking: styles.badgeBlocking } as const;

function linkFor(check: CloseoutCheck, canManageFinance: boolean) {
  if (check.linkAccess === "finance" && !canManageFinance) return null;
  return check.href;
}

export function EventCloseoutView({ data, canSignOff, canManageFinance }: Props) {
  const { summary, checks, history } = data;
  const inReconciliation = data.state === "FINANCIAL_RECONCILIATION";
  const closed = data.state === "CLOSED";
  const current = closed ? history.find((entry) => !entry.reopened) ?? null : null;
  const summaryClass = summary.blocking > 0 ? styles.summaryBlocking : summary.warning > 0 ? styles.summaryWarning : styles.summaryReady;
  return (
    <section className={`page-stack ${styles.stack}`}>
      <div className="page-intro">
        <div>
          <p className="eyebrow">Financial operations</p>
          <h2>Event closeout</h2>
          <p>
            {data.eventName}: the checks to settle before the event is closed, and the finance sign-off that closes it. The checks read the payment,
            refund, invoice, message and waitlist records the site already keeps.
          </p>
        </div>
        <div className="page-intro-actions button-pair">
          {canManageFinance ? <a className="secondary-button" href={withCurrentEvent("/finance/money-report", data.eventId)}><WalletCards aria-hidden="true" size={17} /> Money report</a> : null}
        </div>
      </div>

      <p className={`${styles.summary} ${summaryClass}`} role="status" data-testid="closeout-summary">
        {data.stateLabel}.{" "}
        {summary.blocking > 0
          ? `${summary.blocking} blocking ${summary.blocking === 1 ? "check" : "checks"} to settle${summary.warning > 0 ? `, ${summary.warning} ${summary.warning === 1 ? "warning" : "warnings"}` : ""}.`
          : summary.warning > 0
            ? `Nothing is blocking. ${summary.warning} ${summary.warning === 1 ? "warning needs" : "warnings need"} a look before sign-off.`
            : "Every check is ready."}
      </p>

      <section className={styles.panel} aria-labelledby="closeout-checks">
        <h3 className={styles.panelHeading} id="closeout-checks">Checklist</h3>
        <p className={styles.note}>Blocking checks stop the sign-off. Warnings can be signed off once you have reviewed them. A check that could not be read is never shown as ready.</p>
        <ul className={styles.checks} data-testid="closeout-checks">
          {checks.map((check) => {
            const href = linkFor(check, canManageFinance);
            return (
              <li className={styles.check} key={check.id} data-check={check.id} data-state={check.state}>
                <span className={`${styles.badge} ${badgeClass[check.state]}`}>{closeoutStateWords[check.state]}</span>
                <div className={styles.checkBody}>
                  <p className={styles.checkLabel}>{check.label}</p>
                  <p className={styles.note}>{check.sentence}</p>
                  {href && check.state !== "ready" ? <a className={styles.open} href={href}>{check.linkLabel}</a> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={styles.panel} aria-labelledby="closeout-signoff">
        <h3 className={styles.panelHeading} id="closeout-signoff"><ClipboardCheck aria-hidden="true" size={18} /> Sign-off</h3>
        {closed && current ? (
          <p className={styles.note} data-testid="closeout-current">Signed off by {current.signedByName} on {when(current.signedAt)}.{current.note ? ` Note: ${current.note}` : ""}</p>
        ) : null}
        {closed && !current ? <p className={styles.note}>This event is closed. It was closed before sign-offs were recorded, so there is no sign-off to show.</p> : null}
        {inReconciliation && canSignOff ? (
          <EventCloseoutActions eventId={data.eventId} eventName={data.eventName} lifecycleVersion={data.lifecycleVersion} mode="sign-off" blocking={summary.blocking} warnings={summary.warning} noteMaxLength={CLOSEOUT_NOTE_MAX_LENGTH} reasonMaxLength={LIFECYCLE_REASON_MAX_LENGTH} />
        ) : null}
        {closed && canSignOff ? (
          <EventCloseoutActions eventId={data.eventId} eventName={data.eventName} lifecycleVersion={data.lifecycleVersion} mode="reopen" blocking={summary.blocking} warnings={summary.warning} noteMaxLength={CLOSEOUT_NOTE_MAX_LENGTH} reasonMaxLength={LIFECYCLE_REASON_MAX_LENGTH} />
        ) : null}
        {inReconciliation && !canSignOff ? <p className={styles.note}>Only a finance admin (finance or finalize-invoices permission) can sign off. Ask your event administrator.</p> : null}
        {!inReconciliation && !closed ? <p className={styles.note}>An event is signed off once it is in Financial reconciliation. It is {data.stateLabel.toLowerCase()} now; finance moves it to Financial reconciliation after the event is complete.</p> : null}
      </section>

      <section className={styles.panel} aria-labelledby="closeout-history">
        <h3 className={styles.panelHeading} id="closeout-history">Sign-off history ({history.length})</h3>
        {history.length === 0 && data.unlinkedReopenings.length === 0 ? <p className={styles.note}>This event has not been signed off yet. Each sign-off, and each reopening, is kept here for good.</p> : (
          <ul className={styles.history} data-testid="closeout-history">
            {history.map((entry) => {
              const open = entry.snapshot.filter((row) => row.state !== "ready");
              return (
                <li className={styles.entry} key={entry.id}>
                  <p className={styles.entryTitle}>Signed off by {entry.signedByName} on {when(entry.signedAt)}</p>
                  {entry.reopened ? <p className={styles.note}>Reopened by {entry.reopened.byName} on {when(entry.reopened.at)}: {entry.reopened.reason}</p> : null}
                  {entry.note ? <p className={styles.note}>Note: {entry.note}</p> : null}
                  <p className={styles.snapshot}>
                    {open.length === 0
                      ? "Every check was ready."
                      : `Open at sign-off${entry.warningsAcknowledged ? " (warnings acknowledged)" : ""}: ${open.map((row) => `${checkLabels[row.id]}${row.count !== null ? ` ${row.count}` : ""}${row.cents !== null && row.cents > 0 ? ` (${formatCents(row.cents)})` : ""}`).join(", ")}.`}
                  </p>
                </li>
              );
            })}
            {data.unlinkedReopenings.map((entry) => (
              <li className={styles.entry} key={entry.id}>
                <p className={styles.entryTitle}>Reopened by {entry.byName} on {when(entry.at)}</p>
                <p className={styles.note}>{entry.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
