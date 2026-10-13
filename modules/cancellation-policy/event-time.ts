/**
 * Event-timezone arithmetic for cancellation windows (#169). Pure and dependency-free: it uses `Intl` only.
 *
 * A window "ends on" a local calendar day and covers all of it, so its end is the next local midnight. Computing that
 * instant from the zone's own rules (not "24 hours later") keeps the boundary exact across a daylight-saving change:
 * the day the clocks go back is 25 hours long and the day they go forward is 23.
 */

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

/** Whether `timeZone` is a zone `Intl` knows. Event time zones are validated when events are saved; this guards the calculator. */
export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date ("YYYY-MM-DD") it is in `timeZone` at `instant`. */
export function localDateKey(instant: Date, timeZone: string) {
  const { year, month, day } = zonedParts(instant, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The date after `key`, as "YYYY-MM-DD". Calendar arithmetic only; no time zone is involved. */
export function nextDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * The instant the wall clock in `timeZone` reads `hour:minute` on the calendar date `key`. When that wall time does not
 * exist (the hour skipped when clocks go forward) or happens twice (the hour repeated when clocks go back) the result
 * is one fixed, repeatable instant near it. Window boundaries are local midnights, which only a few zones affect.
 */
export function localInstant(key: string, hour: number, minute: number, timeZone: string) {
  const [year, month, day] = key.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = wall;
  // The UTC offset depends on the instant itself, so settle it in a few passes.
  for (let pass = 0; pass < 4; pass += 1) {
    const local = zonedParts(new Date(guess), timeZone);
    const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    guess -= localAsUtc - wall;
  }
  return new Date(guess);
}

/** The instant local midnight (00:00:00.000) begins on `key` in `timeZone`. */
export function localMidnightInstant(key: string, timeZone: string) {
  return localInstant(key, 0, 0, timeZone);
}

/** The first instant after the whole local day `endsOn`: the moment a window that "ends on" that date has closed. */
export function windowClosesAt(endsOn: string, timeZone: string) {
  return localMidnightInstant(nextDateKey(endsOn), timeZone);
}
