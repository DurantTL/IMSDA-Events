import { ExportLink } from "@/components/export-link";
import { Download } from "lucide-react";
import { PrintReportButton } from "@/components/print-report-button";
import type { KitchenReport } from "@/modules/registrations/kitchen-report";

/** The kitchen report (#787): counts and answers as typed, no names. Shared by the staff and Area Coordinator pages. */
export function KitchenReportView({ eventName, report, csvHref }: { eventName: string; report: KitchenReport; csvHref: string }) {
  return (
    <section className="page-stack kitchen-report">
      <div className="page-intro">
        <div>
          <p className="eyebrow" translate="no">{eventName}</p>
          <h2>Kitchen report</h2>
          <p>
            Confirmed registrations only. {report.totalPeople} {report.totalPeople === 1 ? "person" : "people"} counted, {report.peopleWithNeeds} with a dietary need.
            Answers are shown as typed and are not linked to anyone.
          </p>
        </div>
        <div className="intro-actions kitchen-report-actions">
          <ExportLink className="secondary-button" href={csvHref}><Download aria-hidden="true" size={16} /> Download CSV</ExportLink>
          <PrintReportButton label="Print" />
        </div>
      </div>

      <section className="panel" aria-label="Meal types">
        <h3>Meal types</h3>
        <div className="report-table-wrap"><table className="report-table report-table-auto">
          <thead><tr><th scope="col">Meal type</th><th scope="col">People</th></tr></thead>
          <tbody>
            {report.meals.map((meal) => <tr key={meal.value}><th scope="row">{meal.label}</th><td>{meal.count}</td></tr>)}
          </tbody>
        </table></div>
      </section>

      {report.conferenceCovered.length > 0 && (
        <section className="panel" aria-label="Meals covered by the conference">
          <h3>Meals covered by the conference</h3>
          <p className="field-help">Staff, pastors and volunteers (with their immediate family) have every meal covered and chose no meal tickets. They are counted in the totals above.</p>
          <div className="report-table-wrap"><table className="report-table report-table-auto">
            <thead><tr><th scope="col">Group</th><th scope="col">People</th></tr></thead>
            <tbody>
              {report.conferenceCovered.map((entry) => <tr key={entry.group}><th scope="row">{entry.group}</th><td>{entry.count}</td></tr>)}
            </tbody>
          </table></div>
        </section>
      )}

      {report.conferenceMealServices.length > 0 && (
        <section className="panel" aria-label="Conference-paid meals by service">
          <h3>Conference-paid meals by service</h3>
          <p className="field-help">How many approved staff, pastor and volunteer people the conference-paid meal plan covers at each meal. Registrations waiting for approval and declined ones are never counted.</p>
          <div className="report-table-wrap"><table className="report-table report-table-auto">
            <thead><tr><th scope="col">Service</th><th scope="col">Staff</th><th scope="col">Pastor</th><th scope="col">Volunteer</th><th scope="col">Total</th></tr></thead>
            <tbody>
              {report.conferenceMealServices.map((entry) => (
                <tr key={entry.serviceId}>
                  <th scope="row">{entry.serviceName}<br /><span className="field-help">{entry.serviceDate} · {entry.mealLabel}</span></th>
                  <td>{entry.counts.STAFF}</td><td>{entry.counts.PASTOR}</td><td>{entry.counts.VOLUNTEER}</td><td>{entry.total}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}

      <section className="panel" aria-label="Dietary needs">
        <h3>Dietary needs</h3>
        <p className="field-help">People with any dietary need: <strong>{report.peopleWithNeeds}</strong>. One person can give more than one answer.</p>
        <div className="report-table-wrap"><table className="report-table report-table-auto">
          <thead><tr><th scope="col">Answer</th><th scope="col">People</th></tr></thead>
          <tbody>
            {report.needs.length === 0 && <tr><td colSpan={2}>No dietary needs reported.</td></tr>}
            {report.needs.map((need) => <tr key={need.answer}><td>{need.answer}</td><td>{need.count}</td></tr>)}
          </tbody>
        </table></div>
      </section>
    </section>
  );
}
