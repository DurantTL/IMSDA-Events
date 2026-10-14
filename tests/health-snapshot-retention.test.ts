import { describe, expect, it } from "vitest";
import {
  HEALTH_SNAPSHOT_BREAK_GLASS_HOURS,
  HEALTH_SNAPSHOT_RETENTION,
  addYearsToCalendarDate,
  computeSnapshotExpiry,
  snapshotExpired,
} from "@/modules/health-records/snapshot-retention";

/**
 * Retention for a sealed per-event health copy (#924, ADR 0005 Addendum B). Synthetic dates only.
 */

const event = { eventStartDate: "2027-03-12", eventEndDate: "2027-03-14" };

describe("computeSnapshotExpiry", () => {
  it("keeps a minor's copy until their 26th birthday", () => {
    const result = computeSnapshotExpiry({ ...event, birthDate: "2012-08-20", reportedAge: null, attendeeType: "YOUTH" });
    expect(result).toMatchObject({ ageBasis: "MINOR", expiresOn: "2038-08-20" });
    expect(result.expiresAt.toISOString()).toBe("2038-08-20T00:00:00.000Z");
  });

  it("treats someone who turns 18 the day after the event started as still a minor, and someone who turned 18 that day as an adult", () => {
    expect(computeSnapshotExpiry({ ...event, birthDate: "2009-03-13", reportedAge: null, attendeeType: "YOUTH" })).toMatchObject({ ageBasis: "MINOR", expiresOn: "2035-03-13" });
    expect(computeSnapshotExpiry({ ...event, birthDate: "2009-03-12", reportedAge: null, attendeeType: "YOUTH" })).toMatchObject({ ageBasis: "ADULT", expiresOn: "2032-03-14" });
  });

  it("keeps an adult's copy 5 years after the event's last day", () => {
    expect(computeSnapshotExpiry({ ...event, birthDate: "1985-01-02", reportedAge: null, attendeeType: "STAFF" })).toMatchObject({
      ageBasis: "ADULT",
      expiresOn: "2032-03-14",
    });
  });

  it("with no birth date, takes the longer of 5 years after the event and the 26th birthday on the latest plausible reading", () => {
    // Reported age wins: 12 on the first day, so at the latest born 2015-03-12 and 26 on 2041-03-12.
    expect(computeSnapshotExpiry({ ...event, birthDate: null, reportedAge: 12, attendeeType: "YOUTH" })).toMatchObject({ ageBasis: "UNKNOWN", expiresOn: "2041-03-12" });
    // No age, so the youngest age for the member type: a youth is at least 4 (latest birth 2023-03-12, 26 in 2049).
    expect(computeSnapshotExpiry({ ...event, birthDate: null, reportedAge: null, attendeeType: "YOUTH" })).toMatchObject({ expiresOn: "2049-03-12" });
    // An adult with no birth date is at least 18: 26th birthday 8 years on, longer than 5 years.
    expect(computeSnapshotExpiry({ ...event, birthDate: null, reportedAge: null, attendeeType: "ADULT" })).toMatchObject({ ageBasis: "UNKNOWN", expiresOn: "2035-03-12" });
    // Nothing known at all: the longest reading (age 0).
    expect(computeSnapshotExpiry({ ...event, birthDate: null, reportedAge: null, attendeeType: null })).toMatchObject({ expiresOn: "2053-03-12" });
  });

  it("never keeps a copy for less than 5 years after the event, whatever the age reading", () => {
    const result = computeSnapshotExpiry({ ...event, birthDate: null, reportedAge: 40, attendeeType: "ADULT" });
    expect(result.expiresOn >= "2032-03-14").toBe(true);
  });

  it("treats a birth date after the event, or an impossible one, as unknown", () => {
    expect(computeSnapshotExpiry({ ...event, birthDate: "2030-01-01", reportedAge: null, attendeeType: "ADULT" }).ageBasis).toBe("UNKNOWN");
    expect(computeSnapshotExpiry({ ...event, birthDate: "1850-01-01", reportedAge: null, attendeeType: "ADULT" }).ageBasis).toBe("UNKNOWN");
    expect(computeSnapshotExpiry({ ...event, birthDate: "not-a-date", reportedAge: null, attendeeType: "ADULT" }).ageBasis).toBe("UNKNOWN");
  });

  it("lands a Feb 29 birthday on Mar 1 in a year without one", () => {
    expect(addYearsToCalendarDate("2012-02-29", 26)).toBe("2038-03-01");
    expect(addYearsToCalendarDate("2012-02-29", 28)).toBe("2040-02-29");
  });

  it("is driven by constants counsel can change", () => {
    expect(HEALTH_SNAPSHOT_RETENTION).toMatchObject({ minorUnderAge: 18, minorKeepUntilAge: 26, adultYearsAfterEvent: 5, incidentReportMinorKeepUntilAge: 31, nightlyBackupsKept: 30 });
    expect(HEALTH_SNAPSHOT_BREAK_GLASS_HOURS).toBe(24);
  });
});

describe("snapshotExpired", () => {
  it("expires from the start of the keep-until day", () => {
    const expiresAt = new Date("2032-03-14T00:00:00.000Z");
    expect(snapshotExpired(expiresAt, new Date("2032-03-13T23:59:59.000Z"))).toBe(false);
    expect(snapshotExpired(expiresAt, new Date("2032-03-14T00:00:00.000Z"))).toBe(true);
  });
});
