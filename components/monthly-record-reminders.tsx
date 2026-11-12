import { ColumnHeader } from "@/components/column-header";
import { ListPager } from "@/components/list-pager";
import { SortOrderNote } from "@/components/list-sort";
import { SetupHelpPanel } from "@/components/setup-help";
import { MonthlyRecordReminderSwitch } from "@/components/monthly-record-reminder-switch";
import { cardCell } from "@/components/table-card-labels";
import { sortOrderText, type ServerSort } from "@/lib/list-sort";
import { systemSetupFor } from "@/modules/setup-help/system-setup-steps";
import type { PageSlice } from "@/lib/pagination";
import { reportMonthLabel } from "@/modules/club-reports/domain";
import { MONTHLY_RECORD_REMINDER_DAY_TEXT, type ReminderLogColumn } from "@/modules/club-reports/monthly-reminders-domain";
import type { MonthlyRecordReminderLogRow } from "@/modules/club-reports/monthly-reminders";
import styles from "./monthly-record-reminders.module.css";

const sortLabels: Record<ReminderLogColumn, { label: string; kind: "text" | "date" | "number" }> = {
  month: { label: "month", kind: "date" },
  club: { label: "club", kind: "text" },
  recipients: { label: "recipients", kind: "number" },
  sent: { label: "time sent", kind: "date" },
};

/**
 * The automatic Monthly Record reminder (#1895), for Clubs Administrators and system administrators: the switch for the
 * current club year and the log of what went out (month, club, how many recipients, when). No address or name is shown.
 * A server component, so the sortable headers and pager get plain links; the switch is the one client part. The page and
 * the route check access again; this only draws what they hand it.
 */
export function MonthlyRecordReminders({
  clubYear,
  enabled,
  started,
  turnOnNote,
  emailConfigured,
  isSystemAdmin,
  slice,
  sorting,
  pageHref,
  sentAtLabels,
}: {
  clubYear: string;
  enabled: boolean;
  /** False until a Clubs Administrator first turns reminders on. */
  started: boolean;
  /** What turning them on does right now, in real dates. */
  turnOnNote: string;
  emailConfigured: boolean;
  /** A system administrator can fix the email setup, so they get the setup help; anyone else is told who to ask. */
  isSystemAdmin: boolean;
  slice: PageSlice<MonthlyRecordReminderLogRow>;
  sorting: ServerSort<ReminderLogColumn>;
  pageHref: (page: number) => string;
  /** Each row's sent time in conference time, by row id. */
  sentAtLabels: Record<string, string>;
}) {
  return (
    <section aria-labelledby="monthly-reminders-heading" className={styles.card} data-testid="monthly-record-reminders" id="monthly-record-reminders">
      <h2 className={styles.heading} id="monthly-reminders-heading">Monthly Record reminders</h2>
      <p className={styles.note}>
        {`On the ${MONTHLY_RECORD_REMINDER_DAY_TEXT} of each month, the director and deputy of each club that has not submitted last month's record get one email with a link to the record. Area Coordinators get a summary of counts only.`}
      </p>
      {!emailConfigured && (isSystemAdmin ? (
        <div role="status">
          <p className={styles.problem}>Email isn&apos;t set up, so reminders can&apos;t go out.</p>
          <SetupHelpPanel context="account email" setup={systemSetupFor("account-email")} />
        </div>
      ) : (
        <p className={styles.problem} role="status">Email isn&apos;t set up, so reminders can&apos;t go out. Ask a system administrator.</p>
      ))}
      <MonthlyRecordReminderSwitch clubYear={clubYear} enabled={enabled} started={started} turnOnNote={turnOnNote} />
      {slice.total === 0 ? (
        <p className={styles.note}>No reminders have been sent yet.</p>
      ) : (
        <>
          <div className="report-table-wrap">
            {sorting.order.key && <SortOrderNote>{sortOrderText(sortLabels[sorting.order.key].label, sorting.order.dir, sortLabels[sorting.order.key].kind)}</SortOrderNote>}
            <table className="report-table table-cards" role="table">
              <caption className="sr-only">Reminders sent</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <ColumnHeader column="month" label="Month" sorting={sorting} />
                  <ColumnHeader column="club" label="Club" sorting={sorting} />
                  <ColumnHeader column="recipients" label="Recipients" sorting={sorting} />
                  <ColumnHeader column="sent" label="Sent" sorting={sorting} />
                </tr>
              </thead>
              <tbody role="rowgroup">
                {slice.items.map((row) => (
                  <tr key={row.id} role="row">
                    <td {...cardCell("Month")}>{reportMonthLabel(row.reportMonth)}</td>
                    <th role="rowheader" scope="row" translate="no">{row.clubName}</th>
                    <td {...cardCell("Recipients")}>{row.recipients}</td>
                    <td {...cardCell("Sent")}>{sentAtLabels[row.id]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPager hrefFor={pageHref} label="Reminder log pages" noun="reminders" nounOne="reminder" slice={slice} />
        </>
      )}
    </section>
  );
}
