import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REMINDER_DAYS_MAX,
  buildAgenda,
  calendarPageUrl,
  calendarReminderEmail,
  calendarReminderIdempotencyKey,
  canManageClubCalendar,
  conferenceHour,
  isValidReminderDays,
  reminderIsDue,
  timeLabel,
  timeRangeProblem,
} from "@/modules/club-calendar/domain";
import { clubCalendarItemSchema, clubCalendarReminderSettingSchema, parseMonthQuery } from "@/modules/club-calendar/schemas";
import { CLUB_OPTIONAL_FEATURE_KEYS, clubOptionalFeatureDefinitions } from "@/modules/club-features/domain";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";
import type { CalendarItem } from "@/modules/calendar/domain";

/** The club calendar's pure rules (#1700), with synthetic data and a pinned clock. */

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

// November 2026 is Central Standard Time (UTC-6): 14:00Z is 08:00 local, 13:59Z is 07:59.
const at = (iso: string) => new Date(iso);

describe("the feature is optional and described in plain words", () => {
  it("is a known key with a title and a description that says reminders start off", () => {
    expect(CLUB_OPTIONAL_FEATURE_KEYS).toContain("club-calendar");
    const definition = clubOptionalFeatureDefinitions["club-calendar"];
    expect(definition.title).toBe("Club calendar");
    expect(definition.description).toMatch(/Calendar page/);
    expect(definition.description).toMatch(/off until/i);
  });
});

describe("who can change the calendar", () => {
  it("is the director and deputy only", () => {
    expect(canManageClubCalendar(clubCapabilities("DIRECTOR"))).toBe(true);
    expect(canManageClubCalendar(clubCapabilities("DEPUTY"))).toBe(true);
    expect(canManageClubCalendar(clubCapabilities("REGISTRAR"))).toBe(false);
    expect(canManageClubCalendar(clubCapabilities("REPORTER"))).toBe(false);
  });
});

describe("reminderIsDue: the window, the 8 a.m. cutoff and past items", () => {
  const now = at("2026-11-10T15:00:00.000Z"); // 9:00 a.m. Central, Tuesday 10 November
  it("is due from daysBefore days ahead up to and including the day itself", () => {
    expect(reminderIsDue("2026-11-12", 2, now)).toBe(true); // exactly daysBefore ahead
    expect(reminderIsDue("2026-11-11", 2, now)).toBe(true);
    expect(reminderIsDue("2026-11-10", 2, now)).toBe(true); // the day itself
  });
  it("is not due before the window opens", () => {
    expect(reminderIsDue("2026-11-13", 2, now)).toBe(false);
  });
  it("is never due for a past item", () => {
    expect(reminderIsDue("2026-11-09", 2, now)).toBe(false);
    expect(reminderIsDue("2026-11-09", 14, now)).toBe(false);
  });
  it("waits for 8 a.m. Central, and uses the Central date, not UTC", () => {
    expect(conferenceHour(at("2026-11-10T13:59:00.000Z"))).toBe(7);
    expect(reminderIsDue("2026-11-10", 2, at("2026-11-10T13:59:00.000Z"))).toBe(false);
    expect(reminderIsDue("2026-11-10", 2, at("2026-11-10T14:00:00.000Z"))).toBe(true);
    // 03:00Z on the 11th is 9 p.m. on the 10th in Central time: an item on the 10th is still today, one on the 9th is past.
    expect(reminderIsDue("2026-11-10", 1, at("2026-11-11T03:00:00.000Z"))).toBe(true);
    expect(reminderIsDue("2026-11-09", 1, at("2026-11-11T03:00:00.000Z"))).toBe(false);
  });
  it("follows daylight time: 8 a.m. Central in July is 13:00Z", () => {
    expect(reminderIsDue("2026-07-15", 1, at("2026-07-15T12:59:00.000Z"))).toBe(false);
    expect(reminderIsDue("2026-07-15", 1, at("2026-07-15T13:00:00.000Z"))).toBe(true);
  });
  it("crosses a month end", () => {
    expect(reminderIsDue("2026-12-01", 2, at("2026-11-29T15:00:00.000Z"))).toBe(true);
    expect(reminderIsDue("2026-12-01", 2, at("2026-11-28T15:00:00.000Z"))).toBe(false);
  });
  it("is never due for a bad date or days outside 1 to 14", () => {
    expect(reminderIsDue("2026-02-30", 2, now)).toBe(false);
    expect(reminderIsDue("2026-11-12", 0, now)).toBe(false);
    expect(reminderIsDue("2026-11-12", REMINDER_DAYS_MAX + 1, now)).toBe(false);
    expect(reminderIsDue("2026-11-24", REMINDER_DAYS_MAX, now)).toBe(true);
  });
  it("accepts only whole days from 1 to 14", () => {
    expect([0, 1, 14, 15, 2.5, Number.NaN].map(isValidReminderDays)).toEqual([false, true, true, false, false, false]);
  });
});

