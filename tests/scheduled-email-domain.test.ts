import { describe, expect, it } from "vitest";
import {
  SCHEDULED_EMAIL_MIN_LEAD_MS,
  ScheduleProjectionError,
  addCalendarDays,
  assertSendTimeUsable,
  canEditSchedule,
  canTransitionSchedule,
  decideRecipientEligibility,
  eventTimingChanged,
  projectSchedule,
  refusedYouthTargets,
  scheduleReviewFingerprint,
  scheduleRuleSchema,
  scheduledEmailContentSchema,
  targetKey,
  wallTimeToInstant,
  zoneOffsetMs,
  type CurrentAudienceView,
  type YouthCheckRegistration,
  type ScheduleRule,
} from "@/modules/communications/scheduled-email-domain";

const CHICAGO = "America/Chicago";

describe("wall time to instant (explicit DST behavior)", () => {
  it("uses the standard-time offset in winter and the daylight offset in summer", () => {
    expect(wallTimeToInstant({ date: "2027-01-15", time: "09:00" }, CHICAGO)).toEqual({
      instant: new Date("2027-01-15T15:00:00Z"),
      behavior: "NONE",
    });
    expect(wallTimeToInstant({ date: "2027-07-15", time: "09:00" }, CHICAGO)).toEqual({
      instant: new Date("2027-07-15T14:00:00Z"),
      behavior: "NONE",
    });
  });

  it("spring forward: a time that does not exist goes out at the first moment after the jump", () => {
    // Clocks in Chicago jump from 02:00 CST to 03:00 CDT on 2027-03-14. 02:30 never happens.
    const result = wallTimeToInstant({ date: "2027-03-14", time: "02:30" }, CHICAGO);
    expect(result.behavior).toBe("GAP_SHIFTED");
    expect(result.instant).toEqual(new Date("2027-03-14T08:30:00Z")); // 03:30 CDT
    // The first valid moment after the gap is 03:00 CDT = 08:00Z; the shifted time is after it, never before.
    expect(result.instant.getTime()).toBeGreaterThanOrEqual(new Date("2027-03-14T08:00:00Z").getTime());
  });

  it("spring forward: 01:59 (just before) and 03:00 (just after) are ordinary times", () => {
    expect(wallTimeToInstant({ date: "2027-03-14", time: "01:59" }, CHICAGO).behavior).toBe("NONE");
    expect(wallTimeToInstant({ date: "2027-03-14", time: "03:00" }, CHICAGO)).toEqual({
      instant: new Date("2027-03-14T08:00:00Z"),
      behavior: "NONE",
    });
  });

  it("fall back: a time that happens twice goes out the first time", () => {
    // Clocks in Chicago go from 02:00 CDT back to 01:00 CST on 2027-11-07. 01:30 happens twice.
    const result = wallTimeToInstant({ date: "2027-11-07", time: "01:30" }, CHICAGO);
    expect(result.behavior).toBe("AMBIGUOUS_FIRST");
    expect(result.instant).toEqual(new Date("2027-11-07T06:30:00Z")); // 01:30 CDT, not 01:30 CST (07:30Z)
  });

  it("fall back: the hour after the repeat is an ordinary time", () => {
    expect(wallTimeToInstant({ date: "2027-11-07", time: "02:30" }, CHICAGO)).toEqual({
      instant: new Date("2027-11-07T08:30:00Z"),
      behavior: "NONE",
    });
  });

  it("a zone without daylight saving never shifts", () => {
    for (const date of ["2027-03-14", "2027-11-07", "2027-07-01"]) {
      expect(wallTimeToInstant({ date, time: "02:30" }, "America/Phoenix").behavior).toBe("NONE");
    }
    expect(wallTimeToInstant({ date: "2027-03-14", time: "02:30" }, "America/Phoenix").instant)
      .toEqual(new Date("2027-03-14T09:30:00Z"));
  });

  it("the same wall time is a different instant in a different zone, on the same day", () => {
    const chicago = wallTimeToInstant({ date: "2027-06-01", time: "09:00" }, CHICAGO).instant;
    const newYork = wallTimeToInstant({ date: "2027-06-01", time: "09:00" }, "America/New_York").instant;
    const losAngeles = wallTimeToInstant({ date: "2027-06-01", time: "09:00" }, "America/Los_Angeles").instant;
    expect(newYork.getTime()).toBeLessThan(chicago.getTime());
    expect(chicago.getTime() - newYork.getTime()).toBe(3_600_000);
    expect(losAngeles.getTime() - chicago.getTime()).toBe(2 * 3_600_000);
  });

  it("zoneOffsetMs reports the offset in force at an instant", () => {
    expect(zoneOffsetMs(new Date("2027-01-15T12:00:00Z").getTime(), CHICAGO)).toBe(-6 * 3_600_000);
    expect(zoneOffsetMs(new Date("2027-07-15T12:00:00Z").getTime(), CHICAGO)).toBe(-5 * 3_600_000);
  });

  it("refuses an unknown time zone instead of guessing", () => {
    expect(() => wallTimeToInstant({ date: "2027-01-15", time: "09:00" }, "Mars/Olympus")).toThrow(ScheduleProjectionError);
  });
});

