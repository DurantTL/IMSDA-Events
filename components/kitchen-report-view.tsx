import { Download } from "lucide-react";
import { cardCell } from "@/components/table-card-labels";
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
          <a className="secondary-button" href={csvHref}><Download aria-hidden="true" size={16} /> Download CSV</a>
          <PrintReportButton label="Print" />
        </div>
      </div>

      <section className="panel" aria-label="Meal types">
        <h3>Meal types</h3>
        <div className="report-table-wrap"><table className="report-table report-table-auto table-cards" role="table">
          <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Meal type</th><th role="columnheader" scope="col">People</th></tr></thead>
          <tbody role="rowgroup">
            {report.meals.map((meal) => <tr key={meal.value} role="row"><th role="rowheader" scope="row">{meal.label}</th><td {...cardCell("People")}>{meal.count}</td></tr>)}
          </tbody>
        </table></div>
      </section>

      {report.conferenceCovered.length > 0 && (
        <section className="panel" aria-label="Meals covered by the conference">
          <h3>Meals covered by the conference</h3>
          <p className="field-help">Staff, pastors and volunteers (with their immediate family) have every meal covered and chose no meal tickets. They are counted in the totals above.</p>
          <div className="report-table-wrap"><table className="report-table report-table-auto table-cards" role="table">
            <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Group</th><th role="columnheader" scope="col">People</th></tr></thead>
            <tbody role="rowgroup">
              {report.conferenceCovered.map((entry) => <tr key={entry.group} role="row"><th role="rowheader" scope="row">{entry.group}</th><td {...cardCell("People")}>{entry.count}</td></tr>)}
            </tbody>
          </table></div>
        </section>
      )}

      {report.conferenceMealServices.length > 0 && (
        <section className="panel" aria-label="Conference-paid meals by service">
          <h3>Conference-paid meals by service</h3>
          <p className="field-help">How many approved staff, pastor and volunteer people the conference-paid meal plan covers at each meal. Registrations waiting for approval and declined ones are never counted.</p>
          <div className="report-table-wrap"><table className="report-table report-table-auto table-cards" role="table">
            <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Service</th><th role="columnheader" scope="col">Staff</th><th role="columnheader" scope="col">Pastor</th><th role="columnheader" scope="col">Volunteer</th><th role="columnheader" scope="col">Total</th></tr></thead>
            <tbody role="rowgroup">
              {report.conferenceMealServices.map((entry) => (
                <tr key={entry.serviceId} role="row">
                  <th role="rowheader" scope="row">{entry.serviceName}<br /><span className="field-help">{entry.serviceDate} · {entry.mealLabel}</span></th>
                  <td {...cardCell("Staff")}>{entry.counts.STAFF}</td><td {...cardCell("Pastor")}>{entry.counts.PASTOR}</td><td {...cardCell("Volunteer")}>{entry.counts.VOLUNTEER}</td><td {...cardCell("Total")}>{entry.total}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}

      <section className="panel" aria-label="Dietary needs">
        <h3>Dietary needs</h3>
        <p className="field-help">People with any dietary need: <strong>{report.peopleWithNeeds}</strong>. One person can give more than one answer.</p>
        <div className="report-table-wrap"><table className="report-table report-table-auto table-cards" role="table">
          <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Answer</th><th role="columnheader" scope="col">People</th></tr></thead>
          <tbody role="rowgroup">
            {report.needs.length === 0 && <tr role="row"><td colSpan={2} role="cell">No dietary needs reported.</td></tr>}
            {report.needs.map((need) => <tr key={need.answer} role="row"><th role="rowheader" scope="row">{need.answer}</th><td {...cardCell("People")}>{need.count}</td></tr>)}
          </tbody>
        </table></div>
      </section>
    </section>
  );
}