describe("outbox keys and the email", () => {
  it("is unique per item, date and address, and the same on a repeat", () => {
    const key = calendarReminderIdempotencyKey("item-1", "2026-11-12", "Director@Example.test");
    expect(key).toBe(calendarReminderIdempotencyKey("item-1", "2026-11-12", " director@example.test "));
    expect(key).not.toBe(calendarReminderIdempotencyKey("item-1", "2026-11-13", "director@example.test"));
    expect(key).not.toBe(calendarReminderIdempotencyKey("item-2", "2026-11-12", "director@example.test"));
    expect(key).not.toBe(calendarReminderIdempotencyKey("item-1", "2026-11-12", "deputy@example.test"));
  });

  const item = { id: "item-1", kind: "OUTING" as const, title: "Canoe trip", date: "2026-11-12", startTime: "09:00", endTime: "15:30", location: "Synthetic Lake" };
  it("names the club, kind, title, date, time, place and the calendar link, and never the notes", () => {
    const withNotes = { ...item, notes: "Bring the secret code 12345" };
    const email = calendarReminderEmail({ recipientName: "Avery Example", clubName: "Test Pathfinders", item: withNotes, calendarUrl: calendarPageUrl("https://events.example.test", "club-1", item.date) });
    const text = `${email.subject}\n${email.bodyText}`;
    expect(text).toContain("Test Pathfinders");
    expect(text).toContain("Outing: Canoe trip");
    expect(text).toContain("Thursday, November 12, 2026");
    expect(text).toContain("9:00 AM to 3:30 PM");
    expect(text).toContain("Synthetic Lake");
    expect(text).toContain("https://events.example.test/account/clubs/club-1/calendar?month=2026-11");
    expect(text).not.toContain("secret code");
    expect(text).not.toContain("12345");
  });
  it("leaves out the time and place lines when there are none", () => {
    const email = calendarReminderEmail({ recipientName: "", clubName: "Test Pathfinders", item: { ...item, startTime: null, endTime: null, location: null }, calendarUrl: "https://events.example.test/x" });
    expect(email.bodyText).not.toMatch(/^Time:/m);
    expect(email.bodyText).not.toMatch(/^Where:/m);
    expect(email.bodyText.startsWith("Hello,")).toBe(true);
  });
});

