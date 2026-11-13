/**
 * Roster charts and birthdays (#1704), pure. An optional club feature: aggregate counts from the club's active roster
 * this club year (class, school grade, member type, meeting attendance), plus, for the people who already see birth
 * dates (director and deputy), age groups and this month's birthdays.
 *
 * Counts only. Nothing here keeps a birth date: a birthday is a name with a month and a day, never a year and never an
 * age beside it, and the age groups are counts of people.
 */

import { calendarDateIn } from "@/modules/calendar/domain";
import { ageOn, clubClassLevelLabels, clubRosterAttendeeTypeLabels, clubSchoolGradeLabels, type ClubClassLevel, type ClubSchoolGrade } from "@/modules/club-rosters/domain";
import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";

export const CLUB_ROSTER_CHARTS_FEATURE_KEY = "roster-charts";
export const ROSTER_CHARTS_PATH = "charts";

/** Who sees the charts: the club roles that already see the roster (director, deputy, registrar). */
export function canSeeRosterCharts(capabilities: Pick<ClubCapabilities, "roster">): boolean {
  return capabilities.roster;
}

/** Who sees age groups and birthdays: only the roles that already see birth dates (director, deputy). */
export function canSeeRosterBirthdays(capabilities: Pick<ClubCapabilities, "seeBirthDates">): boolean {
  return capabilities.seeBirthDates;
}

export type CountRow = { key: string; label: string; value: number };

export type ChartMember = {
  attendeeType: string;
  classLevel: string | null;
  schoolGrade: string | null;
};

function ordered(counts: Map<string, number>, order: readonly string[], labels: Record<string, string>, extra?: { key: string; label: string }): CountRow[] {
  const rows: CountRow[] = [];
  for (const key of order) {
    const value = counts.get(key) ?? 0;
    if (value > 0) rows.push({ key, label: labels[key] ?? key, value });
  }
  if (extra && (counts.get(extra.key) ?? 0) > 0) rows.push({ key: extra.key, label: extra.label, value: counts.get(extra.key)! });
  return rows;
}

function tally(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

const NOT_SET = "NOT_SET";

/** Members by class level, in the order a Pathfinder moves through the classes; people with no class listed last. */
export function countByClassLevel(members: readonly ChartMember[]): CountRow[] {
  const counts = tally(members.map((member) => member.classLevel ?? NOT_SET));
  return ordered(counts, Object.keys(clubClassLevelLabels) as ClubClassLevel[], clubClassLevelLabels, { key: NOT_SET, label: "No class set" });
}

/** Youth members by school grade, kindergarten up; a youth with no grade is counted as "Grade not set". Other member types have no grade. */
export function countBySchoolGrade(members: readonly ChartMember[]): CountRow[] {
  const youth = members.filter((member) => member.attendeeType === "YOUTH" || member.schoolGrade !== null);
  const counts = tally(youth.map((member) => member.schoolGrade ?? NOT_SET));
  return ordered(counts, Object.keys(clubSchoolGradeLabels) as ClubSchoolGrade[], clubSchoolGradeLabels, { key: NOT_SET, label: "Grade not set" });
}

/** Members by type (Youth, Staff, Adult, Underage). */
export function countByMemberType(members: readonly ChartMember[]): CountRow[] {
  const counts = tally(members.map((member) => member.attendeeType));
  return ordered(counts, Object.keys(clubRosterAttendeeTypeLabels), clubRosterAttendeeTypeLabels);
}

/** The age groups, youngest first. A person without a birth date is counted apart. */
export const AGE_BANDS = [
  { key: "UNDER_10", label: "Under 10", min: 0, max: 9 },
  { key: "10_12", label: "10 to 12", min: 10, max: 12 },
  { key: "13_15", label: "13 to 15", min: 13, max: 15 },
  { key: "16_17", label: "16 and 17", min: 16, max: 17 },
  { key: "18_PLUS", label: "18 and over", min: 18, max: 120 },
] as const;

/**
 * People by age group on `today` (a calendar date). Takes the birth dates only to count them; it returns counts, no ages
 * and no dates. `birthDates` holds one entry per person, null when none is on file.
 */
export function countByAgeBand(birthDates: ReadonlyArray<string | null>, today: string): CountRow[] {
  const counts = new Map<string, number>();
  for (const birthDate of birthDates) {
    const age = birthDate ? ageOn(birthDate, today) : null;
    const band = age === null || age < 0 || age > 120 ? NOT_SET : AGE_BANDS.find((candidate) => age >= candidate.min && age <= candidate.max)!.key;
    counts.set(band, (counts.get(band) ?? 0) + 1);
  }
  return ordered(counts, AGE_BANDS.map((band) => band.key), Object.fromEntries(AGE_BANDS.map((band) => [band.key, band.label])), { key: NOT_SET, label: "No birth date on file" });
}

/* ------------------------------------------------------------------ Birthdays */

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** A month number 1 to 12 from a query value, or the fallback for anything else. */
export function parseBirthdayMonth(value: string | string[] | undefined, fallback: number): number {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== "string" || !/^\d{1,2}$/.test(text)) return fallback;
  const month = Number(text);
  return month >= 1 && month <= 12 ? month : fallback;
}

