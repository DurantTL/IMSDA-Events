/**
 * Club rosters (#356). Pure rules: club years, ages, and labels. Birth dates
 * travel as `YYYY-MM-DD` calendar dates, never as instants, so a time zone can
 * never move someone's birthday.
 */

export const clubRosterAttendeeTypeLabels = {
  YOUTH: "Youth",
  STAFF: "Staff",
  ADULT: "Adult",
  UNDERAGE: "Underage",
} as const;

/** One-line definitions shown wherever a director picks a member type (#576). */
export const clubRosterAttendeeTypeDefinitions = {
  YOUTH: "A Pathfinder or Adventurer member.",
  STAFF: "Registered club staff (director, deputy, counselor, instructor).",
  ADULT: "A parent, helper, or driver aged 18 or over who isn't registered staff.",
  UNDERAGE: "A child who isn't old enough to be a club member (e.g. a staff member's young child).",
} as const;

const youngestClubMemberAge = 4;
const oldestYouthAge = 18;
const youngestStaffAge = 16;
const youngestAdultAge = 18;

/**
 * A soft hint (#576) when a birth date and the chosen type disagree, for
 * example a 19-year-old marked Youth. Hint only: it never blocks saving, and
 * it returns null when the age can't be worked out or fits the type.
 */
export function attendeeTypeAgeHint(
  attendeeType: keyof typeof clubRosterAttendeeTypeLabels,
  birthDate: string,
  today: string,
) {
  const age = ageOn(birthDate, today);
  if (age === null || age < 0 || age > 120) return null;
  const type = clubRosterAttendeeTypeLabels[attendeeType];
  if (attendeeType === "YOUTH" && age > oldestYouthAge) {
    return `This person is ${age}, which is older than most youth members. Is ${type} right? Adult or Staff may fit better.`;
  }
  if (attendeeType === "YOUTH" && age < youngestClubMemberAge) {
    return `This person is ${age}, which is younger than club members usually are. Is ${type} right? Underage may fit better.`;
  }
  if (attendeeType === "ADULT" && age < youngestAdultAge) {
    return `This person is ${age}, which is under 18. Is ${type} right? Youth or Underage may fit better.`;
  }
  if (attendeeType === "STAFF" && age < youngestStaffAge) {
    return `This person is ${age}, which is young for registered staff. Is ${type} right? Youth may fit better.`;
  }
  if (attendeeType === "UNDERAGE" && age >= youngestClubMemberAge) {
    return `This person is ${age}, which is old enough to be a club member. Is ${type} right? Youth may fit better.`;
  }
  return null;
}

/** Pathfinder class levels (#375), in the order a Pathfinder moves through them. */
export const clubClassLevelLabels = {
  FRIEND: "Friend",
  COMPANION: "Companion",
  EXPLORER: "Explorer",
  RANGER: "Ranger",
  VOYAGER: "Voyager",
  GUIDE: "Guide",
  TLT: "TLT",
  BASIC_STAFF_TRAINING: "Basic Staff Training",
  MASTER_GUIDE: "Master Guide",
} as const;

export type ClubClassLevel = keyof typeof clubClassLevelLabels;

export const clubClassLevels = Object.keys(clubClassLevelLabels) as ClubClassLevel[];

/**
 * The classes a roster member's *current class* can be (#1851). TLT is not one of them: it is a yes/no on youth
 * members (`isTlt`). TLT stays in `clubClassLevelLabels` for class history, monthly report class lists and honor
 * minimum levels.
 */
export type RosterClassLevel = Exclude<ClubClassLevel, "TLT">;

export const rosterClassLevels = clubClassLevels.filter((level): level is RosterClassLevel => level !== "TLT");

export const rosterClassLevelLabels = Object.fromEntries(
  rosterClassLevels.map((level) => [level, clubClassLevelLabels[level]]),
) as Record<RosterClassLevel, string>;

/** The label for the TLT yes/no on a roster member (#1851). */
export const rosterTltLabel = "TLT (Teen Leadership Training)";

/** The TLT yes/no as an export cell (#1851): "Yes" or "No" for a youth, blank for anyone else. */
export function rosterTltCell(member: { attendeeType: string; isTlt?: boolean | null }): string {
  if (member.attendeeType !== "YOUTH") return "";
  return member.isTlt === true ? "Yes" : "No";
}

