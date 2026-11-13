import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLUB_DRAFT_REMINDER_LIMITS,
  DEFAULT_CLUB_DRAFT_REMINDER_POLICY,
  clubDraftReminderPolicySchema,
  draftReminderEmail,
  draftReminderIdempotencyKey,
  draftReminderRecipients,
  draftReminderUrl,
  draftRegistrationWindow,
  nextSendWindowStart,
  sendHoursLabel,
  forecastReminders,
  isWithinSendHours,
  nextReminderDue,
  nextReminderSchedule,
  policyFromRow,
  registrationIsOpen,
  type ClubDraftReminderPolicyValues,
  type DraftReminderEvent,
} from "@/modules/club-registrations/draft-reminders-domain";

/**
 * #164: the pure rules for the unfinished club registration reminder. Dates are pinned; clubs, people and addresses are
 * synthetic.
 */
const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);
const policy: ClubDraftReminderPolicyValues = { enabled: true, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 2, staleAfterDays: 30 };
const open = { registrationOpen: true };

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

describe("the policy", () => {
  it("is off by default, with the agreed starting numbers", () => {
    expect(policyFromRow(null)).toEqual({ enabled: false, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 2, staleAfterDays: 30 });
    expect(DEFAULT_CLUB_DRAFT_REMINDER_POLICY.enabled).toBe(false);
  });

  it("accepts the edges of each range and refuses anything outside", () => {
    const base = { enabled: true, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 2, staleAfterDays: 30 };
    expect(clubDraftReminderPolicySchema.safeParse({ ...base, firstAfterDays: 1, repeatEveryDays: 14, maxReminders: 3, staleAfterDays: 90 }).success).toBe(true);
    expect(clubDraftReminderPolicySchema.safeParse({ ...base, firstAfterDays: 14, staleAfterDays: 15 }).success).toBe(true);
    for (const bad of [
      { firstAfterDays: 0 }, { firstAfterDays: 15 }, { repeatEveryDays: 0 }, { repeatEveryDays: 15 },
      { maxReminders: 0 }, { maxReminders: 4 }, { staleAfterDays: 6 }, { staleAfterDays: 91 }, { firstAfterDays: 1.5 }, { maxReminders: "2" },
    ]) {
      expect(clubDraftReminderPolicySchema.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(CLUB_DRAFT_REMINDER_LIMITS.staleAfterDays.min).toBe(7);
  });

  it("refuses an unknown field and an expiry that falls before the first reminder", () => {
    const base = { enabled: true, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 2, staleAfterDays: 30 };
    expect(clubDraftReminderPolicySchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(clubDraftReminderPolicySchema.safeParse({ ...base, firstAfterDays: 14, staleAfterDays: 7 }).success).toBe(false);
  });
});

describe("send hours", () => {
  it("allows 9:00 up to but not including 19:00 where the event is held", () => {
    // 2026-11-13 is Central Standard Time (UTC-6).
    expect(isWithinSendHours(at("2026-11-13T14:59:00Z"), "America/Chicago")).toBe(false);
    expect(isWithinSendHours(at("2026-11-13T15:00:00Z"), "America/Chicago")).toBe(true);
    expect(isWithinSendHours(at("2026-11-14T00:59:00Z"), "America/Chicago")).toBe(true);
    expect(isWithinSendHours(at("2026-11-14T01:00:00Z"), "America/Chicago")).toBe(false);
  });

  it("uses the event's own time zone and follows daylight saving", () => {
    expect(isWithinSendHours(at("2026-07-13T14:00:00Z"), "America/Chicago")).toBe(true);
    expect(isWithinSendHours(at("2026-07-13T13:59:00Z"), "America/Chicago")).toBe(false);
    expect(isWithinSendHours(at("2026-11-13T17:00:00Z"), "America/Los_Angeles")).toBe(true);
    expect(isWithinSendHours(at("2026-11-13T15:00:00Z"), "America/Los_Angeles")).toBe(false);
  });
});

describe("registration still open", () => {
  const event: DraftReminderEvent = {
    isPublished: true, timezone: "America/Chicago", registrationOpensOn: null, registrationClosesOn: "2026-12-01",
    waitlistEnabled: false, archivedAt: null, lifecycleState: null, startsAt: at("2027-01-08T00:00:00Z"), endsAt: at("2027-01-10T00:00:00Z"), lastDay: null,
  };

  it("is open through the close date in the event's time zone and closed the day after", () => {
    expect(registrationIsOpen(event, at("2026-12-02T05:30:00Z"))).toBe(true); // still Dec 1 at 11:30pm Central
    expect(registrationIsOpen(event, at("2026-12-02T06:30:00Z"))).toBe(false); // Dec 2 in Central
  });

  it("is closed once the event has ended, when archived, or when unpublished", () => {
    expect(registrationIsOpen({ ...event, registrationClosesOn: null }, at("2027-01-12T18:00:00Z"))).toBe(false);
    expect(registrationIsOpen({ ...event, archivedAt: at("2026-11-01T00:00:00Z") }, at("2026-11-13T18:00:00Z"))).toBe(false);
    expect(registrationIsOpen({ ...event, isPublished: false }, at("2026-11-13T18:00:00Z"))).toBe(false);
  });
});

describe("the registration window of a draft, by the club page's own rules", () => {
  const event: DraftReminderEvent = {
    isPublished: true, timezone: "America/Chicago", registrationOpensOn: null, registrationClosesOn: "2026-12-01",
    waitlistEnabled: false, archivedAt: null, lifecycleState: null, startsAt: at("2027-01-08T00:00:00Z"), endsAt: at("2027-01-10T00:00:00Z"), lastDay: null,
  };
  const now = at("2026-12-05T18:00:00Z");
  const early = { id: "loc-early", firstDay: null, lastDay: null, registrationClosesOn: "2026-12-03" };
  const late = { id: "loc-late", firstDay: null, lastDay: null, registrationClosesOn: "2026-12-20" };

  it("follows the event's own dates when it has no locations, and quotes the event's close date", () => {
    expect(draftRegistrationWindow(event, [], null, at("2026-11-20T18:00:00Z"))).toEqual({ open: true, closesOn: "2026-12-01" });
    expect(draftRegistrationWindow(event, [], null, now)).toEqual({ open: false, closesOn: "2026-12-01" });
  });

  it("follows the chosen location's own dates, open or closed, and quotes its date", () => {
    expect(draftRegistrationWindow(event, [early, late], "loc-late", now)).toEqual({ open: true, closesOn: "2026-12-20" });
    expect(draftRegistrationWindow(event, [early], "loc-early", now)).toEqual({ open: false, closesOn: "2026-12-01" });
  });

  it("falls back to the other open locations, and the event-level date, when the chosen location has closed", () => {
    expect(draftRegistrationWindow(event, [early, late], "loc-early", now)).toEqual({ open: true, closesOn: "2026-12-01" });
  });

  it("with no location chosen, is open while any active location is, and quotes the event's date", () => {
    expect(draftRegistrationWindow(event, [early, late], null, now).open).toBe(true);
    expect(draftRegistrationWindow(event, [early], null, now).open).toBe(false);
    expect(draftRegistrationWindow(event, [early, late], null, now).closesOn).toBe("2026-12-01");
    // A chosen location that is no longer active is treated as no choice.
    expect(draftRegistrationWindow(event, [late], "loc-gone", now).open).toBe(true);
  });

  it("is closed, with no date quoted, when the lifecycle state closes registration", () => {
    expect(draftRegistrationWindow({ ...event, lifecycleState: "REGISTRATION_CLOSED" } as DraftReminderEvent, [late], "loc-late", now)).toEqual({ open: false, closesOn: null });
  });
});

describe("send hours as people read them", () => {
  it("says the hours and the zone in words", () => {
    expect(sendHoursLabel("America/Chicago")).toBe("9 a.m. to 7 p.m. Central");
    expect(sendHoursLabel("America/Los_Angeles")).toBe("9 a.m. to 7 p.m. Pacific");
  });

  it("keeps the label sane for zones without a plain Time name", () => {
    expect(sendHoursLabel("America/Phoenix")).toBe("9 a.m. to 7 p.m. Mountain");
    expect(sendHoursLabel("UTC")).toBe("9 a.m. to 7 p.m. where the event is held");
  });

  it("finds the next 9 a.m. where the event is held, or now when inside the hours", () => {
    const inside = at("2026-11-13T17:00:00Z");
    expect(nextSendWindowStart(inside, "America/Chicago")).toEqual(inside);
    expect(nextSendWindowStart(at("2026-11-14T02:00:00Z"), "America/Chicago").toISOString()).toBe("2026-11-14T15:00:00.000Z");
    expect(nextSendWindowStart(at("2026-11-13T14:00:00Z"), "America/Chicago").toISOString()).toBe("2026-11-13T15:00:00.000Z");
  });
});

describe("when a reminder is due", () => {
  const edited = at("2026-11-01T12:00:00Z");

  it("sends the first reminder once the draft has been untouched for the first wait, and not before", () => {
    const draft = { updatedAt: edited };
    expect(nextReminderDue(draft, policy, [], new Date(edited.getTime() + 2 * DAY - 1), open)).toMatchObject({ due: false, reason: "NOT_YET", attempt: 1 });
    expect(nextReminderDue(draft, policy, [], new Date(edited.getTime() + 2 * DAY), open)).toMatchObject({ due: true, attempt: 1 });
  });

  it("sends the second after the repeat wait from the first, and not before", () => {
    const sentAt = at("2026-11-03T15:00:00Z");
    const draft = { updatedAt: edited };
    const prior = [{ attempt: 1, sentAt }];
    expect(nextReminderDue(draft, policy, prior, new Date(sentAt.getTime() + 3 * DAY - 1), open)).toMatchObject({ due: false, reason: "NOT_YET", attempt: 2 });
    expect(nextReminderDue(draft, policy, prior, new Date(sentAt.getTime() + 3 * DAY), open)).toMatchObject({ due: true, attempt: 2 });
  });

  it("restarts the repeat wait from an edit made after the last reminder", () => {
    const sentAt = at("2026-11-03T15:00:00Z");
    const editedAgain = at("2026-11-05T09:00:00Z");
    const draft = { updatedAt: editedAgain };
    const prior = [{ attempt: 1, sentAt }];
    expect(nextReminderDue(draft, policy, prior, at("2026-11-08T08:59:00Z"), open)).toMatchObject({ due: false, reason: "NOT_YET" });
    expect(nextReminderDue(draft, policy, prior, at("2026-11-08T09:00:00Z"), open)).toMatchObject({ due: true, attempt: 2 });
  });

  it("never sends more than the most reminders, however long it waits", () => {
    const draft = { updatedAt: edited };
    const prior = [{ attempt: 1, sentAt: at("2026-11-03T15:00:00Z") }, { attempt: 2, sentAt: at("2026-11-06T15:00:00Z") }];
    expect(nextReminderDue(draft, policy, prior, at("2026-11-20T15:00:00Z"), open)).toEqual({ due: false, reason: "MAX_REACHED" });
    expect(nextReminderDue(draft, { ...policy, maxReminders: 3 }, prior, at("2026-11-20T15:00:00Z"), open)).toMatchObject({ due: true, attempt: 3 });
    expect(nextReminderSchedule(draft, { ...policy, maxReminders: 1 }, [{ attempt: 1, sentAt: edited }])).toBeNull();
  });

  it("never reminds an expired draft, even if it was never reminded", () => {
    const draft = { updatedAt: edited };
    expect(nextReminderDue(draft, policy, [], new Date(edited.getTime() + 30 * DAY), open)).toMatchObject({ due: true });
    expect(nextReminderDue(draft, policy, [], new Date(edited.getTime() + 30 * DAY + 1), open)).toEqual({ due: false, reason: "STALE" });
  });

  it("never reminds once registration is closed, or when the policy is off", () => {
    const draft = { updatedAt: edited };
    const now = new Date(edited.getTime() + 5 * DAY);
    expect(nextReminderDue(draft, policy, [], now, { registrationOpen: false })).toEqual({ due: false, reason: "CLOSED" });
    expect(nextReminderDue(draft, { ...policy, enabled: false }, [], now, open)).toEqual({ due: false, reason: "OFF" });
  });
});

describe("the staff forecast", () => {
  it("counts what is due and lists the next dates, nothing else", () => {
    const now = at("2026-11-13T17:00:00Z");
    const forecast = forecastReminders([
      { updatedAt: at("2026-11-10T12:00:00Z"), prior: [], registrationOpen: true }, // due
      { updatedAt: at("2026-11-12T12:00:00Z"), prior: [], registrationOpen: true }, // due 11-14
      { updatedAt: at("2026-11-13T12:00:00Z"), prior: [], registrationOpen: true }, // due 11-15
      { updatedAt: at("2026-09-01T12:00:00Z"), prior: [], registrationOpen: true }, // expired
      { updatedAt: at("2026-11-10T12:00:00Z"), prior: [], registrationOpen: false }, // its location has closed
    ], policy, now);
    expect(forecast.dueNow).toBe(1);
    expect(forecast.upcoming.map((date) => date.toISOString())).toEqual(["2026-11-14T12:00:00.000Z", "2026-11-15T12:00:00.000Z"]);
    expect(Object.keys(forecast).sort()).toEqual(["dueNow", "upcoming"]);
  });
});

describe("who gets it", () => {
  it("is directors and deputies with a usable address, one message per address, in lower case", () => {
    const people = draftReminderRecipients([
      { role: "DIRECTOR", email: " Pat.Director@Example.test ", name: "Pat" },
      { role: "DEPUTY", email: "pat.director@example.test", name: "Pat Again" },
      { role: "DEPUTY", email: "sam.deputy@example.test", name: "Sam" },
      { role: "REGISTRAR", email: "reg@example.test", name: "Reg" },
      { role: "REPORTER", email: "rep@example.test", name: "Rep" },
      { role: "DIRECTOR", email: "not-an-address", name: "Bad" },
      { role: "DIRECTOR", email: null, name: "None" },
    ]);
    expect(people).toEqual([{ email: "pat.director@example.test", name: "Pat" }, { email: "sam.deputy@example.test", name: "Sam" }]);
  });

  it("keys each message by draft, attempt and normalised address", () => {
    expect(draftReminderIdempotencyKey([{ id: "draft-1", attempt: 2 }], " Pat@Example.test ")).toBe("club-draft-reminder:draft-1:2:pat@example.test");
  });

  it("gives a club with several drafts one stable key, whatever the order, that differs by draft set, attempt and address", () => {
    const a = draftReminderIdempotencyKey([{ id: "d1", attempt: 1 }, { id: "d2", attempt: 1 }, { id: "d3", attempt: 2 }], "pat@example.test");
    expect(draftReminderIdempotencyKey([{ id: "d3", attempt: 2 }, { id: "d1", attempt: 1 }, { id: "d2", attempt: 1 }], "PAT@example.test")).toBe(a);
    expect(a).toMatch(/^club-draft-reminder:group:[0-9a-f]{32}:pat@example\.test$/);
    expect(draftReminderIdempotencyKey([{ id: "d1", attempt: 1 }, { id: "d2", attempt: 1 }], "pat@example.test")).not.toBe(a);
    expect(draftReminderIdempotencyKey([{ id: "d1", attempt: 1 }, { id: "d2", attempt: 1 }, { id: "d3", attempt: 3 }], "pat@example.test")).not.toBe(a);
  });
});

describe("what the email says", () => {
  const input = {
    directorName: "Pat Director", clubName: "Synthetic Pathfinders", eventName: "Synthetic Camporee", registrationClosesOn: "2026-12-01",
    registrationUrl: draftReminderUrl("https://events.example.test", "org-1", "event-1"),
  };

  it("names the director, club and event, the close date and a plain link, and says the club is not registered yet", () => {
    const { subject, bodyText } = draftReminderEmail(input);
    expect(subject).toBe("Synthetic Pathfinders: finish your registration for Synthetic Camporee");
    expect(bodyText).toContain("Hello Pat Director,");
    expect(bodyText).toContain("not registered until the registration is submitted");
    expect(bodyText).toContain("Registration closes on December 1, 2026.");
    expect(bodyText).toContain("https://events.example.test/account/clubs/org-1/events/event-1");
  });

  it("leaves out the close date when the event has none and the greeting name when there is none", () => {
    const { bodyText } = draftReminderEmail({ ...input, directorName: " ", registrationClosesOn: null });
    expect(bodyText).toMatch(/^Hello,\n/);
    expect(bodyText).not.toMatch(/closes on/i);
  });

  it("carries no token, answer, count of people, team name or field name: the link is a plain sign-in-protected page", () => {
    const { subject, bodyText } = draftReminderEmail(input);
    const everything = `${subject}\n${bodyText}`;
    expect(everything).not.toMatch(/token|\?|#|\{\{|attendee|member|guest|team|\d+ (people|members|youth)/i);
    expect(bodyText.match(/https?:\/\/\S+/g)).toEqual(["https://events.example.test/account/clubs/org-1/events/event-1"]);
  });

  it("breaks up placeholder braces in typed names so delivery cannot read them as sentinels", () => {
    const { subject, bodyText } = draftReminderEmail({ ...input, clubName: "Club {{registration_manage_link}}", directorName: "{{x}}" });
    expect(`${subject}${bodyText}`).not.toContain("{{");
    expect(`${subject}${bodyText}`).not.toContain("}}");
  });
});
