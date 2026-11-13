import { describe, expect, it } from "vitest";
import {
  CLUB_OPTIONAL_FEATURE_KEYS,
  canSeeRosterHealth,
  canSwitchClubFeatures,
  isClubOptionalFeatureKey,
  isClubRosterEdit,
  lastMeaningfulUpdate,
  outdatedBefore,
  rosterHealthCounts,
  rosterHealthFlags,
  rosterHealthFlagLabels,
  type RosterHealthInput,
} from "@/modules/club-features/domain";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";

/** Roster health flags (#1709): the pure rules. Synthetic data only. */

const now = new Date("2026-11-08T12:00:00.000Z");
const fresh = new Date("2026-06-01T12:00:00.000Z");
const complete: RosterHealthInput = {
  attendeeType: "YOUTH",
  lastUpdated: fresh,
  hasEmergencyContact: true,
  hasHealthRecord: true,
  hasPhotoRelease: true,
  noSterlingCheck: null,
};

describe("optional club feature keys", () => {
  it("lists the optional features and accepts nothing else", () => {
    expect([...CLUB_OPTIONAL_FEATURE_KEYS]).toEqual(["roster-health-flags", "staff-training-records", "master-guide-tracking", "fill-in-letters", "completion-certificates"]);
    expect(isClubOptionalFeatureKey("roster-health-flags")).toBe(true);
    expect(isClubOptionalFeatureKey("anything-else")).toBe(false);
    expect(isClubOptionalFeatureKey(undefined)).toBe(false);
  });
});

describe("who may switch and see it", () => {
  it("lets the director and deputy switch and see; a registrar and a reporter do neither", () => {
    for (const role of ["DIRECTOR", "DEPUTY"] as const) {
      expect(canSwitchClubFeatures(clubCapabilities(role)), role).toBe(true);
      expect(canSeeRosterHealth(clubCapabilities(role)), role).toBe(true);
    }
    for (const role of ["REGISTRAR", "REPORTER"] as const) {
      expect(canSwitchClubFeatures(clubCapabilities(role)), role).toBe(false);
      expect(canSeeRosterHealth(clubCapabilities(role)), role).toBe(false);
    }
  });

  it("needs all three capabilities it draws on, so it never shows more than those pages do", () => {
    const leader = clubCapabilities("DIRECTOR");
    expect(canSeeRosterHealth({ ...leader, guardians: false })).toBe(false);
    expect(canSeeRosterHealth({ ...leader, seeBirthDates: false })).toBe(false);
    expect(canSeeRosterHealth({ ...leader, editProfile: false })).toBe(false);
  });
});

describe("rosterHealthFlags", () => {
  it("flags nothing for a complete, recent youth record", () => {
    expect(rosterHealthFlags(complete, now)).toEqual([]);
  });

  it("flags a record not updated in over a year, and not one updated exactly a year ago or later", () => {
    const cutoff = outdatedBefore(now);
    expect(cutoff.toISOString()).toBe("2025-11-08T12:00:00.000Z");
    expect(rosterHealthFlags({ ...complete, lastUpdated: new Date(cutoff.getTime() - 1) }, now)).toEqual(["OUTDATED"]);
    expect(rosterHealthFlags({ ...complete, lastUpdated: cutoff }, now)).toEqual([]);
    expect(rosterHealthFlags({ ...complete, lastUpdated: null }, now)).toEqual([]);
  });

  it("flags a missing emergency contact", () => {
    expect(rosterHealthFlags({ ...complete, hasEmergencyContact: false }, now)).toEqual(["NO_EMERGENCY_CONTACT"]);
  });

  it("flags a missing health record, but not when health records are not checked", () => {
    expect(rosterHealthFlags({ ...complete, hasHealthRecord: false }, now)).toEqual(["NO_HEALTH_RECORD"]);
    expect(rosterHealthFlags({ ...complete, hasHealthRecord: null }, now)).toEqual([]);
  });

  it("flags a missing photo release for a minor only, and not when the form is not checked", () => {
    expect(rosterHealthFlags({ ...complete, hasPhotoRelease: false }, now)).toEqual(["NO_PHOTO_RELEASE"]);
    expect(rosterHealthFlags({ ...complete, attendeeType: "UNDERAGE", hasPhotoRelease: false }, now)).toEqual(["NO_PHOTO_RELEASE"]);
    expect(rosterHealthFlags({ ...complete, attendeeType: "STAFF", hasPhotoRelease: false }, now)).toEqual([]);
    expect(rosterHealthFlags({ ...complete, attendeeType: "ADULT", hasPhotoRelease: false }, now)).toEqual([]);
    expect(rosterHealthFlags({ ...complete, hasPhotoRelease: null }, now)).toEqual([]);
  });

  it("flags a missing Sterling check for staff and adults only", () => {
    expect(rosterHealthFlags({ ...complete, attendeeType: "STAFF", noSterlingCheck: true }, now)).toEqual(["NO_STERLING_CHECK"]);
    expect(rosterHealthFlags({ ...complete, attendeeType: "ADULT", noSterlingCheck: true }, now)).toEqual(["NO_STERLING_CHECK"]);
    expect(rosterHealthFlags({ ...complete, attendeeType: "STAFF", noSterlingCheck: false }, now)).toEqual([]);
    expect(rosterHealthFlags({ ...complete, attendeeType: "YOUTH", noSterlingCheck: true }, now)).toEqual([]);
  });

  it("lists every flag in a fixed order", () => {
    const flags = rosterHealthFlags({ attendeeType: "YOUTH", lastUpdated: new Date("2020-01-01T00:00:00Z"), hasEmergencyContact: false, hasHealthRecord: false, hasPhotoRelease: false, noSterlingCheck: null }, now);
    expect(flags).toEqual(["OUTDATED", "NO_EMERGENCY_CONTACT", "NO_HEALTH_RECORD", "NO_PHOTO_RELEASE"]);
    expect(flags.map((flag) => rosterHealthFlagLabels[flag])).toEqual([
      "Not updated in over a year", "No emergency contact", "No health record", "No photo release",
    ]);
  });
});

