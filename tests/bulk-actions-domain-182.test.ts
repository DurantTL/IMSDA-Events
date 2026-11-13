import { describe, expect, it } from "vitest";
import {
  BULK_ACTION_CATALOG,
  BULK_ACTION_KEYS,
  EXPORT_ACTION_MAX_RECORDS,
  EXPORT_FIELDS,
  TAG_ACTION_MAX_RECORDS,
  auditQueryString,
  canonicalBulkQuery,
  describeQueryFilters,
  idempotencyKeySchema,
  missingForAction,
  parseBulkActionKey,
  parseBulkParams,
  permissionsUsed,
  tallyOutcomes,
} from "@/modules/bulk-actions/domain";

// #182: the pure rules of the bulk-action framework. Synthetic data only.
describe("action allowlist", () => {
  it("has exactly three actions and no generic field update", () => {
    expect([...BULK_ACTION_KEYS]).toEqual(["APPLY_TAG", "REMOVE_TAG", "EXPORT_FIELDS"]);
    expect(Object.keys(BULK_ACTION_CATALOG).sort()).toEqual([...BULK_ACTION_KEYS].sort());
  });

  it("accepts a listed key and refuses everything else, naming the page to use", () => {
    expect(parseBulkActionKey("APPLY_TAG")).toEqual({ ok: true, key: "APPLY_TAG" });
    for (const key of ["refund", "REFUND_PAYMENT", "cancel-registration", "transfer", "identity_merge", "protected_record", "lodging_assignment", "session_assign", "change_price", "capacity", "set_field", "update", "__proto__", "constructor"]) {
      const parsed = parseBulkActionKey(key);
      expect(parsed.ok, key).toBe(false);
      if (!parsed.ok) expect(parsed.message).toMatch(/not available as a bulk action/);
    }
    expect(parseBulkActionKey(undefined).ok).toBe(false);
    expect(parseBulkActionKey(null).ok).toBe(false);
    expect(parseBulkActionKey(["APPLY_TAG"]).ok).toBe(false);
  });

  it("limits are the agreed ones", () => {
    expect(TAG_ACTION_MAX_RECORDS).toBe(500);
    expect(EXPORT_ACTION_MAX_RECORDS).toBe(5000);
    expect(BULK_ACTION_CATALOG.APPLY_TAG.maxRecords).toBe(500);
    expect(BULK_ACTION_CATALOG.EXPORT_FIELDS.maxRecords).toBe(5000);
  });
});

describe("export fields", () => {
  it("offers no health, medical, consent, note or insurance field", () => {
    const text = EXPORT_FIELDS.map((field) => `${field.key} ${field.label}`).join(" ").toLowerCase();
    for (const word of ["health", "medical", "consent", "note", "insurance", "allerg"]) expect(text).not.toContain(word);
  });

  it("gives each field its own permission", () => {
    const need = (key: string) => EXPORT_FIELDS.find((field) => field.key === key)?.permissions;
    expect(need("code")).toEqual(["VIEW_EVENT"]);
    expect(need("contactEmail")).toEqual(["VIEW_SENSITIVE_DATA"]);
    expect(need("balance")).toEqual(["MANAGE_FINANCE"]);
    expect(need("tags")).toEqual(["MANAGE_REGISTRATION", "VIEW_SENSITIVE_DATA"]);
  });

  it("rejects an unknown, empty or non-array field list and drops duplicates", () => {
    expect(() => parseBulkParams("EXPORT_FIELDS", { fields: [] })).toThrow();
    expect(() => parseBulkParams("EXPORT_FIELDS", { fields: ["code", "medicalNeeds"] })).toThrow();
    expect(() => parseBulkParams("EXPORT_FIELDS", { fields: "code" })).toThrow();
    expect(() => parseBulkParams("EXPORT_FIELDS", { fields: ["code"], extra: true })).toThrow();
    expect(parseBulkParams("EXPORT_FIELDS", { fields: ["code", "code", "status"] })).toEqual({ action: "EXPORT_FIELDS", fields: ["code", "status"] });
  });

  it("requires a tag id for a tag action and nothing else", () => {
    expect(parseBulkParams("APPLY_TAG", { tagId: " t1 " })).toEqual({ action: "APPLY_TAG", tagId: "t1" });
    expect(() => parseBulkParams("REMOVE_TAG", {})).toThrow();
    expect(() => parseBulkParams("REMOVE_TAG", { tagId: "t1", field: "status" })).toThrow();
  });
});

describe("permissions", () => {
  it("lists everything missing, for the action and for each field", () => {
    const params = parseBulkParams("EXPORT_FIELDS", { fields: ["code", "balance"] });
    expect(missingForAction(params, ["VIEW_EVENT"])).toEqual(["viewing registration records", "downloading reports", "the \"Balance\" field"]);
    expect(missingForAction(params, ["VIEW_EVENT", "VIEW_SENSITIVE_DATA", "VIEW_REPORTS", "MANAGE_FINANCE"])).toEqual([]);
    expect(missingForAction(parseBulkParams("APPLY_TAG", { tagId: "t" }), ["VIEW_SENSITIVE_DATA"])).toEqual(["managing registrations"]);
  });

  it("says which permissions a run uses", () => {
    expect(permissionsUsed(parseBulkParams("APPLY_TAG", { tagId: "t" }))).toEqual(["viewing registration records", "managing registrations"]);
    expect(permissionsUsed(parseBulkParams("EXPORT_FIELDS", { fields: ["balance"] }))).toContain("finance");
  });
});

describe("scope, key and counts", () => {
  it("writes the scope in words without ids or, for the history, search text", () => {
    expect(describeQueryFilters("status=CONFIRMED,SUBMITTED&tag=t1,t2&q=somebody", { showText: true })).toEqual(['Search text: "somebody"', "Status: submitted, confirmed", "Tag: 2 selected"]);
    expect(describeQueryFilters("q=somebody")).toEqual(["Search text"]);
    expect(describeQueryFilters("")).toEqual([]);
  });

  it("keeps typed text out of the audit form of a query", () => {
    expect(auditQueryString("q=Some+Name&status=CONFIRMED")).toBe("q=%5Btext%5D&status=CONFIRMED");
    expect(auditQueryString("status=CONFIRMED")).toBe("status=CONFIRMED");
  });

  it("canonicalizes a query: no page, defaults left out", () => {
    expect(canonicalBulkQuery("page=4&status=CONFIRMED&event=abc&size=50").queryString).toBe("status=CONFIRMED");
  });

  it("needs a bounded idempotency key of plain characters", () => {
    expect(idempotencyKeySchema.safeParse("0b3f1c9e-1111-4222-8333-444455556666").success).toBe(true);
    for (const bad of ["", "short", "a".repeat(101), "has space here", "semi;colon;key"]) expect(idempotencyKeySchema.safeParse(bad).success, bad).toBe(false);
  });

  it("tallies outcomes by state", () => {
    expect(tallyOutcomes([{ outcome: "COMPLETED" }, { outcome: "COMPLETED" }, { outcome: "FAILED" }, { outcome: "OBSOLETE" }])).toEqual({ completed: 2, skipped: 0, conflict: 0, failed: 1, obsolete: 1 });
  });
});
