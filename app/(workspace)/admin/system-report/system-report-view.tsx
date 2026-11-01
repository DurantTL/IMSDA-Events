import Link from "next/link";
import { ArrowRight, CircleHelp, RefreshCw, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  reportReadLabel,
  reportTimeLabel,
  STATE_LABEL,
  type ReportSection,
  type Signal,
  type SignalState,
  type SystemReport,
} from "@/modules/system-admin/system-report/model";
import type { OwnConnection } from "@/modules/system-admin/system-report/own-connection";
import styles from "./page.module.css";
import { SystemReportTesters } from "./system-report-testers";
import { CloudflarePurgeRow } from "./cloudflare-purge-row";
import { TestConnectionsButton } from "./test-connections-button";

/** The shared status chip colors. "Count only" has no verdict, so it is drawn plain, never green. */
const chipColor: Record<SignalState, string> = { ok: "green", watch: "gold", attention: "coral", unavailable: "neutral", info: "neutral" };
const chipClass: Record<SignalState, string> = {
  ok: "",
  watch: "",
  attention: "",
  unavailable: styles.chipUnavailable,
  info: styles.chipInfo,
};
const rowClass: Partial<Record<SignalState, string>> = { attention: styles.isAttention, watch: styles.isWatch, unavailable: styles.isUnavailable };

function StateChip({ state, label }: { state: SignalState; label?: string }) {
  return <span className={`status-chip ${chipColor[state]} ${styles.chip} ${chipClass[state]}`}>{label ?? STATE_LABEL[state]}</span>;
}

const verdictIcon = { attention: ShieldAlert, unavailable: CircleHelp, watch: TriangleAlert, ok: ShieldCheck, info: ShieldCheck } as const;