/** TLT is youth only (#1851): the flag a roster write keeps for the member's (new) type. */
export function rosterIsTltFor(attendeeType: string | null | undefined, isTlt: boolean | null | undefined): boolean {
  return attendeeType === "YOUTH" && isTlt === true;
}

/**
 * A member's class for comparing against a minimum class (#1851): a youth flagged TLT has at least the TLT level even
 * when their current class is blank or lower; a higher class (Basic Staff Training, Master Guide) wins.
 */
export function effectiveClassLevel(
  member: { attendeeType?: string | null; classLevel?: ClubClassLevel | null; isTlt?: boolean | null },
): ClubClassLevel | null {
  const current = member.classLevel ?? null;
  if (!rosterIsTltFor(member.attendeeType ?? "YOUTH", member.isTlt)) return current;
  if (current === null) return "TLT";
  return clubClassLevels.indexOf(current) < clubClassLevels.indexOf("TLT") ? "TLT" : current;
}

/**
 * School grade (#1664), in school order. `NOT_IN_SCHOOL` is a real answer (a child not yet in school, or finished),
 * so it counts as "grade given" and is never flagged as missing.
 */
export const clubSchoolGradeLabels = {
  GRADE_K: "Kindergarten",
  GRADE_1: "1st grade",
  GRADE_2: "2nd grade",
  GRADE_3: "3rd grade",
  GRADE_4: "4th grade",
  GRADE_5: "5th grade",
  GRADE_6: "6th grade",
  GRADE_7: "7th grade",
  GRADE_8: "8th grade",
  GRADE_9: "9th grade",
  GRADE_10: "10th grade",
  GRADE_11: "11th grade",
  GRADE_12: "12th grade",
  NOT_IN_SCHOOL: "Not in school",
} as const;

export type ClubSchoolGrade = keyof typeof clubSchoolGradeLabels;

export const clubSchoolGrades = Object.keys(clubSchoolGradeLabels) as ClubSchoolGrade[];

/** School type (#1668, #1758): for the club's leaders and system administrators, and view only for Clubs Administrators and Area Coordinators; never event managers. */
export const clubSchoolTypeLabels = {
  ADVENTIST_SCHOOL: "Adventist school",
  PUBLIC_SCHOOL: "Public school",
  HOMESCHOOL: "Homeschool",
  OTHER: "Other",
} as const;

export type ClubSchoolType = keyof typeof clubSchoolTypeLabels;

export const clubSchoolTypes = Object.keys(clubSchoolTypeLabels) as ClubSchoolType[];

/** Seventh-day Adventist church membership (#1668), same visibility as school type. */
export const clubChurchMemberLabels = {
  YES: "Yes",
  NO: "No",
  NOT_SURE: "Not sure",
} as const;

export type ClubChurchMember = keyof typeof clubChurchMemberLabels;

export const clubChurchMembers = Object.keys(clubChurchMemberLabels) as ClubChurchMember[];

/** The plain label of the church membership question, wherever it is asked or shown. */
export const CHURCH_MEMBER_LABEL = "Seventh-day Adventist church member";

/**
 * A grade typed or chosen as text (#1664): "K", "Kindergarten", "5", "5th", "5th grade", "Grade 5", "not in school" /
 * "none". Null when it is not a grade from K to 12. Used by the roster CSV and the membership application mapping.
 */
export function schoolGradeFromText(value: string): ClubSchoolGrade | null {
  const wanted = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!wanted) return null;
  if (/^(not in school|none|n\/a|no school|not enrolled)$/.test(wanted)) return "NOT_IN_SCHOOL";
  if (/^(k|kg|kindergarten)$/.test(wanted)) return "GRADE_K";
  const match = /^(?:grade\s*)?(\d{1,2})(?:st|nd|rd|th)?(?:\s*grade)?$/.exec(wanted);
  if (!match) return null;
  const number = Number(match[1]);
  return number >= 1 && number <= 12 ? (`GRADE_${number}` as ClubSchoolGrade) : null;
}

