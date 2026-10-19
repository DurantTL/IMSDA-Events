import { mealTypeLabels, type MealTypeValue } from "@/modules/meals/domain";

/**
 * Conference-paid meal counts for approved staff, pastor and volunteer registrations (#1027): for each meal service, how many
 * people the conference covers, split by group. Pure: the rows come from the meals module's own selections (the conference-paid
 * plan of #905/#916 is the one source of truth); nothing here stores a count.
 */

export const COVERED_GROUPS = ["STAFF", "PASTOR", "VOLUNTEER"] as const;
export type CoveredGroup = (typeof COVERED_GROUPS)[number];

export const COVERED_GROUP_LABEL: Record<CoveredGroup, string> = { STAFF: "Staff", PASTOR: "Pastor", VOLUNTEER: "Volunteer" };

/** One covered person at one meal service: the shape the repository reads. Never a name. */
export type CoveredMealRow = {
  serviceId: string;
  serviceName: string;
  serviceDate: string;
  startTime: string;
  mealType: MealTypeValue;
  group: CoveredGroup;
  /** Identifies the person at that service, so a person counted twice (two selections) is still one. */
  personKey: string;
};

export type StaffMealServiceCount = {
  serviceId: string;
  serviceName: string;
  serviceDate: string;
  mealType: MealTypeValue;
  mealLabel: string;
  counts: Record<CoveredGroup, number>;
  total: number;
};

/** Counts per service (in date and time order) and group. A service nobody is covered at is not listed. */
export function buildStaffMealServiceCounts(rows: readonly CoveredMealRow[]): StaffMealServiceCount[] {
  const services = new Map<string, { row: CoveredMealRow; people: Record<CoveredGroup, Set<string>> }>();
  for (const row of rows) {
    const entry = services.get(row.serviceId) ?? { row, people: { STAFF: new Set(), PASTOR: new Set(), VOLUNTEER: new Set() } };
    entry.people[row.group].add(row.personKey);
    services.set(row.serviceId, entry);
  }
  return [...services.values()]
    .sort((a, b) => a.row.serviceDate.localeCompare(b.row.serviceDate) || a.row.startTime.localeCompare(b.row.startTime) || a.row.serviceName.localeCompare(b.row.serviceName))
    .map(({ row, people }) => {
      const counts = { STAFF: people.STAFF.size, PASTOR: people.PASTOR.size, VOLUNTEER: people.VOLUNTEER.size };
      return {
        serviceId: row.serviceId,
        serviceName: row.serviceName,
        serviceDate: row.serviceDate,
        mealType: row.mealType,
        mealLabel: mealTypeLabels[row.mealType],
        counts,
        total: counts.STAFF + counts.PASTOR + counts.VOLUNTEER,
      };
    });
}

export const STAFF_MEAL_CSV_HEADING = ["Service date", "Service", "Meal", "Staff", "Pastor", "Volunteer", "Total"] as const;

/** The per-service table as CSV rows (heading first), for the kitchen report and the meal ticket summary. Empty when nobody is covered. */
export function staffMealServiceCsvRows(services: readonly StaffMealServiceCount[]): Array<Array<string | number>> {
  if (services.length === 0) return [];
  return [
    [...STAFF_MEAL_CSV_HEADING],
    ...services.map((entry) => [entry.serviceDate, entry.serviceName, entry.mealLabel, entry.counts.STAFF, entry.counts.PASTOR, entry.counts.VOLUNTEER, entry.total]),
  ];
}