describe("lastMeaningfulUpdate", () => {
  const at = (iso: string) => new Date(iso);

  it("is the latest save by the club, across every year's row", () => {
    expect(lastMeaningfulUpdate([at("2024-09-10T10:00:00Z")], [at("2025-02-01T10:00:00Z"), at("2026-03-01T10:00:00Z")])?.toISOString()).toBe("2026-03-01T10:00:00.000Z");
  });

  it("falls back to the earliest row's creation date when nobody has saved the person since", () => {
    expect(lastMeaningfulUpdate([at("2025-08-20T10:00:00Z"), at("2024-09-10T10:00:00Z")], [])?.toISOString()).toBe("2024-09-10T10:00:00.000Z");
  });

  it("is null with nothing to go on", () => {
    expect(lastMeaningfulUpdate([], [])).toBeNull();
  });
});

describe("isClubRosterEdit", () => {
  it("counts a person added or saved by the club", () => {
    expect(isClubRosterEdit({ action: "CLUB_ROSTER_MEMBER_ADDED", metadata: { source: "DIRECTOR" } })).toBe(true);
    expect(isClubRosterEdit({ action: "CLUB_ROSTER_MEMBER_UPDATED", metadata: { fields: ["firstName"] } })).toBe(true);
    expect(isClubRosterEdit({ action: "CLUB_ROSTER_MEMBER_UPDATED" })).toBe(true);
  });

  it("does not count a status flip, a carry-forward, an import's year move, a removal or a registration filling in a reported age", () => {
    for (const action of ["CLUB_ROSTER_MEMBER_DEACTIVATED", "CLUB_ROSTER_MEMBER_REACTIVATED", "CLUB_ROSTER_CARRIED_FORWARD", "CLUB_IMPORT_YEAR_MOVED", "CLUB_ROSTER_MEMBER_REMOVED"]) {
      expect(isClubRosterEdit({ action }), action).toBe(false);
    }
    expect(isClubRosterEdit({ action: "CLUB_ROSTER_MEMBER_UPDATED", metadata: { source: "CLUB_REGISTRATION", fields: ["reportedAge"] } })).toBe(false);
  });
});

describe("rosterHealthCounts", () => {
  it("counts the people checked, the people flagged, and each kind", () => {
    const counts = rosterHealthCounts([
      { flags: [] },
      { flags: ["OUTDATED", "NO_HEALTH_RECORD"] },
      { flags: ["NO_HEALTH_RECORD"] },
    ]);
    expect(counts).toEqual({
      people: 3,
      flagged: 2,
      byFlag: { OUTDATED: 1, NO_EMERGENCY_CONTACT: 0, NO_HEALTH_RECORD: 2, NO_PHOTO_RELEASE: 0, NO_STERLING_CHECK: 0 },
    });
  });
});