/** Grade order (K first, Not in school last) for sorting; null when there is no grade. */
export function schoolGradeOrder(grade: string | null | undefined): number | null {
  const index = clubSchoolGrades.indexOf(grade as ClubSchoolGrade);
  return index === -1 ? null : index;
}

/**
 * Moves a grade up one school year for the year rollover (#1664). K to 1st ... 11th to 12th. 12th stays 12th (the
 * director reviews and removes graduates), and Not in school stays as it is. A missing grade stays missing.
 */
export function nextSchoolGrade(grade: ClubSchoolGrade | null): ClubSchoolGrade | null {
  if (!grade || grade === "NOT_IN_SCHOOL" || grade === "GRADE_12") return grade;
  return clubSchoolGrades[clubSchoolGrades.indexOf(grade) + 1]!;
}

/** The roster screen's two lists (#375): staff and adults, and the club's members. */
export type RosterSection = "STAFF" | "MEMBERS";

export function rosterSectionOf(attendeeType: keyof typeof clubRosterAttendeeTypeLabels): RosterSection {
  return attendeeType === "STAFF" || attendeeType === "ADULT" ? "STAFF" : "MEMBERS";
}

export const clubRosterGenderLabels = { FEMALE: "Female", MALE: "Male" } as const;

export const clubRosterStatusLabels = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  REMOVED: "Removed",
} as const;

/** Club years run September through August, e.g. "2026-27". */
export const CLUB_YEAR_START_MONTH = 9;

