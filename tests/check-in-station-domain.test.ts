import { describe, expect, it } from "vitest";
import {
  classifyStationEntry,
  parseDollarsToCents,
  shouldTouchStation,
  stationCapabilities,
  stationCookieOptions,
  stationInvalidReason,
  stationPaymentSchema,
  stationPaymentSummary,
  stationStartProblem,
  type StationRecordState,
} from "@/modules/checkin-stations/domain";

const now = new Date("2026-10-27T15:00:00.000Z");
const event = {
  startsAt: new Date("2026-10-30T14:00:00.000Z"),
  endsAt: new Date("2026-11-01T18:00:00.000Z"),
};

function station(overrides: Partial<StationRecordState> = {}): StationRecordState {
  return {
    expiresAt: event.endsAt,
    revokedAt: null,
    stoppedAt: null,
    starter: { accountStatus: "ACTIVE", hasCredential: true, credentialDisabledAt: null },
    ...overrides,
  };
}

describe("check-in station start window (#892)", () => {
  it("opens two days before the event starts", () => {
    expect(stationStartProblem(event, new Date("2026-10-28T13:59:59.000Z"))).toBe("TOO_EARLY");
    expect(stationStartProblem(event, new Date("2026-10-28T14:00:00.000Z"))).toBeNull();
  });
  it("stays open until the event ends, then closes", () => {
    expect(stationStartProblem(event, new Date("2026-11-01T17:59:59.000Z"))).toBeNull();
    expect(stationStartProblem(event, event.endsAt)).toBe("EVENT_ENDED");
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
  it("requires a check number for a check but not for cash", () => {
    const base = { registrationId: "registration_1", amountCents: 2500 };
    expect(stationPaymentSchema.safeParse({ ...base, method: "CHECK", checkNumber: "" }).success).toBe(false);
    expect(stationPaymentSchema.safeParse({ ...base, method: "CHECK" }).success).toBe(false);
    expect(stationPaymentSchema.safeParse({ ...base, method: "CHECK", checkNumber: "1042" }).success).toBe(true);
    expect(stationPaymentSchema.safeParse({ ...base, method: "CASH" }).success).toBe(true);
    expect(stationPaymentSchema.safeParse({ ...base, method: "MANUAL" }).success).toBe(false);
  });
});