/** The calendar date today in the conference (Central) time zone, as YYYY-MM-DD. */
export function conferenceToday(now: Date): string {
  return calendarDateIn(now);
}

/** The month (1 to 12) it is now in the conference (Central) time zone. */
export function conferenceMonthOf(now: Date): number {
  return Number(conferenceToday(now).slice(5, 7));
}

export type BirthdayInput = { name: string; birthDate: string };
/** A birthday as shown: a name and a month and day. There is deliberately no year and no age. */
export type Birthday = { name: string; monthDay: string; day: number };

function monthAndDay(birthDate: string): { month: number; day: number } | null {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

/** Who has a birthday in `month`, by day then name. Output carries month and day only. */
export function birthdaysInMonth(people: readonly BirthdayInput[], month: number): Birthday[] {
  const rows: Birthday[] = [];
  for (const person of people) {
    const parts = monthAndDay(person.birthDate);
    if (parts && parts.month === month) rows.push({ name: person.name, monthDay: `${MONTH_NAMES[month - 1]} ${parts.day}`, day: parts.day });
  }
  return rows.sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ Attendance */

/** One meeting's check-off: its date (YYYY-MM-DD) and how many active members were marked present. */
export type MeetingAttendance = { meetingDate: string; present: number };

export type AttendanceMonth = { month: string; label: string; meetings: number; present: number; averagePresent: number };

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Meetings with a check-off and people present, by month, oldest first. */
export function attendanceByMonth(meetings: readonly MeetingAttendance[]): AttendanceMonth[] {
  const byMonth = new Map<string, { meetings: number; present: number }>();
  for (const meeting of meetings) {
    const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(meeting.meetingDate);
    if (!match) continue;
    const key = `${match[1]}-${match[2]}`;
    const entry = byMonth.get(key) ?? { meetings: 0, present: 0 };
    entry.meetings += 1;
    entry.present += meeting.present;
    byMonth.set(key, entry);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, entry]) => ({
      month: key,
      label: `${SHORT_MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`,
      meetings: entry.meetings,
      present: entry.present,
      averagePresent: Math.round(entry.present / entry.meetings),
    }));
}

/* ------------------------------------------------------------------ Text summaries */

export function summarizeCounts(what: string, rows: readonly CountRow[]): string {
  if (rows.length === 0) return `No ${what} to show.`;
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return `${total} ${total === 1 ? "person" : "people"} ${what}: ${rows.map((row) => `${row.label} ${row.value}`).join(", ")}.`;
}

export function summarizeAttendance(months: readonly AttendanceMonth[]): string {
  if (months.length === 0) return "No meetings with attendance checked off yet this club year.";
  return `Meetings with attendance checked off, by month: ${months.map((entry) => `${entry.label}, ${entry.meetings} ${entry.meetings === 1 ? "meeting" : "meetings"}, average ${entry.averagePresent} present`).join("; ")}.`;
}
