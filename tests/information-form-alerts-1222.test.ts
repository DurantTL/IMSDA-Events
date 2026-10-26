import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1222: information forms email the addresses listed on the form when a response arrives. One email per address, no
 * answer in the body, queued after the response is stored (a failure never undoes it), and the switch is honoured. The
 * members CSV is one row per member. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  formFindUnique: vi.fn(),
  formFindFirst: vi.fn(),
  formUpdate: vi.fn(),
  responseFindUnique: vi.fn(),
  responseFindMany: vi.fn(),
  responseCreate: vi.fn(),
  responseCount: vi.fn(),
  versionFindMany: vi.fn(),
  outboxCreate: vi.fn(),
  outboxFindMany: vi.fn(),
  feedCreateMany: vi.fn(),
  writeAuditLog: vi.fn(),
  auditCreate: vi.fn(),
  switchRead: vi.fn(),
  configured: vi.fn(),
  deliver: vi.fn(),
  logError: vi.fn(),
  senderFails: false,
  events: [] as string[],
}));

const client = {
  informationForm: { findUnique: mocks.formFindUnique, findFirst: mocks.formFindFirst, update: mocks.formUpdate },
  informationFormResponse: { findUnique: mocks.responseFindUnique, findMany: mocks.responseFindMany, create: mocks.responseCreate, count: mocks.responseCount },
  informationFormVersion: { findMany: mocks.versionFindMany },
  messageOutbox: { create: mocks.outboxCreate, findMany: mocks.outboxFindMany },
  adminAlertFeedItem: { createMany: mocks.feedCreateMany },
  auditLog: { create: mocks.auditCreate },
  $executeRaw: vi.fn(async () => 0),
  $queryRaw: vi.fn(async () => [{ id: "form-1" }]),
  $transaction: (work: (tx: unknown) => unknown) => {
    mocks.events.push("transaction");
    return work(client);
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/lib/prisma-errors", () => ({ isLockTimeoutError: () => false }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }) }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError, logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/communications/account-email", () => ({
  AccountEmailNotConfiguredError: class extends Error {},
  isAccountEmailConfigured: mocks.configured,
  getAccountEmailSender: () => {
    if (mocks.senderFails) throw new Error("sender settings broken");
    return { name: "IMSDA Events", address: "events@example.test", replyTo: null };
  },
}));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: mocks.deliver }));
vi.mock("@/modules/notifications/settings", () => ({
  isNotificationEnabled: async (key: string) => {
    mocks.events.push(`switch:${key}`);
    return mocks.switchRead(key);
  },
}));

import { InformationFormStatus, InformationFormVersionStatus } from "@prisma/client";
import { informationFormSettingsSchema, INFORMATION_FORM_ALERT_MAX_RECIPIENTS } from "@/modules/information-forms/domain";
import { buildInformationFormMembersCsv, storeInformationFormResponse } from "@/modules/information-forms/responses";
import { updateInformationFormSettings } from "@/modules/information-forms/repository";
import { informationFormSubmittedContent, informationResponseStaffPath } from "@/modules/information-forms/submission-alert";
import { notificationCatalog } from "@/modules/notifications/catalog";
import { adventurerInformationTemplates } from "@/modules/information-forms/adventurer-templates";

const SECRET_ANSWER = "Synthetic Answer Text 9876";
const when = new Date("2026-10-26T15:30:00Z");

const surveyDefinition = {
  title: "Camp survey", description: "", confirmationMessage: "Thanks.",
  sections: [{ id: "section_one", title: "Questions", description: "", fields: [{ id: "field_comments", key: "comments", label: "Comments", helpText: "", type: "LONG_TEXT", scope: "REGISTRATION", required: false, options: [] }] }],
};