function SignalRow({ signal, now }: { signal: Signal; now: Date }) {
  return (
    <li className={`${styles.row} ${rowClass[signal.state] ?? ""}`} data-signal={signal.key} data-state={signal.state}>
      <div className={styles.rowName}>
        <strong>{signal.name}</strong>
        <span>{signal.description}</span>
      </div>
      <div className={styles.rowWhen}>
        <b>{signal.whenLabel} </b>
        {signal.checkedAt ? reportTimeLabel(signal.checkedAt, now) : signal.noTimeLabel ?? reportTimeLabel(null, now)}
      </div>
      <div className={styles.rowResult}>
        <StateChip state={signal.state} />
        <span>{signal.resultText}</span>
        {signal.items && signal.items.length > 0 && (
          <ul className={styles.items} aria-label={`${signal.name}: open items`}>
            {signal.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
          </ul>
        )}
      </div>
      <div className={styles.rowFix}>
        {signal.fixHref ? (
          <Link className={styles.fix} href={signal.fixHref}>{signal.fixLabel ?? "Open"}<ArrowRight aria-hidden="true" size={14} /></Link>
        ) : (
          <span className={styles.noFix}>{signal.fixLabel ?? "—"}</span>
        )}
      </div>
    </li>
  );
}

function OwnConnectionCard({ connection }: { connection: OwnConnection }) {
  const warned = connection.state !== "ok";
  return (
    <div className={`${styles.ownConnection} ${warned ? styles.isWatch : ""}`} data-testid="own-connection" data-state={connection.state}>
      <h3>Your connection as the app sees it</h3>
      <p className={styles.ownConnectionNote}>Only you see this, and only for your own visit. It is not saved, and it is not counted toward the overall status.</p>
      <dl className={styles.ownConnectionFacts}>
        <div><dt>Your address</dt><dd>{connection.state === "invalid" ? "settings invalid" : connection.resolvedIp ?? "not resolved"}</dd></div>
        <div><dt>Header</dt><dd>{connection.header ?? "settings invalid"}</dd></div>
        <div><dt>Proxy hops</dt><dd>{connection.hops ?? "settings invalid"}</dd></div>
      </dl>
      {connection.warnings.length > 0 && (
        <ul className={styles.ownConnectionWarnings} aria-label="Connection warnings">
          {connection.warnings.map((warning) => <li key={warning}><TriangleAlert aria-hidden="true" size={16} />{warning}</li>)}
        </ul>
      )}
    </div>
  );
}

function Section({ section, now, ownConnection, cloudflarePurgeConfigured }: { section: ReportSection; now: Date; ownConnection?: OwnConnection; cloudflarePurgeConfigured: boolean }) {
  const headingId = `h-${section.key}`;
  return (
    <section className={styles.section} id={`s-${section.key}`} aria-labelledby={headingId} data-section={section.key} data-state={section.state}>
      <div className={styles.sectionHead}>
        <div>
          <h2 id={headingId}>{section.title}</h2>
          <StateChip state={section.state} label={section.stateLabel} />
        </div>
        {section.fixHref && <Link className={styles.fix} href={section.fixHref}>{section.fixLabel ?? "Open"}<ArrowRight aria-hidden="true" size={14} /></Link>}
      </div>
      <ul className={styles.rows}>
        {section.signals.map((signal) => <SignalRow key={signal.key} signal={signal} now={now} />)}
      </ul>
      {section.key === "setup" && <CloudflarePurgeRow configured={cloudflarePurgeConfigured} />}
      {section.key === "setup" && ownConnection && <OwnConnectionCard connection={ownConnection} />}
      {!section.counted && <p className={styles.noteLine}>Ticks record that a person checked something. They are not live readings and do not count toward the overall status.</p>}
    </section>
  );
}

/** Draws a built report and nothing else: it measures, sorts and tallies nothing. */
export function SystemReportView({ report, testerDefaultEmail = "", ownConnection, cloudflarePurgeConfigured = false, emailBackupConfigured = false }: { report: SystemReport; testerDefaultEmail?: string; ownConnection?: OwnConnection; cloudflarePurgeConfigured?: boolean; emailBackupConfigured?: boolean }) {
  const now = new Date(report.generatedAt);
  const { overall } = report;
  const Icon = verdictIcon[overall.state];
  const tally = overall.tally;
  return (
    <section className={`page-stack ${styles.workspace}`}>
      <div className="page-intro">
        <div>
          <p className="eyebrow">System administrators only</p>
          <h2 className="duplicate-page-title">System report</h2>
          <p>Every reading the system makes, in one place. Each row says what was checked, when, and what it found. A reading that could not be made shows as unavailable, never as OK.</p>
        </div>
        <div className="page-intro-actions">
          <TestConnectionsButton />
          <Link className="secondary-button" href="/admin/system-report"><RefreshCw aria-hidden="true" size={16} />Check again</Link>
        </div>
      </div>

      <section className={styles.glance} aria-labelledby="glance-heading" data-testid="report-glance" data-state={overall.state}>
        <div className={styles.verdict}>
          <span className={`${styles.verdictIcon} ${styles[`verdict_${overall.state}`] ?? ""}`} aria-hidden="true"><Icon size={24} /></span>
          <div className={styles.verdictText}>
            <h2 id="glance-heading">{overall.headline}</h2>
            <p>Read {reportReadLabel(now)}. {overall.readingsTried} {overall.readingsTried === 1 ? "reading" : "readings"} tried, {overall.couldNotRead} could not be read.</p>
          </div>
          <div className={styles.tally} aria-label="Readings by result">
            <StateChip state="attention" label={`${tally.attention} need attention`} />
            <StateChip state="watch" label={`${tally.watch} check soon`} />
            <StateChip state="unavailable" label={`${tally.unavailable} unavailable`} />
            <StateChip state="ok" label={`${tally.ok} OK`} />
            {tally.info > 0 && <StateChip state="info" label={`${tally.info} count only`} />}
          </div>
        </div>
        <ul className={styles.tiles} aria-label="Sections">
          {report.sections.map((section) => (
            <li key={section.key}>
              <Link href={`#s-${section.key}`}>
                <strong>{section.title}</strong>
                <StateChip state={section.state} label={section.stateLabel} />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <SystemReportTesters defaultEmail={testerDefaultEmail} emailBackupConfigured={emailBackupConfigured} />

      {report.sections.map((section) => <Section key={section.key} section={section} now={now} ownConnection={ownConnection} cloudflarePurgeConfigured={cloudflarePurgeConfigured} />)}

      <p className={styles.footerLine}>
        Counts and states only: no settings values, names or attendee details. The one exception is your own connection card above, which shows only your own address.{" "}
        {report.releaseSha ? <>Release <code>{report.releaseSha.slice(0, 7)}</code>.</> : "Release not recorded."}
      </p>
    </section>
  );
}
