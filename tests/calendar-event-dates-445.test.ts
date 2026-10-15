import { describe, expect, it } from "vitest";
import {
  buildDatePreview,
  datePromptKind,
  datePromptMessage,
  datesNeedDecision,
  type DatePreviewInput,
} from "@/modules/calendar/event-dates";

const agree = { itemStartsOn: "2026-10-09", itemEndsOn: "2026-10-11", eventStartsOn: "2026-10-09", eventEndsOn: "2026-10-11" };
const acknowledged = { baselineStartsOn: "2026-10-09", baselineEndsOn: "2026-10-11" };
const never = { baselineStartsOn: null, baselineEndsOn: null };

describe("date change decision (#445)", () => {
  it("asks nothing while the item and event agree", () => {
    expect(datesNeedDecision({ ...agree, ...acknowledged })).toBe(false);
    expect(datesNeedDecision({ ...agree, ...never })).toBe(false);
  });

  it("asks when Google really moves the item away from the dates staff acknowledged", () => {
    expect(datesNeedDecision({ ...agree, ...acknowledged, itemStartsOn: "2026-11-07", itemEndsOn: "2026-11-09" })).toBe(true);
    expect(datesNeedDecision({ ...agree, ...acknowledged, itemEndsOn: "2026-10-12" })).toBe(true);
  });

  it("does not ask when staff changed the event and the item stayed where it was", () => {
    // The baseline is the item's dates, so an event edited by hand is not a question for the calendar.
    expect(datesNeedDecision({ ...agree, ...acknowledged, eventStartsOn: "2026-10-16", eventEndsOn: "2026-10-18" })).toBe(false);
  });

  it("asks straight away when the item never matched its event, and stays quiet after Keep until it moves again", () => {
    const differing = { ...agree, itemStartsOn: "2026-11-07", itemEndsOn: "2026-11-09" };
    expect(datesNeedDecision({ ...differing, ...never })).toBe(true);
    expect(datesNeedDecision({ ...differing, baselineStartsOn: "2026-11-07", baselineEndsOn: "2026-11-09" })).toBe(false);
    expect(datesNeedDecision({ ...differing, baselineStartsOn: "2026-11-07", baselineEndsOn: "2026-11-08" })).toBe(true);
  });

  it("says moved after a baseline exists and differs when the item never agreed with the event", () => {
    expect(datePromptKind(acknowledged)).toBe("moved");
    expect(datePromptKind(never)).toBe("differs");
    expect(datePromptMessage({ imported: true, kind: "moved", itemStartsOn: "2026-11-07", itemEndsOn: "2026-11-09" }))
      .toBe("Google Calendar moved this event to November 7–9, 2026. Update the registration dates?");
    expect(datePromptMessage({ imported: false, kind: "moved", itemStartsOn: "2026-11-07", itemEndsOn: "2026-11-09" }))
      .toBe("The calendar item for this event was moved to November 7–9, 2026. Update the registration dates?");
    const differs = datePromptMessage({ imported: true, kind: "differs", itemStartsOn: "2026-11-07", itemEndsOn: "2026-11-09" });
    expect(differs).toBe("The calendar item for this event shows November 7–9, 2026, which differs from the registration dates. Update the registration dates?");
    expect(differs).not.toMatch(/moved/);
  });
});

