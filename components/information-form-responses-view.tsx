import { ExportLink } from "@/components/export-link";
import Link from "next/link";
import { Download } from "lucide-react";
import { cardCell } from "@/components/table-card-labels";
import { StaffPageHeader } from "@/components/staff-page-header";
import type { LabelledAnswer } from "@/modules/information-forms/responses";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

export type ResponseRowView = {
  id: string;
  versionNumber: number;
  submittedAt: Date;
  signedIn: boolean;
  answers: LabelledAnswer[];
};

/** One answer as readable text: lists joined, yes/no for a checkbox, an address on one line. */
export function answerText(value: unknown): string {
  // A member list (#1222): one member per line of text, "name, age, level, working on".
  if (Array.isArray(value) && value.some((item) => item && typeof item === "object")) return value.map((item) => answerText(item)).join("; ");
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).filter((part) => part !== "" && part !== null && part !== undefined).map(String).join(", ");
  return value === undefined || value === null ? "" : String(value);
}

function clip(text: string, length = 140) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** One column per question, in the order the questions first appear (newest responses first). */
export function responseColumns(rows: ResponseRowView[]) {
  const columns = new Map<string, string>();
  for (const row of rows) for (const answer of row.answers) if (!columns.has(answer.key)) columns.set(answer.key, answer.label);
  return [...columns].map(([key, label]) => ({ key, label }));
}

/**
 * The staff responses view of one information form (#1150), shared by the system-admin page (general forms) and the
 * event page (MANAGE_FORMS). The caller has already authorized the viewer and loaded the data through the module's
 * target-scoped queries; nothing here reads data itself.
 */
export function InformationFormResponsesView({ formName, total, rows, selected, exportHref, membersExportHref, rowHref, closeHref, nextHref }: {
  formName: string;
  total: number;
  rows: ResponseRowView[];
  selected: ResponseRowView | null;
  exportHref: string;
  /** Set when the form has a member list: a CSV with one row per member. */
  membersExportHref?: string | undefined;
  rowHref: (id: string) => string;
  closeHref: string;
  nextHref: string | null;
}) {
  const columns = responseColumns(rows);
  return (
    <section className="page-stack information-form-responses">
      <StaffPageHeader
        description={`${formName}: answers sent through the form's public link.`}
        primary={total > 0 ? (
          <>
            <ExportLink className="secondary-button information-form-download" href={exportHref}><Download aria-hidden="true" size={16} /> Download CSV</ExportLink>
            {membersExportHref && <ExportLink className="secondary-button information-form-download" href={membersExportHref}><Download aria-hidden="true" size={16} /> Download members CSV</ExportLink>}
          </>
        ) : undefined}
      />
      <section className="panel">
        <h2 className="information-form-count">{total.toLocaleString("en-US")} {total === 1 ? "response" : "responses"}</h2>
        {selected && (
          <article className="information-form-response-detail" aria-label="One response">
            <header>
              <h3>Response from {formatInConferenceTime(selected.submittedAt, { dateStyle: "medium", timeStyle: "short" })}</h3>
              <p className="quiet-copy">Form version {selected.versionNumber} · {selected.signedIn ? "Signed in" : "Not signed in"}</p>
            </header>
            {selected.answers.length === 0
              ? <p className="quiet-copy">No questions were answered.</p>
              : (
                <dl className="information-form-answers">
                  {selected.answers.map((answer) => (
                    <div key={answer.key}>
                      <dt>{answer.label}</dt>
                      <dd>{answerText(answer.value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            <Link className="secondary-button" href={closeHref}>Back to all responses</Link>
          </article>
        )}
        {total === 0
          ? <p className="quiet-copy">No one has answered yet.</p>
          : (
            <div className="report-table-wrap">
              <table role="table" className="report-table table-cards information-form-table">
                <caption className="sr-only">Responses to {formName}, newest first</caption>
                <thead role="rowgroup">
                  <tr role="row">
                    <th role="columnheader" scope="col">Submitted</th>
                    {columns.map((column) => <th role="columnheader" scope="col" key={column.key}>{column.label}</th>)}
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {rows.map((row) => {
                    const byKey = new Map(row.answers.map((answer) => [answer.key, answer.value]));
                    return (
                      <tr role="row" key={row.id}>
                        <th role="rowheader" scope="row"><Link href={rowHref(row.id)}>{formatInConferenceTime(row.submittedAt, { dateStyle: "medium", timeStyle: "short" })}</Link></th>
                        {columns.map((column) => <td {...cardCell(column.label)} key={column.key}>{clip(answerText(byKey.get(column.key)))}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        {nextHref && <p><Link className="secondary-button" href={nextHref}>Older responses</Link></p>}
      </section>
    </section>
  );
}
