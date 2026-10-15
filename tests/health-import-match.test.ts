import { describe, expect, it, vi } from "vitest";
import { clubNameStem, clubsForText, matchEntries, countOutcomes, type MatchClub, type MatchMember } from "@/modules/health-records/import-match";
import type { ParsedHealthEntry } from "@/modules/health-records/import-parser";

vi.mock("server-only", () => ({}));

const clubs: MatchClub[] = [
  { organizationId: "club-a", name: "Example Pathfinders", normalizedName: "example pathfinders", sponsorName: "Example SDA Church" },
  { organizationId: "club-b", name: "Sample Valley Pathfinders", normalizedName: "sample valley pathfinders", sponsorName: "Sample Valley SDA Church" },
  { organizationId: "club-c", name: "Twin Pathfinders", normalizedName: "twin pathfinders", sponsorName: "Twin SDA Church" },
  { organizationId: "club-d", name: "Twin Teens Club", normalizedName: "twin teens club", sponsorName: "Twin SDA Church" },
];

function entry(overrides: Partial<ParsedHealthEntry> = {}): ParsedHealthEntry {
  return {
    sourceId: "1",
    firstName: "Riley",
    lastName: "Sample",
    birthDate: "2012-04-09",
    clubText: "Example Pathfinders",
    guardianEmail: "parent@example.test",
    submittedAt: "2026-09-20",
    incomplete: false,
    values: {},
    sections: [],
    needsCorrection: [],
    contactsOmitted: 0,
    ...overrides,
  };
}

function member(overrides: Partial<MatchMember> = {}): MatchMember {
  return { id: "m1", organizationId: "club-a", firstName: "Riley", lastName: "Sample", birthDate: "2012-04-09", guardianEmails: [], hasRecord: false, ...overrides };
}

const only = (entries: ParsedHealthEntry[], members: MatchMember[]) => matchEntries(entries, clubs, members);

describe("matching an entry to a roster member", () => {
  it("matches on club, name and birth date", () => {
    expect(only([entry()], [member()])[0]).toMatchObject({ outcome: "MATCHED", via: "BIRTH_DATE", organizationId: "club-a", memberId: "m1", clubName: "Example Pathfinders" });
  });

  it("matches on club, name and the parent's email when the birth date is missing or different", () => {
    const parent = member({ birthDate: null, guardianEmails: ["parent@example.test"] });
    expect(only([entry()], [parent])[0]).toMatchObject({ outcome: "MATCHED", via: "PARENT_EMAIL" });
    const different = member({ birthDate: "2011-01-01", guardianEmails: ["parent@example.test"] });
    expect(only([entry()], [different])[0]).toMatchObject({ outcome: "MATCHED", via: "PARENT_EMAIL" });
  });

  it("is case, spacing and accent insensitive on names", () => {
    expect(only([entry({ firstName: "  RILEY ", lastName: "sämple" })], [member()])[0]!.outcome).toBe("MATCHED");
  });

  it("needs a check when only the name agrees: a name alone never matches", () => {
    expect(only([entry({ birthDate: null, guardianEmail: "" })], [member({ birthDate: null })])[0]).toMatchObject({ outcome: "NEEDS_CHECK", reason: "NOT_CONFIRMED", memberId: null });
    expect(only([entry()], [member({ birthDate: "2011-01-01" })])[0]).toMatchObject({ outcome: "NEEDS_CHECK", reason: "BIRTH_DATE_DIFFERS" });
  });

  it("needs a check when two members fit, and picks the one a birth date confirms when only one does", () => {
    const twins = [member({ id: "m1" }), member({ id: "m2" })];
    expect(only([entry()], twins)[0]).toMatchObject({ outcome: "NEEDS_CHECK", reason: "SEVERAL_MEMBERS" });
    expect(only([entry()], [member({ id: "m1" }), member({ id: "m2", birthDate: "2010-01-01" })])[0]).toMatchObject({ outcome: "MATCHED", memberId: "m1" });
    expect(only([entry({ birthDate: null })], [member({ id: "m1", birthDate: null }), member({ id: "m2", birthDate: null })])[0]).toMatchObject({ outcome: "NEEDS_CHECK", reason: "SEVERAL_MEMBERS" });
  });

  it("does not match a parent email shared with a sibling who has a different name", () => {
    const sibling = member({ firstName: "Jordan", birthDate: null, guardianEmails: ["parent@example.test"] });
    expect(only([entry({ birthDate: null })], [sibling])[0]).toMatchObject({ outcome: "UNMATCHED", reason: "MEMBER_NOT_FOUND" });
  });

  it("does not look in another club", () => {
    expect(only([entry()], [member({ organizationId: "club-b" })])[0]).toMatchObject({ outcome: "UNMATCHED", reason: "MEMBER_NOT_FOUND" });
  });

  it("lists an entry whose club is unknown as not matched, and an ambiguous club as needing a check", () => {
    expect(only([entry({ clubText: "Nowhere Fellowship" })], [member()])[0]).toMatchObject({ outcome: "UNMATCHED", reason: "CLUB_NOT_FOUND" });
    expect(only([entry({ clubText: "Twin SDA Church" })], [member()])[0]).toMatchObject({ outcome: "NEEDS_CHECK", reason: "CLUB_AMBIGUOUS" });
    expect(only([entry({ clubText: "" })], [member()])[0]).toMatchObject({ outcome: "UNMATCHED", reason: "CLUB_NOT_FOUND" });
  });

  it("finds the club by the sponsoring church name or a church-and-club name", () => {
    expect(clubsForText("Sample Valley SDA Church", clubs).map((club) => club.organizationId)).toEqual(["club-b"]);
    expect(clubsForText("Sample Valley SDA Church Pathfinder Club", clubs).map((club) => club.organizationId)).toEqual(["club-b"]);
    expect(clubsForText("example pathfinders", clubs).map((club) => club.organizationId)).toEqual(["club-a"]);
    expect(clubNameStem("Albany SDA Church Pathfinders")).toBe("albany");
  });

  it("never imports an incomplete form", () => {
    expect(only([entry({ incomplete: true })], [member()])[0]).toMatchObject({ outcome: "INCOMPLETE", memberId: null });
  });
});

describe("what happens to a member who already has a record or appears twice", () => {
  it("skips a member who already has a record", () => {
    expect(only([entry()], [member({ hasRecord: true })])[0]).toMatchObject({ outcome: "ALREADY_HAS_RECORD", memberId: "m1" });
  });

  it("uses only the latest entry for one member and marks the other superseded", () => {
    const matches = only([entry({ sourceId: "old", submittedAt: "2026-08-01" }), entry({ sourceId: "new", submittedAt: "2026-09-01" })], [member()]);
    expect(matches.map((match) => match.outcome)).toEqual(["SUPERSEDED", "MATCHED"]);
    const tie = only([entry({ sourceId: "first" }), entry({ sourceId: "second" })], [member()]);
    expect(tie.map((match) => match.outcome)).toEqual(["SUPERSEDED", "MATCHED"]);
  });

  it("counts outcomes", () => {
    const counts = countOutcomes(only([entry({ sourceId: "a" }), entry({ sourceId: "b", clubText: "Nowhere" })], [member()]));
    expect(counts).toMatchObject({ MATCHED: 1, UNMATCHED: 1, NEEDS_CHECK: 0 });
  });
});