describe("projecting a schedule in event time", () => {
  const event = {
    timezone: CHICAGO,
    // 2027-03-15 09:00 CDT, the Monday after the spring change.
    startsAt: new Date("2027-03-15T14:00:00Z"),
    registrationClosesOn: "2027-03-14",
  };

  it("a one-time schedule is a date and time in the event's zone, with a DST note", () => {
    const projection = projectSchedule({ trigger: "ONE_TIME", localDate: "2027-03-14", localTime: "02:30" }, event);
    expect(projection.sendAt).toEqual(new Date("2027-03-14T08:30:00Z"));
    expect(projection.dstBehavior).toBe("GAP_SHIFTED");
    expect(projection.dstNote).toContain("does not exist");
    expect(projection.localTime).toBe("03:30");
    expect(projection.eventTimezone).toBe(CHICAGO);
    expect(projection.anchorAt).toBeNull();

    const ordinary = projectSchedule({ trigger: "ONE_TIME", localDate: "2027-05-01", localTime: "09:00" }, event);
    expect(ordinary.dstBehavior).toBe("NONE");
    expect(ordinary.dstNote).toMatch(/No daylight saving change/);
    expect(ordinary.sendAtLabel).toMatch(/CDT/);
  });

  it("the ambiguous hour is explained as the first occurrence", () => {
    const projection = projectSchedule({ trigger: "ONE_TIME", localDate: "2027-11-07", localTime: "01:30" }, event);
    expect(projection.dstBehavior).toBe("AMBIGUOUS_FIRST");
    expect(projection.dstNote).toContain("twice");
  });

  it("'N days before the event' counts calendar days, so 9:00 stays 9:00 across the clock change", () => {
    const sevenBefore = projectSchedule({ trigger: "BEFORE_EVENT_START", daysBefore: 7, localTime: "09:00" }, event);
    // Mar 8 is still standard time: 09:00 CST = 15:00Z. A 7 x 24 hour subtraction from the start would give 14:00Z.
    expect(sevenBefore.sendAt).toEqual(new Date("2027-03-08T15:00:00Z"));
    expect(sevenBefore.sendAt.getTime()).not.toBe(event.startsAt.getTime() - 7 * 24 * 3_600_000);
    expect(sevenBefore.localTime).toBe("09:00");

    const oneBefore = projectSchedule({ trigger: "BEFORE_EVENT_START", daysBefore: 1, localTime: "09:00" }, event);
    expect(oneBefore.sendAt).toEqual(new Date("2027-03-14T14:00:00Z")); // the day of the change, after the jump: CDT
    expect(oneBefore.anchorAt).toEqual(event.startsAt);
  });

  it("the anchor day is the event's own calendar day, not the UTC day", () => {
    // 2027-03-16T03:00Z is still the evening of Mar 15 in Chicago.
    const lateStart = { ...event, startsAt: new Date("2027-03-16T03:00:00Z") };
    const projection = projectSchedule({ trigger: "BEFORE_EVENT_START", daysBefore: 0, localTime: "09:00" }, lateStart);
    expect(projection.localDate).toBe("2027-03-15");
  });

  it("'before registration closes' counts back from the close day; registration is open through that whole day", () => {
    const sameDay = projectSchedule({ trigger: "BEFORE_REGISTRATION_CLOSE", daysBefore: 0, localTime: "09:00" }, event);
    expect(sameDay.localDate).toBe("2027-03-14");
    expect(sameDay.anchorAt).toEqual(new Date("2027-03-15T05:00:00Z")); // midnight ending Mar 14 in CDT
    const week = projectSchedule({ trigger: "BEFORE_REGISTRATION_CLOSE", daysBefore: 7, localTime: "09:00" }, event);
    expect(week.sendAt).toEqual(new Date("2027-03-07T15:00:00Z"));
  });

  it("refuses a relative schedule it cannot count back from", () => {
    expect(() => projectSchedule(
      { trigger: "BEFORE_REGISTRATION_CLOSE", daysBefore: 3, localTime: "09:00" },
      { ...event, registrationClosesOn: null },
    )).toThrow(/no registration close date/);
  });

  describe("'before payment due' (#993)", () => {
    const withDue = { ...event, paymentDueOn: "2027-03-01" };
    const rule: ScheduleRule = { trigger: "BEFORE_PAYMENT_DUE", daysBefore: 7, localTime: "09:00" };

    it("counts calendar days back from the due day, and the day is due through its end", () => {
      const week = projectSchedule(rule, withDue);
      expect(week.localDate).toBe("2027-02-22");
      expect(week.sendAt).toEqual(new Date("2027-02-22T15:00:00Z")); // 09:00 CST
      expect(week.anchorAt).toEqual(new Date("2027-03-02T06:00:00Z")); // midnight ending Mar 1 in CST
      const sameDay = projectSchedule({ ...rule, daysBefore: 0 }, withDue);
      expect(sameDay.localDate).toBe("2027-03-01");
    });

    it("keeps 9:00 local across a clock change between the send day and the due day", () => {
      // Due Mar 20 (CDT); 7 days back is Mar 13 (CST). A 7 x 24 hour subtraction would land at 08:00 local.
      const projection = projectSchedule(rule, { ...event, paymentDueOn: "2027-03-20" });
      expect(projection.localDate).toBe("2027-03-13");
      expect(projection.localTime).toBe("09:00");
      expect(projection.sendAt).toEqual(new Date("2027-03-13T15:00:00Z"));
      // A send time that does not exist that day (the jump) is moved to just after it.
      const gap = projectSchedule({ trigger: "BEFORE_PAYMENT_DUE", daysBefore: 0, localTime: "02:30" }, { ...event, paymentDueOn: "2027-03-14" });
      expect(gap.dstBehavior).toBe("GAP_SHIFTED");
      expect(gap.localTime).toBe("03:30");
    });

    it("is refused when the event has no payment due date, and after the due day ends", () => {
      expect(() => projectSchedule(rule, event)).toThrow(/no payment due date/);
      expect(() => projectSchedule(rule, { ...event, paymentDueOn: null })).toThrow(ScheduleProjectionError);
      expect(() => projectSchedule({ ...rule, daysBefore: 0, localTime: "23:59" }, withDue)).not.toThrow();
    });

    it("changing or clearing the due date makes an approved schedule stale (it pauses for a new review)", () => {
      const reviewed = projectSchedule(rule, withDue);
      const stored = { eventTimezone: reviewed.eventTimezone, anchorAt: reviewed.anchorAt, sendAt: reviewed.sendAt };
      expect(eventTimingChanged(stored, projectSchedule(rule, withDue))).toBe(false);
      expect(eventTimingChanged(stored, projectSchedule(rule, { ...withDue, paymentDueOn: "2027-03-02" }))).toBe(true);
      // Cleared: it cannot be projected at all, which the sweep and the record treat as stale, never as send.
      expect(() => projectSchedule(rule, { ...withDue, paymentDueOn: null })).toThrow(ScheduleProjectionError);
    });
  });

  it("refuses a time after its own anchor", () => {
    expect(() => projectSchedule({ trigger: "BEFORE_EVENT_START", daysBefore: 0, localTime: "23:00" }, event)).toThrow(/after the event starts/);
    expect(() => projectSchedule({ trigger: "BEFORE_EVENT_START", daysBefore: 0, localTime: "09:00" }, event)).toThrow(ScheduleProjectionError);
    expect(() => projectSchedule({ trigger: "BEFORE_REGISTRATION_CLOSE", daysBefore: 0, localTime: "23:59" }, event)).not.toThrow();
  });

  it("a different event time zone gives a different instant for the same rule", () => {
    const rule: ScheduleRule = { trigger: "BEFORE_EVENT_START", daysBefore: 7, localTime: "09:00" };
    const chicago = projectSchedule(rule, event);
    const mountain = projectSchedule(rule, { ...event, timezone: "America/Denver" });
    expect(mountain.sendAt.getTime() - chicago.sendAt.getTime()).toBe(3_600_000);
  });

  it("a schedule edit moves the projection, and a changed event time zone or anchor is detected as stale", () => {
    const rule: ScheduleRule = { trigger: "BEFORE_EVENT_START", daysBefore: 7, localTime: "09:00" };
    const reviewed = projectSchedule(rule, event);
    const stored = { eventTimezone: reviewed.eventTimezone, anchorAt: reviewed.anchorAt, sendAt: reviewed.sendAt };
    expect(eventTimingChanged(stored, projectSchedule(rule, event))).toBe(false);
    expect(eventTimingChanged(stored, projectSchedule(rule, { ...event, timezone: "America/New_York" }))).toBe(true);
    expect(eventTimingChanged(stored, projectSchedule(rule, { ...event, startsAt: new Date("2027-03-22T14:00:00Z") }))).toBe(true);
    // An edit to the rule itself is a new projection too.
    const edited = projectSchedule({ ...rule, daysBefore: 3 }, event);
    expect(edited.sendAt.getTime()).toBeGreaterThan(reviewed.sendAt.getTime());
  });

  it("calendar arithmetic does not depend on a zone", () => {
    expect(addCalendarDays("2027-03-15", -7)).toBe("2027-03-08");
    expect(addCalendarDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("send time must be usable", () => {
  const now = new Date("2027-02-01T12:00:00Z");
  it("refuses a time in the past or too close to now", () => {
    expect(() => assertSendTimeUsable(new Date(now.getTime() - 1), now)).toThrow(ScheduleProjectionError);
    expect(() => assertSendTimeUsable(new Date(now.getTime() + SCHEDULED_EMAIL_MIN_LEAD_MS - 1), now)).toThrow(/five minutes/);
    expect(() => assertSendTimeUsable(new Date(now.getTime() + SCHEDULED_EMAIL_MIN_LEAD_MS), now)).not.toThrow();
  });
});

describe("rule and content validation", () => {
  it("rejects malformed rules", () => {
    expect(scheduleRuleSchema.safeParse({ trigger: "ONE_TIME", localDate: "2027-02-30", localTime: "09:00" }).success).toBe(false);
    expect(scheduleRuleSchema.safeParse({ trigger: "ONE_TIME", localDate: "2027-02-10", localTime: "9:00" }).success).toBe(false);
    expect(scheduleRuleSchema.safeParse({ trigger: "ONE_TIME", localDate: "2027-02-10", localTime: "24:00" }).success).toBe(false);
    expect(scheduleRuleSchema.safeParse({ trigger: "BEFORE_EVENT_START", daysBefore: -1, localTime: "09:00" }).success).toBe(false);
    expect(scheduleRuleSchema.safeParse({ trigger: "BEFORE_EVENT_START", daysBefore: 400, localTime: "09:00" }).success).toBe(false);
    expect(scheduleRuleSchema.safeParse({ trigger: "BEFORE_PAYMENT_DUE", daysBefore: 3, localTime: "09:00" }).success).toBe(true);
    expect(scheduleRuleSchema.safeParse({ trigger: "BEFORE_PAYMENT_DUE", daysBefore: 366, localTime: "09:00" }).success).toBe(false);
    expect(scheduleRuleSchema.safeParse({ trigger: "BEFORE_DEPOSIT_DUE", daysBefore: 3, localTime: "09:00" }).success).toBe(false);
    expect(scheduleRuleSchema.safeParse({ trigger: "BEFORE_EVENT_START", daysBefore: 3, localTime: "09:00", extra: 1 }).success).toBe(false);
  });

  it("an announcement needs its own title and message; other templates take the message from their template", () => {
    const base = { name: "Reminder", rule: { trigger: "BEFORE_EVENT_START", daysBefore: 3, localTime: "09:00" }, query: {} };
    expect(scheduledEmailContentSchema.safeParse({ ...base, templateKey: "EVENT_ANNOUNCEMENT" }).success).toBe(false);
    expect(scheduledEmailContentSchema.safeParse({ ...base, templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Hello", announcementBody: "Text" }).success).toBe(true);
    expect(scheduledEmailContentSchema.safeParse({ ...base, templateKey: "BALANCE_REMINDER" }).success).toBe(true);
    // A template that announces a state change is never schedulable by hand.
    expect(scheduledEmailContentSchema.safeParse({ ...base, templateKey: "WAITLIST_PROMOTED" }).success).toBe(false);
  });
});

describe("states", () => {
  it("only moves along the allowed edges, and a finished schedule never moves again", () => {
    expect(canTransitionSchedule("SCHEDULED", "ACTIVE")).toBe(true);
    expect(canTransitionSchedule("SCHEDULED", "COMPLETED")).toBe(false);
    expect(canTransitionSchedule("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransitionSchedule("PAUSED", "ACTIVE")).toBe(true);
    for (const done of ["CANCELLED", "COMPLETED", "FAILED"] as const) {
      for (const next of ["SCHEDULED", "ACTIVE", "PAUSED", "CANCELLED", "COMPLETED", "FAILED"] as const) {
        expect(canTransitionSchedule(done, next)).toBe(false);
      }
    }
  });

  it("a schedule can be edited until it has finished or been stopped; editing an approved one withdraws the approval", () => {
    for (const status of ["SCHEDULED", "PAUSED", "ACTIVE"] as const) expect(canEditSchedule(status)).toBe(true);
    for (const status of ["COMPLETED", "CANCELLED", "FAILED"] as const) expect(canEditSchedule(status)).toBe(false);
  });
});

describe("re-evaluating a reviewed recipient at send time", () => {
  const registrationId = "reg-1";
  const email = "pat@example.test";
  const recipient = { registrationId, email, roles: ["REGISTRATION_CONTACT"] };
  const view = (overrides: Partial<CurrentAudienceView> = {}): CurrentAudienceView => ({
    targets: new Map([[targetKey(email, registrationId), { balanceCents: 5000, roles: ["REGISTRATION_CONTACT"] }]]),
    registrations: new Map([[registrationId, { active: true }]]),
    exclusionByEmail: new Map(),
    registrationsWithOtherTarget: new Set([registrationId]),
    minorTargets: new Set(),
    isOrganizationBilled: false,
    ...overrides,
  });

  it("keeps an eligible recipient", () => {
    expect(decideRecipientEligibility(recipient, "BALANCE_REMINDER", view())).toBeNull();
    expect(decideRecipientEligibility(recipient, "EVENT_ANNOUNCEMENT", view())).toBeNull();
  });

  it("payment before the reminder: a balance that was paid since review is dropped from a balance reminder only", () => {
    const paid = view({ targets: new Map([[targetKey(email, registrationId), { balanceCents: 0, roles: ["REGISTRATION_CONTACT"] }]]) });
    expect(decideRecipientEligibility(recipient, "BALANCE_REMINDER", paid)).toBe("NO_BALANCE_DUE");
    expect(decideRecipientEligibility(recipient, "EVENT_ANNOUNCEMENT", paid)).toBeNull();
  });

  it("'before payment due' sends only to a registration that still owes, whatever the template (#993)", () => {
    const owes = view();
    const paid = view({ targets: new Map([[targetKey(email, registrationId), { balanceCents: 0, roles: ["REGISTRATION_CONTACT"] }]]) });
    for (const template of ["BALANCE_REMINDER", "EVENT_ANNOUNCEMENT", "CUSTOM_MESSAGE"] as const) {
      expect(decideRecipientEligibility(recipient, template, owes, "BEFORE_PAYMENT_DUE")).toBeNull();
      expect(decideRecipientEligibility(recipient, template, paid, "BEFORE_PAYMENT_DUE")).toBe("NO_BALANCE_DUE");
    }
    // Other triggers are unchanged: an announcement still goes to someone with no balance.
    expect(decideRecipientEligibility(recipient, "EVENT_ANNOUNCEMENT", paid, "BEFORE_EVENT_START")).toBeNull();
    expect(decideRecipientEligibility(recipient, "CUSTOM_MESSAGE", paid, "BEFORE_PAYMENT_DUE")).toBe("NO_BALANCE_DUE");
    expect(decideRecipientEligibility(recipient, "CUSTOM_MESSAGE", view({ isOrganizationBilled: true }), "BEFORE_PAYMENT_DUE")).toBe("ORGANIZATION_BILLED");
  });

  it("an organization-billed event never sends a balance reminder to an attendee", () => {
    expect(decideRecipientEligibility(recipient, "BALANCE_REMINDER", view({ isOrganizationBilled: true }))).toBe("ORGANIZATION_BILLED");
  });

  it("cancellation: a registration that is no longer submitted or confirmed is dropped", () => {
    expect(decideRecipientEligibility(recipient, "EVENT_ANNOUNCEMENT", view({ registrations: new Map([[registrationId, { active: false }]]), targets: new Map() }))).toBe("REGISTRATION_NOT_ACTIVE");
    expect(decideRecipientEligibility(recipient, "EVENT_ANNOUNCEMENT", view({ registrations: new Map(), targets: new Map() }))).toBe("REGISTRATION_NOT_FOUND");
  });

  it("transfer: when the registration's contact moved to another address, the reviewed address is dropped", () => {
    const transferred = view({ targets: new Map([[targetKey("new.owner@example.test", registrationId), { balanceCents: 5000, roles: ["REGISTRATION_CONTACT"] }]]) });
    expect(decideRecipientEligibility(recipient, "BALANCE_REMINDER", transferred)).toBe("ADDRESS_CHANGED");
  });

  it("a registration that no longer matches the approved audience is dropped", () => {
    expect(decideRecipientEligibility(recipient, "EVENT_ANNOUNCEMENT", view({ targets: new Map(), registrationsWithOtherTarget: new Set() }))).toBe("NO_LONGER_MATCHES");
  });

  it("suppressed: an opt-out or bounce recorded since review is dropped with its reason", () => {
    for (const code of ["OPTED_OUT_EVENT", "OPTED_OUT_ALL", "PROVIDER_BOUNCED", "PROVIDER_COMPLAINED"] as const) {
      expect(decideRecipientEligibility(recipient, "EVENT_ANNOUNCEMENT", view({ targets: new Map(), exclusionByEmail: new Map([[email, code]]) }))).toBe(code);
    }
  });

  it("youth: an address the independent check refuses is dropped even when the audience still lists it", () => {
    const minor = view({ minorTargets: new Set([targetKey(email, registrationId)]) });
    expect(decideRecipientEligibility({ registrationId, email, roles: ["ATTENDEE"] }, "EVENT_ANNOUNCEMENT", minor)).toBe("MINOR_RECIPIENT");
    expect(decideRecipientEligibility({ registrationId, email, roles: ["ATTENDEE"] }, "BALANCE_REMINDER", minor)).toBe("MINOR_RECIPIENT");
  });

  it("matches addresses regardless of case or padding", () => {
    expect(decideRecipientEligibility({ registrationId, email: "  PAT@Example.TEST ", roles: [] }, "EVENT_ANNOUNCEMENT", view())).toBeNull();
  });
});

describe("a youth's address (owner decisions, Oct 17)", () => {
  const reg = (overrides: Partial<YouthCheckRegistration> = {}): YouthCheckRegistration => ({
    registrationId: "reg-1",
    accountHolderPersonId: "parent",
    holderEmail: "parent@example.test",
    snapshotEmail: "family@example.test",
    attendees: [
      { personId: "kid", email: "family@example.test", age: "MINOR" },
    ],
    ...overrides,
  });
  const noMinors = { personIds: new Set<string>(), emails: new Set<string>() };
  const minors = (personIds: string[], emails: string[]) => ({ personIds: new Set(personIds), emails: new Set(emails) });
  const run = (roles: string[], email: string, registration: YouthCheckRegistration, eventMinors = minors(["kid"], ["family@example.test"])) =>
    refusedYouthTargets([{ email, registrationId: "reg-1", roles }], new Map([["reg-1", registration]]), eventMinors);
  const key = (email: string) => targetKey(email, "reg-1");

  it("a parent who shares the youth's address receives it, once, as the adult contact", () => {
    // The parent attends nothing in the event, so is an adult holder and is not blocked.
    expect(run(["REGISTRATION_CONTACT"], "family@example.test", reg()).size).toBe(0);
  });

  it("an adult attendee holding the address allows it, even beside a youth attendee", () => {
    const shared = reg({
      snapshotEmail: "other@example.test",
      attendees: [
        { personId: "adult", email: "shared@example.test", age: "ADULT" },
        { personId: "kid", email: "shared@example.test", age: "MINOR" },
      ],
    });
    expect(run(["ATTENDEE"], "shared@example.test", shared, minors(["kid"], ["shared@example.test"])).size).toBe(0);
  });

  it("a Person who is a youth on another registration cannot vouch for their own address through an adult-typed row here", () => {
    // X attends registration B as a youth, and this registration as an adult-type attendee (for example entered as staff).
    const adultRowHere = reg({ snapshotEmail: "parent@example.test", attendees: [{ personId: "x", email: "x@example.test", age: "ADULT" }] });
    const youthElsewhere = minors(["x"], ["x@example.test"]);
    expect([...run(["ATTENDEE"], "x@example.test", adultRowHere, youthElsewhere)]).toEqual([key("x@example.test")]);
    // A genuine adult sharing that address on this registration still vouches.
    const withRealAdult = { ...adultRowHere, attendees: [...adultRowHere.attendees, { personId: "adult", email: "x@example.test", age: "ADULT" as const }] };
    expect(run(["ATTENDEE"], "x@example.test", withRealAdult, youthElsewhere).size).toBe(0);
  });

  it("a group billing contact or organization contact who holds the role now is allowed", () => {
    const youthOnly = reg({ snapshotEmail: "x@example.test", attendees: [{ personId: "kid", email: "leader@example.test", age: "MINOR" }] });
    const youth = minors(["kid"], ["leader@example.test"]);
    expect(run(["GROUP_LEADER"], "leader@example.test", youthOnly, youth).size).toBe(0);
    expect(run(["ORGANIZATION_CONTACT"], "leader@example.test", youthOnly, youth).size).toBe(0);
  });

  it("a lapsed leader role cannot vouch: judged on the roles held now, a youth address with no role left is refused", () => {
    const youthOnly = reg({ snapshotEmail: "x@example.test", attendees: [{ personId: "kid", email: "leader@example.test", age: "MINOR" }] });
    const youth = minors(["kid"], ["leader@example.test"]);
    expect(run([], "leader@example.test", youthOnly, youth).size).toBe(1);
    expect(run(["ATTENDEE"], "leader@example.test", youthOnly, youth).size).toBe(1);
  });

  it("a youth who is their own registration contact through the account-holder fallback is never emailed", () => {
    const own = reg({ accountHolderPersonId: "kid", holderEmail: "kid@example.test", snapshotEmail: "", attendees: [{ personId: "kid", email: "kid@example.test", age: "MINOR" }] });
    const youth = minors(["kid"], ["kid@example.test"]);
    expect([...run(["REGISTRATION_CONTACT"], "kid@example.test", own, youth)]).toEqual([key("kid@example.test")]);
    expect(run(["REGISTRATION_CONTACT"], "kid@example.test", { ...own, snapshotEmail: "kid@example.test" }, youth).size).toBe(1);
    // An age-unknown attendee is treated as a minor.
    expect(run(["REGISTRATION_CONTACT"], "kid@example.test", { ...own, attendees: [{ personId: "kid", email: "kid@example.test", age: "UNKNOWN" }] }, youth).size).toBe(1);
  });

  it("a minor account holder who types a younger sibling's address as the contact is refused", () => {
    // The holder is a youth attendee; the typed contact address is the sibling's own address, held by no adult.
    const sibling = reg({
      accountHolderPersonId: "older",
      holderEmail: "older@example.test",
      snapshotEmail: "sibling@example.test",
      attendees: [
        { personId: "older", email: "older@example.test", age: "MINOR" },
        { personId: "sibling", email: "sibling@example.test", age: "MINOR" },
      ],
    });
    const youth = minors(["older", "sibling"], ["older@example.test", "sibling@example.test"]);
    expect([...run(["REGISTRATION_CONTACT"], "sibling@example.test", sibling, youth)]).toEqual([key("sibling@example.test")]);
    expect(run(["REGISTRATION_CONTACT"], "older@example.test", sibling, youth).size).toBe(1);
  });

  it("a holder who is a youth attendee on another registration of the event is a minor here too", () => {
    // R2 has only a parent-looking contact address, but its account holder attends R1 as a youth.
    const r2 = reg({ registrationId: "reg-1", accountHolderPersonId: "kid", holderEmail: "kid@example.test", snapshotEmail: "typed@example.test", attendees: [] });
    const eventWide = minors(["kid"], ["kid@example.test"]);
    expect(run(["REGISTRATION_CONTACT"], "typed@example.test", r2, eventWide).size).toBe(1);
    expect(run(["REGISTRATION_CONTACT"], "kid@example.test", r2, eventWide).size).toBe(1);
    // An adult attendee of this registration holding the typed address vouches for it.
    const withAdult = { ...r2, attendees: [{ personId: "adult", email: "typed@example.test", age: "ADULT" as const }] };
    expect(run(["REGISTRATION_CONTACT"], "typed@example.test", withAdult, eventWide).size).toBe(0);
  });

  it("a non-attending parent as account holder is an adult and is not blocked", () => {
    const parent = reg({ accountHolderPersonId: "parent", holderEmail: "parent@example.test", snapshotEmail: "", attendees: [{ personId: "kid", email: "kid@example.test", age: "MINOR" }] });
    expect(run(["REGISTRATION_CONTACT"], "parent@example.test", parent, minors(["kid"], ["kid@example.test"])).size).toBe(0);
    expect(run(["REGISTRATION_CONTACT"], "parent@example.test", parent, noMinors).size).toBe(0);
  });

  it("a youth's own address with no adult behind it is refused, as an attendee or under a forged role", () => {
    const youthOnly = reg({ snapshotEmail: "parent@example.test", attendees: [{ personId: "kid", email: "kid@example.test", age: "MINOR" }] });
    const youth = minors(["kid"], ["kid@example.test"]);
    expect(run(["ATTENDEE"], "kid@example.test", youthOnly, youth).size).toBe(1);
    expect(run([], "kid@example.test", youthOnly, youth).size).toBe(1);
  });

  it("an address reached only as an attendee still needs an adult attendee holding it", () => {
    expect(run(["ATTENDEE"], "nobody@example.test", reg(), noMinors).size).toBe(1);
    expect(run(["REGISTRATION_CONTACT", "ATTENDEE"], "nobody@example.test", reg(), noMinors).size).toBe(0);
  });
});

describe("review fingerprint", () => {
  const base = {
    eventId: "event-1",
    audienceFingerprint: "a".repeat(64),
    queryHash: "b".repeat(64),
    templateKey: "EVENT_ANNOUNCEMENT" as const,
    templateVersionId: "version-1",
    announcementTitle: "Hello",
    announcementBody: "Body",
    deliveryMode: "LOCAL_CAPTURE",
    rule: { trigger: "ONE_TIME", localDate: "2027-05-01", localTime: "09:00" } as ScheduleRule,
    sendAt: new Date("2027-05-01T14:00:00Z"),
    eventTimezone: CHICAGO,
    targetKeys: ["b", "a"],
  };

  it("is stable for the same review, independent of target order", () => {
    expect(scheduleReviewFingerprint(base)).toBe(scheduleReviewFingerprint({ ...base, targetKeys: ["a", "b"] }));
    expect(scheduleReviewFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when anything the approver reviewed changes", () => {
    const original = scheduleReviewFingerprint(base);
    const changes = [
      { audienceFingerprint: "c".repeat(64) },
      { templateVersionId: "version-2" },
      { announcementBody: "Different" },
      { deliveryMode: "EXTERNAL_EMAIL" },
      { sendAt: new Date("2027-05-01T15:00:00Z") },
      { eventTimezone: "America/Denver" },
      { targetKeys: ["a"] },
    ];
    for (const change of changes) expect(scheduleReviewFingerprint({ ...base, ...change })).not.toBe(original);
  });
});