describe("Update preview (#445)", () => {
  const base: { startsOn: string; endsOn: string } & DatePreviewInput = {
    startsOn: "2026-10-09",
    endsOn: "2026-10-11",
    registrationOpensOn: "2026-08-01",
    registrationClosesOn: "2026-10-05",
    seminarPreferenceClosesOn: null,
    locations: [{ name: "Site A", firstDay: "2026-10-09", lastDay: "2026-10-11", registrationClosesOn: null }],
    lodging: { firstNight: "2026-10-09", lastNight: "2026-10-10", preferencesDeadline: "2026-10-01" },
    mealServiceDates: [],
    cancellationWindows: [],
    registrationCount: 0,
  };
  const moved = { startsOn: "2026-11-07", endsOn: "2026-11-09" };

  it("previews the new dates and lists dependent dates that stay exactly as they are", () => {
    const preview = buildDatePreview(base, moved);
    expect(preview.changes).toEqual([{ label: "Event dates", from: "October 9–11, 2026", to: "November 7–9, 2026" }]);
    expect(preview.blockedReason).toBeNull();
    expect(preview.notes).toEqual([]);
    expect(preview.unchanged.map((item) => item.label)).toEqual(["Registration opens", "Registration closes", "Site A: days", "Lodging nights", "Lodging preferences close"]);
    expect(preview.unchanged.find((item) => item.label === "Site A: days")?.needsAttention).toBe(true);
    expect(preview.unchanged.find((item) => item.label === "Lodging nights")?.needsAttention).toBe(true);
    expect(preview.unchanged.find((item) => item.label === "Registration closes")?.needsAttention).toBe(false);
  });

  it("flags registration that would close after the event, and refuses one that would open after it", () => {
    const earlier = buildDatePreview(base, { startsOn: "2026-09-25", endsOn: "2026-09-27" });
    expect(earlier.unchanged.find((item) => item.label === "Registration closes")?.needsAttention).toBe(true);
    expect(earlier.blockedReason).toBeNull();
    const blocked = buildDatePreview({ ...base, registrationOpensOn: "2026-10-20" }, { startsOn: "2026-10-09", endsOn: "2026-10-11" });
    expect(blocked.blockedReason).toMatch(/open after the new last day/);
  });

  it("lists meal services, flagging the ones outside the new dates", () => {
    const meals = ["2026-10-09", "2026-10-10", "2026-11-07", "2026-11-10"];
    const preview = buildDatePreview({ ...base, mealServiceDates: meals }, moved);
    const row = preview.unchanged.find((item) => item.label === "Meal services");
    expect(row).toMatchObject({ value: "4 services", needsAttention: true });
    expect(row?.note).toContain("3 fall outside the new event dates");
    expect(row?.note).toContain("October 9, 2026");
    expect(row?.note).not.toContain("November 7, 2026");
    const inside = buildDatePreview({ ...base, mealServiceDates: ["2026-11-07", "2026-11-08"] }, moved);
    expect(inside.unchanged.find((item) => item.label === "Meal services")).toMatchObject({ value: "2 services", needsAttention: false, note: "" });
    expect(buildDatePreview({ ...base, mealServiceDates: ["2026-11-07"] }, moved).unchanged.find((item) => item.label === "Meal services")?.value).toBe("1 service");
    expect(buildDatePreview(base, moved).unchanged.some((item) => item.label === "Meal services")).toBe(false);
  });

  it("lists cancellation policy windows, flagging one that would end after the event", () => {
    const preview = buildDatePreview({ ...base, cancellationWindows: [{ label: "Full refund", endsOn: "2026-10-01" }, { label: "Half refund", endsOn: "2026-11-20" }] }, moved);
    expect(preview.unchanged.find((item) => item.label === 'Cancellation window "Full refund" ends')).toMatchObject({ needsAttention: false, note: "" });
    expect(preview.unchanged.find((item) => item.label === 'Cancellation window "Half refund" ends')).toMatchObject({ needsAttention: true, note: "This is after the new last day." });
  });

  it("says when the event has registrations, and that minor status is measured on the first day", () => {
    expect(buildDatePreview({ ...base, registrationCount: 1 }, moved).notes[0]).toContain("has 1 registration.");
    const many = buildDatePreview({ ...base, registrationCount: 42 }, moved).notes;
    expect(many).toHaveLength(1);
    expect(many[0]).toContain("has 42 registrations");
    expect(many[0]).toContain("minor is measured on the event's first day");
    expect(many[0]).toContain("Update changes none of them");
  });
});
