import { describe, expect, it } from "vitest";
import { eventInstant, eventTimeProblems, keepClockTime, localClockTime } from "@/modules/events/event-times";
import { applyEventTemplateInputSchema } from "@/modules/event-templates/domain";
import { validateFromTemplateForm } from "@/modules/event-templates/from-template-validation";

describe("event times (#1406)", () => {
  it("stores the chosen wall-clock time in the event's time zone", () => {
    expect(eventInstant("2027-03-05", "19:00", "America/Chicago").toISOString()).toBe("2027-03-06T01:00:00.000Z");
    expect(eventInstant("2027-07-09", "07:00", "America/Chicago").toISOString()).toBe("2027-07-09T12:00:00.000Z");
    expect(eventInstant("2027-07-09", "07:00", "America/New_York").toISOString()).toBe("2027-07-09T11:00:00.000Z");
  });

  it("keeps noon UTC when no time is given", () => {
    expect(eventInstant("2027-03-05", undefined, "America/Chicago").toISOString()).toBe("2027-03-05T12:00:00.000Z");
  });

  it("reads the local clock time back", () => {
    expect(localClockTime(new Date("2027-03-06T01:00:00.000Z"), "America/Chicago")).toBe("19:00");
  });

  it("keeps the clock time when a settings save moves the dates", () => {
    const existing = eventInstant("2027-03-05", "19:00", "America/Chicago");
    expect(keepClockTime(existing, "America/Chicago", "2027-03-12", "America/Chicago").toISOString()).toBe("2027-03-13T01:00:00.000Z");
    // A change of time zone keeps the same wall clock in the new zone.
    expect(keepClockTime(existing, "America/Chicago", "2027-03-05", "America/Denver").toISOString()).toBe("2027-03-06T02:00:00.000Z");
  });

  it("leaves an older event's noon UTC alone", () => {
    const legacy = new Date("2027-07-09T12:00:00.000Z");
    expect(keepClockTime(legacy, "America/Chicago", "2027-08-01", "America/Chicago").toISOString()).toBe("2027-08-01T12:00:00.000Z");
  });

  it("refuses an end before the start on the same day, in plain words", () => {
    expect(eventTimeProblems({ startsOn: "2027-03-05", endsOn: "2027-03-05", startTime: "10:00", endTime: "09:00" }).endTime).toMatch(/cannot end before it starts/);
    expect(eventTimeProblems({ startsOn: "2027-03-05", endsOn: "2027-03-06", startTime: "10:00", endTime: "09:00" })).toEqual({});
    expect(eventTimeProblems({ startsOn: "2027-03-05", endsOn: "2027-03-05" })).toEqual({});
  });

  it("accepts optional times on the apply input and rejects a bad one", () => {
    const base = { name: "Mock Run Retreat 2027", slug: "mock-run-retreat-2027", startsOn: "2027-03-05", endsOn: "2027-03-07", requestKey: "request-key-1" };
    expect(applyEventTemplateInputSchema.safeParse(base).success).toBe(true);
    expect(applyEventTemplateInputSchema.safeParse({ ...base, startTime: "19:00", endTime: "11:00" }).success).toBe(true);
    expect(applyEventTemplateInputSchema.safeParse({ ...base, startTime: "7pm" }).success).toBe(false);
    expect(applyEventTemplateInputSchema.safeParse({ ...base, endsOn: "2027-03-05", startTime: "19:00", endTime: "11:00" }).success).toBe(false);
  });

  it("makes the page's times required and checks their order", () => {
    const form = { templateId: "t", name: "Mock Run", slug: "mock-run", startsOn: "2027-03-05", endsOn: "2027-03-05" };
    expect(validateFromTemplateForm({ ...form, startTime: "", endTime: "" })).toMatchObject({ startTime: "Choose the start time.", endTime: "Choose the end time." });
    expect(validateFromTemplateForm({ ...form, startTime: "10:00", endTime: "09:00" }).endTime).toMatch(/cannot end before it starts/);
    expect(validateFromTemplateForm({ ...form, startTime: "09:00", endTime: "17:00" })).toEqual({});
  });
});
