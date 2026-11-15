import { describe, expect, it } from "vitest";
import {
  BULK_ACTION_CATALOG,
  auditParams,
  completedLabel,
  messageSkipReason,
  messageTemplateKey,
  missingForAction,
  paramsFromStored,
  parseBulkActionKey,
  parseBulkParams,
  permissionsUsed,
  reasonLabel,
  storedParams,
} from "@/modules/bulk-actions/domain";

// #182 slice 2: the two message actions are parsed strictly, need communications access and say nothing is sent now.
describe("QUEUE_MESSAGE parameters", () => {
  it("needs a title and a message for an announcement, and trims them", () => {
    expect(parseBulkParams("QUEUE_MESSAGE", { templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "  Bring a jacket ", announcementBody: " Nights are cold. " }))
      .toEqual({ action: "QUEUE_MESSAGE", templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Bring a jacket", announcementBody: "Nights are cold." });
    expect(() => parseBulkParams("QUEUE_MESSAGE", { templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "", announcementBody: "Text" })).toThrow(/needs a title/);
    expect(() => parseBulkParams("QUEUE_MESSAGE", { templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "Title" })).toThrow(/needs a message/);
  });

  it("refuses a title or message for any other template, but allows them empty or left out", () => {
    expect(parseBulkParams("QUEUE_MESSAGE", { templateKey: "BALANCE_REMINDER" })).toMatchObject({ templateKey: "BALANCE_REMINDER", announcementTitle: "", announcementBody: "" });
    expect(parseBulkParams("QUEUE_MESSAGE", { templateKey: "CUSTOM_MESSAGE", announcementTitle: "", announcementBody: "" })).toMatchObject({ templateKey: "CUSTOM_MESSAGE" });
    expect(() => parseBulkParams("QUEUE_MESSAGE", { templateKey: "BALANCE_REMINDER", announcementTitle: "Hi" })).toThrow(/Only an announcement/);
  });

  it("is strict: an unknown template, an extra key and over-long text are refused", () => {
    expect(() => parseBulkParams("QUEUE_MESSAGE", { templateKey: "REFUND_NOTICE" })).toThrow();
    expect(() => parseBulkParams("QUEUE_MESSAGE", { templateKey: "BALANCE_REMINDER", recipients: ["a@example.test"] })).toThrow();
    expect(() => parseBulkParams("QUEUE_MESSAGE", { templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "x".repeat(121), announcementBody: "Text" })).toThrow();
    expect(() => parseBulkParams("QUEUE_MESSAGE", { templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "T", announcementBody: "x".repeat(4001) })).toThrow();
  });
});

describe("REQUEST_INFORMATION parameters", () => {
  it("needs a title and details, within the limits", () => {
    expect(parseBulkParams("REQUEST_INFORMATION", { title: " Shirt size ", details: " Please add each camper's size. " })).toEqual({ action: "REQUEST_INFORMATION", title: "Shirt size", details: "Please add each camper's size." });
    expect(() => parseBulkParams("REQUEST_INFORMATION", { title: "", details: "Text" })).toThrow();
    expect(() => parseBulkParams("REQUEST_INFORMATION", { title: "Title", details: "   " })).toThrow();
    expect(() => parseBulkParams("REQUEST_INFORMATION", { title: "T".repeat(121), details: "Text" })).toThrow();
    expect(() => parseBulkParams("REQUEST_INFORMATION", { title: "T", details: "d".repeat(4001) })).toThrow();
    expect(() => parseBulkParams("REQUEST_INFORMATION", { title: "T", details: "d", templateKey: "CUSTOM_MESSAGE" })).toThrow();
  });

  it("is sent with the announcement template", () => {
    expect(messageTemplateKey(parseBulkParams("REQUEST_INFORMATION", { title: "T", details: "d" }))).toBe("EVENT_ANNOUNCEMENT");
    expect(messageTemplateKey(parseBulkParams("QUEUE_MESSAGE", { templateKey: "BALANCE_REMINDER" }))).toBe("BALANCE_REMINDER");
    expect(messageTemplateKey(parseBulkParams("APPLY_TAG", { tagId: "t" }))).toBeNull();
  });
});

describe("message actions in the catalog", () => {
  it("need communications access on top of the base access, up to 250 registrations, with no file", () => {
    for (const key of ["QUEUE_MESSAGE", "REQUEST_INFORMATION"] as const) {
      const entry = BULK_ACTION_CATALOG[key];
      expect(entry.permissions).toEqual(["MANAGE_COMMUNICATIONS"]);
      expect(entry.maxRecords).toBe(250);
      expect(entry.createsFile).toBe(false);
      expect(entry.effect).toContain("Nothing is sent now. The message waits for approval under Messages waiting for approval.");
    }
    expect(BULK_ACTION_CATALOG.REQUEST_INFORMATION.effect).toMatch(/opted out of announcements are skipped/);
  });

  it("name what is missing in plain words", () => {
    const params = parseBulkParams("QUEUE_MESSAGE", { templateKey: "BALANCE_REMINDER" });
    expect(missingForAction(params, ["VIEW_SENSITIVE_DATA"])).toEqual(["sending messages"]);
    expect(missingForAction(params, ["VIEW_SENSITIVE_DATA", "MANAGE_COMMUNICATIONS"])).toEqual([]);
    expect(missingForAction(params, ["MANAGE_COMMUNICATIONS"])).toEqual(["viewing registration records"]);
    expect(permissionsUsed(params)).toEqual(["viewing registration records", "sending messages"]);
  });

  it("label a queued record as queued for approval, never as sent", () => {
    expect(completedLabel("QUEUE_MESSAGE")).toBe("Queued for approval");
    expect(completedLabel("REQUEST_INFORMATION")).toBe("Queued for approval");
    expect(completedLabel("APPLY_TAG")).toBe("Completed");
  });
});

describe("stored parameters and the audit trail", () => {
  it("round-trip through storage", () => {
    for (const [action, raw] of [
      ["QUEUE_MESSAGE", { templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "T", announcementBody: "B" }],
      ["QUEUE_MESSAGE", { templateKey: "CUSTOM_MESSAGE" }],
      ["REQUEST_INFORMATION", { title: "T", details: "D" }],
    ] as const) {
      const params = parseBulkParams(action, raw);
      expect(paramsFromStored(action, storedParams(params))).toEqual(params);
    }
  });

  it("keeps the staff-written text out of the audit parameters", () => {
    expect(auditParams(storedParams(parseBulkParams("QUEUE_MESSAGE", { templateKey: "EVENT_ANNOUNCEMENT", announcementTitle: "T", announcementBody: "B" })))).toEqual({ templateKey: "EVENT_ANNOUNCEMENT" });
    expect(auditParams(storedParams(parseBulkParams("REQUEST_INFORMATION", { title: "T", details: "D" })))).toEqual({ templateKey: "EVENT_ANNOUNCEMENT" });
    expect(auditParams({ tagId: "t1" })).toEqual({ tagId: "t1" });
  });
});

describe("skip reasons", () => {
  it("map every send skip to a short code and a plain label with no personal data", () => {
    const codes = ["NOT_FOUND", "INACTIVE_REGISTRATION", "NO_BALANCE_DUE", "INVALID_CONTACT_EMAIL", "ORGANIZATION_BILLED", "ANNOUNCEMENT_OPTED_OUT_EVENT", "ANNOUNCEMENT_OPTED_OUT_ALL"];
    const mapped = codes.map(messageSkipReason);
    expect(mapped).toEqual(["NOT_A_REGISTRATION", "NOT_ELIGIBLE_STATUS", "NO_BALANCE_DUE", "NO_VALID_EMAIL", "ORGANIZATION_BILLED", "OPTED_OUT", "OPTED_OUT"]);
    for (const code of mapped) expect(reasonLabel(code)).not.toBe("");
    expect(messageSkipReason("SOMETHING_NEW")).toBe("NOT_QUEUED");
  });
});

describe("the restricted guard still holds", () => {
  it("refuses sending money, cancelling and merging, and names the message actions in the generic guide", () => {
    for (const key of ["refund", "cancel_registration", "merge_people", "send_email_now", "send_message"]) expect(parseBulkActionKey(key).ok).toBe(false);
    const generic = parseBulkActionKey("send_message");
    expect(generic.ok ? "" : generic.message).toContain("queue a message");
    expect(parseBulkActionKey("QUEUE_MESSAGE")).toEqual({ ok: true, key: "QUEUE_MESSAGE" });
  });
});
