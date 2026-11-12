import { describe, expect, it } from "vitest";
import {
  DEBRIEF_FORM_SLUGS,
  dedupeRecipients,
  debriefBatchId,
  debriefEmailContent,
  debriefFillPath,
  debriefMessageKey,
  debriefSchedule,
  nonResponders,
  starterDefinition,
} from "@/modules/event-debriefs/domain";
import { parseInformationFormDefinition } from "@/modules/information-forms/definition";
import { eventModuleDefinition, isEventModuleKey, scopedToggleModuleKeys } from "@/modules/event-modules/catalog";
import { projectSchedule, scheduledEmailContentSchema } from "@/modules/communications/scheduled-email-domain";
import { SCHEDULED_EMAIL_TRIGGERS } from "@/modules/communications/scheduled-email-options";

/** Event ends the evening of Saturday 2027-03-13 in Chicago (22:00Z is 4 p.m. CST). */
const springEnd = new Date("2027-03-13T22:00:00.000Z");

describe("the Debrief module (#1679)", () => {
  it("is an optional club-event module, off by default, that an Area Coordinator may switch", () => {
    expect(isEventModuleKey("debrief")).toBe(true);
    const definition = eventModuleDefinition("debrief");
    expect(definition.offByDefault).toBe(true);
    expect(definition.alwaysOn).toBe(false);
    expect(definition.appliesTo).toBe("club-audience");
    expect(scopedToggleModuleKeys).toContain("debrief");
  });
});

describe("the starter questions", () => {
  it("are the three the youth director asked for, and pass the information form checks", () => {
    const definition = parseInformationFormDefinition(starterDefinition("DEBRIEF", "Sample Spring Camporee"));
    const labels = definition.sections.flatMap((section) => section.fields.map((field) => field.label));
    expect(labels).toEqual(["What went well?", "What should we do better?", "Ideas for next year?"]);
  });

  it("give the director evaluation its own short set that also passes the checks", () => {
    const definition = parseInformationFormDefinition(starterDefinition("DIRECTOR_EVALUATION", "Sample Spring Camporee"));
    expect(definition.sections.flatMap((section) => section.fields)).toHaveLength(3);
    expect(DEBRIEF_FORM_SLUGS.DEBRIEF).not.toBe(DEBRIEF_FORM_SLUGS.DIRECTOR_EVALUATION);
  });
});

describe("when the debrief goes out", () => {
  it("is 8:00 a.m. in the event's zone the day after the last day, and the reminder three days later", () => {
    const { invite, reminder } = debriefSchedule({ timezone: "America/Chicago", endsAt: springEnd });
    expect(invite.localDate).toBe("2027-03-14");
    expect(invite.localTime).toBe("08:00");
    // The clocks spring forward at 2 a.m. that Sunday: 8:00 is CDT (UTC-5).
    expect(invite.sendAt.toISOString()).toBe("2027-03-14T13:00:00.000Z");
    expect(reminder.localDate).toBe("2027-03-17");
    expect(reminder.sendAt.toISOString()).toBe("2027-03-17T13:00:00.000Z");
    expect(reminder.sendAt.getTime() - invite.sendAt.getTime()).toBe(3 * 24 * 3_600_000);
  });

  it("keeps 8:00 local across the spring change: the day before is CST, the day after is CDT", () => {
    const { invite, reminder } = debriefSchedule({ timezone: "America/Chicago", endsAt: new Date("2027-03-11T22:00:00.000Z") });
    expect(invite.sendAt.toISOString()).toBe("2027-03-12T14:00:00.000Z");
    expect(reminder.sendAt.toISOString()).toBe("2027-03-15T13:00:00.000Z");
    expect(reminder.localTime).toBe("08:00");
  });

  it("keeps 8:00 local across the fall change (clocks go back Sunday 2027-11-07)", () => {
    const { invite, reminder } = debriefSchedule({ timezone: "America/Chicago", endsAt: new Date("2027-11-05T22:00:00.000Z") });
    expect(invite.localDate).toBe("2027-11-06");
    expect(invite.sendAt.toISOString()).toBe("2027-11-06T13:00:00.000Z");
    expect(reminder.localDate).toBe("2027-11-09");
    expect(reminder.sendAt.toISOString()).toBe("2027-11-09T14:00:00.000Z");
    expect(reminder.localTime).toBe("08:00");
  });

  it("counts the last day in the event's own zone, not in UTC", () => {
    // 03:00Z on the 14th is still the evening of the 13th in Chicago, so the last day is the 13th and the invitation the 14th.
    const { invite } = debriefSchedule({ timezone: "America/Chicago", endsAt: new Date("2027-03-14T03:00:00.000Z") });
    expect(invite.localDate).toBe("2027-03-14");
    const east = debriefSchedule({ timezone: "America/New_York", endsAt: new Date("2027-03-14T03:00:00.000Z") });
    expect(east.invite.localDate).toBe("2027-03-14");
    const auckland = debriefSchedule({ timezone: "Pacific/Auckland", endsAt: new Date("2027-03-13T22:00:00.000Z") });
    expect(auckland.invite.localDate).toBe("2027-03-15");
  });

  it("falls back to Central time for a missing or unknown zone", () => {
    const central = debriefSchedule({ timezone: "America/Chicago", endsAt: springEnd });
    expect(debriefSchedule({ timezone: "", endsAt: springEnd }).invite.sendAt).toEqual(central.invite.sendAt);
    expect(debriefSchedule({ timezone: "Not/AZone", endsAt: springEnd }).invite.sendAt).toEqual(central.invite.sendAt);
    expect(debriefSchedule({ timezone: null, endsAt: springEnd }).invite.eventTimezone).toBe("America/Chicago");
  });

  it("is a timing staff cannot choose for their own schedules", () => {
    expect(SCHEDULED_EMAIL_TRIGGERS).not.toContain("AFTER_EVENT_END");
    expect(() => projectSchedule({ trigger: "AFTER_EVENT_END", daysAfter: 1, localTime: "08:00" }, { timezone: "America/Chicago", startsAt: springEnd, registrationClosesOn: null })).toThrow(/no end date/);
  });
});

