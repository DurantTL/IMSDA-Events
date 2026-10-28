import { describe, expect, it } from "vitest";
import {
  classifyStationEntry,
  parseDollarsToCents,
  shouldTouchStation,
  stationEndsAt,
  stationCapabilities,
  stationCookieOptions,
  stationInvalidReason,
  stationPaymentSchema,
  stationPaymentSummary,
  stationStartProblem,
  type StationRecordState,
} from "@/modules/checkin-stations/domain";

const now = new Date("2026-10-27T15:00:00.000Z");
// Event dates are stored as noon UTC of the calendar day (07:00 or 06:00 Central).
const event = {
  startsAt: new Date("2026-10-30T12:00:00.000Z"),
  endsAt: new Date("2026-11-01T12:00:00.000Z"),
  timezone: "America/Chicago",
};
const stationEnd = stationEndsAt(event);

function station(overrides: Partial<StationRecordState> = {}): StationRecordState {
  return {
    expiresAt: stationEnd,
    revokedAt: null,
    stoppedAt: null,
    starter: { accountStatus: "ACTIVE", hasCredential: true, credentialDisabledAt: null },
    ...overrides,
  };
}

describe("check-in station start window (#892)", () => {
  it("ends with the event's last calendar day in its own time zone, not at its noon-UTC date", () => {
    // Nov 1 2026 is the day daylight time ends; midnight Central is 06:00 UTC on Nov 2.
    expect(stationEnd.toISOString()).toBe("2026-11-02T06:00:00.000Z");
    expect(stationEndsAt({ endsAt: new Date("2026-07-10T12:00:00.000Z"), timezone: "America/Chicago" }).toISOString()).toBe("2026-07-11T05:00:00.000Z");
  });
  it("opens two days before the event starts", () => {
    expect(stationStartProblem(event, new Date("2026-10-28T11:59:59.000Z"))).toBe("TOO_EARLY");
    expect(stationStartProblem(event, new Date("2026-10-28T12:00:00.000Z"))).toBeNull();
  });
  it("lets a one-day event start at 8 AM Central and stay valid at 9 PM, but not the next morning", () => {
    const oneDay = { startsAt: new Date("2026-07-10T12:00:00.000Z"), endsAt: new Date("2026-07-10T12:00:00.000Z"), timezone: "America/Chicago" };
    expect(stationStartProblem(oneDay, new Date("2026-07-10T13:00:00.000Z"))).toBeNull(); // 8 AM CDT
    expect(stationStartProblem(oneDay, new Date("2026-07-11T02:00:00.000Z"))).toBeNull(); // 9 PM CDT, still the last day
    const record = station({ expiresAt: stationEndsAt(oneDay) });
    expect(stationInvalidReason(record, ["MANAGE_CHECK_IN"], new Date("2026-07-11T02:00:00.000Z"))).toBeNull();
    expect(stationInvalidReason(record, ["MANAGE_CHECK_IN"], new Date("2026-07-11T13:00:00.000Z"))).toBe("EXPIRED");
    expect(stationStartProblem(oneDay, new Date("2026-07-11T13:00:00.000Z"))).toBe("EVENT_ENDED");
  });
  it("expires a station once the event's current dates say it ended", () => {
    expect(stationInvalidReason(station({ eventEnded: true }), ["MANAGE_CHECK_IN"], now)).toBe("EXPIRED");
  });
});

describe("check-in station validity (#892)", () => {
  it("accepts an active station whose starter still has check-in access", () => {
    expect(stationInvalidReason(station(), ["VIEW_EVENT", "MANAGE_CHECK_IN"], now)).toBeNull();
  });
  it("rejects a revoked, stopped or expired station", () => {
    expect(stationInvalidReason(station({ revokedAt: now }), ["MANAGE_CHECK_IN"], now)).toBe("REVOKED");
    expect(stationInvalidReason(station({ stoppedAt: now }), ["MANAGE_CHECK_IN"], now)).toBe("STOPPED");
    expect(stationInvalidReason(station({ expiresAt: now }), ["MANAGE_CHECK_IN"], now)).toBe("EXPIRED");
  });
  it("rejects a station whose starter is disabled, has no credential or is not ACTIVE", () => {
    const starter = { accountStatus: "ACTIVE", hasCredential: true, credentialDisabledAt: null };
    expect(stationInvalidReason(station({ starter: { ...starter, credentialDisabledAt: now } }), ["MANAGE_CHECK_IN"], now)).toBe("STARTER_INACTIVE");
    expect(stationInvalidReason(station({ starter: { ...starter, hasCredential: false } }), ["MANAGE_CHECK_IN"], now)).toBe("STARTER_INACTIVE");
    expect(stationInvalidReason(station({ starter: { ...starter, accountStatus: "SUSPENDED" } }), ["MANAGE_CHECK_IN"], now)).toBe("STARTER_INACTIVE");
  });
  it("rejects a station once its starter lost MANAGE_CHECK_IN or the event", () => {
    expect(stationInvalidReason(station(), ["VIEW_EVENT"], now)).toBe("PERMISSION_LOST");
    expect(stationInvalidReason(station(), null, now)).toBe("PERMISSION_LOST");
  });
  it("has no idle timeout: a station untouched for a day is still valid", () => {
    expect(stationInvalidReason(station(), ["MANAGE_CHECK_IN"], new Date(now.getTime() + 24 * 60 * 60 * 1000))).toBeNull();
  });
  it("rewrites lastSeenAt at most once a minute", () => {
    expect(shouldTouchStation(new Date(now.getTime() - 59_000), now)).toBe(false);
    expect(shouldTouchStation(new Date(now.getTime() - 60_000), now)).toBe(true);
  });
});

