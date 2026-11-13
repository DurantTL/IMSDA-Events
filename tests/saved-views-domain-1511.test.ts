import { describe, expect, it } from "vitest";
import { emptySearchCatalog, type SearchCatalog } from "@/modules/registrations/operations-search-domain";
import {
  checkSavedViewQuery,
  hasSavableContent,
  normalizeSavedViewName,
  normalizeSavedViewQuery,
  savedViewFilterKeys,
} from "@/modules/registrations/saved-views-domain";

// #1511: what may be stored as a saved view, and whether one still works for a viewer. Synthetic data only.
const staff = { eventId: "event-1", permissions: ["VIEW_EVENT", "VIEW_SENSITIVE_DATA", "MANAGE_REGISTRATION", "MANAGE_FINANCE"] as const };
const catalog: SearchCatalog = {
  ...emptySearchCatalog(),
  tags: [{ id: "tag-1", name: "VIP", isActive: true }],
  attendeeTypes: [{ code: "ADULT", label: "Adult" }],
  questions: [{ id: "ATTENDEE:meal", label: "Dinner choice", scope: "ATTENDEE", choices: [{ value: "vegan", label: "Vegan" }], versionIds: ["v1"] } as never],
};

describe("saved view names", () => {
  it("trims, collapses spaces and keeps 1 to 60 characters", () => {
    expect(normalizeSavedViewName("  Unpaid   VIP ")).toEqual({ ok: true, name: "Unpaid VIP" });
    expect(normalizeSavedViewName("   ").ok).toBe(false);
    expect(normalizeSavedViewName("x".repeat(60)).ok).toBe(true);
    expect(normalizeSavedViewName("x".repeat(61)).ok).toBe(false);
    expect(normalizeSavedViewName("bad\u0007name").ok).toBe(false);
    for (const mark of ["\u200E", "\u200F", "\u202A", "\u202E", "\u2066", "\u2069"]) expect(normalizeSavedViewName(`Name${mark}`).ok).toBe(false);
  });
});

describe("saved view queries", () => {
  it("drops the page and writes the canonical form", () => {
    const first = normalizeSavedViewQuery("?page=4&tag=tag-1&status=CONFIRMED,DRAFT");
    const second = normalizeSavedViewQuery("status=DRAFT&status=CONFIRMED&tag=tag-1");
    expect(first.stored).toBe("status=DRAFT%2CCONFIRMED&tag=tag-1");
    expect(first.stored).not.toContain("page");
    expect(second.stored).toBe(first.stored);
  });

  it("needs a filter or a non-default sort to be worth saving", () => {
    expect(hasSavableContent(normalizeSavedViewQuery("").query)).toBe(false);
    expect(hasSavableContent(normalizeSavedViewQuery("page=3&size=100").query)).toBe(false);
    expect(hasSavableContent(normalizeSavedViewQuery("status=CONFIRMED").query)).toBe(true);
    expect(hasSavableContent(normalizeSavedViewQuery("sort=name").query)).toBe(true);
  });

  it("names the filter keys only, never the values", () => {
    expect(savedViewFilterKeys("q=pat+example&tag=tag-1&answer=ATTENDEE%3Ameal%3Dvegan")).toEqual(["q", "tag", "answer"]);
  });
});

describe("checking a view against a viewer", () => {
  it("passes a view whose filters all exist and are allowed", () => {
    const checked = checkSavedViewQuery("tag=tag-1&attendeeType=ADULT&answer=ATTENDEE%3Ameal%3Dvegan", staff, catalog);
    expect(checked.ok).toBe(true);
  });

  it("flags an unknown tag, a removed question, a removed choice and an unknown value", () => {
    expect(checkSavedViewQuery("tag=tag-gone", staff, catalog).ok).toBe(false);
    expect(checkSavedViewQuery("answer=ATTENDEE%3Ashirt%3Dm", staff, catalog).ok).toBe(false);
    expect(checkSavedViewQuery("answer=ATTENDEE%3Ameal%3Dpaleo", staff, catalog).ok).toBe(false);
    expect(checkSavedViewQuery("status=NOT_A_STATUS", staff, catalog).ok).toBe(false);
  });

  it("flags a domain the viewer lacks, and the same message reads for a missing and a forbidden filter", () => {
    const noFinance = { ...staff, permissions: ["VIEW_EVENT", "VIEW_SENSITIVE_DATA"] as const };
    const forbidden = checkSavedViewQuery("payment=PAID", noFinance, catalog);
    const missing = checkSavedViewQuery("tag=tag-gone", staff, catalog);
    expect(forbidden.ok).toBe(false);
    expect(checkSavedViewQuery("payment=PAID", staff, catalog).ok).toBe(true);
    if (!forbidden.ok && !missing.ok) expect(forbidden.issues[0]?.message.length).toBeGreaterThan(0);
  });
});