function openForm(overrides: Record<string, unknown> = {}) {
  return {
    id: "form-1", name: "Camp survey", scope: "GENERAL", eventId: null, status: InformationFormStatus.OPEN, fillAccess: "ANYONE_WITH_LINK",
    opensAt: null, closesAt: null, submissionNotifyEmails: ["Youth@Example.test", "office@example.test", "youth@example.test"],
    versions: [{ id: "version-1", status: InformationFormVersionStatus.PUBLISHED, definition: surveyDefinition }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.length = 0;
  mocks.senderFails = false;
  mocks.switchRead.mockReturnValue(true);
  mocks.configured.mockReturnValue(true);
  mocks.formFindUnique.mockResolvedValue(openForm());
  mocks.responseFindUnique.mockResolvedValue(null);
  mocks.responseCreate.mockImplementation(async () => { mocks.events.push("response-created"); return { id: "response-1", submittedAt: when }; });
  mocks.outboxFindMany.mockResolvedValue([]);
  mocks.outboxCreate.mockImplementation(async () => ({ id: `message-${mocks.outboxCreate.mock.calls.length}` }));
  mocks.feedCreateMany.mockResolvedValue({ count: 1 });
  mocks.deliver.mockResolvedValue(undefined);
});

describe("recipients setting (#1222)", () => {
  it("is part of the settings schema, capped at ten", () => {
    expect(informationFormSettingsSchema.safeParse({ submissionNotifyEmails: ["a@example.test"] }).success).toBe(true);
    expect(informationFormSettingsSchema.safeParse({ submissionNotifyEmails: [] }).success).toBe(true);
    const tooMany = Array.from({ length: INFORMATION_FORM_ALERT_MAX_RECIPIENTS + 1 }, (_, index) => `person${index}@example.test`);
    expect(informationFormSettingsSchema.safeParse({ submissionNotifyEmails: tooMany }).success).toBe(false);
    expect(informationFormSettingsSchema.safeParse({ submissionNotifyEmails: "a@example.test" }).success).toBe(false);
  });

  it("saves lowercased, de-duplicated addresses and audits counts only", async () => {
    mocks.formFindFirst.mockResolvedValue({ id: "form-1", name: "Camp survey", scope: "GENERAL", eventId: null, opensAt: null, closesAt: null, submissionNotifyEmails: [], versions: [] });
    await updateInformationFormSettings({ scope: "GENERAL" }, "form-1", "user-1", { submissionNotifyEmails: ["Youth@Example.test", "youth@example.test", "office@example.test"] }).catch(() => undefined);
    expect(mocks.formUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { submissionNotifyEmails: ["youth@example.test", "office@example.test"] } }));
    const audit = JSON.stringify(mocks.auditCreate.mock.calls);
    expect(audit).not.toContain("youth@example.test");
    expect(audit).toContain("newRecipientCount");
  });

  it("refuses an address that is not valid, naming its line and not the address", async () => {
    mocks.formFindFirst.mockResolvedValue({ id: "form-1", name: "Camp survey", scope: "GENERAL", eventId: null, opensAt: null, closesAt: null, submissionNotifyEmails: [], versions: [] });
    await expect(updateInformationFormSettings({ scope: "GENERAL" }, "form-1", "user-1", { submissionNotifyEmails: ["fine@example.test", "not-an-address"] })).rejects.toMatchObject({ code: "INVALID_REQUEST", message: expect.stringContaining("Address 2") });
    expect(mocks.formUpdate).not.toHaveBeenCalled();
  });
});

describe("the alert content (#1222)", () => {
  it("names the form, the time and a link, and never holds an answer", () => {
    const path = informationResponseStaffPath({ id: "form-1", scope: "GENERAL", eventId: null }, "response-1");
    const content = informationFormSubmittedContent({ formName: "Camp survey", submittedAt: when, path });
    expect(path).toBe("/admin/information-forms/form-1/responses?response=response-1");
    expect(content.subject).toBe("New response: Camp survey");
    expect(content.bodyText).toContain("https://events.imsda.test/admin/information-forms/form-1/responses?response=response-1");
    expect(content.bodyText).toContain("The answers are not in this email.");
    expect(content.bodyText).toContain("October 26, 2026");
  });

  it("links an event form to the event workspace page", () => {
    expect(informationResponseStaffPath({ id: "form-2", scope: "EVENT", eventId: "event-1" }, "response-2")).toBe("/information-forms/responses?event=event-1&form=form-2&response=response-2");
  });

  it("is listed in the notifications catalog with its own switch", () => {
    const entry = notificationCatalog.find((candidate) => candidate.key === "INFORMATION_FORM_SUBMITTED");
    expect(entry).toMatchObject({ built: true, source: { kind: "information-form-list" }, sentFrom: "modules/information-forms/submission-alert.ts", switchReadIn: ["modules/information-forms/responses.ts"] });
  });
});

