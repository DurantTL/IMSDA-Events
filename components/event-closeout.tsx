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
  /** The finance pages the checks link to are for MANAGE_FINANCE. */
  canManageFinance: boolean;
  /** The money report opens for MANAGE_FINANCE and VIEW_REPORTS, not for a finalize-invoices-only viewer. */
  canOpenMoneyReport: boolean;
  /** The Emails page needs VIEW_EVENT. */
  canViewEvent: boolean;
};

const when = (iso: string) => formatInConferenceTime(iso, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
// The shared status chip tones (`.status-chip`): ready is green, a warning gold, a blocking check coral.
const chipTone = { ready: "green", warning: "gold", blocking: "coral" } as const;

function linkFor(check: CloseoutCheck, access: Pick<Props, "canManageFinance" | "canOpenMoneyReport" | "canViewEvent">) {
  if (check.linkAccess === "finance" && !access.canManageFinance) return null;
  if (check.linkAccess === "report" && !access.canOpenMoneyReport) return null;
  if (check.linkAccess === "event" && !access.canViewEvent) return null;
  return check.href;
}

export function EventCloseoutView({ data, canSignOff, canManageFinance, canOpenMoneyReport, canViewEvent }: Props) {
  const { summary, checks, history } = data;
  const inReconciliation = data.state === "FINANCIAL_RECONCILIATION";
  const closed = data.state === "CLOSED";
  const current = closed ? history.find((entry) => !entry.reopened) ?? null : null;
  const summaryClass = closed || summary.blocking === 0 && summary.warning === 0 ? styles.summaryReady : summary.blocking > 0 ? styles.summaryBlocking : styles.summaryWarning;
  const summaryText = closed
    ? "This event is closed. Reopen it to change the checklist or sign off again."
    : !inReconciliation
      ? `The checklist is a preview: sign-off opens once the event is in Financial reconciliation.`
      : summary.blocking > 0
        ? `${summary.blocking} blocking ${summary.blocking === 1 ? "check" : "checks"} to settle${summary.warning > 0 ? `, ${summary.warning} ${summary.warning === 1 ? "warning" : "warnings"}` : ""}.`
        : summary.warning > 0
          ? `Nothing is blocking. ${summary.warning} ${summary.warning === 1 ? "warning needs" : "warnings need"} a look before sign-off.`
          : "Every check is ready.";
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
          {canOpenMoneyReport ? <a className="secondary-button" href={withCurrentEvent("/finance/money-report", data.eventId)}><WalletCards aria-hidden="true" size={17} /> Money report</a> : null}
        </div>
      </div>

      <p className={`${styles.summary} ${summaryClass}`} role="status" data-testid="closeout-summary">
        {data.stateLabel}. {summaryText}
      </p>

      <section className={styles.panel} aria-labelledby="closeout-checks">
        <h3 className={styles.panelHeading} id="closeout-checks">Checklist</h3>
        <p className={styles.note}>Blocking checks stop the sign-off. Warnings can be signed off once you have reviewed them. A check that could not be read is never shown as ready.</p>
        <ul className={styles.checks} data-testid="closeout-checks">
          {checks.map((check) => {
            const href = linkFor(check, { canManageFinance, canOpenMoneyReport, canViewEvent });
            return (
              <li className={styles.check} key={check.id} data-check={check.id} data-state={check.state}>
                <span className={`status-chip ${chipTone[check.state]}`}>{closeoutStateWords[check.state]}</span>
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
        {canSignOff && (inReconciliation || closed) ? (
          // One instance for both modes, so the "Saved." message survives the move from Financial reconciliation to Closed.
          <EventCloseoutActions eventId={data.eventId} eventName={data.eventName} lifecycleVersion={data.lifecycleVersion} mode={closed ? "reopen" : "sign-off"} blocking={summary.blocking} warnings={summary.warning} seenOpenChecks={data.openChecks} noteMaxLength={CLOSEOUT_NOTE_MAX_LENGTH} reasonMaxLength={LIFECYCLE_REASON_MAX_LENGTH} />
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
                  {entry.reopened ? <p className={styles.note}>Reopened by {entry.reopened.byName} on {when(entry.reopened.at)}{entry.reopened.reason ? `: ${entry.reopened.reason}` : ""}</p> : null}
                  {entry.note ? <p className={styles.note}>Note: {entry.note}</p> : null}
                  <p className={styles.snapshot}>
                    {open.length === 0
                      ? "Every check was ready."
                      : `Open at sign-off${entry.checkedAt ? ` (checked ${when(entry.checkedAt)})` : ""}${entry.warningsAcknowledged ? " (warnings acknowledged)" : ""}: ${open.map((row) => `${checkLabels[row.id]}${row.count !== null ? ` ${row.count}` : ""}${row.cents !== null && row.cents > 0 ? ` (${formatCents(row.cents)})` : ""}`).join(", ")}.`}
                  </p>
                </li>
              );
            })}
            {data.unlinkedReopenings.map((entry) => (
              <li className={styles.entry} key={entry.id}>
                <p className={styles.entryTitle}>Reopened by {entry.byName} on {when(entry.at)}</p>
                {entry.reason ? <p className={styles.note}>{entry.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
