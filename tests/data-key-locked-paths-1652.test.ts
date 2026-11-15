import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerEnv: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  sealHealthSnapshot: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logger")>()),
  logWarn: mocks.logWarn,
  logInfo: mocks.logInfo,
  logError: mocks.logError,
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ registrationAttendee: { findFirst: mocks.findFirst } }) }));
vi.mock("@/modules/health-records/flag", () => ({ healthRecordsEnabled: () => true, requireHealthRecordsEnabled: () => undefined }));
vi.mock("@/modules/health-records/snapshot-repository", () => ({
  sealHealthSnapshot: mocks.sealHealthSnapshot,
  sealStartedEventSnapshots: vi.fn(),
  deleteExpiredHealthSnapshots: vi.fn(),
}));

import { resetDataKeyringForTests, setDataKeyStateForTests } from "@/lib/data-key/keyring";
import { DataKeyUnavailableError } from "@/lib/secret-box";
import { clubFormApiError } from "@/modules/club-forms/api-errors";
import { ClubFormError } from "@/modules/club-forms/errors";
import { requireSensitiveSealing, openSensitiveAnswers, sealSensitiveAnswers } from "@/modules/club-forms/sealed-answers";
import { rosterApiError } from "@/modules/club-rosters/api-errors";
import {
  isBirthDateLocked,
  openBirthDateOrLocked,
  openBirthDateOrNull,
  sealBirthDate,
} from "@/modules/club-rosters/birth-dates";
import { healthApiError } from "@/modules/health-records/api";
import { openHealthField, openSnapshotField, sealHealthField, sealSnapshotField } from "@/modules/health-records/crypto";
import { HealthRecordError } from "@/modules/health-records/errors";
import { sealHealthSnapshotAfterCheckIn } from "@/modules/health-records/snapshot-hooks";

const signInKey = "synthetic-sign-in-key-0123456789-abcdefghijklm";
const ring = { current: { version: 1, ikm: Buffer.alloc(32, 41) } };

function ready() {
  setDataKeyStateForTests({ kind: "ready", ring });
}
function locked() {
  setDataKeyStateForTests({ kind: "unavailable", reason: "vault-unreachable" });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDataKeyringForTests();
  mocks.getServerEnv.mockReturnValue({ SECRET_ENCRYPTION_KEY: signInKey, SECRET_ENCRYPTION_KEY_VERSION: 1 });
});

describe("birth dates while the personal-data key is unavailable (#1652)", () => {
  it("reads as locked, behaves like an unknown date, and never throws", () => {
    ready();
    const sealed = sealBirthDate("2012-05-17");
    expect(sealed.startsWith("d1.")).toBe(true);
    expect(openBirthDateOrLocked(sealed)).toEqual({ locked: false, birthDate: "2012-05-17" });
    expect(openBirthDateOrNull(sealed)).toBe("2012-05-17");
    locked();
    expect(openBirthDateOrLocked(sealed)).toEqual({ locked: true });
    expect(openBirthDateOrNull(sealed)).toBeNull();
    expect(isBirthDateLocked(sealed)).toBe(true);
    expect(openBirthDateOrNull(null)).toBeNull();
    expect(isBirthDateLocked(null)).toBe(false);
  });

  it("refuses to seal a new birth date, and reports a value that is simply damaged as a real error", () => {
    locked();
    expect(() => sealBirthDate("2012-05-17")).toThrow(DataKeyUnavailableError);
    ready();
    expect(() => openBirthDateOrLocked("not-a-sealed-value")).toThrow();
  });

  it("still reads a birth date that was not moved yet, with the sign-in key", async () => {
    setDataKeyStateForTests("not-separate");
    const { sealSecret } = await import("@/lib/secret-box");
    const old = sealSecret("2010-01-02", "club-roster:birth-date");
    locked();
    expect(openBirthDateOrNull(old)).toBe("2010-01-02");
  });
});