describe("a response is stored, then alerted (#1222)", () => {
  it("queues one email per distinct address, after the response is stored, with no answer in any of them", async () => {
    const result = await storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: { comments: SECRET_ANSWER } });
    expect(result).toEqual({ id: "response-1", created: true });
    expect(mocks.outboxCreate).toHaveBeenCalledTimes(2);
    const recipients = mocks.outboxCreate.mock.calls.map(([call]) => call.data.recipientEmail).sort();
    expect(recipients).toEqual(["office@example.test", "youth@example.test"]);
    for (const [call] of mocks.outboxCreate.mock.calls) {
      expect(call.data.bodyTextSnapshot).not.toContain(SECRET_ANSWER);
      expect(call.data.subjectSnapshot).not.toContain(SECRET_ANSWER);
      expect(JSON.stringify(call.data.metadata)).not.toContain(SECRET_ANSWER);
      expect(call.data.templateKey).toBe("INFORMATION_FORM_SUBMITTED");
      expect(call.data.recipientKind).toBe("INTERNAL");
    }
    expect(mocks.feedCreateMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.feedCreateMany.mock.calls)).not.toContain(SECRET_ANSWER);
    expect(mocks.deliver).toHaveBeenCalledTimes(1);
    // The response is written before the alert's own transaction opens, and the switch is read before the write.
    expect(mocks.events).toEqual(["switch:INFORMATION_FORM_SUBMITTED", "response-created", "transaction"]);
  });

  it("sends nothing when the list is empty, the switch is off, or the response was already stored", async () => {
    mocks.formFindUnique.mockResolvedValue(openForm({ submissionNotifyEmails: [] }));
    await storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: {} });
    expect(mocks.outboxCreate).not.toHaveBeenCalled();

    mocks.formFindUnique.mockResolvedValue(openForm());
    mocks.switchRead.mockReturnValue(false);
    await storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: {} });
    expect(mocks.outboxCreate).not.toHaveBeenCalled();

    mocks.switchRead.mockReturnValue(true);
    mocks.responseFindUnique.mockResolvedValue({ id: "response-1" });
    expect(await storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: {} })).toEqual({ id: "response-1", created: false });
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("keeps the response when queueing the alert fails, and logs only the response id", async () => {
    mocks.outboxCreate.mockRejectedValue(new Error("outbox is down"));
    const result = await storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: { comments: SECRET_ANSWER } });
    expect(result).toEqual({ id: "response-1", created: true });
    expect(mocks.logError).toHaveBeenCalledWith(expect.any(String), expect.any(Error), { responseId: "response-1" });
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("keeps the response when the sender settings are broken or delivery fails", async () => {
    mocks.senderFails = true;
    expect(await storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-12345678", answers: {} })).toEqual({ id: "response-1", created: true });
    mocks.senderFails = false;
    mocks.deliver.mockRejectedValue(new Error("mail server down"));
    expect(await storeInformationFormResponse({ formId: "form-1", idempotencyKey: "key-abcdefgh", answers: {} })).toEqual({ id: "response-1", created: true });
  });
});

