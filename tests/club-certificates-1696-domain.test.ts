import { describe, expect, it } from "vitest";
import {
  CERTIFICATES_PRINT_MAX,
  canManageClubCertificates,
  certificateKey,
  classCandidates,
  classCertificateTitle,
  filterCandidates,
  formatCompletionDate,
  honorCandidates,
  isCalendarDate,
  parseCertificateFilter,
  parseCertificateItems,
  selectCertificates,
  sortCandidates,
} from "@/modules/club-certificates/domain";
import { CLUB_OPTIONAL_FEATURE_KEYS, clubOptionalFeatureDefinitions } from "@/modules/club-features/domain";

/** Class and honor certificates (#1696), pure. Synthetic data only. */

const ann = { memberId: "m1", firstName: "Ann", lastName: "Example" };
const zed = { memberId: "m2", firstName: "Zed", lastName: "Sample" };

describe("the feature key", () => {
  it("is on the typed list with a title and an off-by-default description", () => {
    expect(CLUB_OPTIONAL_FEATURE_KEYS).toContain("completion-certificates");
    expect(clubOptionalFeatureDefinitions["completion-certificates"].title).toBe("Class and honor certificates");
  });
  it("is for the director and deputy only", () => {
    expect(canManageClubCertificates({ editProfile: true })).toBe(true);
    expect(canManageClubCertificates({ editProfile: false })).toBe(false);
  });
});

describe("current completions", () => {
  it("keeps only completed honors with a real date, and never an in-progress one", () => {
    const out = honorCandidates([{
      ...ann,
      honors: [
        { honorId: "h1", honorName: "Archery", status: "COMPLETED", completionDate: "2026-10-04", recordedAtOrganizationId: "club-1" },
        { honorId: "h2", honorName: "Knots", status: "IN_PROGRESS", completionDate: "", recordedAtOrganizationId: "club-1" },
        { honorId: "h3", honorName: "Camping", status: "COMPLETED", completionDate: "not a date", recordedAtOrganizationId: "club-1" },
      ],
    }], "club-1");
    expect(out.map((item) => item.key)).toEqual(["h:m1:h1"]);
    expect(out[0]).toMatchObject({ kind: "HONOR", title: "Archery", completedOn: "2026-10-04" });
  });

  it("lists only honors this club recorded, never another club's under this club's name", () => {
    const out = honorCandidates([{
      ...ann,
      honors: [
        { honorId: "h1", honorName: "Archery", status: "COMPLETED", completionDate: "2026-10-04", recordedAtOrganizationId: "club-2" },
        { honorId: "h2", honorName: "Knots", status: "COMPLETED", completionDate: "2026-10-05", recordedAtOrganizationId: "club-1" },
        { honorId: "h3", honorName: "Birds", status: "COMPLETED", completionDate: "2026-10-06" },
      ],
    }], "club-1");
    expect(out.map((item) => item.key)).toEqual(["h:m1:h2"]);
  });

  it("a voided entry never counts: the current-status reader leaves it out, so a person with none has no candidate", async () => {
    const { currentHonorsFromHistory } = await import("@/modules/honors/member-honor-domain");
    const entry = (over: Record<string, unknown>) => ({
      id: "e", honorId: "h1", honorCode: "A", honorName: "Archery", status: "COMPLETED", completionDate: "2026-10-04", note: "", createdAt: "2026-10-04T00:00:00.000Z",
      recordedAtOrganizationId: "club-1", recordedAtOrganizationName: "Test", recordedByName: "", voided: null, ...over,
    }) as unknown as Parameters<typeof currentHonorsFromHistory>[0][number];
    const voided = { reason: "mistake", voidedAt: "2026-10-05T00:00:00.000Z", voidedByName: "" };
    const current = currentHonorsFromHistory([entry({ voided })]);
    expect(honorCandidates([{ ...ann, honors: current }], "club-1")).toEqual([]);
  });

  it("builds class completions with class names", () => {
    const out = classCandidates([
      { ...ann, classLevel: "EXPLORER", completedOn: "2026-06-01" },
      { ...ann, classLevel: "MASTER_GUIDE", completedOn: "2026-06-02" },
      { ...zed, classLevel: "FRIEND", completedOn: "bad" },
    ]);
    expect(out.map((item) => [item.key, item.title])).toEqual([["c:m1:EXPLORER", "Explorer Class"], ["c:m1:MASTER_GUIDE", "Master Guide"]]);
    expect(classCertificateTitle("BASIC_STAFF_TRAINING")).toBe("Basic Staff Training");
  });

  it("sorts by last name, first name, then newest completion", () => {
    const list = sortCandidates([
      ...classCandidates([{ ...zed, classLevel: "FRIEND", completedOn: "2026-01-01" }]),
      ...honorCandidates([{ ...ann, honors: [
        { honorId: "a", honorName: "Archery", status: "COMPLETED", completionDate: "2026-02-01", recordedAtOrganizationId: "club-1" },
        { honorId: "b", honorName: "Birds", status: "COMPLETED", completionDate: "2026-03-01", recordedAtOrganizationId: "club-1" },
      ] }], "club-1"),
    ]);
    expect(list.map((item) => item.title)).toEqual(["Birds", "Archery", "Friend Class"]);
  });
});