describe("API answers while the key is unavailable (#1652)", () => {
  it("health routes answer 503 DATA_KEY_UNAVAILABLE before the generic encryption answer", async () => {
    const response = healthApiError(new DataKeyUnavailableError(), "Reading a health record");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("DATA_KEY_UNAVAILABLE");
    expect(body.message).toMatch(/locked right now/);
    const generic = healthApiError(new (class extends Error { name = "SecretBoxError"; })(), "x");
    expect(generic.status).toBe(500);
  });

  it("club form routes answer 503 DATA_KEY_UNAVAILABLE", async () => {
    const response = clubFormApiError(new DataKeyUnavailableError(), "Saving a form");
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("DATA_KEY_UNAVAILABLE");
    const typed = clubFormApiError(new ClubFormError("DATA_KEY_UNAVAILABLE", "Locked."), "Saving a form");
    expect(typed.status).toBe(503);
  });

  it("roster routes answer 503 DATA_KEY_UNAVAILABLE when a birth date cannot be saved", async () => {
    const response = rosterApiError(new DataKeyUnavailableError(), "Adding a member");
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("DATA_KEY_UNAVAILABLE");
  });
});

describe("health fields and sealed form answers while the key is unavailable (#1652)", () => {
  it("a health field can be neither written nor read, and the error is not a 'check the key' failure", () => {
    ready();
    const sealed = sealHealthField("rec1", "allergies", "peanuts");
    const copy = sealSnapshotField("snap1", "allergies", "peanuts");
    locked();
    expect(() => sealHealthField("rec1", "allergies", "x")).toThrow(DataKeyUnavailableError);
    expect(() => openHealthField("rec1", "allergies", sealed)).toThrow(DataKeyUnavailableError);
    expect(() => openSnapshotField("snap1", "allergies", copy)).toThrow(DataKeyUnavailableError);
    ready();
    expect(openHealthField("rec1", "allergies", sealed)).toBe("peanuts");
    expect(() => openHealthField("rec1", "allergies", "garbage")).toThrow(HealthRecordError);
  });

  it("sensitive answers refuse to seal or open, and requireSensitiveSealing names the right problem", () => {
    ready();
    const sealed = sealSensitiveAnswers("sub1", { note: "synthetic" });
    expect(openSensitiveAnswers("sub1", sealed)).toEqual({ note: "synthetic" });
    expect(() => requireSensitiveSealing("not configured")).not.toThrow();
    locked();
    expect(() => sealSensitiveAnswers("sub1", { note: "x" })).toThrow(DataKeyUnavailableError);
    expect(() => openSensitiveAnswers("sub1", sealed)).toThrow(DataKeyUnavailableError);
    expect(() => requireSensitiveSealing("not configured")).toThrow(expect.objectContaining({ code: "DATA_KEY_UNAVAILABLE" }));
    setDataKeyStateForTests("not-separate");
    mocks.getServerEnv.mockReturnValue({});
    expect(() => requireSensitiveSealing("not configured")).toThrow(expect.objectContaining({ code: "ENCRYPTION_NOT_CONFIGURED", message: "not configured" }));
  });
});

describe("a check-in is never held up by the sealed health copy (#1652)", () => {
  it("logs one neutral warning and does not throw when the copy cannot be taken", async () => {
    mocks.findFirst.mockResolvedValue({ personId: "person-1" });
    mocks.sealHealthSnapshot.mockResolvedValue({ outcome: "DATA_KEY_UNAVAILABLE" });
    await expect(sealHealthSnapshotAfterCheckIn("event-1", "attendee-1")).resolves.toBeUndefined();
    expect(mocks.logWarn).toHaveBeenCalledTimes(1);
    const text = JSON.stringify(mocks.logWarn.mock.calls);
    expect(text).toContain("personal-data key is unavailable");
    expect(text).not.toMatch(/person-1|event-1|attendee-1/);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("does not throw when sealing fails outright either", async () => {
    mocks.findFirst.mockResolvedValue({ personId: "person-1" });
    mocks.sealHealthSnapshot.mockRejectedValue(new DataKeyUnavailableError());
    await expect(sealHealthSnapshotAfterCheckIn("event-1", "attendee-1")).resolves.toBeUndefined();
  });
});