describe("times and the item form", () => {
  it("labels times and checks a range", () => {
    expect(timeLabel("00:05")).toBe("12:05 AM");
    expect(timeLabel("12:00")).toBe("12:00 PM");
    expect(timeRangeProblem(null, "10:00")).toMatch(/start time/);
    expect(timeRangeProblem("10:00", "10:00")).toMatch(/after/);
    expect(timeRangeProblem("10:00", "11:00")).toBeNull();
    expect(timeRangeProblem(null, null)).toBeNull();
  });
  it("accepts a valid item and turns blank optional fields into undefined", () => {
    const parsed = clubCalendarItemSchema.parse({ kind: "MEETING", title: "  Weekly meeting ", date: "2026-11-12", startTime: "", endTime: "", location: "", notes: "" });
    expect(parsed).toEqual({ kind: "MEETING", title: "Weekly meeting", date: "2026-11-12" });
  });
  it("refuses a missing title, an impossible date, a bad time, an unknown kind and extra fields", () => {
    const base = { kind: "MEETING", title: "x", date: "2026-11-12" };
    expect(() => clubCalendarItemSchema.parse({ ...base, title: " " })).toThrow();
    expect(() => clubCalendarItemSchema.parse({ ...base, date: "2026-02-30" })).toThrow();
    expect(() => clubCalendarItemSchema.parse({ ...base, startTime: "25:00" })).toThrow();
    expect(() => clubCalendarItemSchema.parse({ ...base, startTime: "10:00", endTime: "09:00" })).toThrow();
    expect(() => clubCalendarItemSchema.parse({ ...base, kind: "PARTY" })).toThrow();
    expect(() => clubCalendarItemSchema.parse({ ...base, organizationId: "club-2" })).toThrow();
    expect(() => clubCalendarItemSchema.parse({ ...base, title: "a\nb" })).toThrow();
  });
  it("accepts reminder days 1 to 14 only", () => {
    expect(clubCalendarReminderSettingSchema.parse({ enabled: true, daysBefore: 14 })).toEqual({ enabled: true, daysBefore: 14 });
    expect(() => clubCalendarReminderSettingSchema.parse({ enabled: true, daysBefore: 0 })).toThrow();
    expect(() => clubCalendarReminderSettingSchema.parse({ enabled: true, daysBefore: 15 })).toThrow();
    expect(() => clubCalendarReminderSettingSchema.parse({ enabled: true, daysBefore: 1.5 })).toThrow();
    expect(() => clubCalendarReminderSettingSchema.parse({ enabled: "yes", daysBefore: 2 })).toThrow();
  });
  it("reads ?month only in the form YYYY-MM", () => {
    expect(parseMonthQuery("2026-11")).toBe("2026-11");
    expect(parseMonthQuery("2026-13")).toBeUndefined();
    expect(parseMonthQuery("nov")).toBeUndefined();
    expect(parseMonthQuery(["2026-12", "2027-01"])).toBe("2026-12");
  });
});

describe("the month agenda", () => {
  const conference = (over: Partial<CalendarItem>): CalendarItem => ({
    key: "event-1", kind: "EVENT", title: "Synthetic Camporee", description: "", startsOn: "2026-11-20", endsOn: "2026-11-22", timeLabel: "", location: "Synthetic Camp",
    category: "", href: "/events/synthetic-camporee", status: "SCHEDULED", registrationOpen: false, ...over,
  });
  const club = (id: string, date: string, kind: "MEETING" | "OUTING" | "DEADLINE", startTime: string | null = null) => ({ id, kind, title: `Item ${id}`, date, startTime, endTime: null, location: null, notes: null });

  it("lists club and conference entries by date, each with a text label that says whose it is", () => {
    const agenda = buildAgenda({
      from: "2026-11-01",
      to: "2026-11-30",
      clubItems: [club("b", "2026-11-20", "OUTING", "09:00"), club("a", "2026-11-05", "MEETING", "18:30"), club("late", "2026-12-01", "MEETING"), club("c", "2026-11-20", "DEADLINE")],
      conferenceItems: [conference({}), conference({ key: "event-2", title: "Next month", startsOn: "2026-12-05", endsOn: "2026-12-05" })],
    });
    expect(agenda.map((entry) => [entry.startsOn, entry.label, entry.title])).toEqual([
      ["2026-11-05", "Club meeting", "Item a"],
      ["2026-11-20", "Club deadline", "Item c"],
      ["2026-11-20", "Conference event", "Synthetic Camporee"],
      ["2026-11-20", "Club outing", "Item b"],
    ]);
    // Every entry has a non-empty label, so colour is never the only cue.
    expect(agenda.every((entry) => entry.label.length > 0)).toBe(true);
  });
  it("includes a conference event that overlaps the month from a neighbouring month, clamped to the month", () => {
    const agenda = buildAgenda({ from: "2026-11-01", to: "2026-11-30", clubItems: [], conferenceItems: [conference({ startsOn: "2026-10-30", endsOn: "2026-11-02" })] });
    expect(agenda).toHaveLength(1);
    expect(agenda[0]).toMatchObject({ startsOn: "2026-11-01", endsOn: "2026-11-02", href: "/events/synthetic-camporee" });
  });
});