describe("check-in station authority and cookie (#892)", () => {
  it("needs MANAGE_FINANCE as well to record cash or checks", () => {
    expect(stationCapabilities(["MANAGE_CHECK_IN"])).toEqual({ canCheckIn: true, canRecordPayments: false });
    expect(stationCapabilities(["MANAGE_CHECK_IN", "MANAGE_FINANCE"])).toEqual({ canCheckIn: true, canRecordPayments: true });
    expect(stationCapabilities(["MANAGE_FINANCE"])).toEqual({ canCheckIn: false, canRecordPayments: false });
  });
  it("sets an httpOnly strict cookie that lasts until the event ends", () => {
    const options = stationCookieOptions(event.endsAt, now, true);
    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: "strict", path: "/", expires: event.endsAt });
    expect(options.maxAge).toBe(Math.floor((event.endsAt.getTime() - now.getTime()) / 1000));
  });
});

describe("check-in station entry and money helpers (#892)", () => {
  it("tells a QR pass from a confirmation code", () => {
    expect(classifyStationEntry("  wr26-abc1 ")).toEqual({ kind: "confirmation", value: "wr26-abc1" });
    expect(classifyStationEntry("imsda-pass.v1.AAAA.BBBB.CCCC")?.kind).toBe("pass");
    expect(classifyStationEntry("   ")).toBeNull();
  });
  it("parses dollars into cents strictly", () => {
    expect(parseDollarsToCents("25")).toBe(2500);
    expect(parseDollarsToCents("$12.5")).toBe(1250);
    expect(parseDollarsToCents("0")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
    expect(parseDollarsToCents("1.234")).toBeNull();
    expect(parseDollarsToCents("ten")).toBeNull();
  });
  it("summarizes Paid, Balance due and church-billed registrations", () => {
    expect(stationPaymentSummary({ balanceCents: 0, isDeferredOrganizationBilling: false, squareAppNote: null })).toEqual({ state: "PAID" });
    expect(stationPaymentSummary({ balanceCents: 5000, isDeferredOrganizationBilling: true, squareAppNote: null })).toEqual({ state: "BILLED_TO_GROUP" });
    expect(stationPaymentSummary({ balanceCents: 5000, isDeferredOrganizationBilling: false, squareAppNote: null })).toEqual({ state: "DUE", balanceCents: 5000, squareAppNote: null });
  });
  it("requires a payment key", () => {
    expect(stationPaymentSchema.safeParse({ registrationId: "r1", amountCents: 100, method: "CASH" }).success).toBe(false);
  });
  it("requires a check number for a check but not for cash", () => {
    const base = { registrationId: "registration_1", amountCents: 2500 };
    const key = { idempotencyKey: "d67776d0-f79d-4e8f-bec2-ee61abb7337c" };
    expect(stationPaymentSchema.safeParse({ ...base, ...key, method: "CHECK", checkNumber: "" }).success).toBe(false);
    expect(stationPaymentSchema.safeParse({ ...base, method: "CHECK" }).success).toBe(false);
    expect(stationPaymentSchema.safeParse({ ...base, ...key, method: "CHECK", checkNumber: "1042" }).success).toBe(true);
    expect(stationPaymentSchema.safeParse({ ...base, ...key, method: "CASH" }).success).toBe(true);
    expect(stationPaymentSchema.safeParse({ ...base, ...key, method: "MANUAL" }).success).toBe(false);
  });
});