describe("staff cannot write the debrief's timing themselves (#1679)", () => {
  const base = { name: "Thanks", templateKey: "CUSTOM_MESSAGE", announcementTitle: "", announcementBody: "", query: {} };
  it("accepts a normal schedule and refuses one that uses the after-the-event timing", () => {
    expect(scheduledEmailContentSchema.safeParse({ ...base, rule: { trigger: "BEFORE_EVENT_START", daysBefore: 3, localTime: "09:00" } }).success).toBe(true);
    const refused = scheduledEmailContentSchema.safeParse({ ...base, rule: { trigger: "AFTER_EVENT_END", daysAfter: 1, localTime: "08:00" } });
    expect(refused.success).toBe(false);
    expect(refused.success ? "" : refused.error.issues[0]!.message).toMatch(/debrief sets its own/);
  });
});

describe("who is on the list and who is reminded", () => {
  const rows = [
    { accountId: "a2", email: "Beta@example.org", name: " Beta " },
    { accountId: "a1", email: "alpha@example.org", name: "Alpha" },
    { accountId: "a1", email: "alpha@example.org", name: "Alpha again" },
    { accountId: "a3", email: "not an address", name: "Bad" },
  ];

  it("is one entry per account, lower-cased, valid addresses only, in a fixed order", () => {
    const list = dedupeRecipients(rows);
    expect(list.map((recipient) => recipient.accountId)).toEqual(["a1", "a2"]);
    expect(list[1]).toEqual({ accountId: "a2", email: "beta@example.org", name: "Beta" });
  });

  it("reminds only people who have not answered", () => {
    const list = dedupeRecipients(rows);
    expect(nonResponders(list, new Set(["a1"])).map((recipient) => recipient.accountId)).toEqual(["a2"]);
    expect(nonResponders(list, new Set())).toHaveLength(2);
    expect(nonResponders(list, new Set(["a1", "a2"]))).toEqual([]);
  });

  it("keys each message by batch, person and form, so a repeat queues nothing new", () => {
    const batch = debriefBatchId("event-1", "INVITE");
    expect(debriefMessageKey(batch, "a1", "DEBRIEF")).toBe(debriefMessageKey(batch, "a1", "DEBRIEF"));
    expect(debriefMessageKey(batch, "a1", "DEBRIEF")).not.toBe(debriefMessageKey(batch, "a1", "DIRECTOR_EVALUATION"));
    expect(debriefMessageKey(batch, "a1", "DEBRIEF")).not.toBe(debriefMessageKey(debriefBatchId("event-1", "REMINDER"), "a1", "DEBRIEF"));
  });
});

describe("the email", () => {
  it("links to the form, names the event, and carries no question or answer", () => {
    const url = `https://events.imsda.test${debriefFillPath("sample-spring-camporee", "DEBRIEF")}`;
    const invite = debriefEmailContent({ kind: "INVITE", purpose: "DEBRIEF", eventName: "Sample Spring Camporee", recipientName: "Pat Sample", url });
    expect(invite.subject).toBe("Debrief for Sample Spring Camporee");
    expect(invite.bodyText).toContain(url);
    expect(invite.bodyText).not.toContain("Ideas for next year");
    expect(invite.bodyText).not.toContain("What should we do better?");
    const reminder = debriefEmailContent({ kind: "REMINDER", purpose: "DEBRIEF", eventName: "Sample Spring Camporee", recipientName: "", url });
    expect(reminder.subject).toBe("Reminder: debrief for Sample Spring Camporee");
    expect(reminder.bodyText.startsWith("Hello,")).toBe(true);
    expect(debriefFillPath("a b", "DIRECTOR_EVALUATION")).toBe("/events/a%20b/forms/director-evaluation");
  });
});