export function clubYearFor(date: Date) {
  const year = date.getUTCFullYear();
  const start = date.getUTCMonth() + 1 >= CLUB_YEAR_START_MONTH ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The current club year and the three before it, newest first; the selected year is added when it is not among them. */
export function clubYearOptions(selected: string, now: Date) {
  const start = Number(clubYearFor(now).slice(0, 4));
  const years = [0, 1, 2, 3].map((back) => `${start - back}-${String((start - back + 1) % 100).padStart(2, "0")}`);
  return years.includes(selected) ? years : [...years, selected].sort().reverse();
}

/** The previous, current, and next club year (#541): what an import may target and a roster may show. */
export function clubYearChoices(now = new Date()) {
  const year = Number(clubYearFor(now).slice(0, 4));
  return [year - 1, year, year + 1].map((start) => `${start}-${String((start + 1) % 100).padStart(2, "0")}`);
}

/** The club years whose rows may hold emergency contact edits (#959): current and next. */
export function guardianEditableYears(now = new Date()) {
  const [, current, next] = clubYearChoices(now);
  return [current!, next!];
}

/**
 * Which club year a roster screen shows for `?year=` (#541). Anything but the
 * previous, current, or next year falls back to the current one. Only the
 * current year is editable: every roster write route works on the current
 * year, so an older or newer year is shown read-only. The one exception is
 * emergency contacts, which a director can also edit on next year's rows (#959).
 */
export function rosterYearView(yearParam: string | string[] | undefined, now = new Date()) {
  const currentClubYear = clubYearFor(now);
  const choices = clubYearChoices(now);
  const clubYear = choices.find((year) => year === yearParam) ?? currentClubYear;
  const nextClubYear = choices[2]!;
  return {
    clubYear,
    currentClubYear,
    nextClubYear,
    choices,
    readOnly: clubYear !== currentClubYear,
    // Emergency contacts stay editable on next year's rows too (#959); a past year is history.
    contactsEditable: clubYear === currentClubYear || clubYear === nextClubYear,
  };
}

/**
 * Which club year the staff club page shows for `?year=` (#1304): every year the
 * club directory offers (the current year and three back) plus next year, so a
 * card opened from an older year keeps that year. Anything else is the current
 * year. Staff never write here, so any year but the current one is read-only.
 * Director screens keep `rosterYearView`; this widens only the staff view.
 */
export function staffClubYearView(yearParam: string | string[] | undefined, now = new Date()) {
  const base = rosterYearView(undefined, now);
  const choices = [base.nextClubYear, ...clubYearOptions(base.currentClubYear, now)].reverse();
  const clubYear = choices.find((year) => year === yearParam) ?? base.currentClubYear;
  return {
    clubYear,
    currentClubYear: base.currentClubYear,
    nextClubYear: base.nextClubYear,
    choices,
    /** The previous, current and next year: where a club import may be moved (#541). */
    importChoices: base.choices,
    readOnly: clubYear !== base.currentClubYear,
  };
}

/**
 * The club year a roster route answers for: the current year, or next year
 * when `?year=` names it (#959). Anything else, a past year included, is the
 * current year, so a route never lists a past year's emergency contacts.
 */
export function contactsRosterYear(yearParam: string | null | undefined, now = new Date()) {
  const { clubYear, contactsEditable } = rosterYearView(yearParam ?? undefined, now);
  return contactsEditable ? clubYear : clubYearFor(now);
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseCalendarDate(value: string) {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** Whole years of age on `onDate` (a calendar date). A Feb 29 birthday turns over on Mar 1. */
export function ageOn(birthDate: string, onDate: string) {
  const birth = parseCalendarDate(birthDate);
  const on = parseCalendarDate(onDate);
  if (!birth || !on) return null;
  let age = on.year - birth.year;
  if (on.month < birth.month || (on.month === birth.month && on.day < birth.day)) age -= 1;
  return age;
}

/**
 * Whether a roster person is an adult (#918): registered staff and adults are, and so is anyone whose
 * birth date makes them 18 or over on `today`. (#918 used it to word the contact section; since #510
 * every member's contact reads "Emergency contact", so nothing in the roster contact code depends on it.)
 */
export function isAdultRosterPerson(attendeeType: string | null | undefined, birthDate?: string | null, today?: string) {
  if (attendeeType === "STAFF" || attendeeType === "ADULT") return true;
  if (!birthDate || !today) return false;
  const age = ageOn(birthDate, today);
  return age !== null && age >= youngestAdultAge && age <= 120;
}

export function calendarDateOf(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** A birth date the roster accepts: a real date, not in the future, under 120 years ago. */
export function birthDateProblem(birthDate: string, today: string) {
  if (!parseCalendarDate(birthDate)) return "Enter a real birth date.";
  if (birthDate > today) return "A birth date can't be in the future.";
  const age = ageOn(birthDate, today);
  if (age === null || age > 120) return "Check the birth date year.";
  return null;
}

/**
 * Two-digit years (#424): "26" or earlier — this year's own last two digits —
 * is 20YY, otherwise 19YY. In 2026, `14` is 2014 and `68` is 1968.
 */
export function centuryForTwoDigitYear(twoDigit: number, currentYear: number) {
  return twoDigit <= currentYear % 100 ? 2000 + twoDigit : 1900 + twoDigit;
}

/**
 * A birth date typed as `M/D/YYYY` or `M/D/YY`, or already `YYYY-MM-DD`, into
 * `YYYY-MM-DD` (#424). One shared, pure parser for the roster form and the
 * CSV import, with the current year injectable for tests. Two-digit years
 * follow the century rule above. Returns null for anything that isn't a real
 * calendar date (`02/30/2014`) or a year before 1900; it doesn't check
 * whether the date is in the future or implausibly old — use
 * `birthDateProblem` for that. Pass `allowTwoDigitYear: false` for dates
 * that aren't birth dates (an expiration date from Sterling Volunteers, say), where the
 * century rule would misread `6/30/28` as 1928: `M/D/YY` is then rejected.
 */
export function parseRosterBirthDateInput(
  value: string,
  currentYear = new Date().getFullYear(),
  options: { allowTwoDigitYear?: boolean } = {},
): string | null {
  const { allowTwoDigitYear = true } = options;
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  const us = allowTwoDigitYear
    ? /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(trimmed)
    : /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    year = us[3].length === 2 ? centuryForTwoDigitYear(Number(us[3]), currentYear) : Number(us[3]);
  } else {
    return null;
  }
  if (year < 1900) return null;
  const isoDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return parseCalendarDate(isoDate) ? isoDate : null;
}

/**
 * The role a blank Role field saves as (#424): "Pathfinder" for youth, and
 * nothing for staff and adults, whose rows then fall back to their type label
 * as before. A role someone typed is never replaced.
 */
export function defaultRosterRole(attendeeType: string | null | undefined) {
  return attendeeType === "YOUTH" ? "Pathfinder" : "";
}

/** A typed role, or the default for the type when it was left blank (#424). */
export function rosterRoleOrDefault(role: string | null | undefined, attendeeType: string | null | undefined) {
  const typed = (role ?? "").trim();
  return typed || defaultRosterRole(attendeeType);
}

export type RosterYearSummary = {
  active: number;
  staff: number;
  members: number;
  byClass: Array<{ classLevel: ClubClassLevel; label: string; count: number }>;
};

/**
 * Roster counts for the club-year dashboard (#488): how many are active, the
 * staff/member split, and how many are in each class. Counts only — never a
 * name — so it's safe on a tile for a viewer who isn't allowed the roster
 * itself. Only active rows count, and the class breakdown is the MEMBERS
 * section only (`rosterSectionOf`) — never staff, even if a row somehow
 * carries a class level.
 */
export function rosterYearSummary(
  members: ReadonlyArray<{ status: string; attendeeType: keyof typeof clubRosterAttendeeTypeLabels; classLevel: ClubClassLevel | null }>,
): RosterYearSummary {
  const active = members.filter((member) => member.status === "ACTIVE");
  const staff = active.filter((member) => rosterSectionOf(member.attendeeType) === "STAFF").length;
  const counts = new Map<ClubClassLevel, number>();
  for (const member of active) {
    // Class levels are a Pathfinder's own field (#375): staff never have one, but only the
    // MEMBERS section is tallied here, so a future staff class level (if one is ever added) can't leak in.
    if (rosterSectionOf(member.attendeeType) !== "MEMBERS" || !member.classLevel) continue;
    counts.set(member.classLevel, (counts.get(member.classLevel) ?? 0) + 1);
  }
  const byClass = clubClassLevels
    .filter((level) => counts.has(level))
    .map((level) => ({ classLevel: level, label: clubClassLevelLabels[level], count: counts.get(level)! }));
  return { active: active.length, staff, members: active.length - staff, byClass };
}

/** The roster's own fields, for the "Missing info" flag (#424). */
export const rosterFieldLabels = {
  birthDate: "Birth date",
  gender: "Gender",
  classLevel: "Current class",
  schoolGrade: "Grade",
  role: "Role",
  attendeeType: "Type",
} as const;

type MissingFieldMember = {
  attendeeType: string | null | undefined;
  role: string | null | undefined;
  classLevel: string | null | undefined;
  /** School grade (#1664). Optional on the type so a caller that has no grade yet never flags everyone; every roster reader passes it. */
  schoolGrade?: string | null | undefined;
  gender: string | null | undefined;
  /** Whether a sealed birth date exists, without opening it. */
  birthDateNeeded: boolean;
};

/**
 * What a roster member is missing among the fields the roster collects
 * (#424): birth date, gender, current class (youth only), role, and type. Pure; worked
 * out from the record alone, so it needs no schema change and never opens a
 * sealed birth date.
 */
export function missingRosterFields(member: MissingFieldMember): string[] {
  const missing: string[] = [];
  if (member.birthDateNeeded) missing.push(rosterFieldLabels.birthDate);
  if (!member.gender) missing.push(rosterFieldLabels.gender);
  // Only youth are in a class; staff and adults are usually "None" (#424).
  if (member.attendeeType === "YOUTH" && !member.classLevel) missing.push(rosterFieldLabels.classLevel);
  // Grade (#1664) is youth only. A caller that does not carry the field at all (undefined) says nothing; null is "not given".
  // School type and church membership (#1668) are optional and are never flagged.
  if (member.attendeeType === "YOUTH" && member.schoolGrade === null) missing.push(rosterFieldLabels.schoolGrade);
  // A blank role only matters for youth; staff and adults show their type.
  if (member.attendeeType === "YOUTH" && !member.role) missing.push(rosterFieldLabels.role);
  if (!member.attendeeType) missing.push(rosterFieldLabels.attendeeType);
  return missing;
}

/**
 * The missing fields a roster row flags. An active person's missing birth date is left out because the roster's
 * birth-date notice already says it (#1004); an inactive person is not counted there, so theirs stays.
 */
export function rosterRowMissingFields(member: MissingFieldMember & { status?: string }): string[] {
  const missing = missingRosterFields(member);
  return member.status === "INACTIVE" ? missing : missing.filter((field) => field !== rosterFieldLabels.birthDate);
}
