import { describe, expect, it } from "vitest";
import {
  HEALTH_SNAPSHOT_BREAK_GLASS_HOURS,
  HEALTH_SNAPSHOT_GRACE_DAYS,
  HEALTH_SNAPSHOT_RETENTION,
  addYearsToCalendarDate,
  computeSnapshotExpiry,
  reportedAgeAtEvent,
  snapshotDeleteFrom,
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
    // 2038-08-20 is the keep-until day; the copy is deletable from the start of the day after it, plus 90 days, in Central time (November is CST, UTC-6).
    expect(result.expiresAt.toISOString()).toBe("2038-11-19T06:00:00.000Z");
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
    expect(HEALTH_SNAPSHOT_GRACE_DAYS).toBe(90);
    expect(HEALTH_SNAPSHOT_RETENTION).toMatchObject({ minorUnderAge: 18, minorKeepUntilAge: 26, adultYearsAfterEvent: 5, incidentReportMinorKeepUntilAge: 31, nightlyBackupsKept: 30 });
    expect(HEALTH_SNAPSHOT_BREAK_GLASS_HOURS).toBe(24);
  });
});

describe("snapshotDeleteFrom", () => {
  it("is the start of the day after the keep-until day in Central time, plus the grace days", () => {
    // Keep-until day 2032-03-14 + 1 + 90 days = 2032-06-13, local midnight in CDT (UTC-5).
    expect(snapshotDeleteFrom("2032-03-14").toISOString()).toBe("2032-06-13T05:00:00.000Z");
  });

  it("is not UTC midnight: the Central evening before is still inside the copy's life", () => {
    const at = snapshotDeleteFrom("2032-03-14");
    expect(at.getTime() % 86_400_000).not.toBe(0);
    // One second before Central midnight on the first deletable day it is kept; at Central midnight it is not.
    expect(snapshotExpired(at, new Date(at.getTime() - 1000))).toBe(false);
    expect(snapshotExpired(at, at)).toBe(true);
  });

  it("is exact at the Chicago midnight in both offsets", () => {
    // Zero grace days is not configurable here, so check through winter dates: keep-until 2031-09-01 + 91 days = 2031-12-01 (CST, UTC-6).
    expect(snapshotDeleteFrom("2031-09-01").toISOString()).toBe("2031-12-01T06:00:00.000Z");
    // Keep-until 2032-12-31 + 91 days = 2033-04-01 (CDT, UTC-5).
    expect(snapshotDeleteFrom("2032-12-31").toISOString()).toBe("2033-04-01T05:00:00.000Z");
  });

  it("counts grace in calendar days across a daylight saving change, so the local midnight never drifts", () => {
    // The 2033 spring change is Mar 13. Keep-until 2032-12-01 + 91 days = 2033-03-02 (CST); +91 from 2033-01-01 crosses it (to 2033-04-02, CDT).
    expect(snapshotDeleteFrom("2032-12-01").toISOString()).toBe("2033-03-02T06:00:00.000Z");
    expect(snapshotDeleteFrom("2033-01-01").toISOString()).toBe("2033-04-02T05:00:00.000Z");
    // The 2032 fall change is Nov 7: keep-until 2032-08-08 + 91 days = 2032-11-07, the 25-hour day, whose midnight is still CDT.
    expect(snapshotDeleteFrom("2032-08-08").toISOString()).toBe("2032-11-07T05:00:00.000Z");
    // The day after (Nov 8) is CST.
    expect(snapshotDeleteFrom("2032-08-09").toISOString()).toBe("2032-11-08T06:00:00.000Z");
  });

  it("handles a Feb 29 keep-until day", () => {
    // 2040-02-29 + 91 days = 2040-05-30.
    expect(snapshotDeleteFrom("2040-02-29").toISOString()).toBe("2040-05-30T05:00:00.000Z");
    // A Feb 29 birthday's 26th falls on Mar 1 in a year without one, and the copy is deletable 91 days after that.
    const result = computeSnapshotExpiry({ ...event, birthDate: "2012-02-29", reportedAge: null, attendeeType: "YOUTH" });
    expect(result.expiresOn).toBe("2038-03-01");
    expect(result.expiresAt.toISOString()).toBe("2038-05-31T05:00:00.000Z");
    // An adult event ending on Feb 29: five years on lands Mar 1, 2031.
    expect(computeSnapshotExpiry({ eventStartDate: "2028-02-27", eventEndDate: "2028-02-29", birthDate: "1985-01-02", reportedAge: null, attendeeType: "STAFF" }).expiresOn).toBe("2033-03-01");
  });
});

describe("snapshotExpired", () => {
  it("expires from the start of the deletable instant", () => {
    const expiresAt = new Date("2032-06-13T05:00:00.000Z");
    expect(snapshotExpired(expiresAt, new Date("2032-06-13T04:59:59.000Z"))).toBe(false);
    expect(snapshotExpired(expiresAt, new Date("2032-06-13T05:00:00.000Z"))).toBe(true);
  });
});

describe("reportedAgeAtEvent", () => {
  const rows = [
    { clubYear: "2027-28", reportedAge: 14 },
    { clubYear: "2026-27", reportedAge: 13 },
    { clubYear: "2024-25", reportedAge: 11 },
  ];
  it("takes the age from the row for the event's own club year", () => {
    expect(reportedAgeAtEvent(rows, "2026-27")).toBe(13);
  });
  it("with only a later year, subtracts the year gap", () => {
    expect(reportedAgeAtEvent([{ clubYear: "2028-29", reportedAge: 15 }], "2026-27")).toBe(13);
    expect(reportedAgeAtEvent([{ clubYear: "2028-29", reportedAge: 1 }], "2026-27")).toBe(0);
  });
  it("with only an earlier year, uses its age as reported, and takes the nearest", () => {
    expect(reportedAgeAtEvent(rows.filter((row) => row.clubYear === "2024-25"), "2026-27")).toBe(11);
  });
  it("skips a row with no age and returns null when none has one", () => {
    expect(reportedAgeAtEvent([{ clubYear: "2026-27", reportedAge: null }, { clubYear: "2027-28", reportedAge: 14 }], "2026-27")).toBe(13);
    expect(reportedAgeAtEvent([{ clubYear: "2026-27", reportedAge: null }], "2026-27")).toBeNull();
  });
});
