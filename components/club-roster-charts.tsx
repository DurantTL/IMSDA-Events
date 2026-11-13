import { HorizontalBars, StatTiles, TrendChart } from "@/components/analytics-charts";
import { GetFilterForm } from "@/components/get-filter-form";
import { MONTH_NAMES, summarizeAttendance, summarizeCounts } from "@/modules/club-roster-charts/domain";
import type { RosterChartsView } from "@/modules/club-roster-charts/repository";
import styles from "./club-roster-charts.module.css";

/**
 * The roster charts and, for a viewer who sees birth dates, age groups and the month's birthdays (#1704). Counts only.
 * `view.birthdayView` is null for a registrar, so nothing about ages or birthdays is rendered for them at all.
 */
export function ClubRosterCharts({ view, action }: { view: RosterChartsView; action: string }) {
  const { birthdayView } = view;
  return (
    <>
      <StatTiles label="Roster totals" tiles={[{ label: "Active people on the roster", value: String(view.peopleCount) }]} />
      <div className={styles.grid}>
        <HorizontalBars empty="No classes are set on the roster yet." nameLabel="Class" order=", in class order" rows={view.byClassLevel} summary={summarizeCounts("by class", view.byClassLevel)} title="Members by class" valueLabel="People" />
        <HorizontalBars empty="No youth members yet." nameLabel="School grade" order=", in grade order" rows={view.bySchoolGrade} summary={summarizeCounts("by school grade", view.bySchoolGrade)} title="Members by school grade" valueLabel="People" />
        <HorizontalBars empty="Nobody is on the roster yet." nameLabel="Member type" order=", by member type" rows={view.byMemberType} summary={summarizeCounts("by member type", view.byMemberType)} title="Members by type" valueLabel="People" />
        {birthdayView && (
          <HorizontalBars empty="Nobody is on the roster yet." nameLabel="Age group" order=", in age order" rows={birthdayView.ageBands} summary={summarizeCounts("by age group", birthdayView.ageBands)} title="Members by age group" valueLabel="People" />
        )}
      </div>
      <section aria-labelledby="roster-charts-attendance" className={styles.section}>
        <h3 id="roster-charts-attendance">Meeting attendance</h3>
        {view.attendance.length === 0 ? (
          <p className={styles.empty}>No meetings with attendance checked off yet this club year. Check people off on a meeting note under Monthly Records and it will show here.</p>
        ) : (
          <TrendChart
            endLabel={view.attendance[view.attendance.length - 1]!.label}
            pointLabel="Month"
            points={view.attendance.map((entry) => ({ label: entry.label, values: [entry.meetings, entry.averagePresent] }))}
            series={[{ key: "meetings", label: "Meetings" }, { key: "present", label: "Average people present" }]}
            startLabel={view.attendance[0]!.label}
            summary={summarizeAttendance(view.attendance)}
            tableNote="counts for each month"
            title="Meetings and people present, by month"
          />
        )}
      </section>
      {birthdayView && (
        <section aria-labelledby="roster-charts-birthdays" className={styles.section}>
          <h3 id="roster-charts-birthdays">{`Birthdays in ${MONTH_NAMES[birthdayView.month - 1]}`}</h3>
          <GetFilterForm action={action} className={styles.filter}>
            <label>
              Month
              <select defaultValue={String(birthdayView.month)} key={birthdayView.month} name="month">
                {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
              </select>
            </label>
            <button className="secondary-button" type="submit">Show</button>
          </GetFilterForm>
          {birthdayView.birthdays.length === 0 ? (
            <p className={styles.empty}>{`Nobody on the active roster has a birthday in ${MONTH_NAMES[birthdayView.month - 1]}, or their birth dates are not on file.`}</p>
          ) : (
            <ul className={styles.birthdays}>
              {birthdayView.birthdays.map((entry, index) => (
                <li className={styles.birthday} key={`${entry.name}-${entry.day}-${index}`}>
                  <span>{entry.name}</span>
                  <span className={styles.birthdayDay}>{entry.monthDay}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