describe("the members CSV (#1222)", () => {
  const annual = adventurerInformationTemplates.find((template) => template.key === "adventurer_annual_registration")!.definition;

  it("has one row per member with club, name, age, level and working on, and escapes formulas", async () => {
    mocks.formFindFirst.mockResolvedValue({ id: "form-1", name: "Annual Adventurer Club Registration", slug: "annual-adventurer-club-registration" });
    mocks.responseCount.mockResolvedValue(2);
    mocks.versionFindMany.mockResolvedValue([{ definition: annual }]);
    mocks.responseFindMany.mockResolvedValue([
      { answers: { club_name: "Sample Club", members: [{ name: "Sample Member", age: 6, level: "Busy Bee", working_on: "Pets honor" }, { name: "=HYPERLINK(\"x\")", age: 4, level: "Eager Beaver" }] } },
      { answers: { club_name: "Other Club", members: [{ name: "Third Member", age: 8, level: "Builder", working_on: "Class work, level 3" }] } },
    ]);
    const file = await buildInformationFormMembersCsv({ scope: "GENERAL" }, "form-1", "user-1");
    expect(file.rowCount).toBe(3);
    expect(file.filename).toBe("annual-adventurer-club-registration-members.csv");
    const lines = file.csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe('"Club","Name","Age","Level","Working on"');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('"Sample Club","Sample Member","6","Busy Bee","Pets honor"');
    expect(lines[2]).toContain(`"Sample Club","'=HYPERLINK`);
    expect(lines[3]).toBe('"Other Club","Third Member","8","Builder","Class work, level 3"');
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("Sample Member");
  });

  it("falls back to the form name when a response has no club_name answer", async () => {
    mocks.formFindFirst.mockResolvedValue({ id: "form-1", name: "Annual Adventurer Club Registration", slug: "annual" });
    mocks.responseCount.mockResolvedValue(1);
    mocks.versionFindMany.mockResolvedValue([{ definition: annual }]);
    mocks.responseFindMany.mockResolvedValue([{ answers: { members: [{ name: "Sample Member", age: 6, level: "Busy Bee" }] } }, { answers: {} }]);
    const file = await buildInformationFormMembersCsv({ scope: "GENERAL" }, "form-1", "user-1");
    expect(file.rowCount).toBe(1);
    expect(file.csv.split("\r\n")[1]).toBe('"Annual Adventurer Club Registration","Sample Member","6","Busy Bee",""');
  });

  it("is refused for a form without a member list", async () => {
    mocks.formFindFirst.mockResolvedValue({ id: "form-1", name: "Camp survey", slug: "camp-survey" });
    mocks.responseCount.mockResolvedValue(1);
    mocks.versionFindMany.mockResolvedValue([{ definition: surveyDefinition }]);
    await expect(buildInformationFormMembersCsv({ scope: "GENERAL" }, "form-1", "user-1")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("only a system administrator sets the recipients (#1222)", () => {
  async function patch(isSystemAdmin: boolean, body: unknown) {
    const { informationFormHandlers } = await import("@/modules/information-forms/api");
    const handlers = informationFormHandlers<{ eventId: string }>(async () => ({ userId: "user-1", isSystemAdmin, target: { scope: "EVENT", eventId: "event-1" } }));
    const request = new Request("https://events.imsda.test/api/events/event-1/information-forms/form-1/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json", Origin: "https://events.imsda.test" }, body: JSON.stringify(body),
    });
    return handlers.updateSettings(request, { eventId: "event-1", formId: "form-1" });
  }

  it("refuses event staff who are not system administrators, and leaves the form untouched", async () => {
    mocks.formFindFirst.mockResolvedValue({ id: "form-1", name: "Camp survey", scope: "EVENT", eventId: "event-1", opensAt: null, closesAt: null, submissionNotifyEmails: [], versions: [] });
    const response = await patch(false, { submissionNotifyEmails: ["youth@example.test"] });
    expect(response.status).toBe(403);
    expect(mocks.formUpdate).not.toHaveBeenCalled();
  });

  it("lets event staff change the other settings, and a system administrator change the recipients", async () => {
    mocks.formFindFirst.mockResolvedValue({ id: "form-1", name: "Camp survey", scope: "EVENT", eventId: "event-1", fillAccess: "ANYONE_WITH_LINK", opensAt: null, closesAt: null, submissionNotifyEmails: [], versions: [] });
    expect((await patch(false, { fillAccess: "SIGNED_IN" })).status).toBe(200);
    expect((await patch(true, { submissionNotifyEmails: ["youth@example.test"] })).status).toBe(200);
  });
});