describe("dates", () => {
  it("formats a calendar date as a long US date", () => {
    expect(formatCompletionDate("2026-11-12")).toBe("November 12, 2026");
    expect(formatCompletionDate("2027-01-01")).toBe("January 1, 2027");
    expect(formatCompletionDate("garbage")).toBe("garbage");
  });
  it("recognizes only real dates", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-2-3")).toBe(false);
    expect(isCalendarDate(42)).toBe(false);
  });
});

describe("filters", () => {
  const all = sortCandidates([
    ...honorCandidates([{ ...ann, honors: [{ honorId: "a", honorName: "Archery", status: "COMPLETED", completionDate: "2026-05-10", recordedAtOrganizationId: "club-1" }] }], "club-1"),
    ...classCandidates([{ ...zed, classLevel: "RANGER", completedOn: "2026-06-20" }, { ...ann, classLevel: "GUIDE", completedOn: "2026-06-21" }]),
  ]);
  it("parses defensively", () => {
    expect(parseCertificateFilter({})).toEqual({ kind: "ALL", from: "", to: "" });
    expect(parseCertificateFilter({ kind: "class", from: "2026-06-01", to: "nope" })).toEqual({ kind: "CLASS", from: "2026-06-01", to: "" });
    expect(parseCertificateFilter({ kind: ["honor", "x"], from: ["2026-02-31"] })).toEqual({ kind: "HONOR", from: "", to: "" });
  });
  it("filters by kind", () => {
    expect(filterCandidates(all, { kind: "HONOR", from: "", to: "" })).toHaveLength(1);
    expect(filterCandidates(all, { kind: "CLASS", from: "", to: "" })).toHaveLength(2);
  });
  it("filters by an inclusive date range, with either end open", () => {
    expect(filterCandidates(all, { kind: "ALL", from: "2026-06-20", to: "2026-06-20" }).map((item) => item.title)).toEqual(["Ranger Class"]);
    expect(filterCandidates(all, { kind: "ALL", from: "2026-06-01", to: "" })).toHaveLength(2);
    expect(filterCandidates(all, { kind: "ALL", from: "", to: "2026-05-31" })).toHaveLength(1);
  });
});

describe("the items a print asks for", () => {
  it("parses distinct well-formed keys and skips the rest", () => {
    expect(parseCertificateItems("h:m1:a, c:m1:GUIDE,h:m1:a,x:m1:a,h:m1,h::a,h:m1:a:b,,")).toEqual(["h:m1:a", "c:m1:GUIDE"]);
    expect(parseCertificateItems(["h:m1:a", "c:m2:FRIEND"])).toEqual(["h:m1:a", "c:m2:FRIEND"]);
    expect(parseCertificateItems(undefined)).toEqual([]);
    expect(parseCertificateItems("h:" + "x".repeat(200) + ":a")).toEqual([]);
  });
  it("is capped", () => {
    const many = Array.from({ length: CERTIFICATES_PRINT_MAX + 50 }, (_, index) => `h:m${index}:a`).join(",");
    expect(parseCertificateItems(many)).toHaveLength(CERTIFICATES_PRINT_MAX);
  });
  it("keeps only keys that are current completions here, in the order asked, and drops the rest silently", () => {
    const candidates = [
      ...honorCandidates([{ ...ann, honors: [{ honorId: "a", honorName: "Archery", status: "COMPLETED", completionDate: "2026-05-10", recordedAtOrganizationId: "club-1" }] }], "club-1"),
      ...classCandidates([{ ...zed, classLevel: "RANGER", completedOn: "2026-06-20" }]),
    ];
    const chosen = selectCertificates([certificateKey("CLASS", "m2", "RANGER"), "h:other-club-member:a", "h:m1:a", "h:m1:a", "h:m1:never"], candidates);
    expect(chosen.map((item) => item.key)).toEqual(["c:m2:RANGER", "h:m1:a"]);
  });
});
